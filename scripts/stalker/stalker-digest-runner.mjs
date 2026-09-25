import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { access, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_DIAGNOSTIC_LINE_BYTES = 64 * 1024;
const EVENT_TYPES = new Set(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error']);
const ITEM_TYPES = new Set(['agent_message', 'reasoning', 'command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'todo_list', 'error']);

export async function resolveCodexProgram({ env = process.env, homeDir = homedir(), accessImpl = access } = {}) {
  if (env.CODEX_BIN) return env.CODEX_BIN;
  const canonical = join(homeDir, ".local/bin/codex");
  try {
    await accessImpl(canonical, constants.X_OK);
    return canonical;
  } catch {
    return "codex";
  }
}

function structuralCollector(stream) {
  const counts = Object.create(null);
  const itemTypes = Object.create(null);
  let bytes = 0;
  let lines = 0;
  let oversizedLines = 0;
  let invalidJsonLines = 0;
  let pending = Buffer.alloc(0);
  let discarding = false;
  const increment = (target, key) => { target[key] = (target[key] ?? 0) + 1; };
  const safeType = (value, allowed) => allowed.has(value) ? value : "unknown";
  const consume = (line) => {
    if (stream === "stdout") {
      try {
        const event = JSON.parse(line.toString("utf8"));
        increment(counts, safeType(event?.type, EVENT_TYPES));
        if (event?.item) increment(itemTypes, safeType(event.item.type, ITEM_TYPES));
      } catch {
        invalidJsonLines += 1;
      }
      return;
    }
    const text = line.toString("utf8");
    const kind = /(?:unauthorized|authentication|\b401\b|\b403\b)/i.test(text) ? "authentication"
      : /(?:rate.?limit|\b429\b)/i.test(text) ? "rate_limit"
        : /(?:ECONN|ENOTFOUND|network|connection)/i.test(text) ? "network"
          : /(?:timed? out|deadline)/i.test(text) ? "timeout"
            : /^(?:OpenAI Codex v|model:|provider:|sandbox:|approval:|reasoning effort:)/i.test(text) ? "startup"
              : "other";
    increment(counts, kind);
  };
  return {
    append(chunk) {
      const value = Buffer.from(chunk);
      bytes += value.length;
      let offset = 0;
      while (offset < value.length) {
        const newline = value.indexOf(10, offset);
        const end = newline === -1 ? value.length : newline;
        if (!discarding) {
          const available = MAX_DIAGNOSTIC_LINE_BYTES - pending.length;
          const take = Math.min(available, end - offset);
          if (take > 0) pending = Buffer.concat([pending, value.subarray(offset, offset + take)]);
          if (take < end - offset) {
            oversizedLines += 1;
            pending = Buffer.alloc(0);
            discarding = true;
          }
        }
        if (newline === -1) break;
        lines += 1;
        if (!discarding) consume(pending);
        pending = Buffer.alloc(0);
        discarding = false;
        offset = newline + 1;
      }
    },
    record(kind) { increment(counts, kind); },
    summary(metadata) {
      if (pending.length > 0 || discarding) {
        lines += 1;
        if (!discarding) consume(pending);
        pending = Buffer.alloc(0);
        discarding = false;
      }
      return `${JSON.stringify({
        format: "codex-structural-diagnostics-v1",
        stream,
        bytes,
        lines,
        oversizedLines,
        ...(stream === "stdout" ? { invalidJsonLines, eventTypes: counts, itemTypes } : { categories: counts }),
        execution: metadata,
      }, null, 2)}\n`;
    },
  };
}

export async function runDigestCodex({
  input,
  outputPath,
  schemaPath,
  cwd,
  model,
  reasoningEffort,
  timeoutMs,
  diagnosticLabel = "human-digest-codex",
  spawnImpl = spawn,
  killGraceMs = 5000,
  settleGraceMs = 2000,
}) {
  if (!/^[a-z0-9-]+$/.test(diagnosticLabel)) throw new Error("diagnosticLabel must be path-safe");
  const program = await resolveCodexProgram();
  const args = [
    "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check",
    "-C", cwd, "--output-schema", schemaPath, "--output-last-message", outputPath,
    "-m", model, "-c", `model_reasoning_effort=${reasoningEffort}`, "-",
  ];
  const diagnosticsDir = dirname(outputPath);
  const stdoutPath = join(diagnosticsDir, `${diagnosticLabel}.stdout.log`);
  const stderrPath = join(diagnosticsDir, `${diagnosticLabel}.stderr.log`);
  await Promise.all([rm(stdoutPath, { force: true }), rm(stderrPath, { force: true })]);
  const stdout = structuralCollector("stdout");
  const stderr = structuralCollector("stderr");
  let timedOut = false;
  const result = await new Promise((resolvePromise) => {
    const child = spawnImpl(program, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let settled = false;
    let forceKill;
    let postKillSettlement;
    child.stdout.on("data", (chunk) => stdout.append(chunk));
    child.stderr.on("data", (chunk) => stderr.append(chunk));
    child.stdin.on("error", () => stderr.record("stdin_write_failure"));
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => {
        child.kill("SIGKILL");
        postKillSettlement = setTimeout(() => {
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref?.();
          finish({ settlementFailure: true });
        }, settleGraceMs);
      }, killGraceMs);
    }, timeoutMs);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKill);
      clearTimeout(postKillSettlement);
      resolvePromise(value);
    };
    child.once("error", (error) => finish({ error }));
    child.once("close", (code) => finish({ code }));
    try {
      child.stdin.end(input);
    } catch {
      stderr.record("stdin_write_failure");
    }
  });
  const metadata = {
    stdinBytes: Buffer.byteLength(input),
    timeoutMs,
    timedOut,
    settlementFailure: Boolean(result.settlementFailure),
    exitCode: Number.isInteger(result.code) ? result.code : null,
  };
  const stdoutText = stdout.summary(metadata);
  const stderrText = stderr.summary(metadata);
  await Promise.all([writeFile(stdoutPath, stdoutText), writeFile(stderrPath, stderrText)]);
  const diagnostics = `diagnostics: stdout=${stdoutPath}; stderr=${stderrPath}`;
  if (result.settlementFailure) throw new Error(`codex exec timed out after ${timeoutMs}ms and did not settle after SIGKILL; ${diagnostics}`);
  if (timedOut) throw new Error(`codex exec timed out after ${timeoutMs}ms; ${diagnostics}`);
  if (result.error) throw new Error(`codex exec could not start: ${result.error.message}; ${diagnostics}`);
  if (result.code !== 0) throw new Error(`codex exec failed (${result.code}); ${diagnostics}`);
}

#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const MAX_CAPTURE_BYTES = 512 * 1024;
const USE_PROCESS_GROUP = process.platform !== "win32";

function usage() {
  process.stderr.write("usage: stop-telemetry.mjs <hook_name> -- <command> [args...]\n");
  process.exit(64);
}

function appendBounded(chunks, total, chunk) {
  if (total >= MAX_CAPTURE_BYTES) return total;
  const remaining = MAX_CAPTURE_BYTES - total;
  chunks.push(Buffer.from(chunk.subarray(0, remaining)));
  return total + Math.min(chunk.length, remaining);
}

function parsedJson(chunks) {
  try {
    const text = Buffer.concat(chunks).toString("utf8").trim();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function classifyDecision(output, { exitCode, timedOut, spawnError }) {
  if (spawnError || timedOut || exitCode !== 0 || !output || typeof output !== "object") return "error";
  if (output.decision === "block") return "block";
  if (typeof output.systemMessage === "string") {
    if (/\bskipp?ed\b/i.test(output.systemMessage)) return "skipped";
    if (/\berror\b/i.test(output.systemMessage)) return "error";
    return "advisory";
  }
  if (Object.keys(output).length === 0) return "allow";
  return "allow";
}

const separator = process.argv.indexOf("--");
if (separator < 3) usage();

const hookName = process.argv[2];
const command = process.argv[separator + 1];
const args = process.argv.slice(separator + 2);
if (!hookName || !command) usage();

const startedAtMs = Date.now();
const timeoutMs = Number(process.env.STOP_TELEMETRY_TIMEOUT_MS ?? 30000);
const logPath =
  process.env.STOP_TELEMETRY_LOG_PATH ??
  join(homedir(), ".claude", "hooks", "stop-decisions.jsonl");

let timedOut = false;
let spawnError = null;
let stdinBytes = 0;
let stdoutBytes = 0;
let receiptBytes = 0;
const stdoutChunks = [];
const receiptChunks = [];

const child = spawn(command, args, {
  env: { ...process.env, STOP_TELEMETRY_FD: "3" },
  detached: USE_PROCESS_GROUP,
  stdio: ["pipe", "pipe", "pipe", "pipe"],
});

process.stdin.on("data", (chunk) => {
  stdinBytes += chunk.length;
});
process.stdin.pipe(child.stdin);
child.stdin.on("error", (error) => {
  if (error.code !== "EPIPE") spawnError = error;
});

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  stdoutBytes = appendBounded(stdoutChunks, stdoutBytes, chunk);
});
child.stderr.pipe(process.stderr);
child.stdio[3].on("data", (chunk) => {
  receiptBytes = appendBounded(receiptChunks, receiptBytes, chunk);
});

const killTimer = setTimeout(() => {
  timedOut = true;
  if (USE_PROCESS_GROUP && Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to the direct child if the process group already disappeared.
    }
  }
  child.kill("SIGKILL");
}, timeoutMs);
killTimer.unref();

function writeTelemetry(exitCode, signal) {
  const endedAtMs = Date.now();
  const output = parsedJson(stdoutChunks);
  const receipt = parsedJson(receiptChunks);
  const decision = classifyDecision(output, { exitCode, timedOut, spawnError });
  const row = {
    schema: "golems.stop-decision.v1",
    hook: hookName,
    startedAtMs,
    endedAtMs,
    durationMs: endedAtMs - startedAtMs,
    decision,
    exitCode,
    signal: signal ?? null,
    timedOut,
    stdinBytes,
    transcriptBytesRead: Number(receipt?.transcriptBytesRead ?? 0),
    transcriptBytesTotal: Number(receipt?.transcriptBytesTotal ?? 0),
    transcriptTail: receipt?.transcriptTail === true,
    stateBytesRead: Number(receipt?.stateBytesRead ?? 0),
    stateFilesAttempted: Number(receipt?.stateFilesAttempted ?? 0),
    bytesRead: Number(receipt?.bytesRead ?? stdinBytes),
  };
  try {
    appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
  } catch {
    // Telemetry must never turn a hook failure into a different hook failure.
  }
}

child.on("error", (error) => {
  spawnError = error;
  clearTimeout(killTimer);
  writeTelemetry(127, null);
  process.exit(127);
});

child.on("close", (code, signal) => {
  clearTimeout(killTimer);
  const exitCode = timedOut ? 124 : code ?? 1;
  writeTelemetry(exitCode, signal);
  process.exitCode = exitCode;
});

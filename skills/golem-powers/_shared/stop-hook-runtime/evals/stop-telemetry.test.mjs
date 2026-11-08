import { afterEach, expect, test, setDefaultTimeout } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

import { materializeOversizeTranscript, readFixture } from "./helpers.mjs";
import { hookSpec } from "../../../../../scripts/hooks/install-hooks.mjs";

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(here, "..");
const powersRoot = path.resolve(runtimeRoot, "../..");
const telemetry = path.join(runtimeRoot, "stop-telemetry.mjs");
const falseGreenHook = path.join(
  powersRoot,
  "false-green-gate",
  "scripts",
  "false-green-gate-hook.mjs",
);
const fixtureRoot = path.join(here, "fixtures");
const scratch = [];

test("an async manifest row may finish after its harness timeout without being killed", () => {
  const manifest = JSON.parse(readFileSync(path.resolve(powersRoot, "../../scripts/hooks/manifest.json"), "utf8"));
  const row = Object.values(manifest.hosts).flat().find((row) => row.async && row.command?.includes("stop-telemetry.mjs"));
  expect(row).toBeDefined();
  const registered = hookSpec({ ...row, cmd: row.command });
  const budget = registered.command.match(/--timeout-ms (\d+)/);
  const root = mkdtempSync(path.join(tmpdir(), "stop-async-deadline-"));
  scratch.push(root);
  const logPath = path.join(root, "decisions.jsonl");
  const durationMs = row.timeout * 1000 + 500;
  const env = { ...process.env, STOP_TELEMETRY_LOG_PATH: logPath, DURATION_MS: String(durationMs) };
  delete env.STOP_TELEMETRY_TIMEOUT_MS;
  const result = spawnSync("node", [telemetry, row.id, ...(budget ? ["--timeout-ms", budget[1]] : []), "--", "node", "-e",
    'process.stdin.resume(); setTimeout(() => process.stdout.write("{}"), Number(process.env.DURATION_MS));'],
    { input: "{}", encoding: "utf8", env, timeout: durationMs + 5000 });
  expect(result.status, String(result.error ?? result.stderr)).toBe(0);
  const decision = JSON.parse(readFileSync(logPath, "utf8"));
  expect(decision.decision).toBe("allow");
  expect(decision.timedOut).toBe(false);
  expect(decision.durationMs).toBeGreaterThan(row.timeout * 1000);
  expect(budget?.[1]).toBe("30000");
});

test("sync row watchdogs and oversized overrides finish before their manifest harness timeout", () => {
  const manifest = JSON.parse(readFileSync(path.resolve(powersRoot, "../../scripts/hooks/manifest.json"), "utf8"));
  const rows = Object.values(manifest.hosts).flat().filter((row) => !row.async && row.command?.includes("stop-telemetry.mjs"));
  expect(rows.length).toBeGreaterThan(0);
  const root = mkdtempSync(path.join(tmpdir(), "stop-deadline-"));
  scratch.push(root);
  for (const row of rows) for (const override of [undefined, "30000"]) {
    const budget = hookSpec({ ...row, cmd: row.command }).command.match(/--timeout-ms (\d+)/)?.[1];
    expect(Number(budget)).toBeLessThan(row.timeout * 1000);
    const logPath = path.join(root, `decisions-${row.id}-${override}.jsonl`);
    const pidPath = path.join(root, "child.pid");
    const source = 'require("node:fs").writeFileSync(process.env.PID_PATH, String(process.pid)); setInterval(() => {}, 1000);';
    const env = { ...process.env, STOP_TELEMETRY_LOG_PATH: logPath, PID_PATH: pidPath };
    delete env.STOP_TELEMETRY_TIMEOUT_MS;
    if (override) env.STOP_TELEMETRY_TIMEOUT_MS = override;
    try {
      const result = spawnSync("node", [telemetry, row.id, "--timeout-ms", budget, "--", "node", "-e", source], { input: "{}", encoding: "utf8", env, timeout: row.timeout * 1000 - 200 });
      expect(result.status, String(result.error ?? result.stderr)).toBe(124);
      expect(JSON.parse(readFileSync(logPath, "utf8")).timedOut).toBe(true);
    } finally {
      try { process.kill(-Number(readFileSync(pidPath, "utf8")), "SIGKILL"); } catch {}
    }
  }
}, 30_000);

for (const [signal, exitCode] of [["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]]) {
  test(`outer ${signal} reaches the child group and reaps a resistant child`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), "stop-termination-"));
    scratch.push(root);
    const pidPath = path.join(root, "child.pid");
    const marker = path.join(root, "signal.txt");
    const descendant = `process.on(${JSON.stringify(signal)}, () => { require("node:fs").writeFileSync(process.env.MARKER, ${JSON.stringify(signal)}); process.exit(0); }); process.stdout.write("ready"); setInterval(() => {}, 1000);`;
    const source = `require("node:fs").writeFileSync(process.env.PID_PATH, String(process.pid)); process.on(${JSON.stringify(signal)}, () => {}); require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], {stdio: ["ignore", "inherit", "inherit"]}); setInterval(() => {}, 1000);`;
    const wrapper = spawn("node", [telemetry, "signal-hook", "--", "node", "-e", source], {
      env: { ...process.env, PID_PATH: pidPath, MARKER: marker, STOP_TELEMETRY_LOG_PATH: path.join(root, "decisions.jsonl") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const guard = setTimeout(() => wrapper.kill("SIGKILL"), 2000);
    try {
      await once(wrapper.stdout, "data");
      const closed = once(wrapper, "close");
      wrapper.kill(signal);
      expect((await closed)[0]).toBe(exitCode);
      expect(readFileSync(marker, "utf8")).toBe(signal);
      expect(() => process.kill(Number(readFileSync(pidPath, "utf8")), 0)).toThrow();
    } finally {
      clearTimeout(guard);
      wrapper.kill("SIGKILL");
      try { process.kill(-Number(readFileSync(pidPath, "utf8")), "SIGKILL"); } catch {}
    }
  });
}

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

function runTelemetry(logPath, payload) {
  return spawnSync(
    process.execPath,
    [telemetry, "false-green-gate", "--", process.execPath, falseGreenHook],
    {
      input: JSON.stringify({ hook_event_name: "Stop", ...payload }),
      encoding: "utf8",
      env: { ...process.env, STOP_TELEMETRY_LOG_PATH: logPath, GOLEMS_STOP_ADVISORY_RENDER: "1" },
    },
  );
}

function runSyntheticTelemetry(logPath, hookName, source, options = {}) {
  return spawnSync(
    process.execPath,
    [telemetry, hookName, "--", process.execPath, "--input-type=module", "-e", source],
    {
      input: "{}",
      encoding: "utf8",
      env: { ...process.env, STOP_TELEMETRY_LOG_PATH: logPath, ...options.env },
      timeout: options.timeout,
    },
  );
}

test("decision telemetry distinguishes a gate advisory from allow and records actual reader bytes", () => {
  const fixture = readFixture(path.join(fixtureRoot, "oversize-tail.json"));
  const root = mkdtempSync(path.join(tmpdir(), "stop-telemetry-"));
  scratch.push(root);
  const transcriptPath = path.join(root, "oversize.jsonl");
  const totalBytes = materializeOversizeTranscript(transcriptPath, fixture);
  const logPath = path.join(root, "decisions.jsonl");

  const flagged = runTelemetry(logPath, { transcript_path: transcriptPath });
  expect(flagged.status, flagged.stderr).toBe(0);
  expect(JSON.parse(flagged.stdout).systemMessage).toStartWith("FALSE-GREEN-GATE advisory");

  const allowed = runTelemetry(logPath, {
    transcript: { events: [{ role: "assistant", text: "Work is still in progress." }] },
  });
  expect(allowed.status, allowed.stderr).toBe(0);
  expect(JSON.parse(allowed.stdout)).toEqual({});

  const rows = readFileSync(logPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.decision)).toEqual(["advisory", "allow"]);
  expect(rows[0].schema).toBe("golems.stop-decision.v1");
  expect(rows[0].bytesRead).toBeGreaterThan(rows[0].stdinBytes);
  expect(rows[0].transcriptBytesTotal).toBe(totalBytes);
  expect(rows[0].transcriptBytesRead).toBeLessThan(totalBytes);
  expect(rows[1].transcriptBytesRead).toBe(0);
});

test("decision telemetry schema covers advisory, skipped, and error outcomes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "stop-telemetry-outcomes-"));
  scratch.push(root);
  const logPath = path.join(root, "decisions.jsonl");
  // Fixed hook source; the payload travels as data in the env, never as code.
  const outputAfterInput =
    'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(process.env.SYNTHETIC_HOOK_OUTPUT));';
  const withOutput = (payload) => ({ env: { SYNTHETIC_HOOK_OUTPUT: JSON.stringify(payload) } });

  const advisory = runSyntheticTelemetry(
    logPath,
    "advisory-hook",
    outputAfterInput,
    withOutput({ systemMessage: "operator attention requested" }),
  );
  expect(advisory.status, advisory.stderr).toBe(0);

  // GO-5 E2: a gate advisory quoting evidence like "error"/"skipped" is still an advisory.
  const gateAdvisory = runSyntheticTelemetry(
    logPath,
    "gate-advisory-hook",
    outputAfterInput,
    withOutput({ systemMessage: "FALSE-GREEN-GATE advisory: flagged (X). X: said the error was skipped" }),
  );
  expect(gateAdvisory.status, gateAdvisory.stderr).toBe(0);

  const blocked = runSyntheticTelemetry(
    logPath,
    "block-hook",
    outputAfterInput,
    withOutput({ decision: "block", reason: "synthetic" }),
  );
  expect(blocked.status, blocked.stderr).toBe(0);

  const skipped = runSyntheticTelemetry(
    logPath,
    "skipped-hook",
    outputAfterInput,
    withOutput({ systemMessage: "gate skipped: unsupported oversized input" }),
  );
  expect(skipped.status, skipped.stderr).toBe(0);

  const error = runSyntheticTelemetry(
    logPath,
    "error-hook",
    "process.stdin.resume(); process.stdin.on('end', () => process.exit(2));",
  );
  expect(error.status).toBe(2);

  const rows = readFileSync(logPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  expect(rows.map((row) => row.decision)).toEqual(["advisory", "advisory", "block", "skipped", "error"]);
  for (const row of rows) {
    expect(row.schema).toBe("golems.stop-decision.v1");
    expect(row.bytesRead).toBe(row.stdinBytes);
  }
});

test("decision telemetry records a real hook input failure as error rather than allow", () => {
  const root = mkdtempSync(path.join(tmpdir(), "stop-telemetry-input-error-"));
  scratch.push(root);
  const logPath = path.join(root, "decisions.jsonl");
  const missingTranscript = path.join(root, "missing.jsonl");

  const result = runTelemetry(logPath, { transcript_path: missingTranscript });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).systemMessage).toContain("error");

  const row = JSON.parse(readFileSync(logPath, "utf8").trim());
  expect(row.decision).toBe("error");
  expect(row.bytesRead).toBe(row.stdinBytes);
});

test("empty successful hook output allows while malformed output and failures remain errors", () => {
  const root = mkdtempSync(path.join(tmpdir(), "stop-telemetry-empty-output-"));
  scratch.push(root);
  const logPath = path.join(root, "decisions.jsonl");
  const cases = [
    { name: "empty", source: "void 0;", stdout: "", status: 0, decision: "allow" },
    { name: "whitespace", source: 'process.stdout.write(" \\n\\t ");', stdout: " \n\t ", status: 0, decision: "allow" },
    { name: "garbage", source: 'process.stdout.write("garbage");', stdout: "garbage", status: 0, decision: "error" },
    { name: "array", source: 'process.stdout.write("[]");', stdout: "[]", status: 0, decision: "error" },
    { name: "failed-empty", source: "process.exit(1);", stdout: "", status: 1, decision: "error" },
  ];

  for (const item of cases) {
    const result = runSyntheticTelemetry(logPath, item.name, item.source);
    expect(result.status, `${item.name}: ${result.stderr}`).toBe(item.status);
    expect(result.stdout).toBe(item.stdout);
  }

  const rows = readFileSync(logPath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
  expect(rows.map(({ hook, decision, exitCode }) => ({ hook, decision, exitCode }))).toEqual(
    cases.map(({ name, decision, status }) => ({ hook: name, decision, exitCode: status })),
  );
});

test("telemetry forwards a buffered hook decision completely before exiting", () => {
  const root = mkdtempSync(path.join(tmpdir(), "stop-telemetry-buffered-output-"));
  scratch.push(root);
  const logPath = path.join(root, "decisions.jsonl");
  const message = "x".repeat(256 * 1024);
  const source = 'process.stdout.write(JSON.stringify({ systemMessage: "x".repeat(256 * 1024) }));';

  const result = runSyntheticTelemetry(logPath, "large-advisory-hook", source);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).systemMessage).toBe(message);
  expect(JSON.parse(readFileSync(logPath, "utf8")).decision).toBe("advisory");
});

test("telemetry timeout terminates descendants that inherit the hook pipes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "stop-telemetry-process-group-"));
  scratch.push(root);
  const logPath = path.join(root, "decisions.jsonl");
  const source = [
    'import { spawn } from "node:child_process";',
    'const descendant = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"],',
    '  { stdio: ["ignore", "inherit", "inherit"] });',
    "descendant.unref();",
  ].join("\n");

  const result = runSyntheticTelemetry(logPath, "descendant-hook", source, {
    env: { STOP_TELEMETRY_TIMEOUT_MS: "100" },
    timeout: 2000,
  });

  expect(result.status, result.stderr).toBe(124);
  const row = JSON.parse(readFileSync(logPath, "utf8"));
  expect(row.decision).toBe("error");
  expect(row.timedOut).toBe(true);
});

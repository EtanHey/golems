import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { materializeOversizeTranscript, readFixture } from "./helpers.mjs";

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
      env: { ...process.env, STOP_TELEMETRY_LOG_PATH: logPath },
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

test("decision telemetry distinguishes block from allow and records actual reader bytes", () => {
  const fixture = readFixture(path.join(fixtureRoot, "oversize-tail.json"));
  const root = mkdtempSync(path.join(tmpdir(), "stop-telemetry-"));
  scratch.push(root);
  const transcriptPath = path.join(root, "oversize.jsonl");
  const totalBytes = materializeOversizeTranscript(transcriptPath, fixture);
  const logPath = path.join(root, "decisions.jsonl");

  const blocked = runTelemetry(logPath, { transcript_path: transcriptPath });
  expect(blocked.status, blocked.stderr).toBe(0);
  expect(JSON.parse(blocked.stdout).decision).toBe("block");

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
  expect(rows.map((row) => row.decision)).toEqual(["block", "allow"]);
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
  const outputAfterInput = (payload) =>
    `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(${JSON.stringify(JSON.stringify(payload))}));`;

  const advisory = runSyntheticTelemetry(
    logPath,
    "advisory-hook",
    outputAfterInput({ systemMessage: "operator attention requested" }),
  );
  expect(advisory.status, advisory.stderr).toBe(0);

  const skipped = runSyntheticTelemetry(
    logPath,
    "skipped-hook",
    outputAfterInput({ systemMessage: "gate skipped: unsupported oversized input" }),
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
  expect(rows.map((row) => row.decision)).toEqual(["advisory", "skipped", "error"]);
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

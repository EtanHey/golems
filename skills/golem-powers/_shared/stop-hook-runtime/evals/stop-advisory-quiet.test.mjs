import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { readFixture } from "./helpers.mjs";

// These tests spawn node; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

// Stop-advisory eval 2026-10-19: false-green 3/25 useful, fleet-wrap 0/25,
// 0/47 follow-ups responded. The two gates now log advisories instead of
// rendering them; GOLEMS_STOP_ADVISORY_RENDER=1 restores the systemMessage.
const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(here, "..");
const powersRoot = path.resolve(runtimeRoot, "../..");
const telemetry = path.join(runtimeRoot, "stop-telemetry.mjs");
const scratch = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

const GATES = [
  {
    gate: "false-green-gate",
    red: path.join(powersRoot, "false-green-gate", "evals", "scope", "fixtures", "red", "22-code-fix-checkmark-no-live-probe.json"),
    green: path.join(here, "fixtures", "fp7-review-summary-no-dashboard-claim.json"),
  },
  {
    gate: "fleet-wrap-gate",
    red: path.join(powersRoot, "fleet-wrap-gate", "evals", "fixtures", "red", "01-healthwatch-cron-left-armed.json"),
    green: path.join(powersRoot, "fleet-wrap-gate", "evals", "fixtures", "green", "02-mid-sprint-cron-armed-na.json"),
  },
];

function scratchDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "stop-advisory-quiet-"));
  scratch.push(dir);
  return dir;
}

function hookPath(gate) {
  return path.join(powersRoot, gate, "scripts", `${gate}-hook.mjs`);
}

function payloadFor(fixturePath) {
  return {
    ...readFixture(fixturePath),
    hook_event_name: "Stop",
    session_id: "sess-quiet-1",
    transcript_path: "/synthetic/sess-quiet-1.jsonl",
    cwd: "/synthetic/repo",
  };
}

function runHook(gate, payload, env = {}, options = {}) {
  const dir = scratchDir();
  const logPath = env.STOP_ADVISORY_LOG_PATH ?? path.join(dir, "stop-advisories.jsonl");
  const childEnv = {
    ...process.env,
    FLEET_WRAP_GATE_TASKS_DIR: dir,
    STOP_ADVISORY_LOG_PATH: logPath,
    ...env,
  };
  if (!("GOLEMS_STOP_ADVISORY_RENDER" in env)) delete childEnv.GOLEMS_STOP_ADVISORY_RENDER;
  const proc = spawnSync(process.execPath, [hookPath(gate)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: childEnv,
    timeout: options.timeout,
  });
  return { proc, logPath };
}

function logRows(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

for (const { gate, red, green } of GATES) {
  test(`${gate} flag is quiet by default: stdout {} and exactly one payload-preserving log line`, () => {
    const fixture = readFixture(red);
    const { proc, logPath } = runHook(gate, payloadFor(red));
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout).toBe("{}");

    const rows = logRows(logPath);
    expect(rows).toHaveLength(1);
    // The message quotes transcript evidence; the log is created owner-only.
    expect(statSync(logPath).mode & 0o777).toBe(0o600);
    const [row] = rows;
    expect(Object.keys(row).sort()).toEqual(
      ["codes", "cwd", "gate", "message", "schema", "session_id", "transcript_path", "ts"].sort(),
    );
    expect(row.schema).toBe("golems.stop-advisory.v1");
    expect(row.gate).toBe(gate);
    expect(Number.isNaN(Date.parse(row.ts))).toBe(false);
    expect(row.session_id).toBe("sess-quiet-1");
    expect(row.transcript_path).toBe("/synthetic/sess-quiet-1.jsonl");
    expect(row.cwd).toBe("/synthetic/repo");
    expect(row.codes).toContain(fixture.violation);
    expect(row.message).toStartWith(`${gate.toUpperCase()} advisory`);
    expect(row.message).toContain(fixture.violation);
  });

  test(`${gate} GOLEMS_STOP_ADVISORY_RENDER=1 restores the rendered systemMessage and writes no log`, () => {
    const quiet = runHook(gate, payloadFor(red));
    const [logged] = logRows(quiet.logPath);

    const rendered = runHook(gate, payloadFor(red), { GOLEMS_STOP_ADVISORY_RENDER: "1" });
    expect(rendered.proc.status, rendered.proc.stderr).toBe(0);
    expect(rendered.proc.stdout).toBe(JSON.stringify({ systemMessage: logged.message }));
    expect(logRows(rendered.logPath)).toHaveLength(0);
  });

  test(`${gate} non-flagging stop prints {} and writes no log line`, () => {
    const { proc, logPath } = runHook(gate, payloadFor(green));
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout).toBe("{}");
    expect(existsSync(logPath)).toBe(false);
  });

  test(`${gate} unwritable advisory log still prints {} and exits 0`, () => {
    const dir = scratchDir();
    const blocker = path.join(dir, "not-a-dir");
    writeFileSync(blocker, "file, not a directory\n");
    const { proc } = runHook(gate, payloadFor(red), {
      STOP_ADVISORY_LOG_PATH: path.join(blocker, "nested", "stop-advisories.jsonl"),
    });
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout).toBe("{}");
  });

  // r1 review: a FIFO with no reader blocks a plain append open, which hung Stop.
  // A bounded spawn turns a hang into a failure instead of a stuck suite.
  for (const shape of ["fifo", "symlink-to-fifo"]) {
    test(`${gate} ${shape} at the advisory log path prints {} and exits 0 without hanging`, () => {
      const dir = scratchDir();
      const fifo = path.join(dir, "advisories.fifo");
      expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
      let logPath = fifo;
      if (shape === "symlink-to-fifo") {
        logPath = path.join(dir, "stop-advisories.jsonl");
        symlinkSync(fifo, logPath);
      }
      const { proc } = runHook(gate, payloadFor(red), { STOP_ADVISORY_LOG_PATH: logPath }, { timeout: 3_000 });
      expect(proc.error).toBeUndefined();
      expect(proc.signal).toBeNull();
      expect(proc.status, proc.stderr).toBe(0);
      expect(proc.stdout).toBe("{}");
    });
  }

  test(`${gate} quiet advisory is still counted as an advisory in decision telemetry`, () => {
    const dir = scratchDir();
    const decisions = path.join(dir, "decisions.jsonl");
    const env = {
      ...process.env,
      FLEET_WRAP_GATE_TASKS_DIR: dir,
      STOP_ADVISORY_LOG_PATH: path.join(dir, "stop-advisories.jsonl"),
      STOP_TELEMETRY_LOG_PATH: decisions,
    };
    delete env.GOLEMS_STOP_ADVISORY_RENDER;
    const run = (fixturePath) => spawnSync(
      process.execPath,
      [telemetry, gate, "--", process.execPath, hookPath(gate)],
      { input: JSON.stringify(payloadFor(fixturePath)), encoding: "utf8", env },
    );
    for (const fixturePath of [red, green]) {
      const proc = run(fixturePath);
      expect(proc.status, proc.stderr).toBe(0);
      expect(proc.stdout).toBe("{}");
    }
    const rows = logRows(decisions);
    expect(rows.map((row) => row.decision)).toEqual(["advisory", "allow"]);
    expect(rows[0].advisoryRendered).toBe(false);
    expect(rows[1].advisoryRendered).toBeUndefined();
  });
}

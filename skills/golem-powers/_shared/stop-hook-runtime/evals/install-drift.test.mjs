import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { materializeOversizeTranscript, readFixture } from "./helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.resolve(here, "..");
const powersRoot = path.resolve(runtimeRoot, "../..");
const fixtureRoot = path.join(here, "fixtures");
const configuredInstalledRoot = process.env.STOP_HOOK_INSTALLED_ROOT
  ? path.resolve(process.env.STOP_HOOK_INSTALLED_ROOT)
  : null;
const scratch = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

function makeInstalledShape(...gates) {
  if (configuredInstalledRoot) return configuredInstalledRoot;
  const root = mkdtempSync(path.join(tmpdir(), "stop-hook-installed-"));
  scratch.push(root);
  const sharedTarget = path.join(root, "_shared", "stop-hook-runtime");
  if (existsSync(runtimeRoot)) cpSync(runtimeRoot, sharedTarget, { recursive: true });
  for (const gate of gates) {
    cpSync(path.join(powersRoot, gate), path.join(root, gate), { recursive: true });
  }
  return root;
}

function makeScratchDir(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(root);
  return root;
}

function runHook(root, gate, payload) {
  const hook = path.join(root, gate, "scripts", `${gate}-hook.mjs`);
  const proc = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: "Stop", ...payload }),
    encoding: "utf8",
  });
  expect(proc.status, proc.stderr).toBe(0);
  return JSON.parse(proc.stdout);
}

const oversizeCases = [
  {
    gate: "false-green-gate",
    fixture: path.join(fixtureRoot, "oversize-tail.json"),
    expectedReason: "FALSE_GREEN_LIVE_PROBE",
  },
  {
    gate: "monitor-law-gate",
    fixture: path.join(powersRoot, "monitor-law-gate", "evals", "fixtures", "red", "01-monitor-absent.json"),
    expectedReason: "MONITOR_ABSENT",
  },
  {
    gate: "fleet-wrap-gate",
    fixture: path.join(powersRoot, "fleet-wrap-gate", "evals", "fixtures", "red", "06-wrap-narrative-healthwatch-no-tool.json"),
    expectedReason: "FLEETWRAP_CRON_ALIVE",
  },
  {
    gate: "qa-verdict-gate",
    fixture: path.join(powersRoot, "qa-verdict-gate", "evals", "fixtures", "red", "03-fail-no-observation.json"),
    expectedReason: "QA_FAIL_WITHOUT_OBSERVATION",
  },
];

for (const testCase of oversizeCases) {
  test(`installed-shape ${testCase.gate} blocks when its decisive turn is after 512KiB`, () => {
    const fixture = readFixture(testCase.fixture);
    const root = makeInstalledShape(testCase.gate);
    const transcriptPath = path.join(makeScratchDir("stop-hook-fixture-"), "oversize.jsonl");
    const size = materializeOversizeTranscript(transcriptPath, {
      paddingBytes: fixture.paddingBytes ?? 614400,
      tailEvents: fixture.tailEvents ?? fixture.events,
    });
    expect(size).toBeGreaterThan(512 * 1024);

    const result = runHook(root, testCase.gate, { transcript_path: transcriptPath });
    expect(result.decision).toBe("block");
    expect(result.reason).toContain(testCase.expectedReason);
  });
}

test("installed-shape idle-dwell hook preserves top-level durable state and blocks an unstarted approved item", () => {
  const fixture = readFixture(path.join(fixtureRoot, "durable-state.json"));
  const root = makeInstalledShape("idle-dwell-gate");

  const result = runHook(root, "idle-dwell-gate", {
    transcript: fixture.transcript,
    state: fixture.state,
  });
  expect(result.decision).toBe(fixture.expectedDecision);
  expect(result.reason).toContain(fixture.expectedReason);
});

test("installed-shape monitor-law hook uses top-level durable registry state", () => {
  const fixture = readFixture(path.join(
    powersRoot,
    "monitor-law-gate",
    "evals",
    "fixtures",
    "green",
    "07-claimed-monitor-live-heartbeat.json",
  ));
  const root = makeInstalledShape("monitor-law-gate");

  const result = runHook(root, "monitor-law-gate", {
    transcript: { events: fixture.events },
    state: fixture.monitorRegistry,
  });
  expect(result).toEqual({});
});

test("installed-shape monitor-law hook keeps transcript registry when durable state is unrelated", () => {
  const fixture = readFixture(path.join(
    powersRoot,
    "monitor-law-gate",
    "evals",
    "fixtures",
    "green",
    "07-claimed-monitor-live-heartbeat.json",
  ));
  const root = makeInstalledShape("monitor-law-gate");

  const result = runHook(root, "monitor-law-gate", {
    transcript: {
      events: fixture.events,
      monitorRegistry: fixture.monitorRegistry,
    },
    state: { queue: [{ id: "unrelated", status: "pending" }] },
  });
  expect(result).toEqual({});
});

test("installed-shape idle-dwell hook evaluates an oversized transcript tail with durable state", () => {
  const fixture = readFixture(path.join(fixtureRoot, "durable-state.json"));
  const root = makeInstalledShape("idle-dwell-gate");
  const transcriptPath = path.join(makeScratchDir("stop-hook-fixture-"), "oversize.jsonl");
  materializeOversizeTranscript(transcriptPath, {
    paddingBytes: 614400,
    tailEvents: fixture.transcript.events,
  });

  const result = runHook(root, "idle-dwell-gate", {
    transcript_path: transcriptPath,
    state: fixture.state,
  });
  expect(result.decision).toBe(fixture.expectedDecision);
  expect(result.reason).toContain(fixture.expectedReason);
});

test("oversized inline stdin is explicit skipped telemetry rather than silent allow", () => {
  const root = makeInstalledShape("false-green-gate");
  const result = runHook(root, "false-green-gate", {
    transcript: { result: "x".repeat(600 * 1024) },
  });
  expect(result).not.toEqual({});
  expect(result.systemMessage).toContain("skipped");
});

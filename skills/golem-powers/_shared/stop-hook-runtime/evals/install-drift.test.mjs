import { afterEach, expect, test, setDefaultTimeout } from "bun:test";
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

// These tests spawn node/bun; a cold CI runner can exceed bun's 5s default.
setDefaultTimeout(15_000);

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
    advisory: true, // GO-5 E2
    fixture: path.join(fixtureRoot, "oversize-tail.json"),
    expectedReason: "FALSE_GREEN_LIVE_PROBE",
  },
  {
    gate: "fleet-wrap-gate",
    advisory: true, // GO-5 E2
    fixture: path.join(powersRoot, "fleet-wrap-gate", "evals", "fixtures", "red", "06-wrap-narrative-healthwatch-no-tool.json"),
    expectedReason: "FLEETWRAP_CRON_ALIVE",
  },
  {
    gate: "qa-verdict-gate",
    advisory: true, // GO-5 E2
    fixture: path.join(powersRoot, "qa-verdict-gate", "evals", "fixtures", "red", "03-fail-no-observation.json"),
    expectedReason: "QA_FAIL_WITHOUT_OBSERVATION",
  },
];

for (const testCase of oversizeCases) {
  test(`installed-shape ${testCase.gate} flags when its decisive turn is after 512KiB`, () => {
    const fixture = readFixture(testCase.fixture);
    const root = makeInstalledShape(testCase.gate);
    const transcriptPath = path.join(makeScratchDir("stop-hook-fixture-"), "oversize.jsonl");
    const size = materializeOversizeTranscript(transcriptPath, {
      paddingBytes: fixture.paddingBytes ?? 614400,
      tailEvents: fixture.tailEvents ?? fixture.events,
    });
    expect(size).toBeGreaterThan(512 * 1024);

    const result = runHook(root, testCase.gate, { transcript_path: transcriptPath });
    if (testCase.advisory) {
      expect(result.decision).toBeUndefined();
      expect(result.systemMessage).toContain(testCase.expectedReason);
    } else {
      expect(result.decision).toBe("block");
      expect(result.reason).toContain(testCase.expectedReason);
    }
  });
}

test("oversized inline stdin is explicit skipped telemetry rather than silent allow", () => {
  const root = makeInstalledShape("false-green-gate");
  const result = runHook(root, "false-green-gate", {
    transcript: { result: "x".repeat(600 * 1024) },
  });
  expect(result).not.toEqual({});
  expect(result.systemMessage).toContain("skipped");
});

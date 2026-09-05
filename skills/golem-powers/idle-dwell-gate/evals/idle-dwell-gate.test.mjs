// Deterministic replay gate for idle-dwell-gate (gen-18 Track 1).
// The pinned RED (violating) + GREEN (driving / legit-pause) transcript fixtures
// ARE the replayable gate — same fixtures in → same pass/fail out (R-003/R-014
// pattern, T6 smoke-spec shape). Runs under `bun test` and `node --test`.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { detectIdleDwell, hookPayloadFor } from "../src/idle-dwell-gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const redDir = path.join(here, "fixtures", "red");
const greenDir = path.join(here, "fixtures", "green");

function loadFixtures(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) }));
}

const reds = loadFixtures(redDir);
const greens = loadFixtures(greenDir);

test("fixture coverage: original suite plus 2026-07-02 FN/FP corpus present", () => {
  expect(reds.length).toBe(12);
  expect(greens.length).toBeGreaterThanOrEqual(11);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const result = detectIdleDwell(fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    // The detector must identify the SPECIFIC violation the specimen names,
    // not merely flag something.
    expect(codes).toContain(fx.violation);
    if (fx.hookDecision) {
      expect(result.hookDecision).toBe(fx.hookDecision);
    }
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const result = detectIdleDwell(fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

// Determinism: replaying the same fixture twice yields byte-identical verdicts.
test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    const a = JSON.stringify(detectIdleDwell(fx));
    const b = JSON.stringify(detectIdleDwell(fx));
    expect(a).toBe(b);
  }
});

// The live caller (/orc) can force queue state; an empty queue suppresses the
// idle-family flag even on an otherwise-idle terminal turn.
test("opts.queueOpen=false suppresses idle-family flags", () => {
  const idle = reds.find((f) => f.violation === "IDLE_SEAT_OPEN_QUEUE");
  expect(detectIdleDwell(idle).verdict).toBe("FLAG");
  expect(detectIdleDwell(idle, { queueOpen: false }).verdict).toBe("PASS");
});

test("hook payload blocks only the two unambiguous classes", () => {
  const blockFixtures = reds.filter((f) => f.hookDecision === "block");
  expect(blockFixtures.map((f) => f.violation).sort()).toEqual([
    "APPROVED_ITEM_UNSTARTED_ZERO_WATCHES",
    "DONE_WORKER_UNHARVESTED",
  ]);
  for (const fx of blockFixtures) {
    const payload = hookPayloadFor(detectIdleDwell(fx));
    expect(payload.decision).toBe("block");
    expect(payload.reason).toContain(fx.violation);
    expect(payload.reason).toContain(fx.state.workers?.[0]?.id ?? fx.state.queue?.[0]?.id);
  }
});

test("hook payload emits advisory systemMessage for ambiguous flagged states", () => {
  const advisoryFixtures = reds.filter((f) => f.hookDecision === "advisory");
  expect(advisoryFixtures.length).toBeGreaterThanOrEqual(2);
  for (const fx of advisoryFixtures) {
    const payload = hookPayloadFor(detectIdleDwell(fx));
    expect(payload.decision).toBeUndefined();
    expect(payload.systemMessage).toContain(fx.violation);
  }
});

test("hook payload allows PASS states", () => {
  expect(hookPayloadFor(detectIdleDwell(greens[0]))).toEqual({});
});

test("Stop hook wrapper writes block, advisory, and allow JSON", () => {
  const hook = path.join(here, "..", "scripts", "idle-dwell-gate-hook.mjs");
  const blockFx = reds.find((f) => f.hookDecision === "block");
  const advisoryFx = reds.find((f) => f.hookDecision === "advisory");
  const passFx = greens.find((f) => f.file === "07-etan-only-decision-monitors-armed.json");

  const runHook = (fixture) => {
    const proc = spawnSync("node", [hook], {
      input: JSON.stringify({ transcript: fixture }),
      encoding: "utf8",
    });
    expect(proc.status).toBe(0);
    return JSON.parse(proc.stdout);
  };

  expect(runHook(blockFx).decision).toBe("block");
  expect(runHook(advisoryFx).systemMessage).toContain(advisoryFx.violation);
  expect(runHook(passFx)).toEqual({});
});

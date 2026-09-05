// Deterministic replay gate for monitor-law-gate (gen-18 Track 1 #2).
// Pinned RED (monitor-law violation) + GREEN (correct monitor / N-A) transcript
// fixtures ARE the replayable gate (R-003/R-014 pattern). Runs under `bun test`.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectMonitorLaw } from "../src/monitor-law-gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (dir) =>
  readdirSync(path.join(here, "fixtures", dir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(here, "fixtures", dir, f), "utf8")) }));

const reds = load("red");
const greens = load("green");

test("fixture coverage: original corpus plus goal-required RED/GREEN cases present", () => {
  expect(reds.length).toBeGreaterThanOrEqual(9);
  expect(greens.length).toBeGreaterThanOrEqual(7);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const r = detectMonitorLaw(fx);
    expect(r.verdict).toBe("FLAG");
    expect(r.violations.map((v) => v.code)).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const r = detectMonitorLaw(fx);
    expect(r.verdict).toBe("PASS");
    expect(r.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectMonitorLaw(fx))).toBe(JSON.stringify(detectMonitorLaw(fx)));
  }
});

test("opts.activeChannel forces the channel", () => {
  const wrong = reds.find((f) => f.violation === "MONITOR_WRONG_CHANNEL");
  // Force the active channel to the one the monitor actually watches → PASS.
  expect(detectMonitorLaw(wrong, { activeChannel: "collab/2026-06-22-side-qa.md" }).verdict).toBe("PASS");
});

test("claimed monitor ids are checked against heartbeat ground truth", () => {
  const stale = reds.find((f) => f.violation === "MONITOR_STALE_HEARTBEAT");
  const result = detectMonitorLaw(stale);
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("MONITOR_STALE_HEARTBEAT");
});

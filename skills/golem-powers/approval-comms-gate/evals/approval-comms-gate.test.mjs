// Deterministic replay gate for approval-comms-gate (gen-18 Track 1 #7).
// Pinned RED + GREEN transcript fixtures ARE the replayable gate.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectApprovalComms } from "../src/approval-comms-gate.mjs";

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

test("fixture coverage: named RED specimens + GREEN references present", () => {
  expect(reds.length).toBeGreaterThanOrEqual(5);
  expect(greens.length).toBeGreaterThanOrEqual(4);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const result = detectApprovalComms(fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const result = detectApprovalComms(fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectApprovalComms(fx))).toBe(JSON.stringify(detectApprovalComms(fx)));
  }
});

test("visual approval cannot be cleared by prose alone", () => {
  const bare = {
    events: [
      { role: "user", text: "Get visual approval on this screenshot before shipping.", tools: [] },
      { role: "assistant", text: "I sent the screenshot for approval and will proceed.", tools: [] }
    ]
  };
  const result = detectApprovalComms(bare);
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("VISUAL_GATE_WRONG_CHANNEL");
});

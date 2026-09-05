// Deterministic replay gate for ultracode-depth-gate (gen-18 Track 1 #8).
// Pinned RED + GREEN transcript fixtures ARE the replayable gate.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectUltracodeDepth } from "../src/ultracode-depth-gate.mjs";

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

test("fixture coverage: RED depth-floor specimens + GREEN references present", () => {
  expect(reds.length).toBeGreaterThanOrEqual(5);
  expect(greens.length).toBeGreaterThanOrEqual(3);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) -> FLAG ${fx.violation}`, () => {
    const result = detectUltracodeDepth(fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) -> PASS`, () => {
    const result = detectUltracodeDepth(fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectUltracodeDepth(fx))).toBe(JSON.stringify(detectUltracodeDepth(fx)));
  }
});

test("prose-only topology cannot clear an ultracode dispatch", () => {
  const bare = {
    events: [
      { role: "user", text: "Run an ultracode exhaustive audit of this repo.", tools: [] },
      { role: "assistant", text: "I will use 17 gatherers, 3 adversarial verifiers, and loop until dry.", tools: [] }
    ]
  };
  const result = detectUltracodeDepth(bare);
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("DEPTH_FLOOR_GATHERERS");
});

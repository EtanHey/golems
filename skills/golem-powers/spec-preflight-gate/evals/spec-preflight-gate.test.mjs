// Deterministic replay gate for spec-preflight-gate (gen-18 Track 1 #9).
// Pinned RED + GREEN transcript fixtures ARE the replayable gate.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectSpecPreflight } from "../src/spec-preflight-gate.mjs";

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

test("fixture coverage: RED spawn-hygiene specimens + GREEN references present", () => {
  expect(reds.length).toBeGreaterThanOrEqual(4);
  expect(greens.length).toBeGreaterThanOrEqual(4);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) -> FLAG ${fx.violation}`, () => {
    const result = detectSpecPreflight(fx.raw ?? fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) -> PASS`, () => {
    const result = detectSpecPreflight(fx.raw ?? fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    const transcript = fx.raw ?? fx;
    expect(JSON.stringify(detectSpecPreflight(transcript))).toBe(JSON.stringify(detectSpecPreflight(transcript)));
  }
});

test("prose-only preflight cannot clear a spec-referencing spawn", () => {
  const bare = {
    events: [
      { role: "user", text: "Spawn a worker from docs/plan/spawn-hygiene.md.", tools: [] },
      {
        role: "assistant",
        text: "I verified docs/plan/spawn-hygiene.md exists and will cite grep-patterns.",
        tools: [
          {
            name: "spawn_agent",
            input: {
              name: "golems",
              repo: "golems",
              launcher: "golems",
              prompt: "Read docs/plan/spawn-hygiene.md and implement the plan."
            }
          }
        ]
      }
    ]
  };
  const result = detectSpecPreflight(bare);
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("SPEC_FILE_UNVERIFIED");
});

// Deterministic replay gate for false-green-gate (gen-18 Track 2).
// Pinned RED (false-green) + GREEN (live-probed / N-A) transcript fixtures ARE
// the replayable gate — same fixtures in → same pass/fail out (R-003/R-014
// pattern, T6 smoke-spec shape). Runs under `bun test` and `node --test`.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectFalseGreen } from "../src/false-green-gate.mjs";

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

test("fixture coverage: original corpus plus goal-required RED/GREEN cases present", () => {
  expect(reds.length).toBeGreaterThanOrEqual(19);
  expect(greens.length).toBeGreaterThanOrEqual(15);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const result = detectFalseGreen(fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const result = detectFalseGreen(fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectFalseGreen(fx))).toBe(JSON.stringify(detectFalseGreen(fx)));
  }
});

test("a completion claim with NO probe of any kind is always a FLAG", () => {
  const bare = { events: [{ role: "assistant", text: "All done ✅ everything works." }] };
  expect(detectFalseGreen(bare).verdict).toBe("FLAG");
});

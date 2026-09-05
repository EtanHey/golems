// Deterministic replay gate for collab-routing-gate (gen-18 Track 1 #4).
import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { detectCollabRouting } from "../src/collab-routing-gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (dir) =>
  readdirSync(path.join(here, "fixtures", dir))
    .filter((f) => f.endsWith(".json")).sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(here, "fixtures", dir, f), "utf8")) }));

const reds = load("red");
const greens = load("green");

test("fixture coverage", () => {
  expect(reds.length).toBe(3);
  expect(greens.length).toBeGreaterThanOrEqual(7);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const r = detectCollabRouting(fx);
    expect(r.verdict).toBe("FLAG");
    expect(r.violations.map((v) => v.code)).toContain(fx.violation);
  });
}
for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const r = detectCollabRouting(fx);
    expect(r.verdict).toBe("PASS");
    expect(r.violations.length).toBe(0);
  });
}
test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectCollabRouting(fx))).toBe(JSON.stringify(detectCollabRouting(fx)));
  }
});

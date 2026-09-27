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

// References and deferred markers are not delivery claims; actual claims remain gated.
test("a review URL does not select dashboard requirements for a generic claim", () => {
  const result = detectFalseGreen("Fixed. Review: https://github.com/example/repo/pull/1");
  expect(result.domains).not.toContain("dashboard");
  expect(result.violations.map(v => v.code)).toEqual(["FALSE_GREEN_LIVE_PROBE"]);
});

test("a published URL still requires dashboard probes", () => {
  const result = detectFalseGreen("Published at https://example.com/release.");
  expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_DASHBOARD_200");
  expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_CLICK_THROUGH");
});

test("attribution and a deferred marker cannot hide a separate dashboard claim", () => {
  const result = detectFalseGreen("w6's 5 false positives are fixed. My report and DONE marker wait for approval. The dashboard is ready to use.");
  expect(result.violations.map(v => v.code)).toContain("FALSE_GREEN_DASHBOARD_200");
});

test("an emitted DONE marker is still a completion claim", () => {
  expect(detectFalseGreen("My DONE marker is ready.").verdict).toBe("FLAG");
});

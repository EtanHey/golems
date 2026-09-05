// Deterministic replay gate for qa-verdict-gate (gen-18 Track 2 #6).
// Pinned RED (verdict-integrity violation) + GREEN (earned verdict + artifact /
// N-A) transcript fixtures ARE the replayable gate — same fixtures in → same
// pass/fail out (R-003/R-014 pattern, T6 smoke-spec shape). Runs under
// `bun test` and `node --test`.

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectQaVerdict } from "../src/qa-verdict-gate.mjs";

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

test("fixture coverage: 3 specimens + evasion REDs + GREEN references present", () => {
  expect(reds.length).toBeGreaterThanOrEqual(10);
  expect(greens.length).toBeGreaterThanOrEqual(4);
  // all three detector codes are exercised by at least one RED
  const codes = new Set(reds.map((r) => r.violation));
  expect(codes.has("QA_FAIL_WITHOUT_OBSERVATION")).toBe(true);
  expect(codes.has("QA_UNREACHED_NOT_INCONCLUSIVE")).toBe(true);
  expect(codes.has("QA_NO_REPORT_ARTIFACT")).toBe(true);
  expect(codes.has("QA_DECISION_CLAIM_NO_VISUAL_EVIDENCE")).toBe(true);
  expect(codes.has("QA_USER_VISIBLE_WITHOUT_RENDERED_EVIDENCE")).toBe(true);
});

for (const fx of reds) {
  test(`RED ${fx.file} (${fx.specimen}) → FLAG ${fx.violation}`, () => {
    const result = detectQaVerdict(fx);
    expect(result.verdict).toBe("FLAG");
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(fx.violation);
  });
}

for (const fx of greens) {
  test(`GREEN ${fx.file} (${fx.specimen}) → PASS`, () => {
    const result = detectQaVerdict(fx);
    expect(result.verdict).toBe("PASS");
    expect(result.violations.length).toBe(0);
  });
}

test("replay is deterministic", () => {
  for (const fx of [...reds, ...greens]) {
    expect(JSON.stringify(detectQaVerdict(fx))).toBe(JSON.stringify(detectQaVerdict(fx)));
  }
});

test("a QA-done claim with no qa-report.md artifact is always a FLAG", () => {
  const bare = { events: [{ role: "assistant", text: "QA complete ✅ — verdict: PASS, everything works." }] };
  const result = detectQaVerdict(bare);
  expect(result.verdict).toBe("FLAG");
  expect(result.violations.map((v) => v.code)).toContain("QA_NO_REPORT_ARTIFACT");
});

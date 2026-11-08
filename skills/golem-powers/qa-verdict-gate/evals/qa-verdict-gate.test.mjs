// Deterministic replay gate for qa-verdict-gate (gen-18 Track 2 #6).
// Pinned RED (verdict-integrity violation) + GREEN (earned verdict + artifact /
// N-A) transcript fixtures ARE the replayable gate — same fixtures in → same
// pass/fail out (R-003/R-014 pattern, T6 smoke-spec shape). Runs under
// `bun test` and `node --test`.

import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
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

test("video inspection receipts preserve the other four checks", () => {
  const earned = greens.find((fx) => fx.file === "10-video-inspected-frames.json");
  for (const [code, mutate] of [
    ["QA_UNREACHED_NOT_INCONCLUSIVE", (fx) => fx.events.splice(4, 0, { role: "tool", text: "element not found" })],
    ["QA_NO_REPORT_ARTIFACT", (fx) => { fx.events[4].tools[0].input.content = "QA report stub"; }],
    ["QA_DECISION_CLAIM_NO_VISUAL_EVIDENCE", (fx) => {
      fx.events[0].text = "Is this ready to ship?";
      fx.events.at(-1).text = "Verdict: FAIL — F1 FAIL.";
    }],
    ["QA_USER_VISIBLE_WITHOUT_RENDERED_EVIDENCE", (fx) => {
      fx.events.at(-1).text = "Verdict: PASS — the app is ready; visual evidence: recording.png.";
    }],
  ]) {
    const fx = structuredClone(earned);
    mutate(fx);
    expect(detectQaVerdict(fx).violations.map((v) => v.code)).toContain(code);
  }
});

test("real qa-video inspection rows earn observed FAIL evidence", () => {
  const repo = path.resolve(here, "../../../..");
  const scratch = mkdtempSync(path.join(repo, "docs.local", "p14-cross-skill-"));
  const run = path.join(scratch, "qa-video", "run");
  mkdirSync(run, { recursive: true });
  try {
    const frame = path.join(run, "frame.png");
    writeFileSync(frame, "synthetic frame bytes");
    const scripts = path.join(repo, "skills/golem-powers/qa-video/scripts");
    execFileSync("python3", ["-c",
      'import sys; sys.path.insert(0,sys.argv[1]); import provenance as p; p.record(sys.argv[2],[(sys.argv[3],0,"coverage","","","")])',
      scripts, run, frame], { env: { ...process.env, QA_RUN_DIR: run } });
    execFileSync("bash", [path.join(scripts, "inspected.sh"), run, frame, "h2: observed overlap", "F1"]);
    const fx = structuredClone(greens.find((f) => f.file === "10-video-inspected-frames.json"));
    fx.events = JSON.parse(JSON.stringify(fx.events).replaceAll("/qa-fixtures/qa-video/synthetic-run", run));
    writeFileSync(path.join(run, "qa-report.md"), fx.events[4].tools[0].input.content);
    fx.events[2].text = execFileSync("bash", [path.join(scripts, "fail-evidence.sh"), run], { encoding: "utf8" });
    expect(fx.events[2].text.trim().split("\t")).toHaveLength(5);
    expect(detectQaVerdict(fx).verdict).toBe("PASS");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

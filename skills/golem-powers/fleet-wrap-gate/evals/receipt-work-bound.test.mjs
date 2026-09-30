import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { detectFleetWrap } from "../src/fleet-wrap-gate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = path.join(here, "..", "scripts", "fleet-wrap-gate-hook.mjs");

function runHook(text, state = {}) {
  const dir = mkdtempSync(path.join(here, ".receipt-work-bound-"));
  const transcriptPath = path.join(dir, "transcript.jsonl");
  writeFileSync(transcriptPath, `${JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  })}\n`);
  try {
    const start = performance.now();
    const run = spawnSync("node", [hook], {
      input: JSON.stringify({ hook_event_name: "Stop", transcript_path: transcriptPath, state }),
      encoding: "utf8",
      timeout: 1_000,
    });
    return { run, elapsed: performance.now() - start };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectQuickJson({ run, elapsed }) {
  expect(run.error).toBeUndefined();
  expect(run.status).toBe(0);
  expect(() => JSON.parse(run.stdout)).not.toThrow();
  expect(elapsed).toBeLessThan(1_000);
  return JSON.parse(run.stdout);
}

test("real hook bounds repeated =/ report-path starts", () => {
  const text = `DONE — https://github.com/o/r/pull/1 merged. ${"=/".repeat(200_000)}`;
  expectQuickJson(runHook(text));
});

test("real hook bounds repeated merge claims with no sentence separators", () => {
  const text = `not ${"PR #1 merged ".repeat(35_000)}`;
  expectQuickJson(runHook(text));
});

test("receipt scan exhaustion preserves live-cron verdict", () => {
  const text = `Stand down. DONE — https://github.com/o/r/pull/1 merged. ${"=/".repeat(200_000)}`;
  const state = { crons: [{ id: "cron-live", status: "active", prompt: "status poll" }] };
  const result = expectQuickJson(runHook(text, state));
  expect(result.systemMessage).toContain("FLEETWRAP_CRON_ALIVE");
});

test("forced receipt budget trip leaves the independent cron result intact", () => {
  const result = detectFleetWrap({
    events: [{ role: "assistant", text: "Stand down. DONE_ABC", tools: [] }],
  }, {
    state: { crons: [{ id: "cron-live", status: "active", prompt: "status poll" }] },
    receiptOptions: { maxWork: 1 },
  });
  expect(result.violations.map((v) => v.code)).toEqual(["FLEETWRAP_CRON_ALIVE"]);
});

test("unscanned tool-result text does not exhaust the receipt budget", () => {
  const result = detectFleetWrap({
    events: [
      { role: "tool", text: "x".repeat(500_000), tools: [] },
      { role: "assistant", text: "DONE_ABC", tools: [] },
    ],
  }, { receiptOptions: { maxWork: 1_000 } });
  expect(result.violations.map((v) => v.code)).toEqual(["FLEETWRAP_CLEANUP_RECEIPT_MISSING"]);
});

test("repeated negated-terminal prefixes stay bounded", () => {
  const text = "not ".repeat(125_000);
  const start = performance.now();
  const result = detectFleetWrap({ events: [{ role: "assistant", text, tools: [] }] });
  expect(result.verdict).toBe("PASS");
  expect(performance.now() - start).toBeLessThan(500);
});

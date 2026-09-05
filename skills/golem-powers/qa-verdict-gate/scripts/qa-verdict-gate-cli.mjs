#!/usr/bin/env bun
// CLI for qa-verdict-gate — run the QA verdict-integrity kill-gate over a transcript.
//
// Usage:
//   bun qa-verdict-gate-cli.mjs <transcript.jsonl | fixture.json>
//   cat transcript.jsonl | bun qa-verdict-gate-cli.mjs -
//
// Exit 0 = PASS (no settled verdict, or the verdict matches the observed evidence
// AND the qa-report.md artifact exists), exit 3 = FLAG (verdict-integrity
// violation), exit 2 = usage. The nonzero FLAG exit makes this wireable as a
// Stop-hook / pr-loop QA completion check: no QA "done"/FAIL leaves the seat
// unless the verdict is earned and the report artifact is written.

import { readFileSync } from "node:fs";
import { detectQaVerdict, formatReport } from "../src/qa-verdict-gate.mjs";

function readInput(arg) {
  const raw = arg === "-" ? readFileSync(0, "utf8") : readFileSync(arg, "utf8");
  const trimmed = raw.trim();
  const looksJsonl =
    (arg.endsWith && arg.endsWith(".jsonl")) ||
    (trimmed.includes("\n") &&
      trimmed.split("\n").every((l) => {
        const s = l.trim();
        if (!s) return true;
        try { JSON.parse(s); return true; } catch { return false; }
      }) && !trimmed.startsWith("{\n") && !trimmed.startsWith("["));
  if (looksJsonl) {
    return trimmed.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  }
  return JSON.parse(trimmed);
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: qa-verdict-gate-cli.mjs <transcript.jsonl|fixture.json|->");
  process.exit(2);
}

const result = detectQaVerdict(readInput(arg));
console.log(formatReport(result));
process.exit(result.verdict === "FLAG" ? 3 : 0);

#!/usr/bin/env bun
// CLI for false-green-gate — run the live-outcome kill-gate over a transcript.
//
// Usage:
//   bun false-green-gate-cli.mjs <transcript.jsonl | fixture.json>
//   cat transcript.jsonl | bun false-green-gate-cli.mjs -
//
// Exit 0 = PASS (no claim, or claim is live-probed), exit 3 = FLAG (false-green),
// exit 2 = usage. The nonzero FLAG exit makes this wireable as a Stop-hook /
// pr-loop completion check: no "done" leaves the seat without a live probe.

import { readFileSync } from "node:fs";
import { detectFalseGreen, formatReport } from "../src/false-green-gate.mjs";

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
  console.error("usage: false-green-gate-cli.mjs <transcript.jsonl|fixture.json|->");
  process.exit(2);
}

const result = detectFalseGreen(readInput(arg));
console.log(formatReport(result));
process.exit(result.verdict === "FLAG" ? 3 : 0);

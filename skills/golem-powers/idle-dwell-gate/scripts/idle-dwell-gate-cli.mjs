#!/usr/bin/env bun
// CLI for idle-dwell-gate — run the autonomy gate over a transcript file.
//
// Usage:
//   bun idle-dwell-gate-cli.mjs <transcript.jsonl | fixture.json>
//   cat transcript.jsonl | bun idle-dwell-gate-cli.mjs -
//
// A .jsonl file is parsed line-by-line as raw Claude Code transcript; a .json
// file is read as a single object (a spine fixture or a claude -p result).
// Exit 0 = PASS (driving), exit 3 = FLAG (idle-dwell violation), exit 2 = usage.
// The nonzero FLAG exit makes this wireable as a Stop-hook / loop autonomy check.

import { readFileSync } from "node:fs";
import { detectIdleDwell, formatReport } from "../src/idle-dwell-gate.mjs";

function readInput(arg) {
  const raw = arg === "-" ? readFileSync(0, "utf8") : readFileSync(arg, "utf8");
  const trimmed = raw.trim();
  const looksJsonl =
    (arg.endsWith && arg.endsWith(".jsonl")) ||
    (trimmed.includes("\n") && trimmed.split("\n").every((l) => {
      const s = l.trim();
      if (!s) return true;
      try { JSON.parse(s); return true; } catch { return false; }
    }) && !trimmed.startsWith("{\n") && !trimmed.startsWith("["));
  if (looksJsonl) {
    return trimmed
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }
  return JSON.parse(trimmed);
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: idle-dwell-gate-cli.mjs <transcript.jsonl|fixture.json|->");
  process.exit(2);
}

const result = detectIdleDwell(readInput(arg));
console.log(formatReport(result));
process.exit(result.verdict === "FLAG" ? 3 : 0);

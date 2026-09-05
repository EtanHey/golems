#!/usr/bin/env bun
// CLI for approval-comms-gate — run the approval/comms doctrine gate over a transcript.
//
// Usage:
//   bun approval-comms-gate-cli.mjs <transcript.jsonl | fixture.json>
//   cat transcript.jsonl | bun approval-comms-gate-cli.mjs -
//
// Exit 0 = PASS, exit 3 = FLAG, exit 2 = usage.

import { readFileSync } from "node:fs";
import { detectApprovalComms, formatReport } from "../src/approval-comms-gate.mjs";

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
  console.error("usage: approval-comms-gate-cli.mjs <transcript.jsonl|fixture.json|->");
  process.exit(2);
}

try {
  const result = detectApprovalComms(readInput(arg));
  console.log(formatReport(result));
  process.exit(result.verdict === "FLAG" ? 3 : 0);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(2);
}

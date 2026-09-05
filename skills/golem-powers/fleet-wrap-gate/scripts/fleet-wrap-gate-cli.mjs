#!/usr/bin/env bun
// CLI for fleet-wrap-gate — run the terminal-state cron-count gate over a transcript.
//
// Usage:
//   bun fleet-wrap-gate-cli.mjs <transcript.jsonl | fixture.json>
//   cat transcript.jsonl | bun fleet-wrap-gate-cli.mjs -
//
// Exit 0 = PASS (not terminal, or terminal with cron-count=0), exit 3 = FLAG
// (FLEET_WRAP_CRON_NONZERO), exit 2 = usage. The nonzero FLAG exit makes this
// wireable as a Stop-hook / fleet-wrap completion check: no stand-down leaves a
// health-watch / poll cron armed.

import { readFileSync } from "node:fs";
import { detectFleetWrap, formatReport } from "../src/fleet-wrap-gate.mjs";

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
  console.error("usage: fleet-wrap-gate-cli.mjs <transcript.jsonl|fixture.json|->");
  process.exit(2);
}

const result = detectFleetWrap(readInput(arg));
console.log(formatReport(result));
process.exit(result.verdict === "FLAG" ? 3 : 0);

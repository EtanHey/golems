#!/usr/bin/env bun
// CLI for monitor-law-gate — run the monitor-law gate over a transcript.
//   bun monitor-law-gate-cli.mjs <transcript.jsonl|fixture.json|->
// Exit 0 = PASS, exit 3 = FLAG (monitor-law violation), exit 2 = usage.
import { readFileSync } from "node:fs";
import { detectMonitorLaw, formatReport } from "../src/monitor-law-gate.mjs";

function readInput(arg) {
  const raw = arg === "-" ? readFileSync(0, "utf8") : readFileSync(arg, "utf8");
  const t = raw.trim();
  const looksJsonl =
    (arg.endsWith && arg.endsWith(".jsonl")) ||
    (t.includes("\n") && !t.startsWith("{\n") && !t.startsWith("[") &&
      t.split("\n").every((l) => { const s = l.trim(); if (!s) return true; try { JSON.parse(s); return true; } catch { return false; } }));
  if (looksJsonl) return t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  return JSON.parse(t);
}

const arg = process.argv[2];
if (!arg) { console.error("usage: monitor-law-gate-cli.mjs <transcript.jsonl|fixture.json|->"); process.exit(2); }
const result = detectMonitorLaw(readInput(arg));
console.log(formatReport(result));
process.exit(result.verdict === "FLAG" ? 3 : 0);

#!/usr/bin/env bun
// CLI for collab-routing-gate. bun collab-routing-gate-cli.mjs <transcript.jsonl|fixture.json|->
// Exit 0 = PASS, 3 = FLAG (collab-routing violation), 2 = usage.
import { readFileSync } from "node:fs";
import { detectCollabRouting, formatReport } from "../src/collab-routing-gate.mjs";

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
if (!arg) { console.error("usage: collab-routing-gate-cli.mjs <transcript.jsonl|fixture.json|->"); process.exit(2); }
const result = detectCollabRouting(readInput(arg));
console.log(formatReport(result));
process.exit(result.verdict === "FLAG" ? 3 : 0);

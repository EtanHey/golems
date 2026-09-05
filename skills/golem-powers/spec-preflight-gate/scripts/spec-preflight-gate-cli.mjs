#!/usr/bin/env bun
// CLI for spec-preflight-gate — run the spawn spec/handoff preflight gate.
//
// Usage:
//   bun spec-preflight-gate-cli.mjs <transcript.jsonl | fixture.json>
//   cat transcript.jsonl | bun spec-preflight-gate-cli.mjs -
//
// Exit 0 = PASS, exit 3 = FLAG, exit 2 = usage/parse error.

import { readFileSync } from "node:fs";
import { detectSpecPreflight, formatReport } from "../src/spec-preflight-gate.mjs";

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
  console.error("usage: spec-preflight-gate-cli.mjs <transcript.jsonl|fixture.json|->");
  process.exit(2);
}

try {
  const result = detectSpecPreflight(readInput(arg));
  console.log(formatReport(result));
  process.exit(result.verdict === "FLAG" ? 3 : 0);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(2);
}

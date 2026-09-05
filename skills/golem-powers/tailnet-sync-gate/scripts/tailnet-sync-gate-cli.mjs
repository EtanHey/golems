#!/usr/bin/env bun
// CLI for tailnet-sync-gate — run the post-Write tailnet sync gate over a transcript.
//
// Usage:
//   bun tailnet-sync-gate-cli.mjs <transcript.jsonl | fixture.json>
//   cat transcript.jsonl | bun tailnet-sync-gate-cli.mjs -
//
// Exit 0 = PASS (no dashboard Write, no publish claim, or claim is mirrored +
// HTTP-200), exit 3 = FLAG (orphaned/unverified dashboard), exit 2 = usage. The
// nonzero FLAG exit makes this wireable as a post-Write hook / pr-loop check: no
// "published" leaves the seat with a dashboard that never reached the hub.

import { readFileSync } from "node:fs";
import { detectTailnetSync, formatReport } from "../src/tailnet-sync-gate.mjs";

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
  console.error("usage: tailnet-sync-gate-cli.mjs <transcript.jsonl|fixture.json|->");
  process.exit(2);
}

const result = detectTailnetSync(readInput(arg));
console.log(formatReport(result));
process.exit(result.verdict === "FLAG" ? 3 : 0);

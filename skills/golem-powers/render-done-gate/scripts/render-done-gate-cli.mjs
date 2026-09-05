#!/usr/bin/env bun
// CLI for render-done-gate — run the narration render-done kill-gate over a
// transcript.
//
// Usage:
//   bun render-done-gate-cli.mjs <transcript.jsonl | fixture.json>
//   cat transcript.jsonl | bun render-done-gate-cli.mjs -
//
// Exit 0 = PASS (no narration render-done claim, or claim is composite-probed),
// exit 3 = FLAG (render-done false-green), exit 2 = usage. The nonzero FLAG exit
// makes this wireable as a Stop-hook / pr-loop completion check: no narration
// "render done / give it a play" leaves the seat without ls+ffprobe(size>0,
// duration>0) of the claimed path + a reachable surface + a registered clone.

import { readFileSync } from "node:fs";
import { detectRenderDone, formatReport } from "../src/render-done-gate.mjs";

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
  console.error("usage: render-done-gate-cli.mjs <transcript.jsonl|fixture.json|->");
  process.exit(2);
}

const result = detectRenderDone(readInput(arg));
console.log(formatReport(result));
process.exit(result.verdict === "FLAG" ? 3 : 0);

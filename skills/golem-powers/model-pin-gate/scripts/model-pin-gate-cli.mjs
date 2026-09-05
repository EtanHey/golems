#!/usr/bin/env node
// CLI replay helper: reads a PreToolUse payload from a file or stdin and prints
// the detector result. Exit 3 means FLAG; exit 0 means PASS/ADVISORY.

import { readFileSync, readSync } from "node:fs";
import { detectModelPin } from "../src/model-pin-gate.mjs";

function readStdin() {
  const chunks = [];
  const buf = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const n = readSync(0, buf, 0, buf.length, null);
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const arg = process.argv[2] || "-";
const raw = arg === "-" ? readStdin() : readFileSync(arg, "utf8");
const payload = JSON.parse(raw);
const result = detectModelPin(payload);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.verdict === "FLAG" ? 3 : 0);

#!/usr/bin/env node
// Claude Code PreToolUse hook wrapper for model-pin-gate.
//
// Stdout schema:
//   allow: {}
//   block: {"decision":"block","reason":"..."}
//   advisory: {"systemMessage":"..."}
//
// Hang-safety contract: no network, no BrainLayer, no subprocesses, bounded
// stdin/transcript reads, and fail-open on malformed input or internal errors.

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { detectModelPin } from "../src/model-pin-gate.mjs";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const MAX_JSONL_LINES = 240;

function allow() {
  process.stdout.write("{}");
}

function block(result) {
  const codes = result.violations.map((v) => v.code).join(", ");
  const details = result.violations
    .map((v) => `${v.code}: ${v.evidence}. Fix: ${v.action}.`)
    .join(" ");
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `MODEL-PIN-GATE blocked unpinned or disallowed model spawn (${codes}). ${details}`,
  }));
}

function advisory(result) {
  const details = result.advisories
    .map((v) => `${v.code}: ${v.evidence}. Fix: ${v.action}.`)
    .join(" ");
  process.stdout.write(JSON.stringify({
    systemMessage: `MODEL-PIN-GATE advisory: ${details}`,
  }));
}

function readBoundedStdin() {
  const chunks = [];
  let total = 0;
  const buf = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const n = readSync(0, buf, 0, buf.length, null);
    if (n === 0) break;
    total += n;
    if (total > MAX_INPUT_BYTES) return null;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function parseJsonOrJsonl(raw, path = "") {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  const looksJsonl =
    path.endsWith(".jsonl") ||
    (lines.length > 1 && lines.slice(-MAX_JSONL_LINES).every((line) => {
      try { JSON.parse(line); return true; } catch { return false; }
    }));
  if (looksJsonl) return lines.slice(-MAX_JSONL_LINES).map((line) => JSON.parse(line));
  return JSON.parse(trimmed);
}

function readTranscriptTail(path) {
  if (typeof path !== "string" || !path) return null;
  const st = statSync(path);
  if (!st.isFile()) return null;
  const bytesToRead = Math.min(st.size, MAX_TRANSCRIPT_TAIL_BYTES);
  const start = Math.max(0, st.size - bytesToRead);
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(bytesToRead);
    const n = readSync(fd, buf, 0, bytesToRead, start);
    const tail = buf.subarray(0, n).toString("utf8");
    const newline = tail.indexOf("\n");
    const aligned = start > 0 && newline >= 0 ? tail.slice(newline + 1) : tail;
    return parseJsonOrJsonl(aligned, path);
  } finally {
    closeSync(fd);
  }
}

function enrichPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.transcript != null) return payload;
  const transcriptPath = payload.transcript_path ?? payload.transcriptPath;
  if (!transcriptPath) return payload;
  const transcript = readTranscriptTail(transcriptPath);
  if (transcript == null) return payload;
  return { ...payload, transcript };
}

function main() {
  try {
    const raw = readBoundedStdin();
    if (raw === null || !raw.trim()) return allow();
    const parsed = JSON.parse(raw);
    const payload = enrichPayload(parsed);
    if (payload == null) return allow();
    const result = detectModelPin(payload);
    if (result.verdict === "FLAG") return block(result);
    if (result.verdict === "ADVISORY") return advisory(result);
    return allow();
  } catch {
    return allow();
  }
}

main();

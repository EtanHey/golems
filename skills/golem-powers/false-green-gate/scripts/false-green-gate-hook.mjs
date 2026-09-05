#!/usr/bin/env node
// Claude Code Stop-hook wrapper for false-green-gate.
//
// Stdout schema:
//   allow: {}
//   block: {"decision":"block","reason":"..."}
//
// Hang-safety contract: no network, no BrainLayer, bounded tail/state reads,
// no subprocesses, and fail-open on malformed input or internal errors.

import {
  publishStopHookReceipt,
  readerFailurePayload,
  readStopHookContext,
} from "../../_shared/stop-hook-runtime/stop-hook-reader.mjs";
import { detectFalseGreen } from "../src/false-green-gate.mjs";

function allow() {
  process.stdout.write("{}");
}

function block(result) {
  const codes = result.violations.map((v) => v.code).join(", ");
  const details = result.violations.map((v) => `${v.code}: ${v.evidence}`).join(" ");
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `FALSE-GREEN-GATE blocked an unproven completion claim (${codes}). ${details}`,
  }));
}

function writePayload(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function main() {
  try {
    const context = readStopHookContext();
    publishStopHookReceipt(context.receipt);
    if (context.transcript == null) return allow();

    const result = detectFalseGreen(context.transcript);
    if (result.verdict === "FLAG") return block(result);
    return allow();
  } catch (error) {
    publishStopHookReceipt(error?.receipt);
    const payload = readerFailurePayload(error, "FALSE-GREEN-GATE");
    if (payload) return writePayload(payload);
    return allow();
  }
}

main();

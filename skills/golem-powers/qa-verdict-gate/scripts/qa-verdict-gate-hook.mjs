#!/usr/bin/env node
// Claude Code Stop-hook wrapper for qa-verdict-gate.
//
// Stdout schema:
//   allow: {}
//   block: {"decision":"block","reason":"..."}
//   advisory: {"systemMessage":"..."}
//
// Hang-safety contract: no network, no BrainLayer, bounded tail/state reads,
// no subprocesses, and fail-open on malformed input or internal errors.

import {
  publishStopHookReceipt,
  readerFailurePayload,
  readStopHookContext,
} from "../../_shared/stop-hook-runtime/stop-hook-reader.mjs";
import { detectQaVerdict } from "../src/qa-verdict-gate.mjs";

function allow() {
  process.stdout.write("{}");
}

function block(result) {
  const codes = result.violations.map((v) => v.code).join(", ");
  const details = result.violations.map((v) => `${v.code}: ${v.evidence}`).join(" ");
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `QA-VERDICT-GATE blocked an unearned QA verdict (${codes}). ${details}`,
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

    const result = detectQaVerdict(context.transcript);
    if (result.verdict === "FLAG") return block(result);
    return allow();
  } catch (error) {
    publishStopHookReceipt(error?.receipt);
    const payload = readerFailurePayload(error, "QA-VERDICT-GATE");
    if (payload) return writePayload(payload);
    return allow();
  }
}

main();

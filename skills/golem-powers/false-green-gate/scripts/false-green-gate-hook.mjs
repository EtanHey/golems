#!/usr/bin/env node
// Claude Code Stop-hook wrapper for false-green-gate.
//
// Stdout schema:
//   allow: {}
//   advisory: {}  logged to ~/.claude/hooks/stop-advisories.jsonl (2026-10-19 eval)
//   advisory with GOLEMS_STOP_ADVISORY_RENDER=1: {"systemMessage":"..."}
//   never a block: GO-5 E2
//
// Hang-safety contract: no network, no BrainLayer, bounded tail/state reads,
// no subprocesses, and fail-open on malformed input or internal errors.

import {
  publishStopHookReceipt,
  readerFailurePayload,
  readStopHookContext,
} from "../../_shared/stop-hook-runtime/stop-hook-reader.mjs";
import { emitAdvisory } from "../../_shared/stop-hook-runtime/stop-advisory.mjs";
import { detectFalseGreen } from "../src/false-green-gate.mjs";

function allow() {
  process.stdout.write("{}");
}

// GO-5 E2: a Stop block makes the model continue its turn, so a flag is an
// advisory: logged by default, rendered as a systemMessage only on opt-in.
function advise(result, payload) {
  const codes = result.violations.map((v) => v.code);
  const details = result.violations.map((v) => `${v.code}: ${v.evidence}`).join(" ");
  writePayload(emitAdvisory({
    gate: "false-green-gate",
    codes,
    message: `FALSE-GREEN-GATE advisory: flagged an unproven completion claim (${codes.join(", ")}). ${details}`,
    payload,
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
    if (result.verdict === "FLAG") return advise(result, context.payload);
    return allow();
  } catch (error) {
    publishStopHookReceipt(error?.receipt);
    const payload = readerFailurePayload(error, "FALSE-GREEN-GATE");
    if (payload) return writePayload(payload);
    return allow();
  }
}

main();

#!/usr/bin/env node
// Claude Code Stop-hook wrapper for fleet-wrap-gate.
//
// Stdout schema:
//   allow: {}
//   advisory: {}  logged to ~/.claude/hooks/stop-advisories.jsonl (2026-10-19 eval)
//   advisory with GOLEMS_STOP_ADVISORY_RENDER=1: {"systemMessage":"..."}
//   never a block: GO-5 E2
//
// Hang-safety contract: no network, no BrainLayer, bounded tail/state reads
// (plus at most 4 cited report files, 256 KiB each), no subprocesses, and
// fail-open on malformed input or internal errors.

import {
  publishStopHookReceipt,
  readerFailurePayload,
  readStopHookContext,
} from "../../_shared/stop-hook-runtime/stop-hook-reader.mjs";
import { emitAdvisory } from "../../_shared/stop-hook-runtime/stop-advisory.mjs";
import { readReport } from "../lib/report-reader.mjs";
import { CLEANUP_RECEIPT_CODE as RECEIPT_CODE, detectFleetWrap } from "../src/fleet-wrap-gate.mjs";

function allow() {
  process.stdout.write("{}");
}

// GO-5 E2: a Stop block makes the model continue its turn, so a flag is an
// advisory: logged by default, rendered as a systemMessage only on opt-in.
function advise(result, payload) {
  const codes = result.violations.map((violation) => violation.code);
  const periodic = codes.filter((code) => code !== RECEIPT_CODE);
  const leads = [];
  if (periodic.length) leads.push(`flagged terminal silence with live periodic work (${periodic.join(", ")})`);
  if (codes.includes(RECEIPT_CODE)) leads.push(`flagged a lane DONE report with no cleanup receipt (${RECEIPT_CODE})`);
  const details = result.violations
    .map((violation) => `${violation.code}: ${violation.evidence} Cleanup: ${violation.action}.`)
    .join(" ");
  writePayload(emitAdvisory({
    gate: "fleet-wrap-gate",
    codes,
    message: `FLEET-WRAP-GATE advisory: ${leads.join("; ")}. ${details}`,
    payload,
  }));
}

function writePayload(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function main() {
  try {
    const context = readStopHookContext({ discoverDefaultTasks: true });
    publishStopHookReceipt(context.receipt);
    if (context.transcript == null) return allow();

    const result = detectFleetWrap(context.transcript, {
      state: context.state,
      sessionId: context.sessionId,
      readReport,
    });
    if (result.verdict === "FLAG") return advise(result, context.payload);
    return allow();
  } catch (error) {
    publishStopHookReceipt(error?.receipt);
    const payload = readerFailurePayload(error, "FLEET-WRAP-GATE");
    if (payload) return writePayload(payload);
    return allow();
  }
}

main();

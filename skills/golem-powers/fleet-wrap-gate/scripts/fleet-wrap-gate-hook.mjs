#!/usr/bin/env node
// Claude Code Stop-hook wrapper for fleet-wrap-gate.
//
// Stdout schema:
//   allow: {}
//   advisory: {"systemMessage":"..."}  (never a block: GO-5 E2)
//
// Hang-safety contract: no network, no BrainLayer, bounded tail/state reads
// (plus at most 4 cited report files, 256 KiB each), no subprocesses, and
// fail-open on malformed input or internal errors.

import {
  publishStopHookReceipt,
  readerFailurePayload,
  readStopHookContext,
} from "../../_shared/stop-hook-runtime/stop-hook-reader.mjs";
import { readReport } from "../lib/report-reader.mjs";
import { detectFleetWrap } from "../src/fleet-wrap-gate.mjs";

const RECEIPT_CODE = "FLEETWRAP_CLEANUP_RECEIPT_MISSING";

function allow() {
  process.stdout.write("{}");
}

// GO-5 E2: a Stop block makes the model continue its turn, so a flag reaches
// it as an advisory systemMessage instead.
function advise(result) {
  const codes = result.violations.map((violation) => violation.code);
  const periodic = codes.filter((code) => code !== RECEIPT_CODE);
  const leads = [];
  if (periodic.length) leads.push(`flagged terminal silence with live periodic work (${periodic.join(", ")})`);
  if (codes.includes(RECEIPT_CODE)) leads.push(`flagged a lane DONE report with no cleanup receipt (${RECEIPT_CODE})`);
  const details = result.violations
    .map((violation) => `${violation.code}: ${violation.evidence} Cleanup: ${violation.action}.`)
    .join(" ");
  process.stdout.write(JSON.stringify({
    systemMessage: `FLEET-WRAP-GATE advisory: ${leads.join("; ")}. ${details}`,
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
    if (result.verdict === "FLAG") return advise(result);
    return allow();
  } catch (error) {
    publishStopHookReceipt(error?.receipt);
    const payload = readerFailurePayload(error, "FLEET-WRAP-GATE");
    if (payload) return writePayload(payload);
    return allow();
  }
}

main();

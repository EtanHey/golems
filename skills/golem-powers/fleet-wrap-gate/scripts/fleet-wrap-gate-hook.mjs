#!/usr/bin/env node
// Claude Code Stop-hook wrapper for fleet-wrap-gate.
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
import { detectFleetWrap } from "../src/fleet-wrap-gate.mjs";

function allow() {
  process.stdout.write("{}");
}

function block(result) {
  const codes = result.violations.map((violation) => violation.code).join(", ");
  const details = result.violations
    .map((violation) => `${violation.code}: ${violation.evidence} Cleanup: ${violation.action}.`)
    .join(" ");
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `FLEET-WRAP-GATE blocked terminal silence with live periodic work (${codes}). ${details}`,
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
    });
    if (result.verdict === "FLAG") return block(result);
    return allow();
  } catch (error) {
    publishStopHookReceipt(error?.receipt);
    const payload = readerFailurePayload(error, "FLEET-WRAP-GATE");
    if (payload) return writePayload(payload);
    return allow();
  }
}

main();

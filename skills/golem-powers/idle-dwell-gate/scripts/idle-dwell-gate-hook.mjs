#!/usr/bin/env node
// Claude Code Stop-hook wrapper for idle-dwell-gate.
//
// Stdout schema:
//   allow: {}
//   block: {"decision":"block","reason":"..."}
//   advisory: {"systemMessage":"..."}
//
// Hang-safety contract: no network, no BrainLayer, no subprocesses, bounded
// tail/state reads, and fail-open on malformed input or internal errors.

import {
  publishStopHookReceipt,
  readerFailurePayload,
  readStopHookContext,
} from "../../_shared/stop-hook-runtime/stop-hook-reader.mjs";
import { detectIdleDwell, hookPayloadFor } from "../src/idle-dwell-gate.mjs";

function allow() {
  process.stdout.write("{}");
}

function writePayload(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function main() {
  try {
    const context = readStopHookContext();
    publishStopHookReceipt(context.receipt);
    if (context.transcript == null) return allow();
    writePayload(hookPayloadFor(detectIdleDwell(context.transcript, { state: context.state })));
  } catch (error) {
    publishStopHookReceipt(error?.receipt);
    const payload = readerFailurePayload(error, "IDLE-DWELL-GATE");
    if (payload) return writePayload(payload);
    return allow();
  }
}

main();

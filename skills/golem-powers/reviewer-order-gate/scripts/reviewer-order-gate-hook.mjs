#!/usr/bin/env node
// Claude Code PreToolUse hook wrapper for reviewer-order-gate.
//
// Stdout schema:
//   allow / not a reviewer spawn: {}
//   deny:     {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
//   advisory: {"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}}
//
// Fail-open contract: any internal error, missing gh, or gh timeout allows the
// spawn with an advisory. The gate never blocks on its own failure. gh calls
// share one budget (REVIEWER_ORDER_GATE_GH_BUDGET_MS, default and ceiling 3500)
// and a timed-out gh is SIGKILLed, so the hook finishes inside its 5 s timeout.

import { readSync } from "node:fs";
import { evaluate } from "../src/reviewer-order-gate.mjs";

const MAX_INPUT_BYTES = 256 * 1024;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function deny(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `REVIEWER-ORDER-GATE: implementer not done — ${reason}. Spawn the reviewer after the implementer reports done: cite its report path (last line DONE_<ID>) or its PR once checks finish.`.replace(/\s*\n\s*/g, " "),
    },
  });
}

function advisory(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: `REVIEWER-ORDER-GATE advisory: ${reason}; reviewer spawn allowed unchecked. Confirm the implementer reported done before the reviewer starts.`,
    },
  });
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

function main() {
  try {
    const raw = readBoundedStdin();
    if (raw === null) return advisory("hook input over 256 KiB");
    if (!raw.trim()) return emit({});
    // evaluate() clamps the budget to 3.5 s, under the 5 s manifest timeout.
    const result = evaluate(JSON.parse(raw), { ghBudgetMs: process.env.REVIEWER_ORDER_GATE_GH_BUDGET_MS });
    if (result.verdict === "DENY") return deny(result.reason);
    if (result.verdict === "ADVISORY") return advisory(result.reason);
    return emit({});
  } catch (err) {
    return advisory(`gate error (${String(err?.message ?? err).split("\n")[0].slice(0, 160)})`);
  }
}

main();

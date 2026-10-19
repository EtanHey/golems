import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { publishStopHookReceipt } from "./stop-hook-reader.mjs";

// Stop-advisory eval 2026-10-19: false-green 3/25 useful, fleet-wrap 0/25, and
// 0/47 follow-ups responded to a rendered advisory. Advisories are therefore
// logged, not rendered, unless GOLEMS_STOP_ADVISORY_RENDER=1.
export const ADVISORY_RENDER_ENV = "GOLEMS_STOP_ADVISORY_RENDER";

export function advisoryLogPath() {
  return process.env.STOP_ADVISORY_LOG_PATH ??
    path.join(homedir(), ".claude", "hooks", "stop-advisories.jsonl");
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

// Returns the hook's stdout payload. Quiet mode appends one log line and
// prints {}; a log failure never throws and never changes that output.
// The telemetry receipt line keeps a quiet advisory counted as an advisory.
export function emitAdvisory({ gate, codes, message, payload }) {
  if (process.env[ADVISORY_RENDER_ENV] === "1") {
    publishStopHookReceipt({ advisoryRendered: true });
    return { systemMessage: message };
  }
  publishStopHookReceipt({ advisoryRendered: false });
  try {
    const row = {
      schema: "golems.stop-advisory.v1",
      ts: new Date().toISOString(),
      gate,
      session_id: stringOrNull(payload?.session_id ?? payload?.sessionId),
      transcript_path: stringOrNull(payload?.transcript_path ?? payload?.transcriptPath),
      cwd: stringOrNull(payload?.cwd) ?? process.cwd(),
      codes,
      message,
    };
    const logPath = advisoryLogPath();
    mkdirSync(path.dirname(logPath), { recursive: true });
    // The message quotes transcript evidence, so a new log is owner-only.
    appendFileSync(logPath, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // The advisory log cannot alter or block the Stop decision.
  }
  return {};
}

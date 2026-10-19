import { closeSync, constants, fstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { publishStopHookReceipt } from "./stop-hook-reader.mjs";

// Stop-advisory eval 2026-10-19: false-green 3/25 useful, fleet-wrap 0/25, and
// 0/47 follow-ups responded to a rendered advisory. Advisories are therefore
// logged, not rendered, unless GOLEMS_STOP_ADVISORY_RENDER=1.
export const ADVISORY_RENDER_ENV = "GOLEMS_STOP_ADVISORY_RENDER";

// O_NONBLOCK: a FIFO with no reader would block a plain append open and hang
// Stop (r1 review); nonblocking, it fails with ENXIO instead.
const LOG_OPEN_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NONBLOCK;
// A short write retries the remainder (r2 review), bounded so Stop cannot spin.
const MAX_WRITE_ATTEMPTS = 8;

export function advisoryLogPath() {
  return process.env.STOP_ADVISORY_LOG_PATH ??
    path.join(homedir(), ".claude", "hooks", "stop-advisories.jsonl");
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

// The message quotes transcript evidence, so a new log is owner-only. Only a
// regular file is written; a FIFO, device or socket (also via symlink) is skipped.
function appendToRegularFile(logPath, line) {
  const fd = openSync(logPath, LOG_OPEN_FLAGS, 0o600);
  try {
    if (!fstatSync(fd).isFile()) return;
    const bytes = Buffer.from(line, "utf8");
    let offset = 0;
    for (let attempt = 0; offset < bytes.length && attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) break;
      offset += written;
    }
  } finally {
    closeSync(fd);
  }
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
    appendToRegularFile(logPath, `${JSON.stringify(row)}\n`);
  } catch {
    // The advisory log cannot alter or block the Stop decision.
  }
  return {};
}

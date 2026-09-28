// Bounded reader for a report file a DONE turn cites (fleet-wrap-gate's
// FLEETWRAP_CLEANUP_RECEIPT_MISSING check looks there for the CLEANUP RECEIPT).
// Local .md/.txt only, at most REPORT_MAX_BYTES; any error means "no receipt".
// The detector caps how many cited paths it asks for (MAX_REPORT_READS).

import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPORT_MAX_BYTES = 256 * 1024;

export function readReport(filePath) {
  if (typeof filePath !== "string" || !/\.(md|txt)$/i.test(filePath)) return null;
  const resolved = filePath.startsWith("~/") ? path.join(os.homedir(), filePath.slice(2)) : filePath;
  if (!path.isAbsolute(resolved)) return null;
  try {
    const stat = statSync(resolved);
    if (!stat.isFile() || stat.size > REPORT_MAX_BYTES) return null;
    return readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
}

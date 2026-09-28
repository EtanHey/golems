// Bounded reader for a report file a DONE turn cites (fleet-wrap-gate's
// FLEETWRAP_CLEANUP_RECEIPT_MISSING check looks there for the CLEANUP RECEIPT).
// Any error or failed check means "no receipt"; contents are only ever matched
// against the receipt shape, never echoed. The detector caps how many eligible
// paths it asks for (MAX_REPORT_READS).
//
// Path policy (stated in SKILL.md § Stated Limits):
//   - the cited path must be absolute or `~/`, end in .md/.txt, and contain
//     no `..` segment (rejected outright, never normalized);
//   - symlinks are allowed only when their realpath target passes every
//     check: a .md/.txt name, a regular file, at most REPORT_MAX_BYTES;
//   - the target is opened ONCE (O_NOFOLLOW so a last-component swap after
//     realpath fails, O_NONBLOCK so a FIFO cannot hang the Stop hook) and its
//     type and size come from fstat on that same descriptor.
// There is no trusted directory boundary: any local file the user can read
// and that passes the checks may be read.

import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPORT_MAX_BYTES = 256 * 1024;
const REPORT_EXT_RE = /\.(md|txt)$/i;

// Pure string check shared with the detector, so ineligible paths never use
// up the read cap. Returns the absolute path to open, or null.
export function eligibleReportPath(filePath) {
  if (typeof filePath !== "string" || !REPORT_EXT_RE.test(filePath)) return null;
  if (filePath.split(/[\\/]/).includes("..")) return null;
  const resolved = filePath.startsWith("~/") ? path.join(os.homedir(), filePath.slice(2)) : filePath;
  return path.isAbsolute(resolved) ? resolved : null;
}

export function readReport(filePath) {
  const resolved = eligibleReportPath(filePath);
  if (!resolved) return null;
  let fd;
  try {
    const target = realpathSync(resolved);
    if (!REPORT_EXT_RE.test(target)) return null;
    fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > REPORT_MAX_BYTES) return null;
    // Read at most one byte past the cap in case the file grew after fstat.
    const buf = Buffer.alloc(REPORT_MAX_BYTES + 1);
    let length = 0;
    while (length < buf.length) {
      const n = readSync(fd, buf, length, buf.length - length, null);
      if (n === 0) break;
      length += n;
    }
    return length > REPORT_MAX_BYTES ? null : buf.toString("utf8", 0, length);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

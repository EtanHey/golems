#!/usr/bin/env node
// Requires a producer's ratchet table comment on a PR: the marker comment, posted by an allowed
// author, whose verdict is bound to this exact head SHA with every enforced real row PASS.
// Only an explicitly configured disk report-only row may carry a validated health warning.
// Missing, stale or red = exit 1 (standards/ratchet.md rule 3: missing is FAIL, never SKIP).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { baseRowsAt, findSticky, parseRows, readVerdict, validDiskMeasurement } from "./table.mjs";

export function checkVerdict({ comments, marker, head, expectedReal, authors, baseHasRows, expectedReportOnly = [] }) {
  // The same comment the producer PATCHes (findSticky), never a newer or older look-alike.
  const sticky = findSticky(comments, marker, authors);
  if (!sticky) return { ok: false, reason: `no ${marker} ratchet comment from ${authors.join("/")}` };
  // Only the fixed line right after the marker is a verdict (table.mjs escapes every cell).
  const verdict = readVerdict(sticky.body, marker);
  if (!verdict) return { ok: false, reason: "ratchet verdict unreadable" };
  // A verdict that skipped the direction check is only acceptable where there was nothing to check.
  if (baseHasRows && verdict.bootstrap !== false) return { ok: false, reason: "bootstrap verdict (direction unchecked) but the base branch has a row file" };
  if (verdict.head !== head) return { ok: false, reason: `stale: table is for ${String(verdict.head).slice(0, 8)}, PR head is ${head.slice(0, 8)}` };
  if (![expectedReal, verdict.real_pass, verdict.real_total].every(value => Number.isSafeInteger(value) && value >= 0)) return { ok: false, reason: "invalid real row counts: expected nonnegative integers" };
  if (verdict.real_total !== expectedReal) return { ok: false, reason: `table has ${verdict.real_total} real rows, expected ${expectedReal}` };
  const reporting = verdict.report_only ?? [];
  if (!Array.isArray(reporting) || reporting.length !== expectedReportOnly.length
    || new Set(reporting.map(r => r?.id)).size !== reporting.length
    || reporting.some(r => r?.id !== "disk-free-floor" || !expectedReportOnly.includes(r.id) || !validDiskMeasurement(r.measurement)))
    return { ok: false, reason: "invalid or unauthorized report-only measurement" };
  const warnings = reporting.filter(r => !r.measurement.health).length;
  if (verdict.ok !== true || verdict.real_pass + warnings !== verdict.real_total) return { ok: false, reason: `verdict FAIL (${verdict.real_pass}/${verdict.real_total} real rows PASS)` };
  return { ok: true, reason: `${verdict.real_pass}/${verdict.real_total} real rows PASS; ${warnings} measured report-only warnings at ${head.slice(0, 8)}` };
}

function parseArgs(argv) {
  const options = { authors: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (value === undefined || value.startsWith("--")) throw new Error(`incomplete argument ${key}`);
    if (key === "--author") options.authors.push(value);
    else if (["--repo", "--pr", "--marker", "--head", "--rows", "--runner", "--base-ref"].includes(key)) options[key.slice(2)] = value;
    else throw new Error(`unknown argument ${key}`);
  }
  for (const key of ["repo", "pr", "marker", "head", "rows", "runner", "base-ref"]) if (!options[key]) throw new Error(`--${key} is required`);
  if (!options.authors.length) throw new Error("at least one --author is required");
  return options;
}

export function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`ratchet: ${error.message}\n`);
    return 2;
  }
  let rows;
  let baseHasRows;
  try {
    rows = parseRows(JSON.parse(readFileSync(options.rows, "utf8")));
    baseHasRows = baseRowsAt(options.rows, options["base-ref"]) !== null;
  } catch (error) {
    process.stderr.write(`ratchet: ${error.message}\n`);
    return 2;
  }
  const expectedReal = rows.rows.filter((row) => row.runner === options.runner && row.kind === "real").length;
  const expectedReportOnly = rows.rows.filter(row => row.runner === options.runner && row.report_only).map(row => row.id);
  const gh = spawnSync("gh", ["api", "--paginate", "--slurp", `repos/${options.repo}/issues/${options.pr}/comments`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (gh.status !== 0) {
    process.stderr.write(`ratchet: cannot read PR comments: ${gh.stderr}\n`);
    return 1;
  }
  const result = checkVerdict({ comments: JSON.parse(gh.stdout).flat(), marker: options.marker, head: options.head, expectedReal, expectedReportOnly, authors: options.authors, baseHasRows });
  process.stdout.write(`ratchet ${options.marker}: ${result.ok ? "PASS" : "FAIL"}: ${result.reason}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));

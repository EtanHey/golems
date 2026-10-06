#!/usr/bin/env node
// Ratchet table: one row file + one results JSON -> a markdown table, ONE sticky PR comment, and
// an exit code. Repo-agnostic on purpose: the contract lives in standards/ratchet.md, and any repo
// calls this script with its own row file. Exit 0 = every selected row within its ceiling, 1 = a
// row FAILED or is MISSING, no row was selected, or a row was loosened without a `ratchet-loosen:`
// ruling, 2 = bad input. Every check fails closed: --head and --base-ref are required, and only a
// base that verifiably has no row file skips the direction check (bootstrap).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KINDS = new Set(["real", "unit"]);
const DIRECTIONS = new Set(["max", "min", "pass"]);
const REF_KINDS = new Set(["commit", "fixture-hash"]);
const ROW_ID = /^[A-Za-z0-9_.:-]+$/;
const SHA = /^[0-9a-f]{7,40}$/;
const FIXTURE_HASH = /^[0-9a-f]{8,64}$/;
// Strict schema: a key nobody validates is a key a producer could later read unchecked.
const FILE_KEYS = new Set(["schema", "rows"]);
const ROW_KEYS = new Set(["id", "metric", "kind", "runner", "direction", "ceiling", "command", "timeout_s", "bug_sha", "fix_sha", "ref_kind", "bug_fixture", "fix_fixture"]);
// Evidence, not measurement: editing these is allowed but always listed in the table.
const METADATA_KEYS = ["bug_sha", "fix_sha", "ref_kind", "bug_fixture", "fix_fixture"];
const short = (sha) => (typeof sha === "string" && sha ? escapeCell(sha.slice(0, 8)) : "none");

export function markerComment(marker) {
  return `<!-- ratchet-table: ${marker} -->`;
}

export const VERDICT_PREFIX = "<!-- ratchet-verdict: ";

export function parseRows(doc) {
  if (!doc || doc.schema !== 1 || !Array.isArray(doc.rows)) throw new Error("row file needs schema: 1 and a rows array");
  for (const key of Object.keys(doc)) if (!FILE_KEYS.has(key)) throw new Error(`row file: unknown key ${key}`);
  const seen = new Set();
  for (const row of doc.rows) {
    const where = `row ${JSON.stringify(row?.id)}`;
    for (const key of Object.keys(row ?? {})) if (!ROW_KEYS.has(key)) throw new Error(`${where}: unknown key ${key}`);
    // The id charset is the ruling line's, so every row can be ruled.
    if (typeof row?.id !== "string" || !ROW_ID.test(row.id)) throw new Error(`${where}: id must match ${ROW_ID}`);
    if (seen.has(row.id)) throw new Error(`duplicate row id ${row.id}`);
    seen.add(row.id);
    if (typeof row.metric !== "string" || !row.metric) throw new Error(`${where}: metric is required`);
    if (!KINDS.has(row.kind)) throw new Error(`${where}: kind must be real or unit`);
    if (!DIRECTIONS.has(row.direction)) throw new Error(`${where}: direction must be max, min or pass`);
    if (row.direction === "pass" ? row.ceiling !== true : typeof row.ceiling !== "number") {
      throw new Error(`${where}: ceiling must be ${row.direction === "pass" ? "true" : "a number"}`);
    }
    if (typeof row.command !== "string" || !row.command) throw new Error(`${where}: command is required`);
    if (row.kind === "real") {
      // Rule 1: a real row is a failure we hit, shown FAIL on the bug commit and PASS on the fix.
      for (const key of ["bug_sha", "fix_sha"]) {
        if (typeof row[key] !== "string" || !SHA.test(row[key])) throw new Error(`${where}: real rows need ${key} (a commit SHA)`);
      }
    }
    // A failure fixed in a private fixture (not a commit) keeps the commit SHAs and adds both
    // fixture content hashes.
    if (row.ref_kind !== undefined && !REF_KINDS.has(row.ref_kind)) throw new Error(`${where}: ref_kind must be commit or fixture-hash`);
    if (row.ref_kind === "fixture-hash") {
      for (const key of ["bug_fixture", "fix_fixture"]) {
        if (typeof row[key] !== "string" || !FIXTURE_HASH.test(row[key])) throw new Error(`${where}: fixture-hash rows need ${key} (a content hash)`);
      }
    }
    if (row.runner !== undefined && typeof row.runner !== "string") throw new Error(`${where}: runner must be a string`);
    if (row.timeout_s !== undefined && !(Number.isInteger(row.timeout_s) && row.timeout_s > 0)) throw new Error(`${where}: timeout_s must be a positive integer`);
  }
  return doc;
}

function resultOf(entry) {
  if (entry === undefined || entry === null) return undefined;
  if (typeof entry === "object") return { value: entry.value, detail: entry.detail };
  return { value: entry, detail: undefined };
}

function judge(row, value) {
  if (row.direction === "pass") return value === true;
  if (typeof value !== "number" || Number.isNaN(value)) return false;
  return row.direction === "max" ? value <= row.ceiling : value >= row.ceiling;
}

// Any change to what a row measures is loosening unless it is a pure tightening: a stricter
// ceiling, or promoting unit -> real. A swapped `command` could otherwise pass trivially.
function loosening(before, after) {
  if (!after) return "row removed";
  if (before.kind === "real" && after.kind !== "real") return "demoted real → unit";
  // Moving a row to another producer drops it from the one that measured it.
  if ((before.runner ?? null) !== (after.runner ?? null)) return `runner ${before.runner ?? "(any)"} → ${after.runner ?? "(any)"}`;
  if (before.direction !== after.direction) return `direction ${before.direction} → ${after.direction}`;
  if (before.direction === "max" && after.ceiling > before.ceiling) return `ceiling ${before.ceiling} → ${after.ceiling}`;
  if (before.direction === "min" && after.ceiling < before.ceiling) return `ceiling ${before.ceiling} → ${after.ceiling}`;
  for (const field of ["command", "metric"]) if (before[field] !== after[field]) return `${field} changed`;
  // More time to pass is a looser row; no timeout means the producer's default.
  if (before.timeout_s !== undefined && (after.timeout_s === undefined || after.timeout_s > before.timeout_s)) return `timeout_s ${before.timeout_s} → ${after.timeout_s ?? "default"}`;
  return null;
}

function rulings(prBody) {
  const ids = new Set();
  for (const line of String(prBody ?? "").split(/\r?\n/)) {
    const match = /^\s*ratchet-loosen:\s*([A-Za-z0-9_.:-]+)\s+\S/.exec(line);
    if (match) ids.add(match[1]);
  }
  return ids;
}

// `baseRows: null` is accepted only with `bootstrap: true` (the base has no row file yet).
export function evaluate({ rows, results, head, baseRows, bootstrap = false, baseline = null, prBody = "", runner = null }) {
  if (!head) throw new Error("head is required: results are checked against the SHA under test");
  if (!baseRows && !bootstrap) throw new Error("base rows are required (or bootstrap for a base without a row file)");
  const selected = rows.rows.filter((row) => !runner || row.runner === runner);
  const stale = results?.head_sha !== head;
  const values = stale ? {} : (results?.results ?? {});
  const base = baseline?.results ?? {};
  const out = selected.map((row) => {
    const now = resultOf(values[row.id]);
    const before = resultOf(base[row.id]);
    const status = now === undefined ? "MISSING" : judge(row, now.value) ? "PASS" : "FAIL";
    const numeric = row.direction !== "pass" && typeof now?.value === "number" && typeof before?.value === "number";
    return { ...row, value: now?.value, detail: now?.detail, baseline: before?.value, delta: numeric ? now.value - before.value : null, status };
  });

  // Direction is checked across EVERY base row, whatever --runner selects.
  const ruled = rulings(prBody);
  const loosened = [];
  const metadata = [];
  if (baseRows) {
    const current = new Map(rows.rows.map((row) => [row.id, row]));
    for (const before of baseRows.rows) {
      const after = current.get(before.id);
      const reason = loosening(before, after);
      if (reason) loosened.push({ id: before.id, reason, ruled: ruled.has(before.id) });
      for (const field of METADATA_KEYS) {
        if (after && before[field] !== after[field]) metadata.push({ id: before.id, field, before: before[field], after: after[field] });
      }
    }
  }

  const real = out.filter((row) => row.kind === "real");
  return {
    rows: out,
    runner,
    head,
    stale,
    bootstrap: !baseRows,
    resultsSha: results?.head_sha ?? null,
    baselineSha: baseline?.head_sha ?? null,
    loosened,
    metadata,
    realPass: real.filter((row) => row.status === "PASS").length,
    realTotal: real.length,
    // No selected row is every row missing (a runner typo, `rows: []`), never a pass. A failing
    // unit row still fails the job (it is a test), but it never counts as ratchet evidence.
    ok: out.length > 0 && out.every((row) => row.status === "PASS") && loosened.every((entry) => entry.ruled),
  };
}

// Cells carry producer-controlled text: no pipe, newline or HTML may escape its cell. Every `&`,
// `<` and `>` is entity-escaped, so no comment opener or terminator of any shape survives.
// Backslashes before pipes, so `\|` cannot become an escaped backslash plus a live pipe.
export function escapeCell(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\|/g, "\\|");
}

function cell(row, value) {
  if (value === undefined || value === null) return "—";
  if (row.direction === "pass") return value === true ? "PASS" : value === false ? "FAIL" : escapeCell(JSON.stringify(value));
  return escapeCell(value);
}

function ceilingCell(row) {
  if (row.direction === "pass") return "PASS";
  return `${row.direction === "max" ? "≤" : "≥"} ${row.ceiling}`;
}

function deltaCell(delta) {
  if (delta === null) return "—";
  return delta > 0 ? `+${delta}` : String(delta);
}

export function renderTable(evaluation, { marker, title = "Ratchet table", producer, receipt } = {}) {
  // `bootstrap` lets a consumer FAIL a verdict that skipped the direction check on a base with rows.
  const verdict = { head: evaluation.head, ok: evaluation.ok, real_pass: evaluation.realPass, real_total: evaluation.realTotal, bootstrap: evaluation.bootstrap };
  // Which commit's row scripts produced it, and a hash of the producer's run receipt.
  if (producer) verdict.producer = producer;
  if (receipt) verdict.receipt = receipt;
  // Fixed position: the verdict is ALWAYS the line right after the marker; consumers read only it.
  const lines = [
    markerComment(marker),
    `${VERDICT_PREFIX}${JSON.stringify(verdict)} -->`,
    `### ${escapeCell(title)}`,
    "",
    `| row | kind | baseline@${short(evaluation.baselineSha)} | this PR@${short(evaluation.head)} | Δ | ceiling | status |`,
    "|---|---|---|---|---|---|---|",
  ];
  for (const row of evaluation.rows) {
    const value = row.detail ? `${cell(row, row.value)} (${escapeCell(row.detail)})` : cell(row, row.value);
    lines.push(`| \`${row.id}\` ${escapeCell(row.metric)} | ${row.kind} | ${cell(row, row.baseline)} | ${value} | ${deltaCell(row.delta)} | ${ceilingCell(row)} | ${row.status} |`);
  }
  lines.push("");
  if (!evaluation.rows.length) lines.push(`**No rows selected${evaluation.runner ? ` for runner \`${escapeCell(evaluation.runner)}\`` : ""}:** every row is missing → FAIL.`, "");
  if (evaluation.stale) lines.push(`**Stale results:** recorded for ${short(evaluation.resultsSha)}, this PR is at ${short(evaluation.head)}. Every row is MISSING until the table is re-run on this head.`, "");
  if (evaluation.bootstrap) lines.push("**Direction unchecked:** the base commit has no row file yet (bootstrap).", "");
  for (const entry of evaluation.loosened) {
    lines.push(`- Loosened \`${entry.id}\` (${escapeCell(entry.reason)}): ${entry.ruled ? "ruled in the PR body" : "**no `ratchet-loosen:` ruling in the PR body → FAIL**"}`);
  }
  if (evaluation.loosened.length) lines.push("");
  for (const entry of evaluation.metadata ?? []) {
    const show = (value) => (typeof value === "string" ? short(value) : escapeCell(value ?? "none"));
    lines.push(`- Metadata changed: \`${entry.id}\` ${entry.field} ${show(entry.before)} → ${show(entry.after)}`);
  }
  if (evaluation.metadata?.length) lines.push("");
  lines.push(`Real rows: ${evaluation.realPass}/${evaluation.realTotal} PASS. \`unit\` rows are shown but never count as ratchet evidence. Verdict: **${evaluation.ok ? "PASS" : "FAIL"}**.`);
  return lines.join("\n");
}

// The verdict a producer posted, read strictly from its fixed line; null when absent or malformed.
export function readVerdict(body, marker) {
  const lines = String(body ?? "").split("\n");
  if (lines[0] !== markerComment(marker) || !lines[1]?.startsWith(VERDICT_PREFIX) || !lines[1].endsWith(" -->")) return null;
  try {
    return JSON.parse(lines[1].slice(VERDICT_PREFIX.length, -4));
  } catch {
    return null;
  }
}

function runGh(args, input) {
  const result = spawnSync("gh", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${(result.stderr || result.error?.message || "").trim()}`);
  return result.stdout;
}

// THE sticky comment: the OLDEST comment by an allowed author whose first line is the marker. The
// producer PATCHes it and CI reads it, so both always agree on one comment (#689 R1 M2).
export function findSticky(comments, marker, authors) {
  const tag = markerComment(marker);
  return comments.find((comment) => authors.includes(comment.user?.login) && typeof comment.body === "string" && comment.body.split("\n")[0] === tag);
}

export function upsertComment({ repo, pr, marker, author, body, gh = runGh }) {
  if (!author) throw new Error("upsert needs the author the producer posts as");
  // `--slurp` turns the paginated pages into one array of pages; flatten it so a PR with more than
  // one page of comments still finds its sticky comment instead of posting a second one.
  const pages = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/issues/${pr}/comments`]) || "[]");
  // Only our own comment is ours to PATCH: another author's marker comment is never touched.
  const existing = findSticky(pages.flat(), marker, [author]);
  const payload = JSON.stringify({ body });
  if (existing) gh(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "--input", "-"], payload);
  else gh(["api", "--method", "POST", `repos/${repo}/issues/${pr}/comments`, "--input", "-"], payload);
}

// The row file as committed at the base, read by the script itself (never a caller-supplied copy).
// null means the base commit verifiably has no row file: bootstrap. A bad ref throws.
export function baseRowsAt(rowsPath, baseRef, git = spawnSync) {
  const dir = dirname(resolve(rowsPath));
  const run = (args) => git("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]).status !== 0) throw new Error(`--base-ref ${baseRef} is not a commit in this repository`);
  const spec = `${baseRef}:./${basename(rowsPath)}`;
  if (run(["cat-file", "-e", spec]).status !== 0) {
    // Absent at base is a bootstrap only if the file did not arrive by rename/copy from a base path.
    const rel = `${run(["rev-parse", "--show-prefix"]).stdout.trim()}${basename(rowsPath)}`;
    const diff = run(["diff", "--find-renames", "--find-copies", "--name-status", baseRef]);
    for (const line of String(diff.stdout ?? "").split("\n")) {
      const [status, from, to] = line.split("\t");
      if (/^[RC]/.test(status ?? "") && to === rel) throw new Error(`${rel} was renamed from ${from} vs base ${baseRef}: a moved row file is FAIL, never a bootstrap`);
    }
    return null;
  }
  const shown = run(["show", spec]);
  if (shown.status !== 0) throw new Error(`cannot read ${basename(rowsPath)} at base ${baseRef}: ${(shown.stderr ?? "").trim()}`);
  return parseRows(JSON.parse(shown.stdout));
}

function parseArgs(argv) {
  const options = { marker: "ratchet" };
  const keys = { "--rows": "rows", "--results": "results", "--baseline": "baseline", "--base-ref": "baseRef", "--pr-body-file": "prBodyFile", "--head": "head", "--runner": "runner", "--marker": "marker", "--title": "title", "--repo": "repo", "--pr": "pr", "--author": "author", "--out": "out", "--producer": "producer", "--receipt": "receipt" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = keys[argv[index]];
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith("--")) throw new Error(`unknown or incomplete argument ${argv[index]}`);
    options[key] = value;
    index += 1;
  }
  for (const key of ["rows", "results", "head", "baseRef"]) if (!options[key]) throw new Error(`--${key === "baseRef" ? "base-ref" : key} is required`);
  if (Boolean(options.repo) !== Boolean(options.pr)) throw new Error("--repo and --pr go together");
  if (options.repo && !options.author) throw new Error("--author is required to post (the login the producer posts as)");
  if (options.producer && !/^[0-9a-f]{40}$/.test(options.producer)) throw new Error("--producer must be a full commit SHA");
  if (options.receipt && !/^[0-9a-f]{64}$/.test(options.receipt)) throw new Error("--receipt must be a sha256");
  return options;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// A results file that is absent or unreadable is not bad input: every row is then MISSING (FAIL).
// One that names its SHA as anything but a string is malformed: exit 2.
function readResults(path) {
  let doc;
  try {
    doc = readJson(path);
  } catch (error) {
    process.stderr.write(`ratchet: results unreadable (${error.message}); every row is MISSING\n`);
    return { head_sha: null, results: {} };
  }
  if (doc?.head_sha !== undefined && doc?.head_sha !== null && typeof doc.head_sha !== "string") throw new Error(`${path}: head_sha must be a string`);
  return doc;
}

export function main(argv) {
  let options;
  let rows;
  let baseRows = null;
  let prBody = "";
  let results;
  let baseline = null;
  try {
    options = parseArgs(argv);
    rows = parseRows(readJson(options.rows));
    baseRows = baseRowsAt(options.rows, options.baseRef);
    if (options.prBodyFile) prBody = readFileSync(options.prBodyFile, "utf8");
    results = readResults(options.results);
    if (options.baseline) baseline = readResults(options.baseline);
  } catch (error) {
    process.stderr.write(`ratchet: ${error.message}\n`);
    return 2;
  }
  const evaluation = evaluate({
    rows,
    baseRows,
    bootstrap: baseRows === null,
    results,
    baseline,
    prBody,
    head: options.head,
    runner: options.runner ?? null,
  });
  const body = renderTable(evaluation, { marker: options.marker, title: options.title, producer: options.producer, receipt: options.receipt });
  process.stdout.write(`${body}\n`);
  if (options.out) writeFileSync(options.out, `${body}\n`);
  if (options.repo) upsertComment({ repo: options.repo, pr: options.pr, marker: options.marker, author: options.author, body });
  return evaluation.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));

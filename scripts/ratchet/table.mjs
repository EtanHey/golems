#!/usr/bin/env node
// Ratchet table: one row file + one results JSON -> a markdown table, ONE sticky PR comment, and
// an exit code. Repo-agnostic on purpose: the contract lives in standards/ratchet.md, and any repo
// calls this script with its own row file. Exit 0 = every row within its ceiling, 1 = a row FAILED,
// is MISSING, or was loosened without a `ratchet-loosen:` ruling, 2 = bad input.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KINDS = new Set(["real", "unit"]);
const DIRECTIONS = new Set(["max", "min", "pass"]);
const SHA = /^[0-9a-f]{7,40}$/;
const short = (sha) => (sha ? sha.slice(0, 8) : "?");

export function markerComment(marker) {
  return `<!-- ratchet-table: ${marker} -->`;
}

export function parseRows(doc) {
  if (!doc || doc.schema !== 1 || !Array.isArray(doc.rows)) throw new Error("row file needs schema: 1 and a rows array");
  const seen = new Set();
  for (const row of doc.rows) {
    const where = `row ${JSON.stringify(row?.id)}`;
    if (typeof row?.id !== "string" || !row.id) throw new Error("every row needs a string id");
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
    if (row.runner !== undefined && typeof row.runner !== "string") throw new Error(`${where}: runner must be a string`);
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

function loosening(before, after) {
  if (!after) return "row removed";
  if (before.kind === "real" && after.kind !== "real") return "demoted real → unit";
  if (before.direction !== after.direction) return `direction ${before.direction} → ${after.direction}`;
  if (before.direction === "max" && after.ceiling > before.ceiling) return `ceiling ${before.ceiling} → ${after.ceiling}`;
  if (before.direction === "min" && after.ceiling < before.ceiling) return `ceiling ${before.ceiling} → ${after.ceiling}`;
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

export function evaluate({ rows, results, baseline = null, baseRows = null, prBody = "", head = null, runner = null }) {
  const selected = rows.rows.filter((row) => !runner || row.runner === runner);
  const stale = Boolean(head) && results?.head_sha !== head;
  const values = stale ? {} : (results?.results ?? {});
  const base = baseline?.results ?? {};
  const out = selected.map((row) => {
    const now = resultOf(values[row.id]);
    const before = resultOf(base[row.id]);
    const status = now === undefined ? "MISSING" : judge(row, now.value) ? "PASS" : "FAIL";
    const numeric = row.direction !== "pass" && typeof now?.value === "number" && typeof before?.value === "number";
    return { ...row, value: now?.value, detail: now?.detail, baseline: before?.value, delta: numeric ? now.value - before.value : null, status };
  });

  const ruled = rulings(prBody);
  const loosened = [];
  if (baseRows) {
    const current = new Map(rows.rows.map((row) => [row.id, row]));
    for (const before of baseRows.rows) {
      if (runner && before.runner !== runner) continue;
      const reason = loosening(before, current.get(before.id));
      if (reason) loosened.push({ id: before.id, reason, ruled: ruled.has(before.id) });
    }
  }

  const real = out.filter((row) => row.kind === "real");
  return {
    rows: out,
    head,
    stale,
    resultsSha: results?.head_sha ?? null,
    baselineSha: baseline?.head_sha ?? null,
    loosened,
    realPass: real.filter((row) => row.status === "PASS").length,
    realTotal: real.length,
    // A failing unit row still fails the job (it is a test), but it never counts as ratchet evidence.
    ok: out.every((row) => row.status === "PASS") && loosened.every((entry) => entry.ruled),
  };
}

function cell(row, value) {
  if (value === undefined || value === null) return "—";
  if (row.direction === "pass") return value === true ? "PASS" : value === false ? "FAIL" : String(value);
  return String(value);
}

function ceilingCell(row) {
  if (row.direction === "pass") return "PASS";
  return `${row.direction === "max" ? "≤" : "≥"} ${row.ceiling}`;
}

function deltaCell(delta) {
  if (delta === null) return "—";
  return delta > 0 ? `+${delta}` : String(delta);
}

export function renderTable(evaluation, { marker, title = "Ratchet table" } = {}) {
  const head = evaluation.head ?? evaluation.resultsSha;
  const lines = [
    markerComment(marker),
    `### ${title}`,
    "",
    `| row | kind | baseline@${short(evaluation.baselineSha)} | this PR@${short(head)} | Δ | ceiling | status |`,
    "|---|---|---|---|---|---|---|",
  ];
  for (const row of evaluation.rows) {
    const value = row.detail ? `${cell(row, row.value)} (${row.detail})` : cell(row, row.value);
    lines.push(`| \`${row.id}\` ${row.metric} | ${row.kind} | ${cell(row, row.baseline)} | ${value} | ${deltaCell(row.delta)} | ${ceilingCell(row)} | ${row.status} |`);
  }
  lines.push("");
  if (evaluation.stale) lines.push(`**Stale results:** recorded for ${short(evaluation.resultsSha)}, this PR is at ${short(evaluation.head)}. Every row is MISSING until the table is re-run on this head.`, "");
  for (const entry of evaluation.loosened) {
    lines.push(`- Loosened \`${entry.id}\` (${entry.reason}): ${entry.ruled ? "ruled in the PR body" : "**no `ratchet-loosen:` ruling in the PR body → FAIL**"}`);
  }
  if (evaluation.loosened.length) lines.push("");
  lines.push(`Real rows: ${evaluation.realPass}/${evaluation.realTotal} PASS. \`unit\` rows are shown but never count as ratchet evidence. Verdict: **${evaluation.ok ? "PASS" : "FAIL"}**.`);
  const verdict = { head, ok: evaluation.ok, real_pass: evaluation.realPass, real_total: evaluation.realTotal };
  lines.push("", `<!-- ratchet-verdict: ${JSON.stringify(verdict)} -->`);
  return lines.join("\n");
}

function runGh(args, input) {
  const result = spawnSync("gh", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${(result.stderr || result.error?.message || "").trim()}`);
  return result.stdout;
}

export function upsertComment({ repo, pr, marker, body, gh = runGh }) {
  // `--slurp` turns the paginated pages into one array of pages; flatten it so a PR with more than
  // one page of comments still finds its sticky comment instead of posting a second one.
  const pages = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/issues/${pr}/comments`]) || "[]");
  const comments = pages.flat();
  const tag = markerComment(marker);
  const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.startsWith(tag));
  const payload = JSON.stringify({ body });
  if (existing) gh(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "--input", "-"], payload);
  else gh(["api", "--method", "POST", `repos/${repo}/issues/${pr}/comments`, "--input", "-"], payload);
}

function parseArgs(argv) {
  const options = { marker: "ratchet" };
  const keys = { "--rows": "rows", "--results": "results", "--baseline": "baseline", "--base-rows": "baseRows", "--pr-body-file": "prBodyFile", "--head": "head", "--runner": "runner", "--marker": "marker", "--title": "title", "--repo": "repo", "--pr": "pr", "--out": "out" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = keys[argv[index]];
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith("--")) throw new Error(`unknown or incomplete argument ${argv[index]}`);
    options[key] = value;
    index += 1;
  }
  if (!options.rows || !options.results) throw new Error("--rows and --results are required");
  if (Boolean(options.repo) !== Boolean(options.pr)) throw new Error("--repo and --pr go together");
  return options;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// A results file that is absent or unreadable is not bad input: every row is then MISSING (FAIL).
function readResults(path) {
  try {
    return readJson(path);
  } catch (error) {
    process.stderr.write(`ratchet: results unreadable (${error.message}); every row is MISSING\n`);
    return { head_sha: null, results: {} };
  }
}

export function main(argv) {
  let options;
  let rows;
  let baseRows = null;
  try {
    options = parseArgs(argv);
    rows = parseRows(readJson(options.rows));
    if (options.baseRows) baseRows = parseRows(readJson(options.baseRows));
  } catch (error) {
    process.stderr.write(`ratchet: ${error.message}\n`);
    return 2;
  }
  const evaluation = evaluate({
    rows,
    baseRows,
    results: readResults(options.results),
    baseline: options.baseline ? readResults(options.baseline) : null,
    prBody: options.prBodyFile ? readFileSync(options.prBodyFile, "utf8") : "",
    head: options.head ?? null,
    runner: options.runner ?? null,
  });
  const body = renderTable(evaluation, { marker: options.marker, title: options.title });
  process.stdout.write(`${body}\n`);
  if (options.out) writeFileSync(options.out, `${body}\n`);
  if (options.repo) upsertComment({ repo: options.repo, pr: options.pr, marker: options.marker, body });
  return evaluation.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));

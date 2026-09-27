// reviewer-order-gate: a cmux reviewer spawn is allowed only once the implementer
// is done. Rule (Etan, 2026-09-27, ~/.claude/CLAUDE.md § Merging): the implementer
// goes first; a reviewer never reads a half-finished diff.
//
// Evidence the boot brief must cite (either one):
//   (a) an implementer report file whose last non-empty line is a DONE_<ID> marker;
//   (b) an open GitHub PR whose head has every check completed. A cloud-session PR
//       (branch claude/…) writes no DONE marker, so its head must also be ≥10 min old.
//
// evaluate() returns { verdict, reason }:
//   SKIP     — not a reviewer spawn; the hook prints {}.
//   ALLOW    — evidence found.
//   DENY     — no evidence; reason names what was missing.
//   ADVISORY — the gate itself could not decide (gh missing, timeout, bad output);
//              the spawn is allowed and the reason is surfaced as context.

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

export const SPAWN_TOOL = /^mcp__cmux(layer)?__spawn_agent$/;
export const DONE_MARKER = /^DONE_[A-Z0-9_]+$/;
export const CLOUD_BRANCH_PREFIX = "claude/";
export const CLOUD_STABLE_MS = 10 * 60_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_REPORT_CANDIDATES = 20;
const MAX_PR_REFS = 3;
const GH_FIELDS = "state,headRefName,headRefOid,statusCheckRollup,commits";
const PENDING_CHECK_RUN = new Set(["QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED"]);
const PENDING_STATUS = new Set(["PENDING", "EXPECTED"]);

class GateError extends Error {}

export function lastNonEmptyLine(text) {
  const lines = String(text).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return "";
}

// Reads a whole small file, or only the tail of a large one (a report's marker is at the end).
function readBounded(file) {
  const st = statSync(file);
  if (!st.isFile()) return null;
  const n = Math.min(st.size, MAX_FILE_BYTES);
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.allocUnsafe(n);
    const got = readSync(fd, buf, 0, n, st.size - n);
    return buf.subarray(0, got).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function expandHome(p) {
  return p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p;
}

// Absolute or ~/ paths cited in prose, with trailing punctuation trimmed.
export function extractPaths(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?<![\w/.:])(~\/|\/)[^\s`'"<>()[\]{}]+/g)) {
    const p = expandHome(m[0].replace(/[.,;:!?]+$/, ""));
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function extractPrRefs(text) {
  const s = String(text);
  const found = [];
  for (const m of s.matchAll(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g)) {
    found.push({ at: m.index, label: m[0], args: [m[0]] });
  }
  for (const m of s.matchAll(/(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d+)\b/g)) {
    found.push({ at: m.index, label: m[0], args: [m[3], "--repo", `${m[1]}/${m[2]}`] });
  }
  for (const m of s.matchAll(/(?<=^|[\s([])#(\d+)\b/g)) {
    found.push({ at: m.index, label: `#${m[1]}`, args: [m[1]] });
  }
  const seen = new Set();
  return found
    .sort((a, b) => a.at - b.at)
    .filter((r) => !seen.has(r.label) && seen.add(r.label))
    .map(({ label, args }) => ({ label, args }));
}

export function classifyChecks(rollup) {
  const pending = [];
  for (const c of rollup ?? []) {
    const isStatus = c.__typename === "StatusContext" || (c.state && !c.status);
    const stillRunning = isStatus
      ? PENDING_STATUS.has(String(c.state).toUpperCase())
      : PENDING_CHECK_RUN.has(String(c.status).toUpperCase());
    if (stillRunning) pending.push(c.name ?? c.context ?? "unnamed");
  }
  return { total: (rollup ?? []).length, pending };
}

// The brief is the inline prompt or the boot_prompt_path file, plus any file it
// points at with "Read and follow <path>" (one level: the fleet's usual pointer).
function collectBrief(input) {
  const briefFiles = [];
  let text = "";
  if (typeof input.boot_prompt_path === "string" && input.boot_prompt_path.trim()) {
    const p = expandHome(input.boot_prompt_path.trim());
    const body = readOrGateError(p, "boot_prompt_path");
    briefFiles.push(p);
    text = body;
  } else if (typeof input.prompt === "string") {
    text = input.prompt;
  }
  for (const m of text.matchAll(/Read and follow\s+(\S+)/gi)) {
    const p = expandHome(m[1].replace(/[.,;:!?]+$/, ""));
    if (briefFiles.includes(p)) continue;
    briefFiles.push(p);
    text += `\n${readOrGateError(p, "the brief's Read-and-follow file")}`;
  }
  return { text, briefFiles };
}

function readOrGateError(p, what) {
  try {
    const body = readBounded(p);
    if (body == null) throw new Error("not a file");
    return body;
  } catch (err) {
    throw new GateError(`could not read ${what} ${p} (${err.code ?? err.message})`);
  }
}

function checkReports(paths) {
  const notDone = [];
  for (const p of paths.slice(0, MAX_REPORT_CANDIDATES)) {
    let body;
    try {
      body = readBounded(p);
    } catch {
      continue; // prose paths that are not files are not evidence either way
    }
    if (body == null) continue;
    if (DONE_MARKER.test(lastNonEmptyLine(body))) return { done: p };
    notDone.push(p);
  }
  return { notDone };
}

function runGh(args, { cwd, deadline, now }) {
  const remaining = deadline - now();
  if (remaining <= 0) throw new GateError("gh budget spent before every PR was checked (timed out)");
  const proc = spawnSync("gh", ["pr", "view", ...args, "--json", GH_FIELDS], {
    cwd,
    encoding: "utf8",
    timeout: remaining,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (proc.error?.code === "ENOENT") throw new GateError("gh is not installed or not on PATH");
  if (proc.error?.code === "ETIMEDOUT" || proc.signal) throw new GateError(`gh pr view ${args[0]} timed out`);
  if (proc.error) throw new GateError(`gh failed: ${proc.error.message}`);
  if (proc.status !== 0) {
    const err = (proc.stderr || "").trim();
    if (/could not resolve to a pullrequest|no pull requests? found|not found/i.test(err)) return null;
    throw new GateError(`gh pr view ${args[0]} exited ${proc.status}: ${err.split("\n")[0].slice(0, 160)}`);
  }
  try {
    return JSON.parse(proc.stdout);
  } catch {
    throw new GateError(`gh pr view ${args[0]} returned non-JSON output`);
  }
}

function headCommitDate(pr) {
  const commits = Array.isArray(pr.commits) ? pr.commits : [];
  const head = commits.find((c) => c.oid === pr.headRefOid) ?? commits[commits.length - 1];
  const t = Date.parse(head?.committedDate ?? "");
  return Number.isFinite(t) ? t : null;
}

// Returns null when the PR is done-evidence, else why it is not.
function prNotDoneReason(ref, pr, nowMs) {
  if (pr == null) return `${ref.label} was not found`;
  if (typeof pr !== "object" || !("statusCheckRollup" in pr)) {
    throw new GateError(`gh pr view ${ref.label} returned an unexpected shape`);
  }
  if (pr.state && pr.state !== "OPEN") return `${ref.label} is ${pr.state}, not an open PR under review`;
  const { total, pending } = classifyChecks(pr.statusCheckRollup);
  const head = String(pr.headRefOid ?? "").slice(0, 8);
  if (total === 0) return `${ref.label} has no checks reported on head ${head} yet`;
  if (pending.length) return `${ref.label} head ${head} has checks still running (${pending.slice(0, 3).join(", ")})`;
  if (String(pr.headRefName ?? "").startsWith(CLOUD_BRANCH_PREFIX)) {
    const at = headCommitDate(pr);
    if (at == null) throw new GateError(`could not read the head commit date of ${ref.label}`);
    const ageMin = Math.floor((nowMs - at) / 60_000);
    if (nowMs - at < CLOUD_STABLE_MS) {
      return `${ref.label} is a cloud branch ${pr.headRefName} whose head is ${ageMin} min old (needs ≥10 min stable)`;
    }
  }
  return null;
}

export function evaluate(payload, opts = {}) {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.ghBudgetMs ?? 3500;
  if (!payload || typeof payload !== "object") throw new GateError("payload is not an object");
  if (!SPAWN_TOOL.test(String(payload.tool_name ?? ""))) return { verdict: "SKIP" };
  const input = payload.tool_input ?? {};
  if (String(input.role ?? "").trim().toLowerCase() !== "reviewer") return { verdict: "SKIP" };

  try {
    const { text, briefFiles } = collectBrief(input);
    const reports = checkReports(extractPaths(text).filter((p) => !briefFiles.includes(p)));
    if (reports.done) return { verdict: "ALLOW", reason: `implementer report ${reports.done} ends in DONE` };

    const refs = extractPrRefs(text).slice(0, MAX_PR_REFS);
    const missing = reports.notDone.map((p) => `report ${p} does not end in a DONE_ marker`);
    if (refs.length) {
      const cwd = [input.cwd, payload.cwd].find((d) => typeof d === "string" && path.isAbsolute(d)) ?? process.cwd();
      const deadline = now() + budgetMs;
      for (const ref of refs) {
        const pr = runGh(ref.args, { cwd: expandHome(cwd), deadline, now });
        const why = prNotDoneReason(ref, pr, now());
        if (why == null) return { verdict: "ALLOW", reason: `${ref.label} has finished checks` };
        missing.push(why);
      }
    }
    if (!missing.length) {
      missing.push("the brief cites no implementer report ending in a DONE_ marker and no PR reference");
    }
    return { verdict: "DENY", reason: missing.join("; ") };
  } catch (err) {
    if (err instanceof GateError) return { verdict: "ADVISORY", reason: err.message };
    throw err;
  }
}

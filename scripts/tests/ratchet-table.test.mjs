import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { baseRowsAt, escapeCell, evaluate, markerComment, parseRows, readVerdict, renderTable, upsertComment } from "../ratchet/table.mjs";

const script = resolve(import.meta.dir, "../ratchet/table.mjs");
const BUG = "a".repeat(40);
const FIX = "b".repeat(40);
const HEAD = "c".repeat(40);
const MAIN = "d".repeat(40);
const scratch = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function dir() {
  const path = mkdtempSync(join(tmpdir(), "ratchet-table-"));
  scratch.push(path);
  return path;
}

function rowsFile(rows) {
  return { schema: 1, rows };
}

const drift = { id: "drift", metric: "hooks-live drift files", kind: "real", direction: "max", ceiling: 0, bug_sha: BUG, fix_sha: FIX, command: "drift.sh" };
const gate = { id: "gate", metric: "private gate passes", kind: "real", direction: "pass", ceiling: true, bug_sha: BUG, fix_sha: FIX, command: "gate.sh" };
const cover = { id: "cover", metric: "covered cases", kind: "real", direction: "min", ceiling: 10, bug_sha: BUG, fix_sha: FIX, command: "cover.sh" };
const unit = { id: "unit-hook", metric: "hook code deny/allow", kind: "unit", direction: "pass", ceiling: true, command: "unit.sh" };

function results(values, head = HEAD) {
  return { head_sha: head, results: values };
}

// Most cases do not exercise the direction check: compare against an identical base.
function run(rows, values, extra = {}) {
  return evaluate({ rows, baseRows: rows, results: results(values), head: HEAD, ...extra });
}

describe("parseRows", () => {
  test("accepts a valid row file", () => {
    expect(parseRows(rowsFile([drift, gate, cover, unit])).rows).toHaveLength(4);
  });

  test("a real row without its bug and fix SHAs is rejected (rule 1)", () => {
    const { bug_sha, ...noBug } = drift;
    expect(() => parseRows(rowsFile([noBug]))).toThrow(/bug_sha/);
  });

  test("a fixture-hash row also names its bug and fix fixture hashes", () => {
    const row = { ...gate, ref_kind: "fixture-hash", bug_fixture: "4".repeat(64), fix_fixture: "1".repeat(64) };
    expect(parseRows(rowsFile([row])).rows[0].ref_kind).toBe("fixture-hash");
    const { fix_fixture, ...noFix } = row;
    expect(() => parseRows(rowsFile([noFix]))).toThrow(/fix_fixture/);
    expect(() => parseRows(rowsFile([{ ...gate, ref_kind: "tag" }]))).toThrow(/ref_kind/);
  });

  test("duplicate ids, unknown kinds and unknown directions are rejected", () => {
    expect(() => parseRows(rowsFile([drift, drift]))).toThrow(/duplicate/);
    expect(() => parseRows(rowsFile([{ ...drift, kind: "mock" }]))).toThrow(/kind/);
    expect(() => parseRows(rowsFile([{ ...drift, direction: "down" }]))).toThrow(/direction/);
    expect(() => parseRows(rowsFile([{ ...drift, ceiling: "0" }]))).toThrow(/ceiling/);
  });

  test("a row id outside the ruling charset is rejected, so every row can be ruled", () => {
    expect(() => parseRows(rowsFile([{ ...drift, id: "has space" }]))).toThrow(/id must match/);
    expect(() => parseRows(rowsFile([{ ...drift, id: "a/b" }]))).toThrow(/id must match/);
  });
});

describe("evaluate", () => {
  const rows = parseRows(rowsFile([drift, gate, cover, unit]));

  test("all rows within their ceilings pass", () => {
    const out = run(rows, { drift: 0, gate: true, cover: { value: 12, detail: "12/12" }, "unit-hook": true });
    expect(out.ok).toBe(true);
    expect(out.rows.map((row) => row.status)).toEqual(["PASS", "PASS", "PASS", "PASS"]);
    expect(out.realPass).toBe(3);
    expect(out.realTotal).toBe(3);
  });

  test("over the ceiling fails, in either direction", () => {
    const out = run(rows, { drift: 2, gate: false, cover: 9, "unit-hook": true });
    expect(out.ok).toBe(false);
    expect(out.rows.slice(0, 3).map((row) => row.status)).toEqual(["FAIL", "FAIL", "FAIL"]);
  });

  test("the ceiling itself passes, in both numeric directions", () => {
    const out = run(rows, { drift: 0, gate: true, cover: 10, "unit-hook": true });
    expect(out.rows.map((row) => row.status)).toEqual(["PASS", "PASS", "PASS", "PASS"]);
  });

  test("a pass row passes only on boolean true, never a truthy value", () => {
    for (const value of ["true", 1, "PASS", {}]) {
      expect(run(parseRows(rowsFile([gate])), { gate: { value } }).rows[0].status).toBe("FAIL");
    }
  });

  test("a missing result is FAIL, never SKIP (rule 3)", () => {
    const out = run(rows, { drift: 0, gate: true, "unit-hook": true });
    expect(out.ok).toBe(false);
    expect(out.rows.find((row) => row.id === "cover").status).toBe("MISSING");
  });

  test("results bound to another SHA are stale: every row is MISSING", () => {
    const out = evaluate({ rows, baseRows: rows, results: results({ drift: 0, gate: true, cover: 12, "unit-hook": true }, MAIN), head: HEAD });
    expect(out.ok).toBe(false);
    expect(out.stale).toBe(true);
    expect(out.rows.every((row) => row.status === "MISSING")).toBe(true);
  });

  test("results with no SHA at all are stale too", () => {
    expect(evaluate({ rows, baseRows: rows, results: { results: { drift: 0 } }, head: HEAD }).stale).toBe(true);
  });

  test("head and base rows are required: no fail-open default", () => {
    expect(() => evaluate({ rows, baseRows: rows, results: results({}) })).toThrow(/head is required/);
    expect(() => evaluate({ rows, results: results({}), head: HEAD })).toThrow(/base rows are required/);
    expect(evaluate({ rows, results: results({}), head: HEAD, bootstrap: true }).bootstrap).toBe(true);
  });

  test("no selected row is FAIL: an empty row file or a runner typo", () => {
    const empty = evaluate({ rows: rowsFile([]), baseRows: rowsFile([]), results: results({}), head: HEAD });
    expect(empty.ok).toBe(false);
    const typo = run(parseRows(rowsFile([{ ...drift, runner: "mac" }])), { drift: 0 }, { runner: "macc" });
    expect(typo.rows).toHaveLength(0);
    expect(typo.ok).toBe(false);
  });

  test("a failing unit row fails the job but is not counted as ratchet evidence (rule 6)", () => {
    const out = run(rows, { drift: 0, gate: true, cover: 12, "unit-hook": false });
    expect(out.ok).toBe(false);
    expect(out.realPass).toBe(3);
    expect(out.realTotal).toBe(3);
  });

  test("Δ is computed against the baseline for numeric rows", () => {
    const out = run(rows, { drift: 0, gate: true, cover: 12, "unit-hook": true }, { baseline: results({ drift: 1, cover: 10 }, MAIN) });
    expect(out.rows.find((row) => row.id === "drift").delta).toBe(-1);
    expect(out.rows.find((row) => row.id === "cover").delta).toBe(2);
    expect(out.baselineSha).toBe(MAIN);
  });

  test("--runner selects only that runner's rows", () => {
    const split = parseRows(rowsFile([{ ...drift, runner: "mac" }, { ...unit, runner: "ci" }]));
    const out = run(split, { "unit-hook": true }, { runner: "ci" });
    expect(out.rows.map((row) => row.id)).toEqual(["unit-hook"]);
    expect(out.ok).toBe(true);
  });
});

describe("ratchet direction (rule 5)", () => {
  const base = parseRows(rowsFile([drift, gate, cover]));
  const pass = results({ drift: 0, gate: true, cover: 12 });
  const check = (rows, prBody = "", extra = {}) => evaluate({ rows: parseRows(rowsFile(rows)), baseRows: base, results: pass, head: HEAD, prBody, ...extra });

  test("tightening and adding rows needs no ruling", () => {
    const out = evaluate({ rows: parseRows(rowsFile([drift, gate, { ...cover, ceiling: 11 }, unit])), baseRows: base, results: results({ drift: 0, gate: true, cover: 12, "unit-hook": true }), head: HEAD });
    expect(out.loosened).toEqual([]);
    expect(out.ok).toBe(true);
  });

  test("raising a max ceiling, lowering a min ceiling, removing a row or demoting to unit is loosening", () => {
    const out = check([{ ...drift, ceiling: 1 }, { ...cover, ceiling: 9 }]);
    expect(out.loosened.map((entry) => entry.id).sort()).toEqual(["cover", "drift", "gate"]);
    expect(out.ok).toBe(false);
    expect(check([drift, { ...gate, kind: "unit" }, cover]).loosened.map((entry) => entry.id)).toEqual(["gate"]);
  });

  test("flipping a row's direction is loosening", () => {
    expect(check([{ ...drift, direction: "min" }, gate, cover]).loosened).toEqual([{ id: "drift", reason: "direction max → min", ruled: false }]);
  });

  test("moving a row to another runner (or dropping its runner) is loosening, whatever --runner selects", () => {
    const macBase = parseRows(rowsFile([{ ...drift, runner: "mac" }]));
    const moved = evaluate({ rows: parseRows(rowsFile([{ ...drift, runner: "nowhere" }])), baseRows: macBase, results: results({}), head: HEAD, runner: "mac" });
    expect(moved.loosened).toEqual([{ id: "drift", reason: "runner mac → nowhere", ruled: false }]);
    expect(moved.ok).toBe(false);
    const dropped = evaluate({ rows: parseRows(rowsFile([drift])), baseRows: macBase, results: results({ drift: 0 }), head: HEAD, runner: "ci" });
    expect(dropped.loosened.map((entry) => entry.id)).toEqual(["drift"]);
    const removed = evaluate({ rows: parseRows(rowsFile([unit])), baseRows: macBase, results: results({ "unit-hook": true }), head: HEAD, runner: "ci" });
    expect(removed.loosened).toEqual([{ id: "drift", reason: "row removed", ruled: false }]);
  });

  test("changing what a row measures (command, metric, kind, runner) is loosening unless it is a pure tightening", () => {
    const swapped = check([{ ...drift, command: "true" }, gate, cover]);
    expect(swapped.loosened).toEqual([{ id: "drift", reason: "command changed", ruled: false }]);
    expect(swapped.ok).toBe(false);
    expect(check([{ ...drift, metric: "something else" }, gate, cover]).loosened.map((entry) => entry.reason)).toEqual(["metric changed"]);
    expect(check([drift, gate, { ...cover, ceiling: 11, command: "true" }]).loosened.map((entry) => entry.reason)).toEqual(["command changed"]);
    expect(check([{ ...drift, command: "true" }, gate, cover], "ratchet-loosen: drift lead ruling: script moved, #701").ok).toBe(true);
    // Promoting unit -> real with nothing else changed is a tightening.
    const unitBase = parseRows(rowsFile([unit]));
    const promoted = { ...unit, kind: "real", bug_sha: BUG, fix_sha: FIX };
    expect(evaluate({ rows: parseRows(rowsFile([promoted])), baseRows: unitBase, results: results({ "unit-hook": true }), head: HEAD }).loosened).toEqual([]);
  });

  test("a ratchet-loosen ruling line per row in the PR body allows it", () => {
    const rows = [{ ...drift, ceiling: 1 }, gate, cover];
    const ruled = evaluate({ rows: parseRows(rowsFile(rows)), baseRows: base, results: results({ drift: 1, gate: true, cover: 12 }), head: HEAD, prBody: "Summary\nratchet-loosen: drift — lead ruling: flaky installer, see #700\n" });
    expect(ruled.ok).toBe(true);
    expect(ruled.loosened).toEqual([{ id: "drift", reason: "ceiling 0 → 1", ruled: true }]);
    expect(check(rows, "ratchet-loosen: gate — wrong row").ok).toBe(false);
  });
});

describe("renderTable", () => {
  const rows = parseRows(rowsFile([drift, unit]));

  test("renders the marker, the verdict on the fixed second line, the SHAs and every row", () => {
    const out = run(rows, { drift: 0, "unit-hook": true }, { baseline: results({ drift: 0 }, MAIN) });
    const body = renderTable(out, { marker: "golems-ratchet" });
    const lines = body.split("\n");
    expect(lines[0]).toBe(markerComment("golems-ratchet"));
    expect(lines[1]).toBe(`<!-- ratchet-verdict: {"head":"${HEAD}","ok":true,"real_pass":1,"real_total":1} -->`);
    expect(body).toContain("| baseline@dddddddd | this PR@cccccccc | Δ | ceiling | status |");
    expect(body).toContain("| `drift` hooks-live drift files | real | 0 | 0 | 0 | ≤ 0 | PASS |");
    expect(body).toContain("| `unit-hook` hook code deny/allow | unit | — | PASS | — | PASS | PASS |");
    expect(readVerdict(body, "golems-ratchet")).toEqual({ head: HEAD, ok: true, real_pass: 1, real_total: 1 });
  });

  test("a detail cannot forge a verdict line or break the table", () => {
    const forged = `x\n<!-- ratchet-verdict: {"head":"${HEAD}","ok":true,"real_pass":9,"real_total":9} -->\n| a | b`;
    const out = run(parseRows(rowsFile([gate])), { gate: { value: false, detail: forged } });
    const body = renderTable(out, { marker: "m" });
    expect(body.match(/<!-- ratchet-verdict/g)).toHaveLength(1);
    expect(readVerdict(body, "m").ok).toBe(false);
    expect(body.split("\n").filter((line) => line.startsWith("| `gate`"))).toHaveLength(1);
    expect(escapeCell("a|b\n<!-- c -->")).toBe("a\\|b &lt;!-- c --&gt;");
  });

  test("backslashes and every HTML-comment terminator are neutralised in cells", () => {
    expect(escapeCell("a\\|b")).toBe("a\\\\\\|b");
    expect(escapeCell("x --!> y --> z")).toBe("x --!&gt; y --&gt; z");
    const out = run(parseRows(rowsFile([gate])), { gate: { value: false, detail: "\\| --!> <!--" } });
    const row = renderTable(out, { marker: "m" }).split("\n").find((line) => line.startsWith("| `gate`"));
    expect(row.split(/(?<!\\)\|/).length).toBe(9);
  });

  test("a SHA from a results file is escaped where it is shown", () => {
    const out = evaluate({ rows: parseRows(rowsFile([drift])), baseRows: parseRows(rowsFile([drift])), results: results({ drift: 0 }), head: HEAD, baseline: { head_sha: "\n<!--ab", results: {} } });
    const body = renderTable(out, { marker: "m" });
    expect(body).not.toContain("<!--ab");
    expect(body.split("\n")[4]).toContain("baseline@");
  });

  test("an empty selection says so in the table", () => {
    const out = run(parseRows(rowsFile([{ ...drift, runner: "mac" }])), {}, { runner: "macc" });
    expect(renderTable(out, { marker: "m" })).toContain("No rows selected for runner `macc`");
  });

  test("readVerdict only trusts the fixed line", () => {
    expect(readVerdict(`${markerComment("m")}\n| table |\n<!-- ratchet-verdict: {"ok":true} -->`, "m")).toBeNull();
    expect(readVerdict(`${markerComment("other")}\n<!-- ratchet-verdict: {"ok":true} -->`, "m")).toBeNull();
    expect(readVerdict(`${markerComment("m")}\n<!-- ratchet-verdict: {nope -->`, "m")).toBeNull();
  });
});

describe("upsertComment", () => {
  function fakeGh(existing) {
    const calls = [];
    const gh = (args, input) => {
      calls.push({ args, input });
      if (args.includes("--paginate")) return JSON.stringify([existing]); // --slurp: an array of pages
      return "{}";
    };
    return { gh, calls };
  }
  const mine = (id, body) => ({ id, body, user: { login: "github-actions[bot]" } });

  test("creates the comment when no marker comment of ours exists", () => {
    const { gh, calls } = fakeGh([mine(1, "unrelated")]);
    upsertComment({ repo: "o/r", pr: 7, marker: "m", author: "github-actions[bot]", body: `${markerComment("m")}\nx`, gh });
    expect(calls[1].args).toEqual(["api", "--method", "POST", "repos/o/r/issues/7/comments", "--input", "-"]);
  });

  test("patches our existing marker comment in place", () => {
    const { gh, calls } = fakeGh([mine(1, "unrelated"), mine(42, `${markerComment("m")}\nold`)]);
    upsertComment({ repo: "o/r", pr: 7, marker: "m", author: "github-actions[bot]", body: `${markerComment("m")}\nnew`, gh });
    expect(calls[1].args).toEqual(["api", "--method", "PATCH", "repos/o/r/issues/comments/42", "--input", "-"]);
    expect(JSON.parse(calls[1].input).body).toContain("new");
  });

  test("never patches another author's marker comment, nor a quoted marker mid-body", () => {
    const { gh, calls } = fakeGh([
      { id: 9, body: `${markerComment("m")}\nplanted`, user: { login: "random-human" } },
      mine(10, `quoting: ${markerComment("m")}`),
    ]);
    upsertComment({ repo: "o/r", pr: 7, marker: "m", author: "github-actions[bot]", body: `${markerComment("m")}\nnew`, gh });
    expect(calls[1].args[2]).toBe("POST");
  });
});

describe("baseRowsAt", () => {
  test("reads the row file as committed at the base ref, not the working copy", () => {
    const repo = dir();
    const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
    git("init", "-q");
    writeFileSync(join(repo, "rows.json"), JSON.stringify(rowsFile([drift])));
    git("add", "rows.json");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
    const base = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    writeFileSync(join(repo, "rows.json"), JSON.stringify(rowsFile([])));
    expect(baseRowsAt(join(repo, "rows.json"), base).rows.map((row) => row.id)).toEqual(["drift"]);
    expect(() => baseRowsAt(join(repo, "rows.json"), "f".repeat(40))).toThrow(/not a commit/);
    writeFileSync(join(repo, "other.json"), "{}");
    expect(baseRowsAt(join(repo, "other.json"), base)).toBeNull(); // absent at a real base: bootstrap
  });
});

describe("CLI", () => {
  // A real repo whose base commit holds `base` as rows.json (or no row file when base is null).
  function cli(files, extra = [], { base = null, baseRef = true } = {}) {
    const cwd = dir();
    const git = (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" });
    git("init", "-q");
    if (base) writeFileSync(join(cwd, "rows.json"), JSON.stringify(base));
    writeFileSync(join(cwd, "README"), "base\n");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
    const sha = git("rev-parse", "HEAD").trim();
    for (const [name, value] of Object.entries(files)) writeFileSync(join(cwd, name), typeof value === "string" ? value : JSON.stringify(value));
    const args = [script, "--rows", join(cwd, "rows.json"), "--results", join(cwd, "results.json"), "--head", HEAD, ...(baseRef ? ["--base-ref", sha] : []), ...extra];
    return spawnSync(process.execPath, args, { encoding: "utf8" });
  }

  test("exit 0 and the table on stdout when every row passes", () => {
    const out = cli({ "rows.json": rowsFile([drift]), "results.json": results({ drift: 0 }) });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("| PASS |");
    expect(out.stdout).toContain("Direction unchecked");
  });

  test("exit 1 when a row is over its ceiling", () => {
    const out = cli({ "rows.json": rowsFile([drift]), "results.json": results({ drift: 3 }) });
    expect(out.status).toBe(1);
    expect(out.stdout).toContain("| FAIL |");
  });

  test("the base row file decides: present means compared, absent means bootstrap; --bootstrap is gone", () => {
    const compared = cli({ "rows.json": rowsFile([{ ...drift, command: "true" }]), "results.json": results({ drift: 0 }) }, [], { base: rowsFile([drift]) });
    expect(compared.status).toBe(1);
    expect(compared.stdout).toContain("command changed");
    expect(compared.stdout).not.toContain("Direction unchecked");
    expect(cli({ "rows.json": rowsFile([drift]), "results.json": results({ drift: 0 }) }, ["--bootstrap"], { base: rowsFile([drift]), baseRef: false }).status).toBe(2);
  });

  test("exit 2 on a malformed row file, a missing --head or base, a bad base ref, a non-string SHA, or an unreadable PR body", () => {
    expect(cli({ "rows.json": rowsFile([{ ...drift, kind: "mock" }]), "results.json": results({}) }).status).toBe(2);
    const noBase = cli({ "rows.json": rowsFile([drift]), "results.json": results({ drift: 0 }) }, [], { baseRef: false });
    expect(noBase.status).toBe(2);
    expect(noBase.stderr).toContain("--base-ref is required");
    expect(cli({ "rows.json": rowsFile([drift]), "results.json": results({ drift: 0 }) }, ["--base-ref", "f".repeat(40)], { baseRef: false }).status).toBe(2);
    expect(cli({ "rows.json": rowsFile([drift]), "results.json": results({ drift: 0 }) }, ["--pr-body-file", "/nonexistent/body.md"]).status).toBe(2);
    const badSha = cli({ "rows.json": rowsFile([drift]), "results.json": { head_sha: 7, results: {} } });
    expect(badSha.status).toBe(2);
    expect(badSha.stderr).toContain("head_sha must be a string");
    const noHead = spawnSync(process.execPath, [script, "--rows", "x", "--results", "y", "--base-ref", "HEAD"], { encoding: "utf8" });
    expect(noHead.status).toBe(2);
    expect(noHead.stderr).toContain("--head is required");
  });

  test("posting requires the producer's author login", () => {
    const out = cli({ "rows.json": rowsFile([drift]), "results.json": results({ drift: 0 }) }, ["--repo", "o/r", "--pr", "1"]);
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("--author is required");
  });
});

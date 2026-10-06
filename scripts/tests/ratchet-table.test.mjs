import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { evaluate, markerComment, parseRows, renderTable, upsertComment } from "../ratchet/table.mjs";

const script = resolve(import.meta.dir, "../ratchet/table.mjs");
const BUG = "a".repeat(40);
const FIX = "b".repeat(40);
const HEAD = "c".repeat(40);
const MAIN = "d".repeat(40);

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

describe("parseRows", () => {
  test("accepts a valid row file", () => {
    expect(parseRows(rowsFile([drift, gate, cover, unit])).rows).toHaveLength(4);
  });

  test("a real row without its bug and fix SHAs is rejected (rule 1)", () => {
    const { bug_sha, ...noBug } = drift;
    expect(() => parseRows(rowsFile([noBug]))).toThrow(/bug_sha/);
  });

  test("duplicate ids, unknown kinds and unknown directions are rejected", () => {
    expect(() => parseRows(rowsFile([drift, drift]))).toThrow(/duplicate/);
    expect(() => parseRows(rowsFile([{ ...drift, kind: "mock" }]))).toThrow(/kind/);
    expect(() => parseRows(rowsFile([{ ...drift, direction: "down" }]))).toThrow(/direction/);
    expect(() => parseRows(rowsFile([{ ...drift, ceiling: "0" }]))).toThrow(/ceiling/);
  });
});

describe("evaluate", () => {
  const rows = parseRows(rowsFile([drift, gate, cover, unit]));

  test("all rows within their ceilings pass", () => {
    const out = evaluate({ rows, results: results({ drift: 0, gate: true, cover: { value: 12, detail: "12/12" }, "unit-hook": true }), head: HEAD });
    expect(out.ok).toBe(true);
    expect(out.rows.map((row) => row.status)).toEqual(["PASS", "PASS", "PASS", "PASS"]);
    expect(out.realPass).toBe(3);
    expect(out.realTotal).toBe(3);
  });

  test("over the ceiling fails, in either direction", () => {
    const out = evaluate({ rows, results: results({ drift: 2, gate: false, cover: 9, "unit-hook": true }), head: HEAD });
    expect(out.ok).toBe(false);
    expect(out.rows.slice(0, 3).map((row) => row.status)).toEqual(["FAIL", "FAIL", "FAIL"]);
  });

  test("a missing result is FAIL, never SKIP (rule 3)", () => {
    const out = evaluate({ rows, results: results({ drift: 0, gate: true, "unit-hook": true }), head: HEAD });
    expect(out.ok).toBe(false);
    expect(out.rows.find((row) => row.id === "cover").status).toBe("MISSING");
  });

  test("results bound to another SHA are stale: every row is MISSING", () => {
    const out = evaluate({ rows, results: results({ drift: 0, gate: true, cover: 12, "unit-hook": true }, MAIN), head: HEAD });
    expect(out.ok).toBe(false);
    expect(out.stale).toBe(true);
    expect(out.rows.every((row) => row.status === "MISSING")).toBe(true);
  });

  test("a failing unit row fails the job but is not counted as ratchet evidence (rule 6)", () => {
    const out = evaluate({ rows, results: results({ drift: 0, gate: true, cover: 12, "unit-hook": false }), head: HEAD });
    expect(out.ok).toBe(false);
    expect(out.realPass).toBe(3);
    expect(out.realTotal).toBe(3);
  });

  test("Δ is computed against the baseline for numeric rows", () => {
    const out = evaluate({ rows, results: results({ drift: 0, gate: true, cover: 12, "unit-hook": true }), baseline: results({ drift: 1, cover: 10 }, MAIN), head: HEAD });
    expect(out.rows.find((row) => row.id === "drift").delta).toBe(-1);
    expect(out.rows.find((row) => row.id === "cover").delta).toBe(2);
    expect(out.baselineSha).toBe(MAIN);
  });

  test("--runner selects only that runner's rows", () => {
    const split = parseRows(rowsFile([{ ...drift, runner: "mac" }, { ...unit, runner: "ci" }]));
    const out = evaluate({ rows: split, results: results({ "unit-hook": true }), head: HEAD, runner: "ci" });
    expect(out.rows.map((row) => row.id)).toEqual(["unit-hook"]);
    expect(out.ok).toBe(true);
  });
});

describe("ratchet direction (rule 5)", () => {
  const base = parseRows(rowsFile([drift, gate, cover]));
  const pass = results({ drift: 0, gate: true, cover: 12 });

  test("tightening and adding rows needs no ruling", () => {
    const rows = parseRows(rowsFile([drift, gate, { ...cover, ceiling: 11 }, unit]));
    const out = evaluate({ rows, baseRows: base, results: results({ drift: 0, gate: true, cover: 12, "unit-hook": true }), head: HEAD, prBody: "" });
    expect(out.loosened).toEqual([]);
    expect(out.ok).toBe(true);
  });

  test("raising a max ceiling, lowering a min ceiling, removing a row or demoting to unit is loosening", () => {
    const rows = parseRows(rowsFile([{ ...drift, ceiling: 1 }, { ...cover, ceiling: 9, kind: "real" }]));
    const out = evaluate({ rows, baseRows: parseRows(rowsFile([drift, gate, cover])), results: pass, head: HEAD, prBody: "" });
    expect(out.loosened.map((entry) => entry.id).sort()).toEqual(["cover", "drift", "gate"]);
    expect(out.ok).toBe(false);

    const demoted = parseRows(rowsFile([drift, { ...gate, kind: "unit" }, cover]));
    expect(evaluate({ rows: demoted, baseRows: base, results: pass, head: HEAD, prBody: "" }).loosened.map((entry) => entry.id)).toEqual(["gate"]);
  });

  test("a ratchet-loosen ruling line per row in the PR body allows it", () => {
    const rows = parseRows(rowsFile([{ ...drift, ceiling: 1 }, gate, cover]));
    const ruled = evaluate({ rows, baseRows: base, results: results({ drift: 1, gate: true, cover: 12 }), head: HEAD, prBody: "Summary\nratchet-loosen: drift — lead ruling: flaky installer, see #700\n" });
    expect(ruled.ok).toBe(true);
    expect(ruled.loosened).toEqual([{ id: "drift", reason: "ceiling 0 → 1", ruled: true }]);

    const otherRow = evaluate({ rows, baseRows: base, results: results({ drift: 1, gate: true, cover: 12 }), head: HEAD, prBody: "ratchet-loosen: gate — wrong row" });
    expect(otherRow.ok).toBe(false);
  });
});

describe("renderTable", () => {
  test("renders the marker, the SHAs, every row and a machine-readable verdict", () => {
    const rows = parseRows(rowsFile([drift, unit]));
    const out = evaluate({ rows, results: results({ drift: 0, "unit-hook": true }), baseline: results({ drift: 0 }, MAIN), head: HEAD });
    const body = renderTable(out, { marker: "golems-ratchet" });
    expect(body.startsWith(markerComment("golems-ratchet"))).toBe(true);
    expect(body).toContain("| baseline@dddddddd | this PR@cccccccc | Δ | ceiling | status |");
    expect(body).toContain("| `drift` hooks-live drift files | real | 0 | 0 | 0 | ≤ 0 | PASS |");
    expect(body).toContain("| `unit-hook` hook code deny/allow | unit | — | PASS | — | PASS | PASS |");
    expect(body).toContain(`<!-- ratchet-verdict: {"head":"${HEAD}","ok":true,"real_pass":1,"real_total":1} -->`);
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

  test("creates the comment when no marker comment exists", () => {
    const { gh, calls } = fakeGh([{ id: 1, body: "unrelated" }]);
    upsertComment({ repo: "o/r", pr: 7, marker: "m", body: `${markerComment("m")}\nx`, gh });
    expect(calls[1].args).toEqual(["api", "--method", "POST", "repos/o/r/issues/7/comments", "--input", "-"]);
  });

  test("patches the existing marker comment in place", () => {
    const { gh, calls } = fakeGh([{ id: 1, body: "unrelated" }, { id: 42, body: `${markerComment("m")}\nold` }]);
    upsertComment({ repo: "o/r", pr: 7, marker: "m", body: `${markerComment("m")}\nnew`, gh });
    expect(calls[1].args).toEqual(["api", "--method", "PATCH", "repos/o/r/issues/comments/42", "--input", "-"]);
    expect(JSON.parse(calls[1].input).body).toContain("new");
  });
});

describe("CLI", () => {
  function cli(files, extra = []) {
    const dir = mkdtempSync(join(tmpdir(), "ratchet-table-"));
    try {
      for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
      return spawnSync(process.execPath, [script, "--rows", join(dir, "rows.json"), "--results", join(dir, "results.json"), "--head", HEAD, ...extra], { encoding: "utf8" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("exit 0 and the table on stdout when every row passes", () => {
    const run = cli({ "rows.json": rowsFile([drift]), "results.json": results({ drift: 0 }) });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("| PASS |");
  });

  test("exit 1 when a row is over its ceiling", () => {
    const run = cli({ "rows.json": rowsFile([drift]), "results.json": results({ drift: 3 }) });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("| FAIL |");
  });

  test("exit 2 on a malformed row file", () => {
    const run = cli({ "rows.json": rowsFile([{ ...drift, kind: "mock" }]), "results.json": results({}) });
    expect(run.status).toBe(2);
  });
});

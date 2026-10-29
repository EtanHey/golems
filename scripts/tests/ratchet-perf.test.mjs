import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, parseRows, renderTable } from "../ratchet/table.mjs";
import { runRows } from "../ratchet/run-rows.mjs";

const HEAD = "c".repeat(40);
const script = resolve(import.meta.dir, "../ratchet/table.mjs");
const producer = resolve(import.meta.dir, "../ratchet/m1-perf.mjs");
const scratch = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
function dir() {
  const root = resolve(import.meta.dir, "../../docs.local");
  mkdirSync(root, { recursive: true });
  const path = mkdtempSync(`${root}/perf-fixture-`);
  scratch.push(path);
  return path;
}
const perf = (extra = {}) => ({ id: "perf", kind: "perf", metric: "latency_p50_ms", runner: "ci", direction: "max", ceiling: 200, command: "echo 100", status: "enforced", ...extra });
const doc = (row) => ({ schema: 1, rows: [row] });
const samples = (...samples) => ({ samples });
function verdict(row, entry, extra = {}) {
  const rows = parseRows(doc(row));
  return evaluate({ rows, baseRows: rows, head: HEAD, results: { head_sha: HEAD, results: { perf: entry } }, ...extra });
}
const baseline = (entry) => ({ head_sha: "a".repeat(40), results: { perf: entry } });

describe("performance verdicts", () => {
  test("bytes reject +1 against baseline, even below the ceiling", () => {
    for (const metric of ["payload_bytes", "db_bytes"]) {
      expect(verdict(perf({ metric }), samples(101), { baseline: baseline(samples(100)) }).ok).toBe(false);
    }
  });
  test("uses sample medians and the default p50 noise band", () => {
    const extra = { baseline: baseline(samples(1, 100, 999)) };
    expect(verdict(perf(), { ...samples(1, 105, 999), value: 999 }, extra).ok).toBe(true);
    expect(verdict(perf(), samples(106, 107, 1), extra).ok).toBe(false);
    expect(verdict(perf(), samples(104, 106), extra).rows[0].value).toBe(105);
  });
  test("ceiling still applies inside the band; min mirrors the baseline band", () => {
    expect(verdict(perf({ ceiling: 102 }), samples(103), { baseline: baseline(samples(100)) }).ok).toBe(false);
    const row = perf({ metric: "throughput_mbps", direction: "min", ceiling: 80 });
    expect(verdict(row, samples(90), { baseline: baseline(samples(100)) }).ok).toBe(true);
    expect(verdict(row, samples(89), { baseline: baseline(samples(100)) }).ok).toBe(false);
    expect(verdict({ ...row, ceiling: 95 }, samples(94)).ok).toBe(false);
  });
  test("remaining metrics default to 10%; an explicit tolerance overrides the default", () => {
    for (const metric of ["latency_p95_ms", "startup_ms", "rss_mb", "idle_cpu_pct", "throughput_mbps"]) {
      const extra = { baseline: baseline(samples(100)) };
      expect(verdict(perf({ metric }), samples(110), extra).ok).toBe(true);
      expect(verdict(perf({ metric }), samples(111), extra).ok).toBe(false);
    }
    expect(verdict(perf({ tolerance: 0.02 }), samples(103), { baseline: baseline(samples(100)) }).ok).toBe(false);
  });
  test("report-only defaults never fail measurement verdicts, including missing/invalid samples", () => {
    const { status, ...row } = perf();
    for (const entry of [undefined, samples(999), samples(), samples("100"), { value: 1 }]) {
      const out = verdict(row, entry);
      expect(out.ok).toBe(true);
      expect(renderTable(out, { marker: "test" })).toContain("report-only");
    }
    expect(verdict(perf(), samples(1, Infinity)).ok).toBe(false);
  });
  test("perf enforcement, tolerance and sampling cannot be silently loosened", () => {
    const before = parseRows(doc(perf()));
    for (const change of [{ status: "report-only" }, { tolerance: 0.2 }, { repeats: 1 }, { kind: "unit", status: undefined }]) {
      expect(verdict(perf(change), samples(100), { baseRows: before }).ok).toBe(false);
    }
  });
});

describe("schema and execution", () => {
  test("strict perf options reject invalid metric, repeats, tolerance, status, direction and unknown keys", () => {
    for (const change of [{ metric: "typo" }, { repeats: 0 }, { repeats: 1.5 }, { tolerance: -1 }, { tolerance: Infinity }, { status: "skip" }, { direction: "pass", ceiling: true }, { ceiling: Infinity }, { unknown: true }]) {
      expect(() => parseRows(doc(perf(change)))).toThrow();
    }
  });
  test("invalid metric exits 2 in both table and producer CLIs", () => {
    const cwd = dir();
    const rows = `${cwd}/rows.json`;
    writeFileSync(rows, JSON.stringify(doc(perf({ metric: "typo" }))));
    for (const target of [script, producer, resolve(import.meta.dir, "../ratchet/run-rows.mjs")]) {
      const args = [target, "--rows", rows, "--head", HEAD, "--out", `${cwd}/out.json`];
      if (target === script) args.push("--results", `${cwd}/missing.json`, "--base-ref", "HEAD");
      const run = spawnSync("node", args, { encoding: "utf8" });
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/metric/);
    }
  });
  test("CI samples seven times by default, honors repeats, and never runs m1 commands", () => {
    const cwd = dir();
    for (const repeats of [undefined, 3]) {
      const out = runRows({ rows: doc(perf({ repeats })), head: HEAD, cwd });
      expect(out.results.perf.samples).toEqual(Array(repeats ?? 7).fill(100));
      expect(out.results.perf.value).toBe(100);
    }
    for (const runner of [null, "ci", "m1"]) {
      expect(runRows({ rows: doc(perf({ runner: "m1", command: "touch ran-m1" })), head: HEAD, runner, cwd }).results).toEqual({});
      expect(existsSync(`${cwd}/ran-m1`)).toBe(false);
    }
    expect(runRows({ rows: doc(perf({ command: "echo 100; exit 1" })), head: HEAD, cwd }).results).toEqual({});
  });
});

describe("M1 attestations", () => {
  const row = perf({ runner: "m1", repeats: 3 });
  const attestation = { repo: "EtanHey/class-fixture", head_sha: HEAD, rows: { perf: { samples: [90, 100, 110], median: 100, machine: "fixture-m1" } } };
  test("missing/stale attestations fail enforced rows; report-only shows no attestation", () => {
    for (const att of [null, { ...attestation, head_sha: "old" }]) {
      const out = verdict(row, samples(1), { attestation: att });
      expect(out.ok).toBe(false);
      expect(out.rows[0].detail).toBe("missing/stale M1 attestation");
      const reporting = verdict({ ...row, status: "report-only" }, undefined, { attestation: att });
      expect(reporting.ok).toBe(true);
      expect(renderTable(reporting, { marker: "test" })).toContain("no attestation");
    }
  });
  test("matching attestation is evaluated, recomputing median and rejecting contradictory evidence", () => {
    expect(verdict(row, undefined, { attestation }).rows[0].value).toBe(100);
    expect(verdict(row, undefined, { attestation }).ok).toBe(true);
    expect(verdict({ ...row, ceiling: 99 }, undefined, { attestation }).ok).toBe(false);
    expect(verdict(row, undefined, { attestation, baseline: { head_sha: "base", rows: { perf: { samples: [80, 90, 100], median: 90 } } } }).ok).toBe(false);
    const bad = { ...attestation, rows: { perf: { ...attestation.rows.perf, median: 1 } } };
    expect(verdict(row, undefined, { attestation: bad }).ok).toBe(false);
  });
  test("local CLI writes attestation JSON and table CLI consumes --attestation", () => {
    const cwd = dir();
    const rows = `${cwd}/rows.json`, out = `${cwd}/attestation.json`;
    writeFileSync(rows, JSON.stringify({ schema: 1, rows: [row, perf({ id: "ci-only", command: "touch ran-ci" })] }));
    const run = spawnSync("node", [producer, "--rows", rows, "--head", HEAD, "--out", out], { cwd, encoding: "utf8" });
    expect(run.status).toBe(0);
    const att = JSON.parse(readFileSync(out, "utf8"));
    expect(att.head_sha).toBe(HEAD);
    expect(typeof att.repo).toBe("string");
    expect(att.repo.length).toBeGreaterThan(0);
    expect(Object.keys(att.rows)).toEqual(["perf"]);
    expect(att.rows.perf.samples).toEqual([100, 100, 100]);
    expect(att.rows.perf.median).toBe(100);
    expect(typeof att.rows.perf.machine).toBe("string");
    expect(existsSync(`${cwd}/ran-ci`)).toBe(false);
    const table = spawnSync("node", [script, "--rows", rows, "--results", `${cwd}/missing.json`, "--runner", "m1", "--head", HEAD, "--base-ref", "HEAD", "--attestation", out], { encoding: "utf8" });
    expect(table.status).toBe(0);
    expect(table.stdout).toContain("| 100 |");
    expect(spawnSync("node", [script, "--help"], { encoding: "utf8" }).stdout).toContain("--attestation");
  });
});

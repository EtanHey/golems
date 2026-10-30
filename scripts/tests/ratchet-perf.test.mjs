import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, parseRows, renderTable } from "../ratchet/table.mjs";
import { runRows } from "../ratchet/run-rows.mjs";

const HEAD = "c".repeat(40);
const REPO = "EtanHey/class-fixture";
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
// A clean one-commit checkout, built with plumbing so no commit hook or signing config runs.
function checkout(root, origin = `https://github.com/${REPO}.git`) {
  const path = `${root}/repo`;
  mkdirSync(path, { recursive: true });
  const git = (...args) => spawnSync("git", args, { cwd: path, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "f", GIT_AUTHOR_EMAIL: "f@example.com", GIT_COMMITTER_NAME: "f", GIT_COMMITTER_EMAIL: "f@example.com" } }).stdout.trim();
  git("init", "-q");
  if (origin) git("remote", "add", "origin", origin);
  const sha = git("commit-tree", "--no-gpg-sign", git("write-tree"), "-m", "fixture");
  git("update-ref", "HEAD", sha);
  return { path, sha };
}
const perf = (extra = {}) => ({ id: "perf", kind: "perf", metric: "latency_p50_ms", runner: "ci", direction: "max", ceiling: 200, command: "echo 100", status: "enforced", repeats: 1, ...extra });
const doc = (row) => ({ schema: 1, rows: [row] });
const samples = (...samples) => ({ samples });
function verdict(row, entry, extra = {}) {
  const rows = parseRows(doc(row));
  return evaluate({ rows, baseRows: rows, head: HEAD, results: { head_sha: HEAD, results: { perf: entry } }, baseline: baseline(samples(100)), ...extra });
}
const baseline = (entry) => ({ head_sha: "a".repeat(40), results: { perf: entry } });

describe("performance verdicts", () => {
  test("bytes reject +1 against baseline, even below the ceiling", () => {
    for (const metric of ["payload_bytes", "db_bytes"]) {
      expect(verdict(perf({ metric }), samples(100)).ok).toBe(true);
      expect(verdict(perf({ metric }), samples(101)).ok).toBe(false);
    }
  });
  test("uses sample medians and the default p50 noise band", () => {
    const extra = { baseline: baseline(samples(1, 100, 999)) };
    expect(verdict(perf({ repeats: 3 }), { ...samples(1, 105, 999), value: 999 }, extra).ok).toBe(true);
    expect(verdict(perf({ repeats: 3 }), samples(106, 107, 1), extra).ok).toBe(false);
    expect(verdict(perf({ repeats: 2 }), samples(104, 106), extra).rows[0].value).toBe(105);
  });
  test("the sample count must equal repeats: fewer or more samples are no measurement", () => {
    for (const entry of [samples(100), samples(100, 100, 100, 100)]) {
      const out = verdict(perf({ repeats: 3 }), entry);
      expect(out.ok).toBe(false);
      expect(out.rows[0].status).toBe("MISSING");
    }
    expect(verdict(perf({ repeats: undefined }), samples(...Array(7).fill(100)), {
      baseline: baseline(samples(...Array(7).fill(100))),
    }).ok).toBe(true);
  });
  test("invalid baseline sample counts cannot make an enforced CI row pass", () => {
    for (const entry of [samples(1000), samples(1000, 1000, 1000, 1000)]) {
      const out = verdict(perf({ repeats: 3 }), samples(107, 107, 107), { baseline: baseline(entry) });
      expect(out.ok).toBe(false);
      expect(out.rows[0].detail).toBe("no baseline");
    }
  });
  test("baseline counts use the base row so increasing repeats remains valid", () => {
    const out = verdict(perf({ repeats: 3 }), samples(100, 100, 100), {
      baseRows: parseRows(doc(perf({ repeats: 1 }))), baseline: baseline(samples(100)),
    });
    expect(out.ok).toBe(true);
    expect(out.rows[0].baseline).toBe(100);
  });
  test("ceiling still applies inside the band; min mirrors the baseline band", () => {
    expect(verdict(perf({ ceiling: 102 }), samples(103)).ok).toBe(false);
    const row = perf({ metric: "throughput_mbps", direction: "min", ceiling: 80 });
    expect(verdict(row, samples(90)).ok).toBe(true);
    expect(verdict(row, samples(89)).ok).toBe(false);
    expect(verdict({ ...row, ceiling: 95 }, samples(94)).ok).toBe(false);
  });
  test("remaining metrics default to 10%; an explicit tolerance overrides the default", () => {
    for (const metric of ["latency_p95_ms", "startup_ms", "rss_mb", "idle_cpu_pct"]) {
      expect(verdict(perf({ metric }), samples(110)).ok).toBe(true);
      expect(verdict(perf({ metric }), samples(111)).ok).toBe(false);
    }
    expect(verdict(perf({ tolerance: 0.02 }), samples(103)).ok).toBe(false);
  });
  test("an enforced row with no baseline fails: the band is half the gate", () => {
    const out = verdict(perf(), samples(100), { baseline: null });
    expect(out.ok).toBe(false);
    expect(out.rows[0].detail).toBe("no baseline");
    expect(verdict(perf({ status: "report-only" }), samples(100), { baseline: null }).rows[0].status).toBe("PASS");
  });
  test("report-only defaults never fail measurement verdicts, including missing/invalid samples", () => {
    const { status, ...row } = perf();
    for (const entry of [undefined, samples(999), samples(), samples("100"), { value: 1 }]) {
      const out = verdict(row, entry);
      expect(out.ok).toBe(true);
      expect(renderTable(out, { marker: "test" })).toContain("report-only");
    }
    expect(verdict(perf({ repeats: 2 }), samples(1, Infinity)).ok).toBe(false);
  });
  test("a new perf row is never enforced on day one", () => {
    const rows = parseRows(doc(perf()));
    for (const baseRows of [parseRows({ schema: 1, rows: [] }), parseRows(doc({ ...perf(), kind: "unit", status: undefined, repeats: undefined }))]) {
      const out = evaluate({ rows, baseRows, head: HEAD, results: { head_sha: HEAD, results: { perf: samples(100) } }, baseline: baseline(samples(100)) });
      expect(out.ok).toBe(false);
      expect(out.rows[0].detail).toBe("new perf rows start report-only");
    }
    expect(evaluate({ rows, baseRows: parseRows(doc(perf({ status: "report-only" }))), head: HEAD, results: { head_sha: HEAD, results: { perf: samples(100) } }, baseline: baseline(samples(100)) }).ok).toBe(true);
  });
  test("perf enforcement, tolerance and sampling cannot be silently loosened", () => {
    const before = parseRows(doc(perf({ repeats: 3 })));
    for (const change of [{ status: "report-only" }, { tolerance: 0.2 }, { repeats: 1 }, { kind: "unit", status: undefined, repeats: undefined }]) {
      expect(verdict(perf({ repeats: 3, ...change }), samples(100, 100, 100), { baseRows: before }).loosened.map(entry => entry.id)).toEqual(["perf"]);
    }
  });
  test("the loosening label names the kind a real row became", () => {
    const real = { id: "perf", kind: "real", metric: "latency_p50_ms", runner: "ci", direction: "max", ceiling: 200, command: "echo 100", bug_sha: "a".repeat(40), fix_sha: "b".repeat(40) };
    const out = verdict(perf({ status: "report-only" }), samples(100), { baseRows: parseRows(doc(real)) });
    expect(out.loosened[0].reason).toBe("demoted real → perf");
  });
});

describe("schema and execution", () => {
  test("strict perf options reject invalid metric, repeats, tolerance, status, direction and unknown keys", () => {
    for (const change of [{ metric: "typo" }, { repeats: 0 }, { repeats: 1.5 }, { repeats: 26 }, { tolerance: -1 }, { tolerance: Infinity }, { status: "skip" }, { direction: "pass", ceiling: true }, { direction: "min" }, { ceiling: Infinity }, { unknown: true }]) {
      expect(() => parseRows(doc(perf(change)))).toThrow();
    }
    expect(() => parseRows(doc(perf({ metric: "throughput_mbps" })))).toThrow(/direction min/);
    expect(parseRows(doc(perf({ repeats: 25 })))).toBeTruthy();
  });
  test("bytes rows are exact: no tolerance above zero", () => {
    for (const metric of ["payload_bytes", "db_bytes"]) {
      expect(() => parseRows(doc(perf({ metric, tolerance: 0.01 })))).toThrow(/exact/);
      expect(parseRows(doc(perf({ metric, tolerance: 0 })))).toBeTruthy();
    }
  });
  test("runner m1 is perf-only, and enforced m1 rows wait for signed attestations", () => {
    expect(() => parseRows(doc({ id: "u", kind: "unit", metric: "x", runner: "m1", direction: "pass", ceiling: true, command: "true" }))).toThrow(/m1/);
    expect(() => parseRows(doc(perf({ runner: "m1" })))).toThrow(/signed/);
    expect(parseRows(doc(perf({ runner: "m1", status: "report-only" })))).toBeTruthy();
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
      expect(runRows({ rows: doc(perf({ runner: "m1", status: "report-only", command: "touch ran-m1" })), head: HEAD, runner, cwd }).results).toEqual({});
      expect(existsSync(`${cwd}/ran-m1`)).toBe(false);
    }
    expect(runRows({ rows: doc(perf({ command: "echo 100; exit 1" })), head: HEAD, cwd }).results).toEqual({});
  });
});

describe("M1 attestations", () => {
  const row = perf({ runner: "m1", repeats: 3, status: "report-only" });
  // Enforced m1 rows are refused by parseRows until signing lands; evaluate keeps their contract.
  const enforced = { schema: 1, rows: [{ ...row, status: "enforced" }] };
  const attestation = { repo: REPO, head_sha: HEAD, rows: { perf: { samples: [90, 100, 110], median: 100, machine: "fixture-m1" } } };
  const mainAttestation = { repo: REPO, head_sha: "a".repeat(40), rows: { perf: { samples: [100, 100, 100], median: 100, machine: "fixture-m1" } } };
  const m1 = (rows, extra) => evaluate({ rows, baseRows: rows, head: HEAD, results: { head_sha: HEAD, results: {} }, attestationRepo: REPO, attestationBaseline: mainAttestation, ...extra });
  test("missing/stale attestations fail enforced rows; report-only shows no attestation", () => {
    for (const att of [null, { ...attestation, head_sha: "old" }]) {
      const out = m1(enforced, { attestation: att });
      expect(out.ok).toBe(false);
      expect(out.rows[0].detail).toBe("missing/stale M1 attestation");
      const reporting = m1(parseRows(doc(row)), { attestation: att });
      expect(reporting.ok).toBe(true);
      expect(renderTable(reporting, { marker: "test" })).toContain("no attestation");
    }
  });
  test("an attestation counts only for the named repo: no repo, or another one, is no attestation", () => {
    for (const attestationRepo of [null, "", "EtanHey/other"]) {
      expect(m1(enforced, { attestation, attestationRepo }).rows[0].detail).toBe("missing/stale M1 attestation");
    }
    expect(m1(enforced, { attestation }).ok).toBe(true);
  });
  test("matching attestation is evaluated, recomputing median and rejecting contradictory evidence", () => {
    expect(m1(enforced, { attestation }).rows[0].value).toBe(100);
    expect(m1({ schema: 1, rows: [{ ...enforced.rows[0], ceiling: 99 }] }, { attestation }).ok).toBe(false);
    const bad = { ...attestation, rows: { perf: { ...attestation.rows.perf, median: 1 } } };
    expect(m1(enforced, { attestation: bad }).ok).toBe(false);
    const short = { ...attestation, rows: { perf: { samples: [100], median: 100, machine: "fixture-m1" } } };
    expect(m1(enforced, { attestation: short }).ok).toBe(false);
  });
  test("baseline attestations require exact samples, matching median and a machine", () => {
    for (const entry of [
      { samples: [1000], median: 1000, machine: "fixture-m1" },
      { samples: [1000, 1000, 1000, 1000], median: 1000, machine: "fixture-m1" },
      { samples: [100, 100, 100], median: 1000, machine: "fixture-m1" },
      { samples: [100, 100, 100], median: 100 },
      { samples: [100, 100, 100], median: 100, machine: "" },
    ]) {
      const out = m1(enforced, { attestation, attestationBaseline: { ...mainAttestation, rows: { perf: entry } } });
      expect(out.ok).toBe(false);
      expect(out.rows[0].detail).toBe("no baseline");
    }
  });
  test("baseline attestations use the base row repeat count", () => {
    const out = m1(enforced, { attestation,
      baseRows: { schema: 1, rows: [{ ...enforced.rows[0], repeats: 1 }] },
      attestationBaseline: { ...mainAttestation, rows: { perf: { samples: [100], median: 100, machine: "fixture-m1" } } },
    });
    expect(out.ok).toBe(true);
    expect(out.rows[0].baseline).toBe(100);
  });
  test("m1 rows band against main's attestation, never the CI results baseline", () => {
    const fast = { ...mainAttestation, rows: { perf: { ...mainAttestation.rows.perf, samples: [80, 90, 90], median: 90 } } };
    expect(m1(enforced, { attestation, attestationBaseline: fast }).ok).toBe(false);
    const out = m1(enforced, { attestation, attestationBaseline: null, baseline: baseline(samples(100, 100, 100)) });
    expect(out.ok).toBe(false);
    expect(out.rows[0].detail).toBe("no baseline");
    expect(m1(enforced, { attestation, attestationBaseline: { ...mainAttestation, repo: "EtanHey/other" } }).rows[0].detail).toBe("no baseline");
  });
  test("local CLI writes attestation JSON and table CLI consumes --attestation", () => {
    const cwd = dir();
    const repo = checkout(cwd);
    const rows = `${cwd}/rows.json`, out = `${cwd}/attestation.json`;
    writeFileSync(rows, JSON.stringify({ schema: 1, rows: [row, perf({ id: "ci-only", command: "touch ran-ci" })] }));
    const run = spawnSync("node", [producer, "--rows", rows, "--head", repo.sha, "--out", out], { cwd: repo.path, encoding: "utf8" });
    expect(run.status).toBe(0);
    const att = JSON.parse(readFileSync(out, "utf8"));
    expect(att).toMatchObject({ head_sha: repo.sha, repo: REPO, rows: { perf: { samples: [100, 100, 100], median: 100 } } });
    expect(Object.keys(att.rows)).toEqual(["perf"]);
    expect(typeof att.rows.perf.machine).toBe("string");
    expect(existsSync(`${repo.path}/ran-ci`)).toBe(false);
    const table = (...extra) => spawnSync("node", [script, "--rows", rows, "--results", `${cwd}/missing.json`, "--runner", "m1", "--head", repo.sha, "--base-ref", "HEAD", "--attestation", out, "--attestation-baseline", out, ...extra], { encoding: "utf8" });
    const consumed = table("--attestation-repo", REPO);
    expect(consumed.status).toBe(0);
    expect(consumed.stdout).toContain("| perf | 100 | 100 | 0 |");
    const unnamed = table();
    expect(unnamed.status).toBe(2);
    expect(unnamed.stderr).toMatch(/--attestation-repo/);
    expect(spawnSync("node", [script, "--help"], { encoding: "utf8" }).stdout).toContain("--attestation-repo");
  });
  test("the producer refuses a head that is not the clean checkout, or a checkout with no origin", () => {
    const cwd = dir();
    const repo = checkout(cwd);
    const rows = `${cwd}/rows.json`;
    writeFileSync(rows, JSON.stringify(doc(row)));
    const produce = (head, at = repo.path) => spawnSync("node", [producer, "--rows", rows, "--head", head, "--out", `${cwd}/att.json`], { cwd: at, encoding: "utf8" });
    expect(produce(HEAD).status).toBe(2);
    writeFileSync(`${repo.path}/dirty`, "x");
    const dirty = produce(repo.sha);
    expect(dirty.status).toBe(2);
    expect(dirty.stderr).toMatch(/uncommitted/);
    const bare = checkout(`${cwd}/bare-root`, null);
    expect(produce(bare.sha, bare.path).stderr).toMatch(/origin/);
    expect(existsSync(`${cwd}/att.json`)).toBe(false);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runRows } from "../ratchet/run-rows.mjs";

const script = resolve(import.meta.dir, "../ratchet/run-rows.mjs");
const HEAD = "c".repeat(40);
const scratch = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function dir() {
  const path = mkdtempSync(join(tmpdir(), "ratchet-run-rows-"));
  scratch.push(path);
  return path;
}

const row = (id, command, extra = {}) => ({ id, metric: id, kind: "unit", runner: "ci", direction: "pass", ceiling: true, command, ...extra });

describe("runRows", () => {
  test("a pass row is true on exit 0 and false on any other exit", () => {
    const out = runRows({ rows: { schema: 1, rows: [row("ok", "true"), row("bad", "exit 3")] }, head: HEAD, cwd: dir() });
    expect(out.head_sha).toBe(HEAD);
    expect(out.results.ok).toEqual({ value: true, detail: "exit 0" });
    expect(out.results.bad).toEqual({ value: false, detail: "exit 3" });
  });

  test("a numeric row takes the number on its last stdout line", () => {
    const rows = { schema: 1, rows: [row("drift", "echo noise; echo 2", { direction: "max", ceiling: 0 })] };
    expect(runRows({ rows, head: HEAD, cwd: dir() }).results.drift).toEqual({ value: 2, detail: undefined });
  });

  test("a numeric row that exits non-zero or prints no number is left out, so the table says MISSING", () => {
    const rows = { schema: 1, rows: [row("crash", "echo 0; exit 1", { direction: "max", ceiling: 0 }), row("words", "echo none", { direction: "min", ceiling: 1 })] };
    expect(runRows({ rows, head: HEAD, cwd: dir() }).results).toEqual({});
  });

  test("only the selected runner's rows run", () => {
    const cwd = dir();
    const rows = { schema: 1, rows: [row("ci", "true"), row("mac", "touch ran-mac", { runner: "mac" })] };
    const out = runRows({ rows, head: HEAD, cwd, runner: "ci" });
    expect(Object.keys(out.results)).toEqual(["ci"]);
    expect(spawnSync("test", ["-e", join(cwd, "ran-mac")]).status).toBe(1);
  });

  test("a row over its timeout fails instead of hanging", () => {
    const out = runRows({ rows: { schema: 1, rows: [row("slow", "sleep 5", { timeout_s: 1 })] }, head: HEAD, cwd: dir() });
    expect(out.results.slow.value).toBe(false);
  });
});

describe("CLI", () => {
  test("writes the results file and exits 0 even when a row fails (the table decides)", () => {
    const cwd = dir();
    writeFileSync(join(cwd, "rows.json"), JSON.stringify({ schema: 1, rows: [row("bad", "false")] }));
    const run = spawnSync(process.execPath, [script, "--rows", join(cwd, "rows.json"), "--head", HEAD, "--out", join(cwd, "out.json")], { cwd, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(JSON.parse(readFileSync(join(cwd, "out.json"), "utf8")).results.bad.value).toBe(false);
  });
});

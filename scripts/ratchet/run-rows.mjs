#!/usr/bin/env node
// Ratchet row producer: runs each selected row's `command` and writes the results JSON that
// table.mjs reads. Repo-agnostic. A `pass` row is true on exit 0. A `max`/`min` row must exit 0
// and print its number on the last stdout line; otherwise it is left out, so the table shows
// MISSING (FAIL), never a guessed value. The bounded disk report-only row also requires a
// valid structured measurement and a matching exit status; unhealthy health remains false. This script never decides PASS/FAIL itself.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseRows, validDiskMeasurement } from "./table.mjs";

const DEFAULT_TIMEOUT_S = 900;

export function runRows({ rows, head, cwd = process.cwd(), runner = null, log = () => {} }) {
  const results = {};
  for (const row of parseRows(rows).rows) {
    if (runner && row.runner !== runner) continue;
    const started = Date.now();
    const run = spawnSync("bash", ["-c", row.command], {
      cwd, encoding: "utf8", timeout: (row.timeout_s ?? DEFAULT_TIMEOUT_S) * 1000, maxBuffer: 256 * 1024 * 1024,
    });
    const code = run.status ?? (run.signal ? `killed by ${run.signal}` : "spawn error");
    log(`ratchet row ${row.id}: exit ${code} in ${((Date.now() - started) / 1000).toFixed(1)}s`, run);
    if (row.report_only) {
      try {
        const measurement = JSON.parse(String(run.stdout ?? "").trim().split("\n").pop());
        if (validDiskMeasurement(measurement) && run.status === (measurement.health ? 0 : 1))
          results[row.id] = { value: measurement.health, measurement };
      } catch {} // Malformed/missing measurement stays MISSING (FAIL), never WARN.
      continue;
    }
    if (row.direction === "pass") {
      results[row.id] = { value: run.status === 0, detail: `exit ${code}` };
      continue;
    }
    const last = String(run.stdout ?? "").trim().split("\n").pop()?.trim() ?? "";
    if (run.status === 0 && /^-?\d+(\.\d+)?$/.test(last)) results[row.id] = { value: Number(last), detail: undefined };
  }
  return { head_sha: head, runner, results };
}

function parseArgs(argv) {
  const options = {};
  const keys = { "--rows": "rows", "--head": "head", "--runner": "runner", "--out": "out", "--cwd": "cwd" };
  for (let index = 0; index < argv.length; index += 2) {
    const key = keys[argv[index]];
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith("--")) throw new Error(`unknown or incomplete argument ${argv[index]}`);
    options[key] = value;
  }
  if (!options.rows || !options.head || !options.out) throw new Error("--rows, --head and --out are required");
  return options;
}

export function main(argv) {
  let options;
  let rows;
  try {
    options = parseArgs(argv);
    rows = JSON.parse(readFileSync(options.rows, "utf8"));
  } catch (error) {
    process.stderr.write(`ratchet: ${error.message}\n`);
    return 2;
  }
  // Each row's output goes to stderr so a CI log shows why a row failed.
  const log = (line, run) => process.stderr.write(`${run.stdout ?? ""}${run.stderr ?? ""}${line}\n`);
  const out = runRows({ rows, head: options.head, cwd: options.cwd ?? process.cwd(), runner: options.runner ?? null, log });
  writeFileSync(options.out, `${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));

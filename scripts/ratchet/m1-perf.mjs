#!/usr/bin/env node
// Local measurement only: caller supplies the checkout and head. No network, signing,
// hardware authentication or checkout verification; CI consumes this evidence separately.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { hostname, platform, arch } from "node:os";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRows } from "./table.mjs";
import { runPerfRow } from "./run-rows.mjs";

export function main(argv) {
  try {
    const options = {};
    const keys = { "--rows": "rows", "--head": "head", "--out": "out" };
    for (let i = 0; i < argv.length; i += 2) {
      if (!keys[argv[i]] || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`unknown or incomplete argument ${argv[i]}`);
      options[keys[argv[i]]] = argv[i + 1];
    }
    if (!options.rows || !options.head || !options.out) throw new Error("--rows, --head and --out are required");
    const rows = parseRows(JSON.parse(readFileSync(options.rows, "utf8"))).rows;
    const remote = spawnSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" });
    const repo = remote.stdout?.trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? basename(process.cwd());
    const machine = `${hostname()} (${platform()}/${arch()})`;
    const attestation = { repo, head_sha: options.head, rows: {} };
    let failed = false;
    for (const row of rows.filter(row => row.kind === "perf" && row.runner === "m1")) {
      const measured = runPerfRow(row, process.cwd(), (line, run) => process.stderr.write(`${run.stdout ?? ""}${run.stderr ?? ""}${line}\n`));
      if (!measured) { failed = true; continue; }
      attestation.rows[row.id] = { samples: measured.samples, median: measured.value, machine };
    }
    writeFileSync(options.out, `${JSON.stringify(attestation, null, 2)}\n`);
    return failed ? 1 : 0;
  } catch (error) {
    process.stderr.write(`m1-perf: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));

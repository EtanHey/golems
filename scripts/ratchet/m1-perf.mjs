#!/usr/bin/env node
// Runs the m1 perf rows in this checkout, which must be exactly --head with no uncommitted changes.
// No network, signing or hardware authentication yet: the M1-lane PR adds signing and upload.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { hostname, platform, arch } from "node:os";
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
    const git = (...args) => spawnSync("git", args, { encoding: "utf8" }).stdout?.trim() ?? "";
    const checkout = git("rev-parse", "HEAD");
    if (checkout !== options.head) throw new Error(`--head ${options.head} is not this checkout's HEAD (${checkout || "no git checkout"})`);
    if (git("status", "--porcelain")) throw new Error("the checkout has uncommitted changes, so it is not --head");
    const repo = git("config", "--get", "remote.origin.url").match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/)?.[1];
    if (!repo) throw new Error("no origin remote: an attestation must name its repo");
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

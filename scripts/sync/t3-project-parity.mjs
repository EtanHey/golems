#!/usr/bin/env node
// Usage:
//   t3-project-parity.mjs [remote-host=m1]                            audit both Macs, exit 1 on findings
//   t3-project-parity.mjs --precheck <remote-url> --on <local|host>   exit 1 if that Mac already has the repo
// Reads each Mac's T3 database read-only; never writes it. Exit 2 when a Mac can't be read.

import { spawnSync } from "node:child_process";

import {
  auditProjects,
  canonicalRepoKey,
  groupingKeyFromRemotes,
  precheckRegistration,
} from "./t3-project-parity-lib.mjs";

// Runs on each Mac via `node -`: JSON rows plus each root's `git remote -v`. Any failure exits 1.
const SNAPSHOT = `
const { execFileSync } = require("node:child_process");
const db = require("node:path").join(require("node:os").homedir(), ".t3/userdata/statev2.sqlite");
const out = execFileSync("sqlite3", ["-readonly", "-json", db,
  "select project_id, title, workspace_root, project_icon_json, favicon_path, scripts_json from projection_projects where deleted_at is null"],
  { encoding: "utf8" });
const rows = out.trim() ? JSON.parse(out) : [];
for (const row of rows) {
  try { row.remotes = execFileSync("git", ["-C", row.workspace_root, "remote", "-v"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { row.remotes = ""; }
}
process.stdout.write(JSON.stringify(rows));
`;

function snapshot(host) {
  const command = host === "local" ? ["node", ["-"]] : ["ssh", ["-o", "ConnectTimeout=8", host, "node", "-"]];
  const result = spawnSync(command[0], command[1], { input: SNAPSHOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${host}: project snapshot exited ${result.status}`);
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${host}: project snapshot was not JSON`);
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${host}: no projects read`);
  return rows.map((row) => ({
    host,
    id: row.project_id,
    title: row.title,
    root: row.workspace_root,
    icon: row.project_icon_json ?? null,
    favicon: row.favicon_path ?? null,
    scripts: row.scripts_json ?? "[]",
    key: groupingKeyFromRemotes(row.remotes ?? ""),
  }));
}

function describe(finding, projects) {
  if (finding.kind === "drift") return `DRIFT ${finding.key}: ${finding.fields.join(", ")} differ between Macs`;
  const roots = projects.filter((p) => finding.ids.includes(p.id)).map((p) => p.root);
  return `DUPLICATE ${finding.key} on ${finding.host}: ${finding.ids.length} projects (${roots.join(", ")})`;
}

const args = process.argv.slice(2);
try {
  if (args[0] === "--precheck") {
    const host = args.includes("--on") ? args[args.indexOf("--on") + 1] : "local";
    const result = precheckRegistration(snapshot(host), host, args[1] ?? "");
    if (result.ok) {
      console.log(`OK: ${host} has no project for ${canonicalRepoKey(args[1])}; register one.`);
    } else {
      console.error(
        result.error
          ? `REFUSE: ${result.error}`
          : `REFUSE: ${host} already has project ${result.reuse.id} at ${result.reuse.root}; reuse it, never register a second.`,
      );
    }
    process.exit(result.ok ? 0 : 1);
  }
  const projects = ["local", args[0] ?? "m1"].flatMap(snapshot);
  const findings = auditProjects(projects);
  if (findings.length === 0) console.log("T3 project parity OK: one project per repo per Mac, settings match");
  for (const finding of findings) console.error(describe(finding, projects));
  process.exit(findings.length === 0 ? 0 : 1);
} catch (error) {
  console.error(`T3 PROJECT PARITY UNKNOWN: ${error.message}`);
  process.exit(2);
}

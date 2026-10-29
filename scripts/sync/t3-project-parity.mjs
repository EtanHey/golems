#!/usr/bin/env node
// Usage:
//   t3-project-parity.mjs [remote-host=m1]                      audit both Macs, exit 1 on findings
//   t3-project-parity.mjs --precheck <remote-url> --on <local|host>   exit 1 if that Mac already has the repo
// Reads each Mac's T3 database read-only; never writes it.

import { spawnSync } from "node:child_process";

import { auditProjects, canonicalRepoKey, precheckRegistration } from "./t3-project-parity-lib.mjs";

// Prints one tab-separated row per live project: id, title, root, icon, favicon, scripts, remote.
const SNAPSHOT = `sqlite3 -readonly -separator '\t' ~/.t3/userdata/statev2.sqlite \
  "select project_id, title, workspace_root, coalesce(project_icon_json,''), coalesce(favicon_path,''), coalesce(scripts_json,'[]') from projection_projects where deleted_at is null" |
while IFS="$(printf '\t')" read -r id title root icon favicon scripts; do
  remote=$(git -C "$root" remote get-url upstream 2>/dev/null || git -C "$root" remote get-url origin 2>/dev/null)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$title" "$root" "$icon" "$favicon" "$scripts" "$remote"
done`;

function snapshot(host) {
  const result =
    host === "local"
      ? spawnSync("/bin/zsh", ["-c", SNAPSHOT], { encoding: "utf8" })
      : spawnSync("ssh", ["-o", "ConnectTimeout=8", host, SNAPSHOT], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${host}: project snapshot exited ${result.status}`);
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, title, root, icon, favicon, scripts, remote] = line.split("\t");
      return { host, id, title, root, icon: icon || null, favicon: favicon || null, scripts, key: canonicalRepoKey(remote) };
    });
}

function describe(finding, projects) {
  if (finding.kind === "drift") return `DRIFT ${finding.key}: ${finding.fields.join(", ")} differ between Macs`;
  const roots = projects.filter((p) => finding.ids.includes(p.id)).map((p) => p.root);
  return `DUPLICATE ${finding.key} on ${finding.host}: ${finding.ids.length} projects (${roots.join(", ")})`;
}

const args = process.argv.slice(2);
try {
  if (args[0] === "--precheck") {
    const host = args[args.indexOf("--on") + 1] ?? "local";
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

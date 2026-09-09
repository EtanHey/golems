#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VALID_MACHINE_ROLES = new Set(["workspace", "daemon-host"]);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const checkoutManifestPath = resolve(scriptDir, "../../../..", "release-gate.json");
const installedManifestPath = resolve(scriptDir, "..", "release-gate.json");
export const defaultManifestPath = existsSync(checkoutManifestPath) ? checkoutManifestPath : installedManifestPath;

function manifestEntry(manifest, repo) {
  const repositories = manifest.repositories ?? {};
  if (repo.includes("/")) return { entry: repositories[repo] };
  const matches = Object.entries(repositories).filter(([slug]) => slug.split("/").at(-1) === repo);
  if (matches.length > 1) return { ambiguous: true };
  return { entry: matches[0]?.[1] };
}

function artifactName(artifact) {
  return `${artifact.kind}:${artifact.identifier ?? "unnamed"}`;
}

export function decideRepoAction(manifest, repo, machineRole) {
  if (!VALID_MACHINE_ROLES.has(machineRole)) {
    return {
      action: "REFUSE",
      artifact: null,
      reason: `machineRole must be exactly workspace or daemon-host; received ${machineRole ?? "missing"}`,
    };
  }

  const lookup = manifestEntry(manifest, repo);
  if (lookup.ambiguous) {
    return {
      action: "REFUSE",
      artifact: null,
      reason: `${repo} matches multiple repositories in release-gate.json; use a qualified slug`,
    };
  }

  const entry = lookup.entry;
  if (!entry?.artifact?.kind) {
    return {
      action: "REFUSE",
      artifact: null,
      reason: `${repo} is not classified in release-gate.json; refusing to clone`,
    };
  }

  if (entry.artifact.kind !== "none") {
    const artifact = artifactName(entry.artifact);
    return {
      action: "INSTALL",
      artifact,
      reason: `${repo} is distributed as ${artifact}`,
    };
  }

  if (machineRole === "workspace") {
    return {
      action: "CLONE",
      artifact: null,
      reason: entry.reason,
    };
  }

  return {
    action: "REFUSE",
    artifact: null,
    reason: `daemon-host machines use installed artifacts and never clone repositories; ${repo} has no installable artifact`,
  };
}

export function decideAllRepoActions(manifest, machineRole) {
  return Object.keys(manifest.repositories ?? {}).map((slug) => {
    return { repo: slug, ...decideRepoAction(manifest, slug, machineRole) };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [machineRole, manifestPath = defaultManifestPath] = process.argv.slice(2);
  try {
    const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
    console.log(JSON.stringify(decideAllRepoActions(manifest, machineRole), null, 2));
    if (!VALID_MACHINE_ROLES.has(machineRole)) process.exitCode = 1;
  } catch (error) {
    console.error(`REFUSE: could not read release-gate.json: ${error.message}`);
    process.exitCode = 2;
  }
}

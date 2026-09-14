#!/usr/bin/env bun

import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_AGENT_KEYS = [
  "default_subagent_model",
  "default_subagent_reasoning_effort",
  "max_concurrent_threads_per_session",
];
const SUPERSEDED_AGENT_KEYS = new Set(["max_threads"]);
const AGENT_FILES = ["recon.toml", "packet.toml"];

function parseManagedAssignments(fragment) {
  const lines = fragment.split(/\r?\n/);
  const agentsHeader = lines.findIndex((line) => /^\s*\[agents\]\s*(?:#.*)?$/.test(line));
  if (agentsHeader === -1) {
    throw new Error("Codex config fragment must contain an [agents] table");
  }

  const assignments = new Map();
  for (const line of lines.slice(agentsHeader + 1)) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
    if (match && MANAGED_AGENT_KEYS.includes(match[1])) assignments.set(match[1], line);
  }

  const missing = MANAGED_AGENT_KEYS.filter((key) => !assignments.has(key));
  if (missing.length > 0) {
    throw new Error(`Codex config fragment is missing managed keys: ${missing.join(", ")}`);
  }
  return assignments;
}

export function mergeCodexConfig(existing, fragment) {
  const assignments = parseManagedAssignments(fragment);
  if (existing.trim() === "") return `${fragment.trimEnd()}\n`;

  const lines = existing.split(/\r?\n/);
  const agentsHeader = lines.findIndex((line) => /^\s*\[agents\]\s*(?:#.*)?$/.test(line));
  if (agentsHeader === -1) {
    return `${existing.trimEnd()}\n\n[agents]\n${[...assignments.values()].join("\n")}\n`;
  }

  let sectionEnd = lines.findIndex(
    (line, index) => index > agentsHeader && /^\s*\[\[?.+?\]?\]\s*(?:#.*)?$/.test(line),
  );
  if (sectionEnd === -1) sectionEnd = lines.length;

  const emitted = new Set();
  const mergedSection = [];
  for (const line of lines.slice(agentsHeader + 1, sectionEnd)) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
    if (match && SUPERSEDED_AGENT_KEYS.has(match[1])) continue;
    if (!match || !assignments.has(match[1])) {
      mergedSection.push(line);
      continue;
    }
    if (!emitted.has(match[1])) {
      mergedSection.push(assignments.get(match[1]));
      emitted.add(match[1]);
    }
  }
  for (const [key, line] of assignments) {
    if (!emitted.has(key)) mergedSection.push(line);
  }

  const merged = [
    ...lines.slice(0, agentsHeader + 1),
    ...mergedSection,
    ...lines.slice(sectionEnd),
  ].join("\n");
  return `${merged.trimEnd()}\n`;
}

export async function installCodexConfig({ sourceDir, codexHome }) {
  const fragment = await readFile(join(sourceDir, "config.toml"), "utf8");
  const configPath = join(codexHome, "config.toml");
  const configExists = existsSync(configPath);
  const existing = configExists ? await readFile(configPath, "utf8") : "";
  const existingMode = configExists ? (await stat(configPath)).mode & 0o777 : undefined;
  const merged = mergeCodexConfig(existing, fragment);

  await mkdir(codexHome, { recursive: true });
  const stagingPath = join(codexHome, ".config.toml.golems-new");
  try {
    await writeFile(stagingPath, merged);
    if (existingMode !== undefined) await chmod(stagingPath, existingMode);
    await rename(stagingPath, configPath);
  } finally {
    await rm(stagingPath, { force: true });
  }

  const agentsDir = join(codexHome, "agents");
  await mkdir(agentsDir, { recursive: true });
  await Promise.all(
    AGENT_FILES.map((name) => copyFile(join(sourceDir, "agents", name), join(agentsDir, name))),
  );
}

export function parseArgs(argv) {
  const args = new Map();
  const supported = new Set(["--source-dir", "--codex-home"]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !supported.has(key) || value === undefined) {
      throw new Error("Usage: install-codex-config.mjs [--source-dir PATH] [--codex-home PATH]");
    }
    args.set(key, value);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultSource = resolve(scriptDir, "../../../../config/codex");
  const sourceDir = resolve(args.get("--source-dir") ?? defaultSource);
  const codexHome = resolve(args.get("--codex-home") ?? join(homedir(), ".codex"));
  await installCodexConfig({ sourceDir, codexHome });
  console.log(`Installed Codex subagent defaults in ${codexHome}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

#!/usr/bin/env bun
// repogolem-config: one local config file for repoGolem launchers.
//
//   import   --registry <registry.json> --seats <config.yaml> --out <path>
//            [--drop-cli <cli>]... [--write [--force]]
//
// `import` writes ONE YAML: the seat-registry file copied verbatim, plus the
// Ralph registry's sections appended as new top-level keys.
//
// AIDEV-NOTE: the config file is LOCAL (Etan, 2026-09-25: "config is local,
// generation function can be committed"). Never commit one; tests use the
// synthetic fixtures in scripts/tests/fixtures/repogolem-config/.
// AIDEV-NOTE: the seat file is copied as text, never re-serialized.
// cmuxlayer reads `seatRegistry:` with a line parser (seat-identity.ts
// parseSeatRegistryConfig) that stops at the next column-0 line, so the seat
// block must stay byte-identical and the appended keys must start at column 0.
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml, parseAllDocuments, stringify as stringifyYaml } from "yaml";

const GENERATOR_ID = "golems/scripts/repogolem/repogolem-config.ts";
const REGISTRY_KEYS = ["version", "coderabbit", "global", "projects", "mcpDefinitions"] as const;
// registry.json key -> config.yaml key. `version` is renamed so it cannot be
// mistaken for the config file's own version.
const CONFIG_KEY: Record<(typeof REGISTRY_KEYS)[number], string> = {
  version: "registryVersion",
  coderabbit: "coderabbit",
  global: "global",
  projects: "projects",
  mcpDefinitions: "mcpDefinitions",
};
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

class UsageError extends Error {}

function fail(message: string): never {
  throw new UsageError(message);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

// JS objects put integer-like keys first, which would silently reorder
// projects (and therefore launchers). Refuse instead.
function assertOrderSafeKeys(section: string, value: JsonObject) {
  for (const key of Object.keys(value)) {
    if (/^(0|[1-9]\d*)$/.test(key)) fail(`${section}.${key}: integer-like keys are not supported`);
  }
}

// ── import ────────────────────────────────────────────────────────────────

export interface ImportResult {
  text: string;
  projects: number;
  mcpDefinitions: number;
  dropped: number;
  // Key paths (never values) of secret/env values that are not op:// refs.
  literals: string[];
}

// Secrets belong in 1Password; a literal here is copied into the config file.
function literalPaths(imported: JsonObject): string[] {
  const found: string[] = [];
  const scan = (where: string, values: Json | undefined) => {
    if (!isObject(values)) return;
    for (const [key, value] of Object.entries(values)) {
      if (!(typeof value === "string" && value.startsWith("op://"))) found.push(`${where}.${key}`);
    }
  };
  for (const [name, project] of Object.entries(imported.projects as JsonObject)) {
    if (isObject(project)) scan(`projects.${name}.secrets`, project.secrets);
  }
  if (isObject(imported.global)) scan("global.env", imported.global.env);
  if (isObject(imported.mcpDefinitions)) {
    for (const [name, definition] of Object.entries(imported.mcpDefinitions)) {
      if (isObject(definition)) scan(`mcpDefinitions.${name}.env`, definition.env);
    }
  }
  return found;
}

export function buildImport(registryText: string, seatsText: string, dropClis: string[]): ImportResult {
  const registry: unknown = JSON.parse(registryText);
  if (!isObject(registry)) fail("registry: top level must be a JSON object");
  for (const key of Object.keys(registry)) {
    if (!(REGISTRY_KEYS as readonly string[]).includes(key)) {
      fail(`registry: unknown top-level key "${key}" would not round-trip`);
    }
  }
  if (!isObject(registry.projects)) fail("registry: projects must be an object");
  assertOrderSafeKeys("projects", registry.projects);
  if (isObject(registry.mcpDefinitions)) assertOrderSafeKeys("mcpDefinitions", registry.mcpDefinitions);

  const docs = parseAllDocuments(seatsText);
  if (docs.length !== 1) fail(`seats: expected one YAML document, found ${docs.length}`);
  const seatErrors = docs[0].errors;
  if (seatErrors.length > 0) fail(`seats: ${seatErrors[0].message}`);
  const seats: unknown = docs[0].toJS();
  if (!isObject(seats)) fail("seats: top level must be a YAML mapping");

  const imported: JsonObject = {};
  for (const key of REGISTRY_KEYS) {
    if (!(key in registry)) continue;
    const configKey = CONFIG_KEY[key];
    if (configKey in seats) fail(`seats: already has top-level "${configKey}"; refusing to merge`);
    imported[configKey] = structuredClone(registry[key]);
  }

  let dropped = 0;
  const projects = imported.projects as JsonObject;
  for (const project of Object.values(projects)) {
    if (!isObject(project) || !Array.isArray(project.clis)) continue;
    const kept = project.clis.filter((cli) => !dropClis.includes(cli as string));
    dropped += project.clis.length - kept.length;
    project.clis = kept;
  }

  const block = stringifyYaml(imported, {
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
  });
  const prefix = seatsText.length === 0 || seatsText.endsWith("\n") ? seatsText : `${seatsText}\n`;
  const text = [
    prefix,
    "# ── repoGolem launcher registry ──────────────────────────────────────",
    `# Imported by ${GENERATOR_ID}`,
    `# from a registry.json with sha256 ${sha256(registryText)}.`,
    "# Keys above this banner are the seat registry, copied verbatim.",
    "# Regenerate launchers with:",
    "#   bun scripts/repogolem/repogolem-config.ts generate --config <this file> --out-dir <dir>",
    block,
  ].join("\n");

  // Self-check before anything is written: the merged file must parse back to
  // exactly the seat file's keys plus the imported ones.
  const merged: unknown = parseYaml(text);
  if (!isObject(merged)) fail("internal: merged config did not parse as a mapping");
  for (const [key, value] of Object.entries(seats)) {
    if (!isDeepStrictEqual(merged[key], value)) fail(`internal: seat key "${key}" changed in the merge`);
  }
  for (const [key, value] of Object.entries(imported)) {
    if (!isDeepStrictEqual(merged[key], value)) fail(`internal: imported key "${key}" did not round-trip`);
  }

  return {
    text,
    projects: Object.keys(projects).length,
    mcpDefinitions: isObject(imported.mcpDefinitions) ? Object.keys(imported.mcpDefinitions).length : 0,
    dropped,
    literals: literalPaths(imported),
  };
}

function backupStamp() {
  return `${new Date().toISOString().slice(0, 19).replace(/:/g, "")}Z`;
}

function writeAtomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

// ── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[], flags: string[], values: string[], repeated: string[] = []) {
  const out: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = arg.replace(/^--/, "");
    if (!arg.startsWith("--")) fail(`unexpected argument: ${arg}`);
    if (flags.includes(name)) {
      out[name] = true;
    } else if (values.includes(name) || repeated.includes(name)) {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      if (repeated.includes(name)) out[name] = [...((out[name] as string[]) ?? []), value];
      else out[name] = value;
    } else {
      fail(`unknown option: ${arg}`);
    }
  }
  return out;
}

function required(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string") fail(`--${name} is required`);
  return value;
}

function runImport(argv: string[]) {
  const args = parseArgs(argv, ["write", "force"], ["registry", "seats", "out"], ["drop-cli"]);
  const out = required(args, "out");
  const result = buildImport(
    readFileSync(required(args, "registry"), "utf8"),
    readFileSync(required(args, "seats"), "utf8"),
    (args["drop-cli"] as string[]) ?? [],
  );
  const summary = `projects ${result.projects}, mcpDefinitions ${result.mcpDefinitions}, dropped ${result.dropped}, literals ${result.literals.length}`;
  if (result.literals.length > 0) {
    console.error(
      `warning: ${result.literals.length} literal (non-op://) secret/env value(s) will be copied into ${out}:\n  ${result.literals.join("\n  ")}`,
    );
  }
  if (!args.write) {
    console.log(`${summary} (dry-run; pass --write to write ${out})`);
    return 0;
  }
  if (existsSync(out)) {
    if (!args.force) fail(`${out} exists; pass --force to overwrite (a dated .bak is written first)`);
    const bak = `${out}.bak-${backupStamp()}`;
    copyFileSync(out, bak, constants.COPYFILE_EXCL);
    console.log(`backup: ${bak}`);
  }
  writeAtomic(out, result.text);
  console.log(`${summary}; wrote ${out}`);
  return 0;
}

function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (command === "import") return runImport(rest);
  fail("usage: repogolem-config.ts import [options] (see the header comment)");
}

// Exit codes: 0 ok · 2 any error (1 is reserved for a staleness verdict).
if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`repogolem-config: ${message}`);
    process.exit(2);
  }
}

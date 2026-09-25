#!/usr/bin/env bun
// repogolem-config: one local config file for repoGolem launchers.
//
//   import   --registry <registry.json> --seats <config.yaml> --out <path>
//            [--drop-cli <cli>]... [--write [--force]]
//   generate --config <config.yaml> --out-dir <dir> [--home <dir>] [--check]
//
// `import` writes ONE YAML: the seat-registry file copied verbatim, plus the
// Ralph registry's sections appended as new top-level keys. `generate` turns
// that file back into the registry.json golem-dispatch.zsh reads today and
// the launchers.zsh Ralph's _ralph_generate_launchers_from_registry emits.
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
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
const CLI_SUFFIX: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  cursor: "Cursor",
  kiro: "Kiro",
};
const BAR = `# ${"═".repeat(67)}`;
const BOOTSTRAP = [
  "# Bootstrap repoGolem when this file is sourced directly.",
  'if ! typeset -f repoGolem >/dev/null 2>&1 && [[ -f "$HOME/.config/ralphtools/ralph.zsh" ]]; then',
  '  source "$HOME/.config/ralphtools/ralph.zsh"',
  "fi",
  "",
];

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
  // Key paths (never values) of secret/env values that are not op:// or $ refs.
  literals: string[];
}

// Secrets belong in 1Password; a literal here is copied into the config file.
// Every `env` or `secrets` mapping anywhere in the imported sections counts.
// op:// (1Password) and $VAR / ${VAR} (resolved at launch) are references.
function literalPaths(value: Json, where: string, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => literalPaths(item, `${where}.${index}`, found));
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const path = where ? `${where}.${key}` : key;
      if ((key === "env" || key === "secrets") && isObject(child)) {
        for (const [name, entry] of Object.entries(child)) {
          const isRef = typeof entry === "string" && (entry.startsWith("op://") || entry.startsWith("$"));
          if (!isRef) found.push(`${path}.${name}`);
        }
      } else {
        literalPaths(child, path, found);
      }
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
    literals: literalPaths(imported, ""),
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

// ── generate ──────────────────────────────────────────────────────────────

const SAFE_WORD = /^[A-Za-z0-9._-]+$/;
const SAFE_MCP = /^[A-Za-z0-9._@/-]+$/;
const UNSAFE_PATH = /["\\$`|\n]/;

function optionalString(project: JsonObject, field: string, where: string): string {
  const value = project[field];
  if (value === undefined || value === null || value === false) return "";
  if (typeof value !== "string") fail(`${where}.${field}: must be a string`);
  if (value !== "" && !SAFE_WORD.test(value)) fail(`${where}.${field}: unsafe characters`);
  return value;
}

// Same order and probe as Ralph's _repogolem_installed_clis (gemini runs via npx).
function installedClis(): string[] {
  const probes: [string, string][] = [
    ["claude", "claude"],
    ["codex", "codex"],
    ["gemini", "npx"],
    ["cursor", "cursor"],
  ];
  return probes.filter(([, bin]) => Bun.which(bin) !== null).map(([cli]) => cli);
}

export function launchersBody(projects: JsonObject, home: string): string {
  const names = Object.keys(projects);
  if (names.length === 0) return "# No projects registered\n";

  const lines: string[] = [];
  const aliasLines: string[] = [];
  for (const name of names) {
    const where = `projects.${name}`;
    const project = projects[name];
    if (!isObject(project)) fail(`${where}: must be an object`);
    if (!SAFE_WORD.test(name)) fail(`${where}: unsafe project name`);
    if (typeof project.path !== "string") fail(`${where}.path: must be a string`);
    if (UNSAFE_PATH.test(project.path)) fail(`${where}.path: unsafe characters`);
    const mcps = project.mcps ?? [];
    if (!Array.isArray(mcps) || !mcps.every((m) => typeof m === "string" && SAFE_MCP.test(m))) {
      fail(`${where}.mcps: must be a list of plain MCP names`);
    }

    const base = name.toLowerCase();
    const path = project.path.startsWith("~") ? `${home}${project.path.slice(1)}` : project.path;
    lines.push(`repoGolem ${name} "${path}" ${mcps.join(" ")}`);

    const funcAlias = optionalString(project, "funcAlias", where);
    const prefix = optionalString(project, "launcherAliasPrefix", where);
    let clis = project.clis ?? [];
    if (!Array.isArray(clis) || !clis.every((c) => typeof c === "string")) {
      fail(`${where}.clis: must be a list of strings`);
    }
    if (clis.length === 0) clis = installedClis();

    if (funcAlias) aliasLines.push(`alias ${funcAlias}=${base}Claude`);
    if (prefix) {
      aliasLines.push(`function ${prefix}() { ${base}Claude "$@"; }`);
      for (const cli of clis as string[]) {
        const suffix = CLI_SUFFIX[cli];
        if (!suffix) continue;
        aliasLines.push(`function ${prefix}${suffix}() { ${base}${suffix} "$@"; }`);
      }
    }
  }

  return [
    ...lines,
    "",
    "# Aliases (from funcAlias / launcherAliasPrefix in registry)",
    ...aliasLines,
    "",
  ].join("\n");
}

export interface Generated {
  registryJson: string;
  launchersZsh: string;
}

export function buildGenerated(configText: string, home: string, sourceSha: string): Generated {
  const config: unknown = parseYaml(configText);
  if (!isObject(config) || !isObject(config.projects)) {
    fail("config: no top-level projects mapping (run `import` first)");
  }
  assertOrderSafeKeys("projects", config.projects);
  if (isObject(config.mcpDefinitions)) assertOrderSafeKeys("mcpDefinitions", config.mcpDefinitions);
  const configSha = sha256(configText);

  const registry: JsonObject = {
    _generated: { generator: GENERATOR_ID, sourceSha, configSha256: configSha },
  };
  for (const key of REGISTRY_KEYS) {
    const configKey = CONFIG_KEY[key];
    if (configKey in config) registry[key] = config[configKey];
  }

  const header = [
    BAR,
    `# AUTO-GENERATED by ${GENERATOR_ID} - do not edit manually`,
    "# Regenerate with: bun scripts/repogolem/repogolem-config.ts generate --config <config.yaml> --out-dir <dir>",
    `# generator-sha: ${sourceSha}`,
    `# config-sha256: ${configSha}`,
    BAR,
    "",
    ...BOOTSTRAP,
  ].join("\n");

  return {
    registryJson: `${JSON.stringify(registry, null, 2)}\n`,
    launchersZsh: `${header}\n${launchersBody(config.projects, home)}`,
  };
}

function currentSourceSha(): string {
  if (process.env.REPOGOLEM_SOURCE_SHA) return process.env.REPOGOLEM_SOURCE_SHA;
  const cwd = import.meta.dir;
  const head = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "HEAD"], { stderr: "ignore" });
  if (head.exitCode !== 0) return "unknown";
  const sha = head.stdout.toString().trim();
  const dirty = Bun.spawnSync(["git", "-C", cwd, "status", "--porcelain", "--", import.meta.path], {
    stderr: "ignore",
  });
  return dirty.stdout.toString().trim() ? `${sha}-dirty` : sha;
}

// The source SHA each output recorded. --check regenerates with it, so a new
// golems commit alone never reads as stale; only the config or the file can.
function recordedSourceSha(registryText: string | null, launchersText: string | null): string | null {
  if (registryText !== null) {
    try {
      const parsed: unknown = JSON.parse(registryText);
      if (isObject(parsed) && isObject(parsed._generated) && typeof parsed._generated.sourceSha === "string") {
        return parsed._generated.sourceSha;
      }
    } catch {
      // fall through to the launchers header
    }
  }
  const match = launchersText?.match(/^# generator-sha: (\S+)$/m);
  return match ? match[1] : null;
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
      `warning: ${result.literals.length} literal (non-op://, non-$) secret/env value(s) will be copied into ${out}:\n  ${result.literals.join("\n  ")}`,
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

function runGenerate(argv: string[]) {
  const args = parseArgs(argv, ["check"], ["config", "out-dir", "home"]);
  const configText = readFileSync(required(args, "config"), "utf8");
  const outDir = required(args, "out-dir");
  const home = typeof args.home === "string" ? args.home : homedir();
  const registryPath = join(outDir, "registry.json");
  const launchersPath = join(outDir, "launchers.zsh");

  if (!args.check) {
    const generated = buildGenerated(configText, home, currentSourceSha());
    writeAtomic(registryPath, generated.registryJson);
    writeAtomic(launchersPath, generated.launchersZsh);
    console.log(`wrote ${registryPath}\nwrote ${launchersPath}`);
    return 0;
  }

  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);
  const registryText = read(registryPath);
  const launchersText = read(launchersPath);
  const expected = buildGenerated(configText, home, recordedSourceSha(registryText, launchersText) ?? "unknown");
  const stale: string[] = [];
  if (registryText !== expected.registryJson) stale.push(registryText === null ? `${registryPath} (missing)` : registryPath);
  if (launchersText !== expected.launchersZsh) {
    stale.push(launchersText === null ? `${launchersPath} (missing)` : launchersPath);
  }
  if (stale.length > 0) {
    console.error(`stale vs ${required(args, "config")}:\n  ${stale.join("\n  ")}\nrerun generate`);
    return 1;
  }
  console.log(`fresh: ${registryPath}, ${launchersPath}`);
  return 0;
}

function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (command === "import") return runImport(rest);
  if (command === "generate") return runGenerate(rest);
  fail("usage: repogolem-config.ts import|generate [options] (see the header comment)");
}

// Exit codes: 0 ok · 1 stale (generate --check) · 2 any error. An unreadable
// or unparseable input must never exit 1, or a --check caller reads it as stale.
if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`repogolem-config: ${message}`);
    process.exit(2);
  }
}

#!/usr/bin/env bun
// repogolem-config: one local config file for repoGolem launchers.
//
//   import   --registry <registry.json> --seats <config.yaml> --out <path>
//            [--drop-cli <cli>]... [--write [--force]]
//   generate [--config <config.yaml>] [--out-dir <dir>] [--home <dir>]
//            [--host <LocalHostName>] [--check | --check-refs [--no-prompt]]
// --check-refs allows Touch ID; --no-prompt disables it for automation.
//   init     [--config <path>] [--host <LocalHostName>] [--force]
//
// --config defaults to $REPOGOLEM_CONFIG, --out-dir to
// ~/.config/repogolem/generated. --host defaults to
// $REPOGOLEM_HOST, then `scutil --get LocalHostName`; it picks the config's
// machines.<host> section (config.schema.json documents the shape).
//
// `import` writes ONE YAML: the seat-registry file copied verbatim, plus the
// Ralph registry's sections appended as new top-level keys. `generate` turns
// that file back into the registry.json golem-dispatch.zsh reads today and
// the launchers.zsh Ralph's _ralph_generate_launchers_from_registry emits,
// plus secrets.env: every op:// ref resolved through varlock in one op batch
// (repogolem-secrets.ts). All three are 0600 in a 0700 dir outside any repo.
// `init` writes config.example.yaml, with this machine's section, as a starter.
//
// AIDEV-NOTE: a real config is never committed to golems (Etan, 2026-09-25:
// "config is local, generation function can be committed"; 2026-09-27: one
// private file with a machines: section). It holds op:// refs, never values.
// Tests use the synthetic fixtures in scripts/tests/fixtures/repogolem-config/
// and config.example.yaml, whose boundary tests forbid real paths/hosts/vaults.
// AIDEV-NOTE: the seat file is copied as text, never re-serialized.
// cmuxlayer reads `seatRegistry:` with a line parser (seat-identity.ts
// parseSeatRegistryConfig) that stops at the next column-0 line, so the seat
// block must stay byte-identical and the appended keys must start at column 0.
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import Ajv, { type ErrorObject } from "ajv";
import { parse as parseYaml, parseAllDocuments, stringify as stringifyYaml } from "yaml";
import { runSync } from "./repogolem-sync";
import { runInstall } from "./repogolem-install";
import { readTransferredSecrets } from "./runtime-reader";
import configSchema from "./config.schema.json";
import { collectRefs, resolveRefs, secretKey, secretsEnvKeys, secretsEnvText } from "./repogolem-secrets";
import { varlockResolver } from "./repogolem-varlock";
import { isOpCredential, checkRefs, opEnvironment } from "./repogolem-check-refs";

const GENERATOR_ID = "golems/scripts/repogolem/repogolem-config.ts";
const EXAMPLE_PATH = join(import.meta.dir, "config.example.yaml");
const EXAMPLE_HOST = "example-host";
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
};
const BAR = `# ${"═".repeat(67)}`;
const BOOTSTRAP = [
  "# Bootstrap the standalone cache-only runtime when sourced directly.",
  'if ! typeset -f _golem_runtime_read >/dev/null 2>&1; then',
  '  source "${REPOGOLEM_RUNTIME_FILE:-$HOME/.config/repogolem/runtime/runtime.zsh}" || return $?',
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

function writeAtomic(path: string, text: string, mode?: number) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  if (mode === undefined) {
    writeFileSync(tmp, text);
  } else {
    // wx: never follow a pre-placed file or symlink at the tmp path.
    writeFileSync(tmp, text, { mode, flag: "wx" });
    chmodSync(tmp, mode);
  }
  renameSync(tmp, path);
}

// ── config: schema + machines ─────────────────────────────────────────────

const ajv = new Ajv({ allErrors: true });
const validateConfig = ajv.compile(configSchema);

// Key paths and schema rules only: ajv messages never carry the value, and
// the value may be a pasted secret.
function schemaErrors(label: string, errors: ErrorObject[] | null | undefined): never {
  const lines = (errors ?? []).slice(0, 8).map((e) => {
    const name = e.params.additionalProperty ?? e.params.propertyName ?? e.params.missingProperty;
    return `  ${e.instancePath || "/"}: ${e.message}${typeof name === "string" ? ` (${name})` : ""}`;
  });
  fail(`${label} does not match config.schema.json:\n${lines.join("\n")}`);
}

function detectHost(): string {
  if (process.env.REPOGOLEM_HOST) return process.env.REPOGOLEM_HOST;
  const scutil = () => {
    try {
      return Bun.spawnSync(["scutil", "--get", "LocalHostName"], { stdout: "pipe", stderr: "ignore" });
    } catch {
      fail("cannot run `scutil --get LocalHostName`; pass --host or set REPOGOLEM_HOST");
    }
  };
  const proc = scutil();
  const host = proc.stdout.toString().trim();
  if (proc.exitCode !== 0 || host === "") fail("`scutil --get LocalHostName` failed; pass --host or set REPOGOLEM_HOST");
  return host;
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Objects merge, lists and scalars replace, null removes the key.
function deepMerge(base: JsonObject, over: JsonObject, where: string): JsonObject {
  const merged: JsonObject = structuredClone(base);
  for (const [key, value] of Object.entries(over)) {
    if (UNSAFE_KEYS.has(key)) fail(`${where}.${key}: reserved key`);
    const current = merged[key];
    if (value === null) delete merged[key];
    else if (isObject(current) && isObject(value)) merged[key] = deepMerge(current, value, `${where}.${key}`);
    else merged[key] = structuredClone(value);
  }
  return merged;
}

// prelaunch is shell code the dispatcher runs at every launch, not a secrets
// channel: an op:// ref there would skip secrets.env. Every machine's list is
// checked, not only this one's, and only the key path is ever reported.
function assertNoPrelaunchRefs(parsed: JsonObject) {
  const lists: [string, Json | undefined][] = [];
  if (isObject(parsed.global)) lists.push(["global.prelaunch", parsed.global.prelaunch]);
  if (isObject(parsed.machines)) {
    for (const [host, section] of Object.entries(parsed.machines)) {
      if (!isObject(section) || !isObject(section.overrides) || !isObject(section.overrides.global)) continue;
      lists.push([`machines.${host}.overrides.global.prelaunch`, section.overrides.global.prelaunch]);
    }
  }
  for (const [where, list] of lists) {
    if (!Array.isArray(list)) continue;
    list.forEach((command, index) => {
      if (typeof command === "string" && command.includes("op://")) {
        fail(`${where}.${index}: op:// refs are not allowed in prelaunch; it is not a secrets channel (use secrets: or env:)`);
      }
    });
  }
}

export interface Resolved {
  config: JsonObject;
  machine: string | null;
}

// The config as this machine sees it: machines.<host>.overrides merged in,
// relative project paths joined to its reposPath, clis bounded by its clis.
export function resolveConfig(configText: string, host: () => string): Resolved {
  const parsed: unknown = parseYaml(configText);
  if (!isObject(parsed) || !isObject(parsed.projects)) {
    fail("config: no top-level projects mapping (run `import` or `init` first)");
  }
  assertOrderSafeKeys("projects", parsed.projects);
  if (isObject(parsed.mcpDefinitions)) assertOrderSafeKeys("mcpDefinitions", parsed.mcpDefinitions);
  assertNoPrelaunchRefs(parsed);
  if (!validateConfig(parsed)) schemaErrors("config", validateConfig.errors);

  const { machines, ...shared } = parsed;
  let config: JsonObject = shared;
  let machine: string | null = null;
  let reposPath: string | null = null;
  let machineClis: string[] | null = null;
  if (isObject(machines)) {
    machine = host();
    const section = machines[machine];
    if (!isObject(section)) {
      fail(`machine "${machine}" has no machines: section (known: ${Object.keys(machines).join(", ")})`);
    }
    if (isObject(section.overrides)) {
      if (isObject(section.overrides.projects)) assertOrderSafeKeys("overrides.projects", section.overrides.projects);
      config = deepMerge(config, section.overrides, `machines.${machine}.overrides`);
    }
    if (typeof section.reposPath === "string") reposPath = section.reposPath.replace(/\/+$/, "");
    if (Array.isArray(section.clis)) machineClis = section.clis as string[];
  }

  for (const [name, project] of Object.entries(config.projects as JsonObject)) {
    if (!isObject(project)) continue;
    if (typeof project.path === "string" && !/^[/~]/.test(project.path)) {
      if (reposPath === null) {
        fail(`projects.${name}.path is relative but there is no machines.<host>.reposPath to join it to`);
      }
      project.path = `${reposPath}/${project.path}`;
    }
    const allowed = machineClis;
    if (allowed !== null) {
      const clis = Array.isArray(project.clis) ? project.clis : allowed;
      project.clis = clis.filter((cli) => allowed.includes(cli as string));
    }
  }

  if (!validateConfig(config)) {
    schemaErrors(`effective config for machine ${machine ?? "(none)"}`, validateConfig.errors);
  }
  return { config, machine };
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
  // secrets.env minus the value lines, which only `generate` can add.
  secretsHeader: string[];
  refs: string[];
  configSha: string;
  machine: string | null;
}

export function buildGenerated(configText: string, home: string, sourceSha: string, host: () => string): Generated {
  const { config, machine } = resolveConfig(configText, host);
  const configSha = sha256(configText);

  const registry: JsonObject = {
    _generated: { generator: GENERATOR_ID, sourceSha, configSha256: configSha, machine },
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
    `# machine: ${machine ?? "(none)"}`,
    BAR,
    "",
    ...BOOTSTRAP,
  ].join("\n");

  let refs: string[];
  try {
    refs = collectRefs(config);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const secretsHeader = [
    BAR,
    `# AUTO-GENERATED by ${GENERATOR_ID} - do not edit manually`,
    "# Resolved op:// values: mode 0600, outside every repo. Never commit, copy or print.",
    "# A ref's value is REPOGOLEM_SECRET_<first 32 hex of sha256(ref)>; registry.json keeps the refs.",
    `# generator-sha: ${sourceSha}`,
    `# config-sha256: ${configSha}`,
    `# machine: ${machine ?? "(none)"}`,
    `# refs: ${refs.length}`,
    BAR,
  ];

  return {
    registryJson: `${JSON.stringify(registry, null, 2)}\n`,
    launchersZsh: `${header}\n${launchersBody(config.projects as JsonObject, home)}`,
    secretsHeader,
    refs,
    configSha,
    machine,
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

function configPath(args: Record<string, unknown>): string {
  if (typeof args.config === "string") return args.config;
  if (process.env.REPOGOLEM_CONFIG) return process.env.REPOGOLEM_CONFIG;
  fail("no config: set REPOGOLEM_CONFIG or pass --config <path>");
}

function hostFrom(args: Record<string, unknown>): () => string {
  return () => (typeof args.host === "string" ? args.host : detectHost());
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const OUTPUTS = ["registry.json", "launchers.zsh", "secrets.env"] as const;

const myUid = () => (typeof process.getuid === "function" ? process.getuid() : -1);

// secrets.env must never land where git could pick it up, or anywhere another
// user (or a symlink) could redirect it. Checked once before `op` runs and
// again after, because `op` may wait on Touch ID (Daybreak R1 P3).
function assertTrustedPath(outDir: string) {
  const abs = resolve(outDir);
  // A symlink on the requested path is trusted only when root owns it
  // (macOS /var, /tmp); any other one could be re-pointed.
  let prefix = "/";
  for (const part of abs.split("/").filter(Boolean)) {
    prefix = join(prefix, part);
    if (!existsSync(prefix) && !lstatOrNull(prefix)) break;
    const link = lstatOrNull(prefix);
    if (link?.isSymbolicLink() && link.uid !== 0) {
      fail(`${outDir}: ${prefix} is a symlink; point --out-dir at the real directory; nothing written`);
    }
  }
  let existing = abs;
  while (!existsSync(existing)) existing = dirname(existing);
  for (let dir = realpathSync(existing); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) {
      fail(`${outDir} is inside a git work tree (${dir}); secrets.env must live outside every repo; nothing written`);
    }
    const stat = statSync(dir);
    if (stat.uid !== 0 && stat.uid !== myUid()) fail(`${dir} is owned by another user; nothing written`);
    if ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0) {
      fail(`${dir} is writable by others and not sticky; it could be swapped under --out-dir; nothing written`);
    }
    if (dirname(dir) === dir) break;
  }
}

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function assertSafeOutDir(outDir: string) {
  assertTrustedPath(outDir);
  if (!existsSync(outDir)) return;
  const stat = lstatSync(outDir);
  if (!stat.isDirectory()) fail(`${outDir} is not a directory`);
  if (stat.uid !== myUid()) fail(`${outDir} is owned by another user`);
}

// Writes bound to the directory itself, not its pathname: open it no-follow,
// check the handle, chdir into it and prove cwd is that same inode, re-check
// its real path, then create and rename the leaves relative to cwd. A swap of
// the path (or any parent) after this point cannot redirect a write.
function writeOutputsBound(outDir: string, texts: Record<(typeof OUTPUTS)[number], string>) {
  assertSafeOutDir(outDir);
  mkdirSync(outDir, { recursive: true, mode: DIR_MODE });
  let dirFd: number;
  try {
    dirFd = openSync(outDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "error";
    fail(`${outDir} is not a real directory (${code}; a symlink?); nothing written`);
  }
  const back = process.cwd();
  try {
    const held = fstatSync(dirFd);
    if (!held.isDirectory() || held.uid !== myUid()) fail(`${outDir} is not a directory this user owns; nothing written`);
    fchmodSync(dirFd, DIR_MODE);
    process.chdir(outDir);
    const here = statSync(".");
    if (here.dev !== held.dev || here.ino !== held.ino) fail(`${outDir} changed while it was opened; nothing written`);
    assertTrustedPath(process.cwd());
    for (const name of OUTPUTS) writeLeaf(name, texts[name]);
  } finally {
    process.chdir(back);
    closeSync(dirFd);
  }
}

// O_EXCL | O_NOFOLLOW: never write through a pre-placed tmp file or symlink.
function writeLeaf(name: string, text: string) {
  const tmp = `${name}.tmp-${process.pid}`;
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE);
  try {
    writeSync(fd, text);
    fchmodSync(fd, FILE_MODE);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, name);
}

const octal = (mode: number) => `0${(mode & 0o777).toString(8)}`;

function stampOf(text: string, field: string): string | null {
  const match = text.match(new RegExp(`^# ${field}: (\\S+)$`, "m"));
  return match ? match[1] : null;
}

function registryStamp(text: string, field: "configSha256" | "machine"): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isObject(parsed) && isObject(parsed._generated)) {
      const value = parsed._generated[field];
      return value === null ? "(none)" : typeof value === "string" ? value : null;
    }
  } catch {
    // unparseable: reported as a content difference
  }
  return null;
}

// Why one output is stale, or [] when it is fresh. Only reads files: never
// resolves a ref, never prints a value.
function staleReasons(
  path: string,
  text: string | null,
  stamps: { configSha: string | null; machine: string | null },
  expected: Generated,
  contentFresh: () => string | null,
): string[] {
  if (text === null) return ["missing"];
  const reasons: string[] = [];
  const machine = expected.machine ?? "(none)";
  if (stamps.machine !== machine) reasons.push(`machine ${stamps.machine ?? "unstamped"}, want ${machine}`);
  if (stamps.configSha !== expected.configSha) {
    const was = stamps.configSha ? stamps.configSha.slice(0, 12) : "unstamped";
    reasons.push(`config-sha256 ${was} != config ${expected.configSha.slice(0, 12)}`);
  }
  if (reasons.length === 0) {
    const differs = contentFresh();
    if (differs) reasons.push(differs);
  }
  const mode = statSync(path).mode & 0o777;
  if (mode !== FILE_MODE) reasons.push(`mode ${octal(mode)}, want ${octal(FILE_MODE)}`);
  return reasons;
}

function checkOutputs(configText: string, outDir: string, home: string, host: () => string): string[] {
  const paths = Object.fromEntries(OUTPUTS.map((name) => [name, join(outDir, name)])) as Record<
    (typeof OUTPUTS)[number],
    string
  >;
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);
  const registryText = read(paths["registry.json"]);
  const launchersText = read(paths["launchers.zsh"]);
  const secretsText = read(paths["secrets.env"]);
  const expected = buildGenerated(configText, home, recordedSourceSha(registryText, launchersText) ?? "unknown", host);

  const stale: string[] = [];
  const note = (path: string, reasons: string[]) => {
    if (reasons.length > 0) stale.push(`${path} (${reasons.join("; ")})`);
  };
  if (existsSync(outDir)) {
    const mode = statSync(outDir).mode & 0o777;
    if (mode !== DIR_MODE) stale.push(`${outDir} (mode ${octal(mode)}, want ${octal(DIR_MODE)})`);
  }
  note(
    paths["registry.json"],
    staleReasons(
      paths["registry.json"],
      registryText,
      { configSha: registryText && registryStamp(registryText, "configSha256"), machine: registryText && registryStamp(registryText, "machine") },
      expected,
      () => (registryText === expected.registryJson ? null : "content differs"),
    ),
  );
  note(
    paths["launchers.zsh"],
    staleReasons(
      paths["launchers.zsh"],
      launchersText,
      { configSha: launchersText && stampOf(launchersText, "config-sha256"), machine: launchersText && stampOf(launchersText, "machine") },
      expected,
      () => (launchersText === expected.launchersZsh ? null : "content differs"),
    ),
  );
  note(
    paths["secrets.env"],
    staleReasons(
      paths["secrets.env"],
      secretsText,
      { configSha: secretsText && stampOf(secretsText, "config-sha256"), machine: secretsText && stampOf(secretsText, "machine") },
      expected,
      () => {
        const have = secretsEnvKeys(secretsText ?? "");
        const want = new Set(expected.refs.map(secretKey));
        const missing = [...want].filter((key) => !have.has(key)).length;
        const extra = [...have].filter((key) => !want.has(key)).length;
        return missing + extra > 0 ? `refs differ: ${missing} missing, ${extra} extra` : null;
      },
    ),
  );
  return stale;
}

function runGenerate(argv: string[]) {
  const args = parseArgs(argv, ["check", "check-refs", "no-prompt", "help"], ["config", "out-dir", "home", "host", "secrets-from"]);
  if (args.help) {
    console.log("usage: repogolem generate [--config PATH] [--host HOST] [--check | --check-refs [--no-prompt]]");
    console.log("--check-refs checks vault/item/field names, signs in if needed, allows Touch ID, writes nothing; --no-prompt disables biometric integration for automation. Metadata calls are bounded to 15 seconds; sign-in requires a terminal and is bounded to 120 seconds.");
    return 0;
  }
  if (args["no-prompt"] && !args["check-refs"]) fail("--no-prompt requires --check-refs");
  const config = configPath(args);
  const configText = readFileSync(config, "utf8");
  const home = typeof args.home === "string" ? args.home : homedir();
  const outDir = typeof args["out-dir"] === "string" ? args["out-dir"] : join(homedir(), ".config", "repogolem", "generated");
  const host = hostFrom(args);

  if (args["check-refs"]) {
    if (args.check || args["secrets-from"]) fail("--check-refs cannot be combined with --check or --secrets-from");
    const { config: effective } = resolveConfig(configText, host);
    const refs = collectRefs(effective);
    if (refs.length && !effective.secrets) console.log('secrets.backend missing; defaulting to 1password.');
    return checkRefs(refs, process.env.REPOGOLEM_OP_BIN || "op", args["no-prompt"] === true);
  }

  if (args.check) {
    const stale = checkOutputs(configText, outDir, home, host);
    if (stale.length > 0) {
      console.error(`stale vs ${config}:\n  ${stale.join("\n  ")}\nrerun generate`);
      return 1;
    }
    console.log(`fresh: ${OUTPUTS.map((name) => join(outDir, name)).join(", ")}`);
    return 0;
  }

  // Everything that can fail runs before the first write.
  const generated = buildGenerated(configText, home, currentSourceSha(), host);
  assertSafeOutDir(outDir);
  const opBin = process.env.REPOGOLEM_OP_BIN || 'op';
  const opEnv = opEnvironment();
  let secretsEnv: string;
  try {
    if (!args['secrets-from'] && generated.refs.length) {
      const { config: effective } = resolveConfig(configText, host);
      if (!effective.secrets) console.log('secrets.backend missing; defaulting to 1password.');
      const status = checkRefs(generated.refs, opBin, false, opEnv);
      if (status !== 0) return status;
    }
    const resolved = typeof args["secrets-from"] === "string"
      ? readTransferredSecrets(args["secrets-from"], generated.configSha, generated.machine, generated.refs)
      : resolveRefs(generated.refs, varlockResolver(opBin, opEnv));
    secretsEnv = secretsEnvText(generated.secretsHeader, resolved);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    for (const key of Object.keys(opEnv)) if (isOpCredential(key)) delete opEnv[key];
  }

  writeOutputsBound(outDir, {
    "registry.json": generated.registryJson,
    "launchers.zsh": generated.launchersZsh,
    "secrets.env": secretsEnv,
  });
  const refs = generated.refs.length;
  console.log(
    `machine ${generated.machine ?? "(none)"}: ${refs} op:// refs resolved (${args["secrets-from"] ? "transferred cache; op not run" : refs > 0 ? "1 op session" : "op not run"})`,
  );
  for (const name of OUTPUTS) console.log(`wrote ${join(outDir, name)}`);
  return 0;
}

// The example, with its example-host section renamed to this machine.
export function starterConfig(host: string): string {
  if (!/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(host)) fail(`host "${host}" is not a LocalHostName`);
  const example = readFileSync(EXAMPLE_PATH, "utf8");
  const marker = new RegExp(`^  ${EXAMPLE_HOST}:$`, "m");
  if (!marker.test(example)) fail(`internal: config.example.yaml has no ${EXAMPLE_HOST} section`);
  const text = example.replace(marker, `  ${host}:`);
  const parsed: unknown = parseYaml(text);
  if (!validateConfig(parsed)) schemaErrors("starter config", validateConfig.errors);
  return text;
}

function runInit(argv: string[]) {
  const args = parseArgs(argv, ["force"], ["config", "host"]);
  const target = configPath(args);
  const host = hostFrom(args)();
  const text = starterConfig(host);
  if (existsSync(target)) {
    if (!args.force) fail(`${target} exists; pass --force to overwrite (a dated .bak is written first)`);
    const bak = `${target}.bak-${backupStamp()}`;
    copyFileSync(target, bak, constants.COPYFILE_EXCL);
    console.log(`backup: ${bak}`);
  }
  writeAtomic(target, text, 0o600);
  console.log(`wrote ${target} (machine ${host}); edit it, then run generate`);
  return 0;
}

function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (command === "sync") return runSync(rest, buildGenerated, currentSourceSha());
  if (command === "install") return runInstall(rest);
  if (command === "import") return runImport(rest);
  if (command === "generate") return runGenerate(rest);
  if (command === "init") return runInit(rest);
  fail("usage: repogolem-config.ts import|generate|init [options] (see the header comment)");
}

// Exit codes: 0 ok · 1 stale (--check) · 2 error/missing refs · 3 sign-in/authorization unavailable. An unreadable
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

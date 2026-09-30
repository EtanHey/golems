// Standalone launch-time reader. Cache bytes are data, never shell code; no op calls.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

type ObjectMap = Record<string, any>;
function privatePath(path: string, directory = false) {
  const stat = lstatSync(path);
  const mode = directory ? 0o700 : 0o600;
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== mode) {
    throw new Error(`runtime cache must be an owned ${directory ? "0700 directory" : "0600 regular file"}`);
  }
}
function stamp(text: string, name: string) {
  return text.match(new RegExp(`^# ${name}: (\\S+)$`, "m"))?.[1];
}
export function parseCache(text: string) {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(REPOGOLEM_SECRET_[0-9a-f]{32})=\$'((?:[^'\\]|\\(?:['\\nrt]|x[0-9a-f]{2}))*)'$/);
    if (!match || Object.hasOwn(values, match[1])) throw new Error("invalid cached assignment");
    values[match[1]] = match[2].replace(/\\(x[0-9a-f]{2}|['\\nrt])/g, (_, code) =>
      code.startsWith("x") ? String.fromCharCode(parseInt(code.slice(1), 16)) : ({ n: "\n", r: "\r", t: "\t" }[code] ?? code));
    if (values[match[1]].includes("\0")) throw new Error("invalid cached assignment");
  }
  return values;
}
export function readTransferredSecrets(path: string, configSha: string, machine: string | null, refs: string[]): Map<string, string> {
  privatePath(path);
  const text = readFileSync(path, "utf8");
  if (stamp(text, "config-sha256") !== configSha || stamp(text, "machine") !== (machine ?? "(none)")) {
    throw new Error("runtime cache is stale; nothing written");
  }
  const values = parseCache(text);
  const keys = refs.map(ref => `REPOGOLEM_SECRET_${createHash("sha256").update(ref).digest("hex").slice(0, 32)}`);
  if (Object.keys(values).length !== keys.length || keys.some(key => !Object.hasOwn(values, key) || !values[key])) {
    throw new Error("runtime cache references differ; nothing written");
  }
  return new Map(refs.map((ref, i) => [ref, values[keys[i]]]));
}
export function readRuntime(dir: string, environment: Record<string, string | undefined> = process.env): ObjectMap {
  privatePath(dir, true);
  for (const name of ["registry.json", "secrets.env"]) privatePath(join(dir, name));
  const registry = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8"));
  const text = readFileSync(join(dir, "secrets.env"), "utf8");
  if (!registry._generated?.configSha256 || stamp(text, "config-sha256") !== registry._generated.configSha256 ||
      stamp(text, "machine") !== (registry._generated.machine ?? "(none)")) throw new Error("runtime cache is stale; rerun generate");
  const values = parseCache(text);
  function walk(value: any, name = "config"): any {
    if (typeof value === "string") {
      if (value.startsWith("op://")) {
        const key = `REPOGOLEM_SECRET_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
        if (!Object.hasOwn(values, key)) throw new Error(`missing cached reference for ${name}`);
        return values[key];
      }
      const ref = value.match(/^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/);
      if (ref) {
        const key = ref[1] ?? ref[2];
        if (environment[key] === undefined) throw new Error(`missing environment reference for ${name}`);
        return environment[key];
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${name}.${i}`));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, `${name}.${k}`)]));
    return value;
  }
  return walk(registry);
}
export function runtimeMcpConfig(registry: ObjectMap, project: string) {
  const item = registry.projects?.[project];
  if (!item) throw new Error(`unknown project ${project}`);
  const servers: ObjectMap = { ...registry.global?.mcps };
  for (const name of item.mcps ?? []) {
    let definition = registry.mcpDefinitions?.[name];
    const key = name === "linear" ? "LINEAR_API_TOKEN" : name === "supabase" ? "SUPABASE_ACCESS_TOKEN" : null;
    if (!definition && key && item.secrets?.[key]) definition = {
      command: "npx", args: ["-y", name === "linear" ? "@tacticlaunch/mcp-linear" : "@supabase/mcp-server-supabase@latest"],
      env: { [key]: item.secrets[key] },
    };
    if (definition) servers[name] = definition;
  }
  return { mcpServers: servers };
}
export function runtimeEnvironment(registry: ObjectMap, project: string): Record<string, string> {
  const out = { ...registry.global?.env, ...registry.projects?.[project]?.secrets };
  for (const definition of Object.values(runtimeMcpConfig(registry, project).mcpServers) as ObjectMap[]) {
    for (const [key, value] of Object.entries(definition.env ?? {})) if (!(key in out)) out[key] = value;
  }
  for (const [key, value] of Object.entries(out)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0")) {
      throw new Error(`invalid runtime environment key ${key}`);
    }
  }
  return out;
}
if (import.meta.main) {
  try {
    const [command, dir, project] = process.argv.slice(2);
    const registry = readRuntime(dir);
    if (command === "mcp") process.stdout.write(JSON.stringify(runtimeMcpConfig(registry, project)));
    else if (command === "env") {
      for (const [key, value] of Object.entries(runtimeEnvironment(registry, project))) process.stdout.write(`${key}\0${value}\0`);
    } else if (command !== "check") throw new Error("usage: runtime-reader check|mcp|env <cache-dir> [project]");
  } catch (error) {
    // JSON/parser errors can contain source bytes. Only our key/count diagnostics are emitted.
    const message = error instanceof Error ? error.message : "";
    console.error(/^(runtime cache|invalid cached|missing (cached|environment) reference|unknown project|invalid runtime environment key|usage:)/.test(message) ? message : "runtime cache could not be read");
    process.exitCode = 1;
  }
}

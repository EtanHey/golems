// repogolem-secrets: generate-time op:// resolution for repogolem-config.ts.
//
// `generate` is the ONLY caller of resolveRefs: one `op run` per run, so one
// Touch ID prompt. Values land in secrets.env (mode 0600, outside every repo,
// never committed); registry.json keeps the refs. Readers (--check,
// golem-dispatch) only read files and never run `op`, so unattended spawns
// never prompt.
//
// AIDEV-NOTE: never print a resolved value. Messages carry counts, key paths
// and refs (refs are in the config already); values stay in memory until
// written to secrets.env.
import { createHash } from "node:crypto";
import { isOpCredential } from "./repogolem-check-refs";

export type Resolver = (refs: string[]) => string[];

const REF_ENV = "REPOGOLEM_REF_";
// What `op run` substitutes when masking is on; --no-masking must be honoured.
const MASKED = "<concealed by 1Password>";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// secrets.env variable for a ref: REPOGOLEM_SECRET_<first 32 hex of sha256(ref)>.
// A ref-derived name keeps two projects that map one env name to different
// refs apart, and lets a reader find a ref's value without resolving it.
export function secretKey(ref: string): string {
  return `REPOGOLEM_SECRET_${createHash("sha256").update(ref).digest("hex").slice(0, 32)}`;
}

// Every distinct op:// ref in an `env` or `secrets` mapping, sorted. An
// op:// string anywhere else would reach dispatch unresolved, so it fails.
export function collectRefs(config: unknown): string[] {
  const refs = new Set<string>();
  const stray: string[] = [];
  const definitions = isObject(config) && isObject(config.values) ? config.values : {};
  const walk = (value: unknown, where: string, inRefMap: boolean) => {
    if (typeof value === "string") {
      if (!value.startsWith("op://") && !value.startsWith("varlock://")) return;
      if (value.startsWith('varlock://') && !Object.hasOwn(definitions, value.slice(10))) throw new Error(`${where}: undeclared varlock value; nothing written`);
      if (inRefMap) refs.add(value);
      else stray.push(where);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${where}.${index}`, false));
    } else if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (!where && key === "values") continue;
        const path = where ? `${where}.${key}` : key;
        const refMap = (key === "env" || key === "secrets") && isObject(child);
        if (refMap) {
          for (const [name, entry] of Object.entries(child)) walk(entry, `${path}.${name}`, true);
        } else {
          walk(child, path, false);
        }
      }
    }
  };
  walk(config, "", false);
  if (stray.length > 0) {
    throw new Error(`op:// refs resolve only inside env/secrets mappings; found elsewhere at:\n  ${stray.join("\n  ")}`);
  }
  for (const name of Object.keys(definitions)) refs.add(`varlock://${name}`);
  return [...refs].sort();
}

// One `op run` for every ref: each ref rides in as an env var, op swaps in
// the value, and a child bun prints them back as JSON on the piped stdout.
// Authentication/preflight happens first; resolver diagnostics are suppressed
// because CLI errors can contain values. Only parsed values reach the writer.
export function opResolver(opBin: string, childEnv: Record<string, string | undefined> = process.env): Resolver {
  return (refs) => {
    const env: Record<string, string | undefined> = { ...childEnv };
    for (const key of Object.keys(env)) if (key.startsWith(REF_ENV)) delete env[key];
    refs.forEach((ref, index) => {
      env[`${REF_ENV}${index}`] = ref;
    });
    env.REPOGOLEM_REF_COUNT = String(refs.length);
    const emit = [
      "const n = Number(process.env.REPOGOLEM_REF_COUNT);",
      "const out = [];",
      `for (let i = 0; i < n; i++) out.push(process.env["${REF_ENV}" + i] ?? null);`,
      "process.stdout.write(JSON.stringify(out));",
    ].join(" ");
    const spawn = () => {
      try {
        return Bun.spawnSync([opBin, "run", "--no-masking", "--", "/usr/bin/env", ...Object.keys(env).filter(isOpCredential).flatMap(key => ["-u", key]), process.execPath, "--no-install", "-e", emit], {
          env,
          stdin: "inherit",
          stdout: "pipe",
          stderr: "ignore",
        });
      } catch {
        throw new Error(`cannot run ${opBin} (1Password CLI); ${refs.length} op:// ref(s) unresolved, nothing written`);
      }
    };
    const proc = spawn();
    if (proc.exitCode !== 0) {
      throw new Error(`op run exited ${proc.exitCode}; ${refs.length} op:// ref(s) unresolved, nothing written`);
    }
    let values: unknown;
    try {
      values = JSON.parse(proc.stdout.toString());
    } catch {
      throw new Error("op run returned unreadable output; nothing written");
    }
    if (!Array.isArray(values) || values.length !== refs.length) {
      throw new Error("op run returned the wrong number of values; nothing written");
    }
    return values as string[];
  };
}

// Resolve through `resolver`, then refuse anything that is not a real value.
export function resolveRefs(refs: string[], resolver: Resolver): Map<string, string> {
  const resolved = new Map<string, string>();
  if (refs.length === 0) return resolved;
  const values = resolver(refs);
  refs.forEach((ref, index) => {
    const value = values[index];
    if (typeof value !== "string" || value === "") throw new Error(`${ref}: no value from op; nothing written`);
    if (value === ref) throw new Error(`${ref}: op left the ref unresolved; nothing written`);
    if (value === MASKED) throw new Error(`${ref}: op returned a masked value (--no-masking ignored); nothing written`);
    if (value.includes("\0")) throw new Error(`${ref}: value contains a NUL byte; nothing written`);
    resolved.set(ref, value);
  });
  return resolved;
}

// $'...' (bash/zsh ANSI-C quoting) keeps every value on its own line, so a
// multi-line secret can never pose as another assignment to a line reader.
const ESCAPES: Record<string, string> = { "\\": "\\\\", "'": "\\'", "\n": "\\n", "\r": "\\r", "\t": "\\t" };
function shellQuote(value: string): string {
  const body = value.replace(
    /[\\'\x00-\x1f\x7f]/g,
    (c) => ESCAPES[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
  return `$'${body}'`;
}

export function secretsEnvText(header: string[], resolved: Map<string, string>): string {
  const lines = [...resolved].map(([ref, value]) => `${secretKey(ref)}=${shellQuote(value)}`).sort();
  return `${[...header, ...lines].join("\n")}\n`;
}

// The keys a secrets.env defines, read without touching its values.
export function secretsEnvKeys(text: string): Set<string> {
  return new Set([...text.matchAll(/^(REPOGOLEM_SECRET_[0-9a-f]{32})=\$'/gm)].map((m) => m[1]));
}

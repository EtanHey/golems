/**
 * Axiom credential resolution — the one place that decides which token and
 * dataset golems sends to. Used by getAxiom() and the doctor's Axiom row.
 *
 * Token:   AXIOM_TOKEN env → env file → config.observability.axiomToken
 * Dataset: AXIOM_DATASET env → env file → config.observability.axiomDataset → "golems"
 * Env file: $GOLEMS_AXIOM_ENV, else ~/.config/golems/axiom.env
 *
 * observability.enabled false wins over every source: the file is not even read.
 * A missing or unreadable file, or a malformed (unterminated / mismatched quote)
 * value, resolves to no token from the file — never a throw, never a log.
 *
 * AIDEV-NOTE: never log the token or the env file's contents from here; the
 * doctor reports tokenSource, not the value.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AxiomObservabilityConfig {
  enabled?: boolean;
  axiomToken?: string;
  axiomDataset?: string;
}

export interface AxiomCredentials {
  enabled: boolean;
  token: string | null;
  tokenSource: "env" | "env-file" | "config" | null;
  dataset: string;
  envFilePath: string;
}

type Env = Record<string, string | undefined>;

export function defaultAxiomEnvPath(env: Env = process.env): string {
  if (env.GOLEMS_AXIOM_ENV) return env.GOLEMS_AXIOM_ENV;
  return join(env.HOME || homedir(), ".config", "golems", "axiom.env");
}

/**
 * A value is bare (no quote characters at all) or wrapped in one matching pair
 * of quotes with none inside. Anything else — an unterminated or mismatched
 * quote — is malformed and yields null, so the key counts as absent.
 */
function unquote(raw: string): string | null {
  const wrapped = raw.match(/^(['"])(.*)\1$/);
  if (wrapped) return /['"]/.test(wrapped[2]) ? null : wrapped[2];
  return /['"]/.test(raw) ? null : raw;
}

function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const m = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const value = unquote(m[2].trim());
    if (value) out[m[1]] = value;
  }
  return out;
}

function readEnvFile(path: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function resolveAxiomCredentials(
  observability: AxiomObservabilityConfig,
  env: Env = process.env,
): AxiomCredentials {
  const envFilePath = defaultAxiomEnvPath(env);
  if (!observability.enabled) {
    return { enabled: false, token: null, tokenSource: null, dataset: "golems", envFilePath };
  }

  const file = env.AXIOM_TOKEN && env.AXIOM_DATASET ? {} : readEnvFile(envFilePath);

  let token: string | null = null;
  let tokenSource: AxiomCredentials["tokenSource"] = null;
  if (env.AXIOM_TOKEN) {
    token = env.AXIOM_TOKEN;
    tokenSource = "env";
  } else if (file.AXIOM_TOKEN) {
    token = file.AXIOM_TOKEN;
    tokenSource = "env-file";
  } else if (observability.axiomToken) {
    token = observability.axiomToken;
    tokenSource = "config";
  }

  const dataset =
    env.AXIOM_DATASET || file.AXIOM_DATASET || observability.axiomDataset || "golems";

  return { enabled: true, token, tokenSource, dataset, envFilePath };
}

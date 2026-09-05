/**
 * External CLI helpers layer - unified interface for Gemini, Cursor, Codex, Kiro, Haiku
 * with rate limit tracking and automatic fallback.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { runHaiku as runCloudLLM } from "./cloud-llm";
import { runGLM as runLocalGLM } from "./glm-llm";
import { logCost } from "./cost-tracker";

/** Available external CLI helper backends */
export type HelperBackend =
  | "gemini"
  | "cursor"
  | "codex"
  | "kiro"
  | "glm"
  | "haiku";

/** Result from running an external helper */
export interface HelperResult {
  output: string;
  backend: HelperBackend;
  durationMs: number;
}

/** Options for running a helper backend */
export interface HelperOptions {
  backend?: HelperBackend;
  file?: string;
  timeout?: number;
  /** Source identifier for cost tracking (e.g. "job-golem", "email-golem") */
  source?: string;
}

interface RateLimitEntry {
  limited: boolean;
  limited_at: string | null;
  resets_at: string | null;
}

type RateLimitsFile = Record<HelperBackend, RateLimitEntry>;

const ALL_BACKENDS: HelperBackend[] = [
  "gemini",
  "kiro",
  "codex",
  "cursor",
  "glm",
  "haiku",
];

/** Default fallback order when a backend is rate-limited */
export const FALLBACK_CHAIN: HelperBackend[] = [
  "gemini",
  "kiro",
  "codex",
  "cursor",
  "glm",
  "haiku",
];

function getStateDir(): string {
  return (
    process.env.GOLEMS_STATE_DIR ||
    join(process.env.HOME || "~", ".golems-zikaron")
  );
}

function getRateLimitsPath(): string {
  return join(getStateDir(), "rate-limits.json");
}

function readRateLimits(): RateLimitsFile {
  const path = getRateLimitsPath();
  const defaults: RateLimitsFile = {
    gemini: { limited: false, limited_at: null, resets_at: null },
    kiro: { limited: false, limited_at: null, resets_at: null },
    codex: { limited: false, limited_at: null, resets_at: null },
    cursor: { limited: false, limited_at: null, resets_at: null },
    glm: { limited: false, limited_at: null, resets_at: null },
    haiku: { limited: false, limited_at: null, resets_at: null },
  };
  try {
    const data = readFileSync(path, "utf-8");
    return { ...defaults, ...JSON.parse(data) };
  } catch {
    return defaults;
  }
}

function writeRateLimits(limits: RateLimitsFile): void {
  const dir = getStateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getRateLimitsPath(), JSON.stringify(limits, null, 2));
}

/**
 * Compute resets_at timestamp for a given backend.
 */
function computeResetsAt(
  backend: HelperBackend,
  now: Date = new Date(),
): string {
  switch (backend) {
    case "gemini": {
      // Resets at midnight UTC
      const reset = new Date(now);
      reset.setUTCDate(reset.getUTCDate() + 1);
      reset.setUTCHours(0, 0, 0, 0);
      return reset.toISOString();
    }
    case "kiro": {
      // Resets at end of current month (UTC)
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      // Day 0 of next month = last day of current month
      return new Date(
        Date.UTC(year, month + 1, 0, 23, 59, 59, 999),
      ).toISOString();
    }
    case "codex": {
      // 1 minute RPM
      return new Date(now.getTime() + 60_000).toISOString();
    }
    case "cursor": {
      // Monthly (30 days)
      return new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString();
    }
    case "glm": {
      // Local model — no real rate limit, but in case of Ollama overload: 1 minute
      return new Date(now.getTime() + 60_000).toISOString();
    }
    case "haiku": {
      // 1 minute RPM
      return new Date(now.getTime() + 60_000).toISOString();
    }
  }
}

/**
 * Mark a backend as rate-limited. Call when you get a 429.
 */
export function helperLimitReached(
  backend: HelperBackend,
  now: Date = new Date(),
): void {
  const limits = readRateLimits();
  limits[backend] = {
    limited: true,
    limited_at: now.toISOString(),
    resets_at: computeResetsAt(backend, now),
  };
  writeRateLimits(limits);
}

/**
 * Check if a backend is available (not rate-limited, or limit has expired).
 * Auto-clears expired limits.
 */
export function isHelperAvailable(
  backend: HelperBackend,
  now: Date = new Date(),
): boolean {
  const limits = readRateLimits();
  const entry = limits[backend];

  if (!entry.limited) return true;

  // Auto-clear if resets_at has passed
  if (entry.resets_at && new Date(entry.resets_at) <= now) {
    limits[backend] = { limited: false, limited_at: null, resets_at: null };
    writeRateLimits(limits);
    return true;
  }

  return false;
}

/**
 * Get status of all backends.
 */
export function getHelperStatus(
  now: Date = new Date(),
): Record<HelperBackend, { available: boolean; resets_at: string | null }> {
  const limits = readRateLimits();
  const result: Record<
    string,
    { available: boolean; resets_at: string | null }
  > = {};

  for (const backend of ALL_BACKENDS) {
    const entry = limits[backend];
    if (!entry.limited) {
      result[backend] = { available: true, resets_at: null };
    } else if (entry.resets_at && new Date(entry.resets_at) <= now) {
      // Auto-clear
      limits[backend] = { limited: false, limited_at: null, resets_at: null };
      result[backend] = { available: true, resets_at: null };
    } else {
      result[backend] = { available: false, resets_at: entry.resets_at };
    }
  }

  writeRateLimits(limits);
  return result as Record<
    HelperBackend,
    { available: boolean; resets_at: string | null }
  >;
}

/** Whether a backend takes the prompt as a CLI argument (vs stdin) */
const PROMPT_VIA_ARG: Set<HelperBackend> = new Set(["cursor", "codex"]);

/**
 * Build the CLI command for a given backend.
 * Backends in PROMPT_VIA_ARG get the prompt appended as the last arg.
 * Others receive the prompt via stdin.
 */
function buildCommand(
  backend: HelperBackend,
  prompt: string,
  opts: HelperOptions,
): string[] {
  switch (backend) {
    case "gemini":
      // Reads prompt from stdin
      return ["gemini"];
    case "cursor":
      // -p = non-interactive mode, prompt as last arg
      return [
        "cursor",
        "agent",
        "-p",
        "--model",
        "gpt-5.2-codex-high",
        "--output-format",
        "text",
        prompt,
      ];
    case "codex":
      // npx codex exec --full-auto, prompt as last arg
      return ["npx", "codex", "exec", "--full-auto", prompt];
    case "kiro":
      // Reads prompt from stdin
      return ["kiro-cli", "chat", "--no-interactive", "-w", "never"];
    case "glm":
      // Handled separately via glm-llm (local Ollama)
      return [];
    case "haiku":
      // Handled separately via cloud-llm
      return [];
  }
}

/**
 * Run a CLI helper command via subprocess.
 * Gemini and Kiro receive prompt via stdin; Cursor and Codex via CLI arg.
 */
async function runCliHelper(
  backend: HelperBackend,
  prompt: string,
  opts: HelperOptions,
): Promise<string> {
  const args = buildCommand(backend, prompt, opts);
  const timeout = opts.timeout || 120_000;
  const usesStdin = !PROMPT_VIA_ARG.has(backend);

  const proc = Bun.spawn(args, {
    stdin: usesStdin ? "pipe" : undefined,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  if (usesStdin) {
    proc.stdin.write(prompt);
    proc.stdin.end();
  }

  const timer = setTimeout(() => proc.kill(), timeout);

  try {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      if (
        stderr.includes("429") ||
        stderr.includes("rate limit") ||
        stderr.toLowerCase().includes("quota")
      ) {
        throw new Error("RATE_LIMITED");
      }
      throw new Error(
        `${backend} failed (exit ${exitCode}): ${stderr.slice(0, 500)}`,
      );
    }

    return stdout.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a helper, with automatic fallback on rate limit.
 */
export async function runHelper(
  prompt: string,
  opts: HelperOptions = {},
): Promise<HelperResult> {
  const now = new Date();

  // If specific backend requested, try it first then fall back
  const chain = opts.backend
    ? [opts.backend, ...FALLBACK_CHAIN.filter((b) => b !== opts.backend)]
    : [...FALLBACK_CHAIN];

  const errors: Array<{ backend: string; error: string }> = [];

  for (const backend of chain) {
    if (!isHelperAvailable(backend, now)) continue;

    const start = Date.now();
    try {
      let output: string | null;
      if (backend === "haiku") {
        output = await runCloudLLM(prompt, opts.source || "helpers");
      } else if (backend === "glm") {
        output = await runLocalGLM(prompt, opts.source || "helpers");
      } else {
        output = await runCliHelper(backend, prompt, opts);
      }

      if (output === null) {
        throw new Error(`${backend} failed`);
      }

      const durationMs = Date.now() - start;

      // Log free CLI helper calls only — haiku/glm are already logged by their own modules
      if (backend !== "haiku" && backend !== "glm") {
        try {
          const costLogPath = join(getStateDir(), "api_costs.jsonl");
          logCost(costLogPath, {
            timestamp: new Date().toISOString(),
            model: backend,
            source: opts.source || "helpers",
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0,
            tier: "free",
            duration_ms: durationMs,
          });
        } catch {
          // Don't let logging failures break the main flow
        }
      }

      return {
        output,
        backend,
        durationMs,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg === "RATE_LIMITED") {
        helperLimitReached(backend, new Date());
        errors.push({ backend, error: "Rate limited" });
        continue;
      }
      // Non-rate-limit error, collect and try next backend
      errors.push({ backend, error: errMsg });
      continue;
    }
  }

  throw new Error(
    `All backends failed: ${errors.map((e) => `${e.backend}: ${e.error}`).join(", ")}`,
  );
}

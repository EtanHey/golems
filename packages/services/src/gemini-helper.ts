/**
 * Gemini CLI Helper
 *
 * Wrapper for Gemini CLI with rate limiting, retry logic, and JSON parsing.
 * Use for complex reasoning tasks that benefit from Gemini 3's capabilities.
 *
 * Rate limits (free tier):
 * - 60 requests per minute (RPM)
 * - 1000 requests per day (RPD)
 *
 * See: docs.local/research/gemini-cli-migration.md
 */

import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const execAsync = promisify(exec);

// Rate limit state file
const STATE_DIR = join(process.env.HOME || "~", ".golems-zikaron");
const RATE_LIMIT_FILE = join(STATE_DIR, "gemini-rate-limits.json");

// Limits
const RPM_LIMIT = 60;
const RPD_LIMIT = 1000;

interface RateLimitState {
  minuteRequests: number[];
  dayRequests: number;
  dayStart: string; // ISO date string (YYYY-MM-DD)
}

interface GeminiResponse {
  response: string;
  stats?: {
    models: Record<string, { promptTokens: number; responseTokens: number; totalTokens: number }>;
    toolCalls?: number;
  };
  error?: string;
}

interface GeminiOptions {
  timeout?: number; // ms, default 30000
  model?: string; // default gemini-2.5-pro
  maxRetries?: number; // default 3
  source?: string; // for logging
}

/**
 * Load rate limit state from disk
 */
function loadRateLimitState(): RateLimitState {
  const today = new Date().toISOString().split("T")[0];

  if (!existsSync(RATE_LIMIT_FILE)) {
    return { minuteRequests: [], dayRequests: 0, dayStart: today };
  }

  try {
    const state = JSON.parse(readFileSync(RATE_LIMIT_FILE, "utf-8")) as RateLimitState;

    // Reset if new day
    if (state.dayStart !== today) {
      return { minuteRequests: [], dayRequests: 0, dayStart: today };
    }

    return state;
  } catch {
    return { minuteRequests: [], dayRequests: 0, dayStart: today };
  }
}

/**
 * Save rate limit state to disk
 */
function saveRateLimitState(state: RateLimitState): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  writeFileSync(RATE_LIMIT_FILE, JSON.stringify(state, null, 2));
}

/**
 * Clean up old minute requests (older than 60s)
 */
function cleanupMinuteRequests(requests: number[]): number[] {
  const cutoff = Date.now() - 60000;
  return requests.filter((ts) => ts > cutoff);
}

/**
 * Check if we can make a request (rate limit check)
 */
function canMakeRequest(): { allowed: boolean; waitMs: number; reason?: string } {
  const state = loadRateLimitState();
  const now = Date.now();

  // Clean up old minute requests
  const recentRequests = cleanupMinuteRequests(state.minuteRequests);

  // Check daily limit
  if (state.dayRequests >= RPD_LIMIT) {
    return {
      allowed: false,
      waitMs: 0,
      reason: `Daily limit reached (${RPD_LIMIT} RPD). Resets at midnight.`,
    };
  }

  // Check minute limit
  if (recentRequests.length >= RPM_LIMIT) {
    const oldestRequest = Math.min(...recentRequests);
    const waitMs = oldestRequest + 60000 - now;
    return {
      allowed: false,
      waitMs: Math.max(0, waitMs),
      reason: `Minute limit reached (${RPM_LIMIT} RPM). Wait ${Math.ceil(waitMs / 1000)}s.`,
    };
  }

  return { allowed: true, waitMs: 0 };
}

/**
 * Record a request for rate limiting
 */
function recordRequest(): void {
  const state = loadRateLimitState();
  const now = Date.now();

  state.minuteRequests = cleanupMinuteRequests(state.minuteRequests);
  state.minuteRequests.push(now);
  state.dayRequests++;

  saveRateLimitState(state);
}

/**
 * Get current rate limit status
 */
export function getRateLimitStatus(): {
  minuteRemaining: number;
  dayRemaining: number;
  dayUsed: number;
  canRequest: boolean;
  waitMs: number;
} {
  const state = loadRateLimitState();
  const recentRequests = cleanupMinuteRequests(state.minuteRequests);
  const check = canMakeRequest();

  return {
    minuteRemaining: Math.max(0, RPM_LIMIT - recentRequests.length),
    dayRemaining: Math.max(0, RPD_LIMIT - state.dayRequests),
    dayUsed: state.dayRequests,
    canRequest: check.allowed,
    waitMs: check.waitMs,
  };
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Escape prompt for shell
 */
function escapeForShell(str: string): string {
  // Use single quotes and escape any single quotes in the string
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Validate and sanitize model name to prevent command injection
 * Only allow alphanumeric, hyphens, underscores, and dots
 */
function sanitizeModel(model: string): string {
  const sanitized = model.replace(/[^a-zA-Z0-9._-]/g, "");
  if (sanitized !== model) {
    console.warn(`[Gemini] Model name sanitized: "${model}" -> "${sanitized}"`);
  }
  return sanitized;
}

/**
 * Run Gemini CLI with rate limiting and retry
 */
export async function runGemini(
  prompt: string,
  options: GeminiOptions = {}
): Promise<string> {
  const { timeout = 30000, model = "gemini-2.5-pro", maxRetries = 3, source = "unknown" } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check rate limits
    const check = canMakeRequest();
    if (!check.allowed) {
      if (check.waitMs > 0 && check.waitMs < 120000) {
        console.log(`[Gemini] Rate limited, waiting ${Math.ceil(check.waitMs / 1000)}s...`);
        await sleep(check.waitMs);
      } else {
        throw new Error(`[Gemini] ${check.reason}`);
      }
    }

    try {
      // Record the request before making it
      recordRequest();

      // Build command with timeout
      // SECURITY: Sanitize model to prevent command injection
      const escapedPrompt = escapeForShell(prompt);
      const safeModel = sanitizeModel(model);
      const cmd = `timeout ${Math.ceil(timeout / 1000)} gemini -m ${safeModel} --output-format json ${escapedPrompt}`;

      console.log(`[Gemini] Request (${source}): ${prompt.slice(0, 50)}...`);

      const { stdout, stderr } = await execAsync(cmd, {
        timeout: timeout + 5000, // Add buffer for timeout command
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      if (stderr && stderr.includes("429")) {
        throw new Error("Rate limit exceeded (429)");
      }

      // Parse JSON response
      const response = JSON.parse(stdout) as GeminiResponse;

      if (response.error) {
        throw new Error(response.error);
      }

      console.log(`[Gemini] Response received (${response.stats?.models?.[model]?.totalTokens || "?"} tokens)`);
      return response.response;
    } catch (error: any) {
      lastError = error;

      // Check for specific error types
      const errorMsg = error.message || String(error);

      if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("rate")) {
        // Rate limit - exponential backoff
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.log(`[Gemini] Rate limited (attempt ${attempt + 1}/${maxRetries}), backing off ${backoffMs}ms...`);
        await sleep(backoffMs);
        continue;
      }

      if (error.killed || errorMsg.includes("timeout") || errorMsg.includes("SIGTERM")) {
        console.log(`[Gemini] Timeout (attempt ${attempt + 1}/${maxRetries})`);
        continue;
      }

      // Unknown error - don't retry
      console.error(`[Gemini] Error: ${errorMsg}`);
      throw error;
    }
  }

  throw lastError || new Error("[Gemini] Max retries exceeded");
}

/**
 * Run Gemini and parse JSON response
 *
 * Expects the model to return JSON in its response.
 * Extracts the first JSON object found.
 */
export async function runGeminiJSON<T>(
  prompt: string,
  options: GeminiOptions = {}
): Promise<T | null> {
  const result = await runGemini(prompt, options);

  if (!result) return null;

  try {
    // Try to find JSON in the response
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }

    // Maybe it's a JSON array
    const arrayMatch = result.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]) as T;
    }
  } catch (e) {
    console.error("[Gemini] JSON parse error:", e);
  }

  return null;
}

/**
 * Quick helpers for common sources (matching ollama-wrapper pattern)
 */
export const forComplexAnalysis = {
  runGemini: (prompt: string) => runGemini(prompt, { source: "complex-analysis" }),
  runGeminiJSON: <T>(prompt: string) => runGeminiJSON<T>(prompt, { source: "complex-analysis" }),
};

export const forPatternExtraction = {
  runGemini: (prompt: string) => runGemini(prompt, { source: "pattern-extraction" }),
  runGeminiJSON: <T>(prompt: string) => runGeminiJSON<T>(prompt, { source: "pattern-extraction" }),
};


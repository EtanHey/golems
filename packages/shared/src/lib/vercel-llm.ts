/**
 * Vercel AI SDK Cloud LLM — Free Gemini/Groq Backend
 *
 * Replaces paid Haiku in hosted workers with free APIs.
 * Uses Vercel AI SDK for unified provider interface.
 *
 * Fallback chain: Gemini ↔ Groq (auto-switch on 429)
 *
 * ENV:
 *   LLM_BACKEND=gemini (or groq)
 *   GOOGLE_GENERATIVE_AI_API_KEY (for Gemini)
 *   GROQ_API_KEY (for Groq)
 */

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { join } from "path";
import { homedir } from "os";
import { logCost } from "./cost-tracker";
import { logLLMCall, logError } from "./axiom";

// Models
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Cost log
const COST_LOG_DIR =
  process.env.GOLEMS_STATE_DIR || join(homedir(), ".golems-zikaron");
const COST_LOG_PATH = join(COST_LOG_DIR, "api_costs.jsonl");

// Provider instances (lazy init)
let geminiProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null;
let groqProvider: ReturnType<typeof createGroq> | null = null;

function getGeminiProvider() {
  if (!geminiProvider) {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey)
      throw new Error(
        "GOOGLE_GENERATIVE_AI_API_KEY required for LLM_BACKEND=gemini",
      );
    geminiProvider = createGoogleGenerativeAI({ apiKey });
  }
  return geminiProvider;
}

function getGroqProvider() {
  if (!groqProvider) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY required for LLM_BACKEND=groq");
    groqProvider = createGroq({ apiKey });
  }
  return groqProvider;
}

/** @internal Reset providers for testing */
export function _resetProviders(): void {
  geminiProvider = null;
  groqProvider = null;
}

// Usage tracking (in-memory)
let totalCalls = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;

// Error rate tracking — alert on consecutive failures
let consecutiveErrors = 0;
let alertSentForBatch = false;
const ERROR_ALERT_THRESHOLD = 5; // Alert after 5 consecutive failures

function trackUsage(
  model: string,
  source: string,
  inputTokens: number,
  outputTokens: number,
  durationMs = 0,
) {
  totalInputTokens += inputTokens;
  totalOutputTokens += outputTokens;
  totalCalls++;

  const backend = model.includes("gemini") ? "gemini" : "groq";

  try {
    logCost(COST_LOG_PATH, {
      timestamp: new Date().toISOString(),
      model,
      source,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: 0,
      tier: "free",
    });
  } catch {
    // Don't let logging failures break the main flow
  }

  // Send to Axiom (fire-and-forget)
  logLLMCall({
    model,
    source,
    backend,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: 0,
    duration_ms: durationMs,
    tier: "free",
    success: true,
  });

  if (totalCalls % 10 === 0) {
    console.log(
      `[Cloud LLM] ${totalCalls} calls | ${totalInputTokens} in + ${totalOutputTokens} out tokens (free tier)`,
    );
  }
}

/**
 * Run a prompt through a free cloud LLM (Gemini or Groq).
 * Same interface as runHaiku — drop-in replacement.
 */
export async function runCloudFree(
  prompt: string,
  source = "unknown",
): Promise<string | null> {
  const backendEnv = process.env.LLM_BACKEND || "gemini";
  const providers =
    backendEnv === "groq"
      ? [{ name: "groq", get: getGroqProvider, model: GROQ_MODEL }]
      : [{ name: "gemini", get: getGeminiProvider, model: GEMINI_MODEL }];

  // Add fallback: if primary is gemini, fallback to groq and vice versa
  if (backendEnv === "gemini" && process.env.GROQ_API_KEY) {
    providers.push({ name: "groq", get: getGroqProvider, model: GROQ_MODEL });
  } else if (
    backendEnv === "groq" &&
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  ) {
    providers.push({
      name: "gemini",
      get: getGeminiProvider,
      model: GEMINI_MODEL,
    });
  }

  for (const p of providers) {
    const startMs = Date.now();
    try {
      const provider = p.get();
      const result = await generateText({
        model: provider(p.model),
        prompt,
        maxTokens: 1024,
      });

      const inputTokens = result.usage?.inputTokens ?? 0;
      const outputTokens = result.usage?.outputTokens ?? 0;
      const durationMs = Date.now() - startMs;
      trackUsage(p.model, source, inputTokens, outputTokens, durationMs);

      // Reset error tracking on success
      consecutiveErrors = 0;
      alertSentForBatch = false;

      return result.text.trim();
    } catch (err: unknown) {
      const errObj = err as Record<string, unknown>;
      const errMsg = err instanceof Error ? err.message : String(err);
      const isRateLimit =
        errObj?.statusCode === 429 ||
        errMsg?.includes("429") ||
        errMsg?.includes("rate limit");
      const isLastProvider = providers.indexOf(p) >= providers.length - 1;
      if (isRateLimit && !isLastProvider) {
        console.warn(`[Cloud LLM] ${p.name} rate limited, trying fallback...`);
        continue;
      }
      // Only count terminal failures (no more fallbacks remaining)
      if (isLastProvider) consecutiveErrors++;
      console.error(
        `[Cloud LLM] Error from ${p.name} (source: ${source}):`,
        errMsg || err,
      );
      logError({
        service: source,
        error_message: errMsg || String(err),
        error_type: `${p.name}_api_error`,
      });

      // Alert on consecutive failures (once per batch)
      if (consecutiveErrors >= ERROR_ALERT_THRESHOLD && !alertSentForBatch) {
        alertSentForBatch = true;
        import("./telegram-direct")
          .then(({ sendNotification }) => {
            sendNotification({
              title: "LLM Quota Alert",
              body: `${consecutiveErrors} consecutive LLM failures (${p.name}). Jobs/emails may be degraded. Error: ${errMsg?.slice(0, 100) ?? "unknown"}`,
              source: "healthcheck",
              priority: "high",
            }).catch((notifyErr: unknown) => {
              console.warn(
                "[Cloud LLM] Alert notification failed:",
                notifyErr instanceof Error ? notifyErr.message : notifyErr,
              );
            });
          })
          .catch((importErr: unknown) => {
            console.warn(
              "[Cloud LLM] Failed to import telegram-direct:",
              importErr instanceof Error ? importErr.message : importErr,
            );
          });
      }

      if (!isLastProvider) continue;
      return null;
    }
  }

  return null;
}

/**
 * Run a prompt through a free cloud LLM and parse JSON from response.
 * Same interface as runHaikuJSON — drop-in replacement.
 */
export async function runCloudFreeJSON<T>(
  prompt: string,
  source = "unknown",
): Promise<T | null> {
  const result = await runCloudFree(prompt, source);
  if (!result) return null;

  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
  } catch (e) {
    console.error(`[Cloud LLM] JSON parse error (source: ${source}):`, e);
  }

  return null;
}

/** Get usage stats */
export function getCloudFreeUsageStats(): {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
} {
  return { totalCalls, totalInputTokens, totalOutputTokens };
}

/**
 * Cloud LLM - Anthropic Haiku Backend
 *
 * Replaces Ollama for hosted deployments.
 * Uses Claude Haiku 4.5 via Anthropic SDK for scoring/classification tasks.
 *
 * Includes token usage tracking for cost monitoring.
 *
 * ENV: ANTHROPIC_API_KEY (required when LLM_BACKEND=haiku)
 */

import Anthropic from "@anthropic-ai/sdk";
import { join } from "path";
import { homedir } from "os";
import { logCost, type CostEntry } from "./cost-tracker";
import { logLLMCall, logError } from "./axiom";
import { classifyLLMError, withRetry, LLMErrorType } from "./llm-errors";

const MODEL = "claude-haiku-4-5-20251001";

// Persistent JSONL cost log — survives restarts, matches SongScript format
const COST_LOG_DIR =
  process.env.GOLEMS_STATE_DIR || join(homedir(), ".golems-zikaron");
const COST_LOG_PATH = join(COST_LOG_DIR, "api_costs.jsonl");

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is required when LLM_BACKEND=haiku. " +
          "Set it in your environment or .env file.",
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** @internal Reset/inject client for testing */
export function _resetClient(mockClient?: Anthropic | null): void {
  client = mockClient ?? null;
}

// ═══════════════════════════════════════════════════════
// Usage Tracking
// ═══════════════════════════════════════════════════════

interface UsageEntry {
  timestamp: string;
  source: string;
  inputTokens: number;
  outputTokens: number;
}

/** Rolling usage stats since process start */
const usageLog: UsageEntry[] = [];
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalCalls = 0;

function trackUsage(source: string, inputTokens: number, outputTokens: number) {
  totalInputTokens += inputTokens;
  totalOutputTokens += outputTokens;
  totalCalls++;

  const timestamp = new Date().toISOString();
  const costUsd = (inputTokens * 0.8 + outputTokens * 4.0) / 1_000_000;

  usageLog.push({ timestamp, source, inputTokens, outputTokens });

  // Keep only last 1000 entries to bound memory
  if (usageLog.length > 1000) {
    usageLog.splice(0, usageLog.length - 1000);
  }

  const roundedCost = Math.round(costUsd * 1_000_000) / 1_000_000;

  // Persist to JSONL via unified cost tracker
  try {
    logCost(COST_LOG_PATH, {
      timestamp,
      model: MODEL,
      source,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: roundedCost,
      tier: "paid",
    });
  } catch {
    // Don't let logging failures break the main flow
  }

  // Send to Axiom (fire-and-forget)
  logLLMCall({
    model: MODEL,
    source,
    backend: "haiku",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: roundedCost,
    duration_ms: 0, // Not tracked at this level
    tier: "paid",
    success: true,
  });

  // Log every 10 calls for visibility
  if (totalCalls % 10 === 0) {
    console.log(
      `[Haiku Usage] ${totalCalls} calls | ${totalInputTokens} input + ${totalOutputTokens} output tokens | ~$${estimateCost().toFixed(4)}`,
    );
  }
}

/**
 * Estimate cost based on Haiku 4.5 pricing.
 * Input: $0.80/MTok, Output: $4.00/MTok (as of 2025)
 */
function estimateCost(): number {
  return (totalInputTokens * 0.8 + totalOutputTokens * 4.0) / 1_000_000;
}

/** Get current usage statistics */
export function getUsageStats(): {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUSD: number;
  recentCalls: typeof usageLog;
} {
  return {
    totalCalls,
    totalInputTokens,
    totalOutputTokens,
    estimatedCostUSD: estimateCost(),
    recentCalls: usageLog.slice(-20),
  };
}

/** Get usage breakdown by source */
export function getUsageBySource(): Record<
  string,
  { calls: number; inputTokens: number; outputTokens: number }
> {
  const bySource: Record<
    string,
    { calls: number; inputTokens: number; outputTokens: number }
  > = {};

  for (const entry of usageLog) {
    if (!bySource[entry.source]) {
      bySource[entry.source] = { calls: 0, inputTokens: 0, outputTokens: 0 };
    }
    bySource[entry.source].calls++;
    bySource[entry.source].inputTokens += entry.inputTokens;
    bySource[entry.source].outputTokens += entry.outputTokens;
  }

  return bySource;
}

// ═══════════════════════════════════════════════════════
// LLM Functions
// ═══════════════════════════════════════════════════════

/**
 * Run a prompt through Haiku and return the text response.
 * Drop-in replacement for runOllama().
 * Retries transient errors (rate limits, overloaded) with exponential backoff.
 */
export async function runHaiku(
  prompt: string,
  source = "unknown",
): Promise<string | null> {
  try {
    const response = await withRetry(
      () =>
        getClient().messages.create({
          model: MODEL,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      { maxRetries: 2, baseDelayMs: 1000 },
    );

    // Track usage from response
    if (response.usage) {
      trackUsage(
        source,
        response.usage.input_tokens,
        response.usage.output_tokens,
      );
    }

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text?.trim() ?? "";
  } catch (err) {
    const errorType = classifyLLMError(err);
    console.error(
      `[Haiku] ${errorType} error (source: ${source}):`,
      (err as Error).message,
    );
    logError({
      service: source,
      error_message: (err as Error).message,
      error_type: `haiku_${errorType}`,
    });
    return null;
  }
}

/**
 * Run a prompt through Haiku and parse JSON from response.
 * Drop-in replacement for runOllamaJSON().
 */
export async function runHaikuJSON<T>(
  prompt: string,
  source = "unknown",
): Promise<T | null> {
  const result = await runHaiku(prompt, source);

  if (!result) return null;

  try {
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
  } catch (e) {
    console.error(`[Haiku] JSON parse error (source: ${source}):`, e);
  }

  return null;
}

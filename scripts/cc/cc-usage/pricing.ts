/**
 * April 2026 pricing ground truth — hardcoded per-provider rates.
 *
 * Why hardcoded (not LiteLLM):
 * - LiteLLM can't represent Anthropic's dual-tier cache (5m vs 1h write premiums)
 * - LiteLLM can't represent Gemini Flex tier (50% sync discount)
 * - Prices shift quarterly; a frozen snapshot is more auditable than a live fetch
 *
 * Override via env: PRICING_OVERRIDE_JSON (path to JSON file with same schema)
 */

import type { ModelPricing, Provider } from "./types";

export const PRICING_UPDATED = "2026-04";

export const PRICING_REGISTRY: Record<string, ModelPricing> = {
  // ── Anthropic (docs.anthropic.com/en/docs/about-claude/pricing) ────
  "claude-opus-4-6": {
    provider: "anthropic",
    input: 5.0,
    output: 25.0,
    cacheRead: 0.5, // 0.1× input
    cacheWrite5m: 6.25, // 1.25× input
    cacheWrite1h: 10.0, // 2.0× input
    batchDiscount: 0.5,
  },
  "claude-sonnet-4-6": {
    provider: "anthropic",
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    batchDiscount: 0.5,
  },
  "claude-haiku-4-5": {
    provider: "anthropic",
    input: 1.0,
    output: 5.0,
    cacheRead: 0.1,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
    batchDiscount: 0.5,
  },

  // ── OpenAI (openai.com/api/pricing) ────────────────────────────────
  // OpenAI: implicit caching, no write premium. cached_input = 90% off.
  "gpt-5.4": {
    provider: "openai",
    input: 2.5,
    output: 15.0,
    cacheRead: 0.25, // 90% off input
    cacheWrite5m: 2.5, // no write premium
    cacheWrite1h: 2.5,
    batchDiscount: 0.5,
  },
  "gpt-5.4-mini": {
    provider: "openai",
    input: 0.75,
    output: 4.5,
    cacheRead: 0.075,
    cacheWrite5m: 0.75,
    cacheWrite1h: 0.75,
    batchDiscount: 0.5,
  },
  "gpt-5-codex": {
    provider: "openai",
    input: 1.25,
    output: 10.0,
    cacheRead: 0.125,
    cacheWrite5m: 1.25,
    cacheWrite1h: 1.25,
    batchDiscount: 1.0, // no batch API for Codex
  },

  // ── Google Gemini (ai.google.dev/gemini-api/docs/pricing) ──────────
  // Gemini: explicit caching available. Rates below are ≤200K context.
  "gemini-2.5-pro": {
    provider: "google",
    input: 1.25,
    output: 10.0,
    cacheRead: 0.125, // explicit cache read
    cacheWrite5m: 1.25, // no write premium (Gemini charges per-hour storage instead)
    cacheWrite1h: 1.25,
    batchDiscount: 0.5,
  },
  "gemini-2.5-flash": {
    provider: "google",
    input: 0.3,
    output: 2.5,
    cacheRead: 0.03,
    cacheWrite5m: 0.3,
    cacheWrite1h: 0.3,
    batchDiscount: 0.5,
  },
  "gemini-2.5-flash-lite": {
    provider: "google",
    input: 0.1,
    output: 0.4,
    cacheRead: 0.01,
    cacheWrite5m: 0.1,
    cacheWrite1h: 0.1,
    batchDiscount: 0.5,
  },
};

// ── Aliases for versioned model IDs ──────────────────────────────────

const MODEL_ALIASES: Record<string, string> = {
  // Anthropic versioned IDs
  "claude-opus-4-5-20250620": "claude-opus-4-6",
  "claude-sonnet-4-5-20250514": "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4-6",
  "claude-sonnet-4-6-20260301": "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};

/**
 * Resolve a model ID to its pricing entry.
 *
 * Priority:
 * 1. Exact match in PRICING_REGISTRY
 * 2. Exact match in MODEL_ALIASES → registry lookup
 * 3. Fuzzy: strip version suffixes, brackets, check for provider keywords
 * 4. Fallback: Sonnet 4.6 (most common model)
 */
export function getModelPricing(modelId: string): ModelPricing {
  // 1. Exact match
  if (PRICING_REGISTRY[modelId]) return PRICING_REGISTRY[modelId];

  // 2. Alias
  const aliased = MODEL_ALIASES[modelId];
  if (aliased && PRICING_REGISTRY[aliased]) return PRICING_REGISTRY[aliased];

  // 3. Fuzzy matching
  const normalized = modelId.replace(/\[.*?\]/g, "").trim(); // strip [1m] etc.
  if (PRICING_REGISTRY[normalized]) return PRICING_REGISTRY[normalized];

  // Keyword-based fallback
  if (normalized.includes("opus")) return PRICING_REGISTRY["claude-opus-4-6"];
  if (normalized.includes("sonnet"))
    return PRICING_REGISTRY["claude-sonnet-4-6"];
  if (normalized.includes("haiku")) return PRICING_REGISTRY["claude-haiku-4-5"];
  if (normalized.includes("gpt-5.4-mini"))
    return PRICING_REGISTRY["gpt-5.4-mini"];
  if (normalized.includes("gpt-5-codex"))
    return PRICING_REGISTRY["gpt-5-codex"];
  if (normalized.includes("gpt")) return PRICING_REGISTRY["gpt-5.4"];
  if (normalized.includes("gemini") && normalized.includes("pro"))
    return PRICING_REGISTRY["gemini-2.5-pro"];
  if (normalized.includes("gemini") && normalized.includes("flash-lite"))
    return PRICING_REGISTRY["gemini-2.5-flash-lite"];
  if (normalized.includes("gemini") && normalized.includes("flash"))
    return PRICING_REGISTRY["gemini-2.5-flash"];
  if (normalized.includes("gemini"))
    return PRICING_REGISTRY["gemini-2.5-flash"];
  if (normalized.includes("cursor"))
    return PRICING_REGISTRY["claude-sonnet-4-6"]; // Cursor Auto routes to various models

  // 4. Default: Sonnet (most commonly used model)
  return PRICING_REGISTRY["claude-sonnet-4-6"];
}

/**
 * Simple cost calculation — no cache assumptions, just multiply tokens × rates.
 * Used for backward-compatible cost display (matches old cc-usage.ts behavior).
 */
export function calculateRawCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreateTokens: number,
): number {
  const p = getModelPricing(modelId);
  return (
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    (cacheReadTokens / 1_000_000) * p.cacheRead +
    // Cache writes use 5-min TTL rate (1.25x) as default — most CC sessions
    // use ephemeral caching. Override with cacheWrite1h for long-lived contexts.
    (cacheCreateTokens / 1_000_000) * p.cacheWrite5m
  );
}

/**
 * Shared types for multi-provider usage tracking.
 */

export type Provider = "anthropic" | "openai" | "google" | "cursor";

export interface ModelPricing {
  provider: Provider;
  input: number; // $/MTok — fresh (uncached) input
  output: number; // $/MTok — output & reasoning tokens
  cacheRead: number; // $/MTok — cache hit
  cacheWrite5m: number; // $/MTok — 5-min TTL cache write
  cacheWrite1h: number; // $/MTok — 1-hour TTL cache write (Anthropic only)
  batchDiscount: number; // multiplier — 0.5 = 50% off, 1.0 = no discount
}

export interface HypotheticalCostInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number; // explicit cache hits (from transcript)
  cacheCreateTokens?: number; // explicit cache writes (from transcript)
  modelId: string;
  cacheRatio?: number; // default CACHE_HIT_ASSUMPTION (0.85)
  serviceTier?: "standard" | "flex" | "batch";
}

export interface HypotheticalCostResult {
  /** $0 for subscription usage, actual API cost for pay-per-use */
  actualIncurredCost: number;
  /** Cost if all tokens billed as fresh input (0% cache) */
  apiUnoptimizedCost: number;
  /** Cost with cache assumption applied */
  apiOptimizedCost: number;
  currency: "USD";
}

/** Row from usage_monthly_snapshots table */
export interface MonthlySnapshot {
  year_month: string; // 'YYYY-MM'
  provider: Provider;
  model_id: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read: number;
  total_cache_create: number;
  calculated_api_cost: number;
}

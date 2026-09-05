/**
 * Hypothetical optimized-API cost model.
 *
 * Answers: "What WOULD this usage have cost at listed API rates,
 * assuming efficient cache utilization?"
 *
 * Cache assumption baseline: 85% (empirically validated from 283 dev sessions,
 * arXiv 2602.20478v1). Override via CACHE_HIT_ASSUMPTION env var or cacheRatio param.
 *
 * The model splits input tokens into three buckets:
 *   - cacheRead  = ratio × totalInput     (cache hits — discounted)
 *   - cacheWrite = 0.05 × totalInput      (one-time cache population)
 *   - freshInput = (1 - ratio - 0.05) × totalInput  (dynamic, uncached turns)
 */

import { getModelPricing } from "./pricing";
import type { HypotheticalCostInput, HypotheticalCostResult } from "./types";

export const DEFAULT_CACHE_RATIO = 0.85;

const CACHE_WRITE_FRACTION = 0.05; // 5% of input goes to cache writes

/**
 * Get the effective cache ratio from env or default.
 */
function getDefaultCacheRatio(): number {
  const env = process.env.CACHE_HIT_ASSUMPTION;
  if (env) {
    const parsed = parseFloat(env);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return DEFAULT_CACHE_RATIO;
}

/**
 * Calculate hypothetical API costs for a usage payload.
 *
 * When explicit cache tokens are provided (cacheReadTokens, cacheCreateTokens),
 * those are used directly — no assumption needed. The inputTokens field represents
 * only the fresh (non-cached) input in that case.
 *
 * When no explicit cache data exists, the cache ratio assumption is applied to
 * inputTokens to split it into read/write/fresh buckets.
 */
export function calculateHypotheticalCost(
  input: HypotheticalCostInput,
): HypotheticalCostResult {
  const pricing = getModelPricing(input.modelId);
  const cacheRatio = input.cacheRatio ?? getDefaultCacheRatio();
  const tier = input.serviceTier ?? "standard";

  // Tier discount multiplier
  let tierMultiplier = 1.0;
  if (tier === "flex") tierMultiplier = 0.5;
  if (tier === "batch") tierMultiplier = pricing.batchDiscount;

  const hasExplicitCache =
    (input.cacheReadTokens ?? 0) > 0 || (input.cacheCreateTokens ?? 0) > 0;

  let unoptimizedCost: number;
  let optimizedCost: number;

  if (hasExplicitCache) {
    // ── Explicit cache data: use actual numbers ──────────────
    const freshInput = input.inputTokens;
    const cacheRead = input.cacheReadTokens ?? 0;
    const cacheWrite = input.cacheCreateTokens ?? 0;
    const totalRawInput = freshInput + cacheRead + cacheWrite;

    // Unoptimized: treat ALL input tokens as fresh
    unoptimizedCost =
      (totalRawInput / 1_000_000) * pricing.input +
      (input.outputTokens / 1_000_000) * pricing.output;

    // Optimized: use actual cache breakdown
    optimizedCost =
      (freshInput / 1_000_000) * pricing.input +
      (cacheRead / 1_000_000) * pricing.cacheRead +
      (cacheWrite / 1_000_000) * pricing.cacheWrite5m +
      (input.outputTokens / 1_000_000) * pricing.output;
  } else {
    // ── No explicit cache: apply assumption model ────────────
    const totalInput = input.inputTokens;

    // Unoptimized: all tokens at fresh input rate
    unoptimizedCost =
      (totalInput / 1_000_000) * pricing.input +
      (input.outputTokens / 1_000_000) * pricing.output;

    if (cacheRatio <= 0) {
      // No cache optimization requested
      optimizedCost = unoptimizedCost;
    } else {
      // Split input: cacheRatio% read, 5% write, rest fresh
      const freshFraction = Math.max(0, 1 - cacheRatio - CACHE_WRITE_FRACTION);
      const readTokens = totalInput * cacheRatio;
      const writeTokens = totalInput * CACHE_WRITE_FRACTION;
      const freshTokens = totalInput * freshFraction;

      optimizedCost =
        (freshTokens / 1_000_000) * pricing.input +
        (readTokens / 1_000_000) * pricing.cacheRead +
        (writeTokens / 1_000_000) * pricing.cacheWrite5m +
        (input.outputTokens / 1_000_000) * pricing.output;
    }
  }

  // Apply tier discount
  unoptimizedCost *= tierMultiplier;
  optimizedCost *= tierMultiplier;

  return {
    actualIncurredCost: 0, // subscription usage = $0 marginal cost
    apiUnoptimizedCost: unoptimizedCost,
    apiOptimizedCost: optimizedCost,
    currency: "USD",
  };
}

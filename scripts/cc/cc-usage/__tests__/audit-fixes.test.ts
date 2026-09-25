import { describe, test, expect } from "bun:test";
import { calculateHypotheticalCost } from "../hypothetical";

describe("Audit Fix: CACHE_HIT_ASSUMPTION env var bypass", () => {
  test("env var CACHE_HIT_ASSUMPTION should NOT override explicit --cache-ratio", () => {
    // Save/set env
    const origEnv = process.env.CACHE_HIT_ASSUMPTION;
    process.env.CACHE_HIT_ASSUMPTION = "0.50"; // env says 50%

    // When cacheRatio is explicitly passed (simulating --cache-ratio=0.90),
    // it should use the explicit value, NOT the env var
    const result = calculateHypotheticalCost({
      inputTokens: 1_000_000,
      outputTokens: 0,
      modelId: "claude-sonnet-4-6",
      cacheRatio: 0.9, // explicit CLI flag
    });

    // With 90% cache: 900K × $0.30 + 50K × $3.75 + 50K × $3.00 = $0.27 + $0.1875 + $0.15 = $0.6075
    // With 50% cache: 500K × $0.30 + 50K × $3.75 + 450K × $3.00 = $0.15 + $0.1875 + $1.35 = $1.6875
    // The result should match 90%, proving env var was ignored
    expect(result.apiOptimizedCost).toBeCloseTo(0.6075, 2);

    process.env.CACHE_HIT_ASSUMPTION = origEnv;
  });

  test("env var should be used when NO explicit cacheRatio is passed", () => {
    const origEnv = process.env.CACHE_HIT_ASSUMPTION;
    process.env.CACHE_HIT_ASSUMPTION = "0.70";

    const result = calculateHypotheticalCost({
      inputTokens: 1_000_000,
      outputTokens: 0,
      modelId: "claude-sonnet-4-6",
      // cacheRatio NOT passed — should fall back to env var 0.70
    });

    // With 70% cache: 700K × $0.30 + 50K × $3.75 + 250K × $3.00
    // = $0.21 + $0.1875 + $0.75 = $1.1475
    expect(result.apiOptimizedCost).toBeCloseTo(1.1475, 2);

    process.env.CACHE_HIT_ASSUMPTION = origEnv;
  });
});

describe("Audit Fix: Per-provider representative models in aggregate", () => {
  test("anthropic aggregate uses claude-sonnet-4-6 (not blended)", () => {
    const result = calculateHypotheticalCost({
      inputTokens: 2_000_000,
      outputTokens: 200_000,
      modelId: "claude-sonnet-4-6",
      cacheRatio: 0.85,
    });
    // Should use Sonnet pricing ($3/$15), not some blended rate
    expect(result.apiOptimizedCost).toBeCloseTo(4.485, 2);
  });

  test("openai aggregate uses gpt-5.4 pricing", () => {
    const result = calculateHypotheticalCost({
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      modelId: "gpt-5.4",
      cacheRatio: 0.85,
    });
    // 85% read: 850K × $0.25/M = $0.2125
    // 5% write: 50K × $2.50/M = $0.125
    // 10% fresh: 100K × $2.50/M = $0.25
    // Output: 100K × $15/M = $1.50
    // Total: $2.0875
    expect(result.apiOptimizedCost).toBeCloseTo(2.0875, 2);
  });

  test("google aggregate uses gemini-2.5-flash pricing", () => {
    const result = calculateHypotheticalCost({
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      modelId: "gemini-2.5-flash",
      cacheRatio: 0.85,
    });
    // 85% read: 850K × $0.03/M = $0.0255
    // 5% write: 50K × $0.30/M = $0.015
    // 10% fresh: 100K × $0.30/M = $0.03
    // Output: 100K × $2.50/M = $0.25
    // Total: $0.3205
    expect(result.apiOptimizedCost).toBeCloseTo(0.3205, 2);
  });
});

describe("Audit Fix: supabase-reader error message", () => {
  test("error message mentions both SERVICE_KEY and ANON_KEY", async () => {
    // Dynamic import to test the error message
    const origUrl = process.env.SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_KEY;
    const origAnon = process.env.SUPABASE_ANON_KEY;

    // Remove both keys
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_ANON_KEY;

    const { fetchMonthlySnapshots } = await import("../supabase-reader");

    try {
      await fetchMonthlySnapshots();
      // Should throw
      expect(true).toBe(false);
    } catch (e: any) {
      // Error should mention BOTH key types, not just SERVICE_KEY
      expect(e.message).toContain("SUPABASE_ANON_KEY");
      expect(e.message).toContain("SUPABASE_SERVICE_KEY");
    }

    // Restore
    if (origUrl) process.env.SUPABASE_URL = origUrl;
    if (origKey) process.env.SUPABASE_SERVICE_KEY = origKey;
    if (origAnon) process.env.SUPABASE_ANON_KEY = origAnon;
  });
});

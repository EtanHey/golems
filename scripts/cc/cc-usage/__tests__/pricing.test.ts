import { describe, test, expect } from "bun:test";
import { PRICING_REGISTRY, PRICING_UPDATED, getModelPricing } from "../pricing";

describe("Pricing Registry — April 2026 Ground Truth", () => {
  test("pricing is dated April 2026", () => {
    expect(PRICING_UPDATED).toBe("2026-04");
  });

  // ── Anthropic ──────────────────────────────────────────────

  test("Opus 4.6: $5/$25 input/output", () => {
    const p = getModelPricing("claude-opus-4-6");
    expect(p.input).toBe(5.0);
    expect(p.output).toBe(25.0);
  });

  test("Opus 4.6: cache read 0.1x, write 1.25x (5m), 2.0x (1h)", () => {
    const p = getModelPricing("claude-opus-4-6");
    expect(p.cacheRead).toBe(0.5); // 0.1x of $5
    expect(p.cacheWrite5m).toBe(6.25); // 1.25x of $5
    expect(p.cacheWrite1h).toBe(10.0); // 2.0x of $5
  });

  test("Sonnet 4.6: $3/$15 input/output", () => {
    const p = getModelPricing("claude-sonnet-4-6");
    expect(p.input).toBe(3.0);
    expect(p.output).toBe(15.0);
    expect(p.cacheRead).toBe(0.3);
    expect(p.cacheWrite5m).toBe(3.75);
    expect(p.cacheWrite1h).toBe(6.0);
  });

  test("Haiku 4.5: $1/$5 input/output", () => {
    const p = getModelPricing("claude-haiku-4-5-20251001");
    expect(p.input).toBe(1.0);
    expect(p.output).toBe(5.0);
    expect(p.cacheRead).toBe(0.1);
    expect(p.cacheWrite5m).toBe(1.25);
    expect(p.cacheWrite1h).toBe(2.0);
  });

  test("all Anthropic models have 50% batch discount", () => {
    for (const [id, pricing] of Object.entries(PRICING_REGISTRY)) {
      if (pricing.provider === "anthropic") {
        expect(pricing.batchDiscount).toBe(0.5);
      }
    }
  });

  // ── OpenAI ─────────────────────────────────────────────────

  test("GPT-5.4: $2.50/$15 input/output, cached input $0.25", () => {
    const p = getModelPricing("gpt-5.4");
    expect(p.input).toBe(2.5);
    expect(p.output).toBe(15.0);
    expect(p.cacheRead).toBe(0.25);
  });

  test("OpenAI has no cache write premium (write = input rate)", () => {
    const p = getModelPricing("gpt-5.4");
    expect(p.cacheWrite5m).toBe(p.input);
    expect(p.cacheWrite1h).toBe(p.input);
  });

  test("GPT-5-Codex: $1.25/$10, no batch discount", () => {
    const p = getModelPricing("gpt-5-codex");
    expect(p.input).toBe(1.25);
    expect(p.output).toBe(10.0);
    expect(p.batchDiscount).toBe(1.0); // no discount
  });

  // ── Google Gemini ──────────────────────────────────────────

  test("Gemini 2.5 Flash-Lite: $0.10/$0.40", () => {
    const p = getModelPricing("gemini-2.5-flash-lite");
    expect(p.input).toBe(0.1);
    expect(p.output).toBe(0.4);
  });

  test("Gemini 2.5 Flash: $0.30/$2.50", () => {
    const p = getModelPricing("gemini-2.5-flash");
    expect(p.input).toBe(0.3);
    expect(p.output).toBe(2.5);
  });

  test("Gemini 2.5 Pro: $1.25/$10.00", () => {
    const p = getModelPricing("gemini-2.5-pro");
    expect(p.input).toBe(1.25);
    expect(p.output).toBe(10.0);
  });

  test("all Gemini models have 50% batch discount", () => {
    for (const [id, pricing] of Object.entries(PRICING_REGISTRY)) {
      if (pricing.provider === "google") {
        expect(pricing.batchDiscount).toBe(0.5);
      }
    }
  });

  // ── Fuzzy matching ─────────────────────────────────────────

  test("fuzzy: 'claude-opus-4-6[1m]' resolves to Opus 4.6 pricing", () => {
    const p = getModelPricing("claude-opus-4-6[1m]");
    expect(p.input).toBe(5.0);
  });

  test("fuzzy: old sonnet model ID resolves to Sonnet pricing", () => {
    const p = getModelPricing("claude-sonnet-4-5-20250929");
    expect(p.input).toBe(3.0);
  });

  test("fuzzy: unknown model falls back to Sonnet pricing", () => {
    const p = getModelPricing("some-unknown-model");
    expect(p.input).toBe(3.0); // Sonnet default
  });
});

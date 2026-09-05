import { describe, expect, test } from "bun:test";
import { buildShellbookUsageExport } from "../shellbook-export";

describe("Shellbook usage export", () => {
  test("groups raw usage rows by day and model with cache tokens included", () => {
    const exported = buildShellbookUsageExport([
      {
        created_at: "2026-06-01T10:00:00.000Z",
        model: "claude-opus-4-6",
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_tokens: 30,
        cache_read_tokens: 40,
        cost_usd: 1.25,
      },
      {
        created_at: "2026-06-01T11:00:00.000Z",
        model: "claude-opus-4-6",
        input_tokens: 10,
        output_tokens: 2,
        cache_creation_tokens: 3,
        cache_read_tokens: 4,
        cost_usd: 0.25,
      },
      {
        created_at: "2026-06-02T10:00:00.000Z",
        model: "gpt-5-codex",
        input_tokens: 200,
        output_tokens: 50,
        cache_creation_tokens: 0,
        cache_read_tokens: 100,
        cost_usd: 2,
      },
    ]);

    expect(exported.daily).toEqual([
      {
        date: "2026-06-01",
        inputTokens: 110,
        outputTokens: 22,
        cacheCreationTokens: 33,
        cacheReadTokens: 44,
        totalTokens: 209,
        totalCost: 1.5,
        modelsUsed: ["claude-opus-4-6"],
        modelBreakdowns: [
          {
            modelName: "claude-opus-4-6",
            inputTokens: 110,
            outputTokens: 22,
            cacheCreationTokens: 33,
            cacheReadTokens: 44,
            totalTokens: 209,
            cost: 1.5,
          },
        ],
      },
      {
        date: "2026-06-02",
        inputTokens: 200,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 100,
        totalTokens: 350,
        totalCost: 2,
        modelsUsed: ["gpt-5-codex"],
        modelBreakdowns: [
          {
            modelName: "gpt-5-codex",
            inputTokens: 200,
            outputTokens: 50,
            cacheCreationTokens: 0,
            cacheReadTokens: 100,
            totalTokens: 350,
            cost: 2,
          },
        ],
      },
    ]);
    expect(exported.totals).toEqual({
      inputTokens: 310,
      outputTokens: 72,
      cacheCreationTokens: 33,
      cacheReadTokens: 144,
      totalTokens: 559,
      totalCost: 3.5,
    });
  });

  test("skips rows without valid dates and labels missing models as unknown", () => {
    const exported = buildShellbookUsageExport([
      {
        created_at: "",
        model: "claude-opus-4-6",
        input_tokens: 999,
        output_tokens: 999,
        cache_creation_tokens: 999,
        cache_read_tokens: 999,
        cost_usd: 999,
      },
      {
        created_at: "2026-06-01T10:00:00.000Z",
        model: "",
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_tokens: 3,
        cache_read_tokens: 4,
        cost_usd: 5,
      },
    ]);

    expect(exported.daily).toHaveLength(1);
    expect(exported.daily[0].modelsUsed).toEqual(["unknown"]);
    expect(exported.daily[0].totalTokens).toBe(10);
  });
});

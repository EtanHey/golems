import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readCostLog,
  logCost,
  filterByPeriod,
  summarize,
  groupBySource,
  groupByModel,
  groupByDay,
  formatSummary,
  formatBySource,
  formatDaily,
  formatFullStats,
  getFullUsageStats,
  estimateValueSaved,
  type CostEntry,
} from "@golems/shared/lib/cost-tracker";

const TEST_DIR = join(tmpdir(), `golems-cost-test-${Date.now()}`);
const COST_LOG = join(TEST_DIR, "api_costs.jsonl");

const sampleEntries: CostEntry[] = [
  {
    timestamp: "2026-02-07T10:00:00.000Z",
    model: "claude-haiku-4-5-20251001",
    source: "email-scorer",
    input_tokens: 500,
    output_tokens: 100,
    cost_usd: 0.0008,
  },
  {
    timestamp: "2026-02-07T11:00:00.000Z",
    model: "claude-haiku-4-5-20251001",
    source: "job-scorer",
    input_tokens: 800,
    output_tokens: 200,
    cost_usd: 0.001440,
  },
  {
    timestamp: "2026-02-07T12:00:00.000Z",
    model: "claude-haiku-4-5-20251001",
    source: "email-scorer",
    input_tokens: 600,
    output_tokens: 150,
    cost_usd: 0.001080,
  },
  {
    timestamp: "2026-02-06T08:00:00.000Z",
    model: "claude-sonnet-4-5-20250929",
    source: "briefing",
    input_tokens: 2000,
    output_tokens: 500,
    cost_usd: 0.0076,
  },
  {
    timestamp: "2026-02-01T09:00:00.000Z",
    model: "claude-haiku-4-5-20251001",
    source: "soltome-learner",
    input_tokens: 1000,
    output_tokens: 300,
    cost_usd: 0.002,
  },
];

describe("cost-tracker", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("readCostLog returns empty array for missing file", () => {
    const result = readCostLog(join(TEST_DIR, "nonexistent.jsonl"));
    expect(result).toEqual([]);
  });

  test("readCostLog returns empty array for empty file", () => {
    writeFileSync(COST_LOG, "");
    const result = readCostLog(COST_LOG);
    expect(result).toEqual([]);
  });

  test("readCostLog parses JSONL correctly", () => {
    const content = sampleEntries.map((e) => JSON.stringify(e)).join("\n");
    writeFileSync(COST_LOG, content);

    const result = readCostLog(COST_LOG);
    expect(result).toHaveLength(5);
    expect(result[0].source).toBe("email-scorer");
    expect(result[0].cost_usd).toBe(0.0008);
  });

  test("readCostLog skips malformed lines", () => {
    writeFileSync(COST_LOG, '{"valid": true}\nbroken json\n{"also": "valid"}\n');
    const result = readCostLog(COST_LOG);
    expect(result).toHaveLength(2);
  });

  test("logCost appends to JSONL file", () => {
    const entry: CostEntry = {
      timestamp: "2026-02-08T10:00:00.000Z",
      model: "claude-haiku-4-5-20251001",
      source: "test",
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.00028,
    };

    logCost(COST_LOG, entry);
    logCost(COST_LOG, entry);

    const result = readCostLog(COST_LOG);
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("test");
  });

  test("logCost creates directory if needed", () => {
    const nestedPath = join(TEST_DIR, "sub", "dir", "costs.jsonl");
    logCost(nestedPath, sampleEntries[0]);
    expect(existsSync(nestedPath)).toBe(true);
  });

  test("filterByPeriod — today", () => {
    const now = new Date("2026-02-07T15:00:00.000Z");
    const filtered = filterByPeriod(sampleEntries, "today", now);
    expect(filtered).toHaveLength(3); // 3 entries on 2026-02-07
  });

  test("filterByPeriod — week (Sun start)", () => {
    // 2026-02-07 is a Saturday. Week starts Sun Feb 1.
    const now = new Date("2026-02-07T15:00:00.000Z");
    const filtered = filterByPeriod(sampleEntries, "week", now);
    // All 5 entries are in the same week (Feb 1 is Sunday, Feb 7 is Saturday)
    expect(filtered).toHaveLength(5);
  });

  test("filterByPeriod — month", () => {
    const now = new Date("2026-02-07T15:00:00.000Z");
    const filtered = filterByPeriod(sampleEntries, "month", now);
    expect(filtered).toHaveLength(5); // All in February
  });

  test("filterByPeriod — all returns everything", () => {
    const filtered = filterByPeriod(sampleEntries, "all");
    expect(filtered).toHaveLength(5);
  });

  test("summarize totals correctly", () => {
    const summary = summarize(sampleEntries, "test");
    expect(summary.totalCalls).toBe(5);
    expect(summary.totalInputTokens).toBe(4900);
    expect(summary.totalOutputTokens).toBe(1250);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.period).toBe("test");
  });

  test("groupBySource aggregates per source", () => {
    const bySource = groupBySource(sampleEntries);
    expect(Object.keys(bySource)).toHaveLength(4);
    expect(bySource["email-scorer"].totalCalls).toBe(2);
    expect(bySource["job-scorer"].totalCalls).toBe(1);
    expect(bySource["briefing"].totalCalls).toBe(1);
    expect(bySource["soltome-learner"].totalCalls).toBe(1);
  });

  test("groupByModel aggregates per model", () => {
    const byModel = groupByModel(sampleEntries);
    expect(Object.keys(byModel)).toHaveLength(2);
    expect(byModel["claude-haiku-4-5-20251001"].totalCalls).toBe(4);
    expect(byModel["claude-sonnet-4-5-20250929"].totalCalls).toBe(1);
  });

  test("groupByDay aggregates per day, sorted", () => {
    const daily = groupByDay(sampleEntries);
    expect(daily).toHaveLength(3);
    expect(daily[0].date).toBe("2026-02-01");
    expect(daily[1].date).toBe("2026-02-06");
    expect(daily[2].date).toBe("2026-02-07");
    expect(daily[2].calls).toBe(3);
  });

  test("formatSummary produces readable output", () => {
    const summary = summarize(sampleEntries, "all-time");
    const formatted = formatSummary(summary);
    expect(formatted).toContain("Period: all-time");
    expect(formatted).toContain("Calls:  5");
    expect(formatted).toContain("$");
  });

  test("formatBySource shows table with sources", () => {
    const bySource = groupBySource(sampleEntries);
    const formatted = formatBySource(bySource);
    expect(formatted).toContain("email-scorer");
    expect(formatted).toContain("job-scorer");
    expect(formatted).toContain("Source");
  });

  test("formatBySource handles empty data", () => {
    const formatted = formatBySource({});
    expect(formatted).toBe("No data.");
  });

  test("formatDaily shows day-by-day breakdown", () => {
    const daily = groupByDay(sampleEntries);
    const formatted = formatDaily(daily);
    expect(formatted).toContain("2026-02-07");
    expect(formatted).toContain("TOTAL");
  });

  test("getFullUsageStats splits paid vs free", () => {
    const mixedEntries: CostEntry[] = [
      {
        timestamp: "2026-02-07T10:00:00.000Z",
        model: "claude-haiku-4-5-20251001",
        source: "email-scorer",
        input_tokens: 500,
        output_tokens: 100,
        cost_usd: 0.0008,
        tier: "paid",
      },
      {
        timestamp: "2026-02-07T11:00:00.000Z",
        model: "gemini",
        source: "job-scorer",
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        tier: "free",
      },
      {
        timestamp: "2026-02-07T12:00:00.000Z",
        model: "cursor",
        source: "helpers",
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        tier: "free",
      },
      {
        timestamp: "2026-02-07T13:00:00.000Z",
        model: "claude-haiku-4-5-20251001",
        source: "job-scorer",
        input_tokens: 800,
        output_tokens: 200,
        cost_usd: 0.00144,
        tier: "paid",
      },
    ];

    const content = mixedEntries.map((e) => JSON.stringify(e)).join("\n");
    writeFileSync(COST_LOG, content);

    const stats = getFullUsageStats(COST_LOG, "all");

    expect(stats.paid.totalCalls).toBe(2);
    expect(stats.paid.totalCost).toBeGreaterThan(0);
    expect(stats.paid.bySource["email-scorer"].totalCalls).toBe(1);
    expect(stats.paid.bySource["job-scorer"].totalCalls).toBe(1);

    expect(stats.free.totalCalls).toBe(2);
    expect(stats.free.byHelper["gemini"]).toBe(1);
    expect(stats.free.byHelper["cursor"]).toBe(1);
    expect(stats.free.bySource["job-scorer"]).toBe(1);
    expect(stats.free.bySource["helpers"]).toBe(1);

    expect(stats.combined.totalCalls).toBe(4);
  });

  test("getFullUsageStats handles entries without tier field as paid", () => {
    // Old entries without tier field should be treated as paid
    const content = sampleEntries.map((e) => JSON.stringify(e)).join("\n");
    writeFileSync(COST_LOG, content);

    const stats = getFullUsageStats(COST_LOG, "all");
    expect(stats.paid.totalCalls).toBe(5);
    expect(stats.free.totalCalls).toBe(0);
  });

  test("estimateValueSaved returns 0 for 0 free calls", () => {
    expect(estimateValueSaved(sampleEntries, 0)).toBe(0);
  });

  test("estimateValueSaved uses paid averages when available", () => {
    const paidEntries: CostEntry[] = [
      { timestamp: "", model: "haiku", source: "a", input_tokens: 1000, output_tokens: 200, cost_usd: 0.001, tier: "paid" },
      { timestamp: "", model: "haiku", source: "b", input_tokens: 2000, output_tokens: 400, cost_usd: 0.002, tier: "paid" },
    ];
    // Avg: 1500 in, 300 out
    // Cost per call: (1500/1M * 0.80) + (300/1M * 4.00) = 0.0012 + 0.0012 = 0.0024
    const value = estimateValueSaved(paidEntries, 10);
    expect(value).toBeCloseTo(0.024, 4);
  });

  test("estimateValueSaved uses defaults when no paid entries", () => {
    // Default: 600 in, 150 out
    // Cost per call: (600/1M * 0.80) + (150/1M * 4.00) = 0.00048 + 0.0006 = 0.00108
    const value = estimateValueSaved([], 100);
    expect(value).toBeCloseTo(0.108, 4);
  });

  test("getFullUsageStats includes estimatedValueSaved", () => {
    const mixedEntries: CostEntry[] = [
      { timestamp: "2026-02-07T10:00:00.000Z", model: "haiku", source: "scorer", input_tokens: 500, output_tokens: 100, cost_usd: 0.0008, tier: "paid" },
      { timestamp: "2026-02-07T11:00:00.000Z", model: "gemini", source: "helpers", input_tokens: 0, output_tokens: 0, cost_usd: 0, tier: "free" },
      { timestamp: "2026-02-07T12:00:00.000Z", model: "cursor", source: "helpers", input_tokens: 0, output_tokens: 0, cost_usd: 0, tier: "free" },
    ];
    const content = mixedEntries.map(e => JSON.stringify(e)).join("\n");
    writeFileSync(COST_LOG, content);

    const stats = getFullUsageStats(COST_LOG, "all");
    expect(stats.free.estimatedValueSaved).toBeGreaterThan(0);
    // 1 paid call: 500 in, 100 out → avg per call same
    // 2 free calls × ((500/1M * 0.80) + (100/1M * 4.00)) = 2 × 0.0008 = 0.0016
    expect(stats.free.estimatedValueSaved).toBeCloseTo(0.0016, 5);
  });

  test("formatFullStats produces readable output", () => {
    const mixedEntries: CostEntry[] = [
      { timestamp: "2026-02-07T10:00:00.000Z", model: "haiku", source: "scorer", input_tokens: 500, output_tokens: 100, cost_usd: 0.0008, tier: "paid" },
      { timestamp: "2026-02-07T11:00:00.000Z", model: "gemini", source: "helpers", input_tokens: 0, output_tokens: 0, cost_usd: 0, tier: "free" },
    ];
    const content = mixedEntries.map(e => JSON.stringify(e)).join("\n");
    writeFileSync(COST_LOG, content);

    const stats = getFullUsageStats(COST_LOG, "all");
    const output = formatFullStats(stats);
    expect(output).toContain("LLM Usage");
    expect(output).toContain("Paid API: 1 calls");
    expect(output).toContain("Free CLI: 1 calls");
    expect(output).toContain("Value saved:");
    expect(output).toContain("Total value:");
  });

  test("getFullUsageStats respects period filter", () => {
    const entries: CostEntry[] = [
      {
        timestamp: new Date().toISOString(),
        model: "claude-haiku-4-5-20251001",
        source: "test",
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: 0.0003,
        tier: "paid",
      },
      {
        timestamp: "2025-01-01T10:00:00.000Z", // old entry
        model: "gemini",
        source: "test",
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        tier: "free",
      },
    ];

    const content = entries.map((e) => JSON.stringify(e)).join("\n");
    writeFileSync(COST_LOG, content);

    const statsToday = getFullUsageStats(COST_LOG, "today");
    expect(statsToday.combined.totalCalls).toBe(1);
    expect(statsToday.paid.totalCalls).toBe(1);

    const statsAll = getFullUsageStats(COST_LOG, "all");
    expect(statsAll.combined.totalCalls).toBe(2);
  });
});

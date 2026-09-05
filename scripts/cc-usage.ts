#!/usr/bin/env bun
/**
 * Multi-Provider AI Usage Tracker — BrainLayer-backed.
 *
 * Reads from Supabase (usage_monthly_snapshots + llm_usage) instead of
 * parsing local JSONL files. See cc-usage-sync.ts for the ingestion pipeline.
 *
 * Usage:
 *   bun scripts/cc-usage.ts                          # This month summary
 *   bun scripts/cc-usage.ts --period=today            # Today only
 *   bun scripts/cc-usage.ts --period=week             # This week
 *   bun scripts/cc-usage.ts --period=month            # This month (default)
 *   bun scripts/cc-usage.ts --period=all              # All time with monthly breakdown
 *   bun scripts/cc-usage.ts --daily                   # Daily breakdown
 *   bun scripts/cc-usage.ts --by-project              # By project
 *   bun scripts/cc-usage.ts --by-model                # By model
 *   bun scripts/cc-usage.ts --by-provider             # By provider (NEW)
 *   bun scripts/cc-usage.ts --hypothetical            # Show optimized API cost (NEW)
 *   bun scripts/cc-usage.ts --roi                     # Subscription ROI (NEW)
 *   bun scripts/cc-usage.ts --cache-ratio=0.85        # Override cache assumption (NEW)
 *   bun scripts/cc-usage.ts --export=json|csv         # Structured export (NEW)
 *   bun scripts/cc-usage.ts --json                    # JSON for statusline
 *   bun scripts/cc-usage.ts --snapshot                # Write monthly snapshot to Supabase
 */

import {
  calculateHypotheticalCost,
} from "./cc-usage/hypothetical";
import {
  getModelPricing,
  calculateRawCost,
  PRICING_REGISTRY,
  PRICING_UPDATED,
} from "./cc-usage/pricing";
import {
  fetchMonthlySnapshots,
  fetchRawUsageAggregated,
  fetchSupabaseCosts,
  type SupabaseEntry,
} from "./cc-usage/supabase-reader";
import { parseUsageArgs } from "./cc-usage/cli-args";
import {
  CURSOR_LOWER_BOUND_VALUE_NOTE,
  hasLowerBoundProviderCost,
  hasLowerBoundSourceCost,
  valueNoteForProvider,
  valuePrefixForProvider,
} from "./cc-usage/display-semantics";
import { shouldUseRawAggregation } from "./cc-usage/data-source";
import type {
  MonthlySnapshot,
  Provider,
  HypotheticalCostResult,
} from "./cc-usage/types";

// ─── ANSI Colors ──────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

// ─── Formatters ───────────────────────────────────────────────────

function formatUSD(amount: number): string {
  if (amount < 0.01 && amount > 0) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function costColor(cost: number): string {
  if (cost > 50) return c.red;
  if (cost > 20) return c.yellow;
  return c.green;
}

function providerLabel(p: Provider): string {
  switch (p) {
    case "anthropic":
      return "Claude";
    case "openai":
      return "Codex/GPT";
    case "google":
      return "Gemini";
    case "cursor":
      return "Cursor";
  }
}

function providerColor(p: Provider): string {
  switch (p) {
    case "anthropic":
      return c.magenta;
    case "openai":
      return c.green;
    case "google":
      return c.blue;
    case "cursor":
      return c.cyan;
  }
}

// ─── Subscription cost config ─────────────────────────────────────

const MONTHLY_SUBSCRIPTIONS: Record<Provider, number> = {
  anthropic: 200, // Claude Max
  openai: 200, // ChatGPT Pro
  google: 0, // Free / Flex tier
  cursor: 20, // Cursor Pro
};

// ─── Date helpers ─────────────────────────────────────────────────

function getDateRange(period: string): { from?: string; to?: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const thisMonth = now.toISOString().slice(0, 7);

  switch (period) {
    case "today":
      return { from: today };
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { from: d.toISOString().slice(0, 10) };
    }
    case "month":
      return { from: `${thisMonth}-01` };
    case "all":
      return {}; // no filter
    default:
      return { from: `${thisMonth}-01` };
  }
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// ─── Data fetching ────────────────────────────────────────────────

interface UsageData {
  snapshots: MonthlySnapshot[];
  apiEntries: SupabaseEntry[];
}

async function fetchUsageData(period: string): Promise<UsageData> {
  const range = getDateRange(period);

  // Try snapshots first, fall back to raw aggregation. All-time reports use raw
  // rows so backfills are reflected immediately even if snapshots lag.
  let snapshots: MonthlySnapshot[];
  if (period === "all" || period === "month") {
    snapshots = await fetchMonthlySnapshots({
      fromMonth: range.from?.slice(0, 7),
      toMonth: range.to?.slice(0, 7),
    });
    if (shouldUseRawAggregation(period, snapshots.length)) {
      snapshots = await fetchRawUsageAggregated({ fromDate: range.from });
    }
  } else {
    // For today/week, always use raw data (sub-month granularity)
    snapshots = await fetchRawUsageAggregated({ fromDate: range.from });
  }

  const apiEntries = await fetchSupabaseCosts(period);

  return { snapshots, apiEntries };
}

// ─── Renderers ────────────────────────────────────────────────────

function renderSummary(
  data: UsageData,
  period: string,
  opts: { hypothetical: boolean; roi: boolean; cacheRatio: number },
) {
  const { snapshots, apiEntries } = data;

  // Aggregate totals across all snapshots
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;
  let totalCost = 0;

  const byProvider: Record<
    Provider,
    {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreate: number;
      cost: number;
    }
  > = {
    anthropic: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 },
    openai: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 },
    google: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 },
    cursor: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, cost: 0 },
  };

  for (const s of snapshots) {
    const p = s.provider as Provider;
    if (!byProvider[p]) continue;

    totalInput += s.total_input_tokens;
    totalOutput += s.total_output_tokens;
    totalCacheRead += s.total_cache_read;
    totalCacheCreate += s.total_cache_create;
    totalCost += Number(s.calculated_api_cost);

    byProvider[p].input += s.total_input_tokens;
    byProvider[p].output += s.total_output_tokens;
    byProvider[p].cacheRead += s.total_cache_read;
    byProvider[p].cacheCreate += s.total_cache_create;
    byProvider[p].cost += Number(s.calculated_api_cost);
  }

  // API entries (paid tier)
  const paidApi = apiEntries.filter((e) => e.tier === "paid");
  const apiCost = paidApi.reduce((s, e) => s + e.cost, 0);
  const totalHasLowerBound = hasLowerBoundProviderCost(
    Object.entries(byProvider).map(([provider, d]) => ({
      provider,
      cost: d.cost,
    })),
  );

  console.log();
  console.log(
    `${c.bold}${c.cyan}══════════════════════════════════════════════════════${c.reset}`,
  );
  console.log(
    `${c.bold}  AI Usage — ${period.toUpperCase()}${c.reset}  ${c.dim}(pricing: ${PRICING_UPDATED})${c.reset}`,
  );
  console.log(
    `${c.bold}${c.cyan}══════════════════════════════════════════════════════${c.reset}`,
  );
  console.log();

  // Per-provider breakdown
  for (const p of ["anthropic", "openai", "google", "cursor"] as Provider[]) {
    const d = byProvider[p];
    const allTokens = d.input + d.output + d.cacheRead + d.cacheCreate;
    if (allTokens === 0) continue;

    const sub = MONTHLY_SUBSCRIPTIONS[p];
    const subLabel = sub > 0 ? `$${sub}/mo subscription` : "free/flex";

    console.log(
      `${c.bold}${providerColor(p)}${providerLabel(p)}${c.reset} ${c.dim}(${subLabel})${c.reset}`,
    );
    console.log(
      `  Tokens:   ${c.cyan}${formatTokens(d.input + d.cacheRead + d.cacheCreate)}${c.reset} in  ${c.yellow}${formatTokens(d.output)}${c.reset} out`,
    );
    console.log(
      `  Value:    ${costColor(d.cost)}${valuePrefixForProvider(p)}${formatUSD(d.cost)}${c.reset} ${c.dim}(${valueNoteForProvider(p)})${c.reset}`,
    );

    if (opts.hypothetical) {
      // When explicit cache data exists, inputTokens = fresh only (not cached).
      // When no cache data, inputTokens = total input for assumption model.
      const hasCache = d.cacheRead > 0 || d.cacheCreate > 0;
      const hypo = calculateHypotheticalCost({
        inputTokens: hasCache ? d.input : d.input + d.cacheRead + d.cacheCreate,
        outputTokens: d.output,
        cacheReadTokens: hasCache ? d.cacheRead : undefined,
        cacheCreateTokens: hasCache ? d.cacheCreate : undefined,
        modelId:
          p === "anthropic"
            ? "claude-sonnet-4-6"
            : p === "openai"
              ? "gpt-5.4"
              : p === "google"
                ? "gemini-2.5-flash"
                : "claude-sonnet-4-6",
        cacheRatio: opts.cacheRatio,
      });
      console.log(
        `  Hypo:     ${c.yellow}${formatUSD(hypo.apiOptimizedCost)}${c.reset} ${c.dim}(optimized, ${Math.round(opts.cacheRatio * 100)}% cache)${c.reset}  ${c.dim}${formatUSD(hypo.apiUnoptimizedCost)} (no cache)${c.reset}`,
      );
    }

    if (p === "cursor") {
      console.log(
        `  ${c.dim}Note: Cursor transcripts omit tool results and codebase-context tokens, so this is not exact API-equivalent value.${c.reset}`,
      );
    }

    console.log();
  }

  // Bottom line
  const totalAllTokens =
    totalInput + totalOutput + totalCacheRead + totalCacheCreate;
  const totalSubscription = Object.values(MONTHLY_SUBSCRIPTIONS).reduce(
    (s, v) => s + v,
    0,
  );

  console.log(
    `${c.cyan}══════════════════════════════════════════════════════${c.reset}`,
  );
  console.log(
    `${c.bold}  Total tokens:   ${c.white}${formatTokens(totalAllTokens)}${c.reset}`,
  );
  console.log(
    `${c.bold}  Total value:    ${costColor(totalCost)}${totalHasLowerBound ? ">=" : ""}${formatUSD(totalCost)}${c.reset} ${c.dim}(${totalHasLowerBound ? "at API rates; Cursor lower-bound" : "at API rates"})${c.reset}`,
  );

  if (opts.hypothetical) {
    const hasTotalCache = totalCacheRead > 0 || totalCacheCreate > 0;
    const totalHypo = calculateHypotheticalCost({
      inputTokens: hasTotalCache
        ? totalInput
        : totalInput + totalCacheRead + totalCacheCreate,
      outputTokens: totalOutput,
      cacheReadTokens: hasTotalCache ? totalCacheRead : undefined,
      cacheCreateTokens: hasTotalCache ? totalCacheCreate : undefined,
      modelId: "claude-sonnet-4-6", // weighted average approximation
      cacheRatio: opts.cacheRatio,
    });
    console.log(
      `${c.bold}  Hypothetical:   ${c.yellow}${formatUSD(totalHypo.apiOptimizedCost)}${c.reset} ${c.dim}(optimized)${c.reset}  ${c.dim}${formatUSD(totalHypo.apiUnoptimizedCost)} (no cache)${c.reset}`,
    );
  }

  if (opts.roi && period === "month") {
    const roi =
      totalCost > 0 ? (totalCost / totalSubscription).toFixed(1) : "0";
    console.log(
      `${c.bold}  Subscription:   ${c.dim}${formatUSD(totalSubscription)}/mo${c.reset}`,
    );
    console.log(`${c.bold}  ROI:            ${c.green}${roi}x${c.reset}`);
  }

  if (apiCost > 0) {
    console.log(
      `${c.bold}  API (paid):     ${costColor(apiCost)}${formatUSD(apiCost)}${c.reset}`,
    );
  }

  console.log();
}

function renderMonthlyBreakdown(
  snapshots: MonthlySnapshot[],
  opts: { hypothetical: boolean; cacheRatio: number },
) {
  // Group by month
  const months = new Map<
    string,
    Record<Provider, { input: number; output: number; cost: number }>
  >();

  for (const s of snapshots) {
    const m = s.year_month;
    if (!months.has(m)) {
      months.set(m, {
        anthropic: { input: 0, output: 0, cost: 0 },
        openai: { input: 0, output: 0, cost: 0 },
        google: { input: 0, output: 0, cost: 0 },
        cursor: { input: 0, output: 0, cost: 0 },
      });
    }
    const entry = months.get(m)!;
    const p = s.provider as Provider;
    if (!entry[p]) continue;
    entry[p].input +=
      s.total_input_tokens + s.total_cache_read + s.total_cache_create;
    entry[p].output += s.total_output_tokens;
    entry[p].cost += Number(s.calculated_api_cost);
  }

  const sorted = Array.from(months.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  if (sorted.length === 0) return;

  console.log(`${c.bold}${c.cyan}Monthly Breakdown${c.reset}`);
  console.log();

  // Header
  let header = `${c.dim}Month      Claude tok    Codex tok     Gemini tok    Value $`;
  if (opts.hypothetical) header += `     Hypo $`;
  header += c.reset;
  console.log(header);
  console.log(`${c.dim}${"─".repeat(opts.hypothetical ? 80 : 65)}${c.reset}`);

  for (const [month, providers] of sorted) {
    const claudeTok = providers.anthropic.input + providers.anthropic.output;
    const codexTok = providers.openai.input + providers.openai.output;
    const geminiTok = providers.google.input + providers.google.output;
    const totalCost =
      providers.anthropic.cost +
      providers.openai.cost +
      providers.google.cost +
      providers.cursor.cost;
    const totalCostPrefix = providers.cursor.cost > 0 ? ">=" : "";

    let line =
      `${month}  ` +
      `${formatTokens(claudeTok).padStart(12)}  ` +
      `${formatTokens(codexTok).padStart(12)}  ` +
      `${formatTokens(geminiTok).padStart(12)}  ` +
      `${costColor(totalCost)}${`${totalCostPrefix}${formatUSD(totalCost)}`.padStart(10)}${c.reset}`;

    if (opts.hypothetical) {
      const totalInput =
        providers.anthropic.input +
        providers.openai.input +
        providers.google.input;
      const totalOutput =
        providers.anthropic.output +
        providers.openai.output +
        providers.google.output;
      const hypo = calculateHypotheticalCost({
        inputTokens: totalInput,
        outputTokens: totalOutput,
        modelId: "claude-sonnet-4-6",
        cacheRatio: opts.cacheRatio,
      });
      line += `  ${c.yellow}${formatUSD(hypo.apiOptimizedCost).padStart(10)}${c.reset}`;
    }

    console.log(line);
  }

  console.log();
}

function renderByProvider(snapshots: MonthlySnapshot[]) {
  const byProvider: Record<
    string,
    { tokens: number; cost: number; models: Set<string> }
  > = {};

  for (const s of snapshots) {
    if (!byProvider[s.provider]) {
      byProvider[s.provider] = { tokens: 0, cost: 0, models: new Set() };
    }
    byProvider[s.provider].tokens +=
      s.total_input_tokens +
      s.total_output_tokens +
      s.total_cache_read +
      s.total_cache_create;
    byProvider[s.provider].cost += Number(s.calculated_api_cost);
    byProvider[s.provider].models.add(s.model_id);
  }

  console.log(`${c.bold}${c.cyan}By Provider${c.reset}`);
  console.log(
    `${c.dim}Provider      Tokens        Value        Models${c.reset}`,
  );
  console.log(`${c.dim}${"─".repeat(60)}${c.reset}`);

  for (const [provider, data] of Object.entries(byProvider).sort(
    (a, b) => b[1].cost - a[1].cost,
  )) {
    const col = costColor(data.cost);
    const valueText = `${valuePrefixForProvider(provider)}${formatUSD(data.cost)}`;
    console.log(
      `${providerColor(provider as Provider)}${providerLabel(provider as Provider).padEnd(12)}${c.reset}  ` +
        `${formatTokens(data.tokens).padStart(10)}  ` +
        `${col}${valueText.padStart(10)}${c.reset}  ` +
        `${c.dim}${Array.from(data.models).slice(0, 3).join(", ")}${data.models.size > 3 ? ` +${data.models.size - 3}` : ""}${c.reset}`,
    );
  }
  if (byProvider.cursor?.cost > 0) {
    console.log(
      `${c.dim}Cursor value is a lower bound: ${CURSOR_LOWER_BOUND_VALUE_NOTE}.${c.reset}`,
    );
  }
  console.log();
}

function renderByModel(snapshots: MonthlySnapshot[]) {
  const byModel: Record<
    string,
    { input: number; output: number; cost: number; providers: Set<Provider> }
  > = {};

  for (const s of snapshots) {
    if (!byModel[s.model_id]) {
      byModel[s.model_id] = {
        input: 0,
        output: 0,
        cost: 0,
        providers: new Set(),
      };
    }
    byModel[s.model_id].input +=
      s.total_input_tokens + s.total_cache_read + s.total_cache_create;
    byModel[s.model_id].output += s.total_output_tokens;
    byModel[s.model_id].cost += Number(s.calculated_api_cost);
    byModel[s.model_id].providers.add(s.provider as Provider);
  }

  const models = Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost);

  console.log(`${c.bold}${c.cyan}By Model${c.reset}`);
  const maxName = Math.max(...models.map(([n]) => n.length), 8);
  console.log(
    `${c.dim}${"Model".padEnd(maxName)}  Value       Tokens In    Tokens Out${c.reset}`,
  );
  console.log(`${c.dim}${"─".repeat(maxName + 40)}${c.reset}`);

  for (const [name, data] of models) {
    const valuePrefix = data.providers.has("cursor") ? ">=" : "";
    console.log(
      `${name.padEnd(maxName)}  ` +
        `${costColor(data.cost)}${`${valuePrefix}${formatUSD(data.cost)}`.padStart(10)}${c.reset}  ` +
        `${formatTokens(data.input).padStart(10)}  ` +
        `${formatTokens(data.output).padStart(10)}`,
    );
  }
  if (models.some(([, data]) => data.providers.has("cursor"))) {
    console.log(
      `${c.dim}Rows containing Cursor include lower-bound transcript estimates.${c.reset}`,
    );
  }
  console.log();
}

function renderDaily(data: UsageData) {
  const dayMap: Record<
    string,
    {
      cost: number;
      calls: number;
      input: number;
      output: number;
      hasLowerBound: boolean;
    }
  > = {};

  // From snapshots (grouped by day from llm_usage created_at)
  for (const e of data.apiEntries) {
    if (!dayMap[e.day]) {
      dayMap[e.day] = {
        cost: 0,
        calls: 0,
        input: 0,
        output: 0,
        hasLowerBound: false,
      };
    }
    dayMap[e.day].cost += e.cost;
    dayMap[e.day].calls += 1;
    dayMap[e.day].input += e.inputTokens || 0;
    dayMap[e.day].output += e.outputTokens || 0;
    dayMap[e.day].hasLowerBound ||= hasLowerBoundSourceCost([e]);
  }

  const days = Object.entries(dayMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({ date, ...d }));

  if (days.length === 0) {
    console.log(
      `${c.dim}No daily data available. Run cc-usage-sync.ts first.${c.reset}`,
    );
    return;
  }

  console.log(`${c.bold}${c.cyan}Daily Breakdown${c.reset}`);
  console.log(
    `${c.dim}Date         Calls  Value       Tokens In    Tokens Out${c.reset}`,
  );
  console.log(`${c.dim}${"─".repeat(60)}${c.reset}`);

  for (const d of days) {
    const valuePrefix = d.hasLowerBound ? ">=" : "";
    console.log(
      `${d.date}  ` +
        `${String(d.calls).padStart(5)}  ` +
        `${costColor(d.cost)}${`${valuePrefix}${formatUSD(d.cost)}`.padStart(10)}${c.reset}  ` +
        `${formatTokens(d.input).padStart(10)}  ` +
        `${formatTokens(d.output).padStart(10)}`,
    );
  }
  if (days.some((d) => d.hasLowerBound)) {
    console.log(
      `${c.dim}Days containing Cursor include lower-bound transcript estimates: ${CURSOR_LOWER_BOUND_VALUE_NOTE}.${c.reset}`,
    );
  }
  console.log();
}

function renderJSON(
  data: UsageData,
  period: string,
  opts: { hypothetical: boolean; cacheRatio: number },
) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  const providers: Record<string, { tokens: number; cost: number }> = {};

  for (const s of data.snapshots) {
    const allTokens =
      s.total_input_tokens +
      s.total_output_tokens +
      s.total_cache_read +
      s.total_cache_create;
    totalInput +=
      s.total_input_tokens + s.total_cache_read + s.total_cache_create;
    totalOutput += s.total_output_tokens;
    totalCost += Number(s.calculated_api_cost);

    if (!providers[s.provider]) {
      providers[s.provider] = { tokens: 0, cost: 0 };
    }
    providers[s.provider].tokens += allTokens;
    providers[s.provider].cost += Number(s.calculated_api_cost);
  }

  const result: Record<string, unknown> = {
    period,
    pricingDate: PRICING_UPDATED,
    total: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      valueUsd: Math.round(totalCost * 100) / 100,
    },
    providers,
  };

  if (
    hasLowerBoundProviderCost(
      Object.entries(providers).map(([provider, d]) => ({
        provider,
        cost: d.cost,
      })),
    )
  ) {
    result.estimateWarnings = [
      {
        provider: "cursor",
        kind: "lower_bound",
        note: CURSOR_LOWER_BOUND_VALUE_NOTE,
      },
    ];
  }

  if (opts.hypothetical) {
    const hypo = calculateHypotheticalCost({
      inputTokens: totalInput,
      outputTokens: totalOutput,
      modelId: "claude-sonnet-4-6",
      cacheRatio: opts.cacheRatio,
    });
    result.hypothetical = {
      optimizedUsd: Math.round(hypo.apiOptimizedCost * 100) / 100,
      unoptimizedUsd: Math.round(hypo.apiUnoptimizedCost * 100) / 100,
      cacheRatio: opts.cacheRatio,
    };
  }

  console.log(JSON.stringify(result));
}

function renderCSV(
  snapshots: MonthlySnapshot[],
  opts: { hypothetical: boolean; cacheRatio: number },
) {
  let header =
    "year_month,provider,model_id,input_tokens,output_tokens,cache_read,cache_create,api_cost";
  if (opts.hypothetical) header += ",hypo_optimized,hypo_unoptimized";
  console.log(header);

  for (const s of snapshots) {
    let line = `${s.year_month},${s.provider},${s.model_id},${s.total_input_tokens},${s.total_output_tokens},${s.total_cache_read},${s.total_cache_create},${Number(s.calculated_api_cost).toFixed(4)}`;

    if (opts.hypothetical) {
      const hypo = calculateHypotheticalCost({
        inputTokens:
          s.total_input_tokens + s.total_cache_read + s.total_cache_create,
        outputTokens: s.total_output_tokens,
        modelId: s.model_id,
        cacheRatio: opts.cacheRatio,
      });
      line += `,${hypo.apiOptimizedCost.toFixed(4)},${hypo.apiUnoptimizedCost.toFixed(4)}`;
    }

    console.log(line);
  }
}

// ─── Snapshot writer ──────────────────────────────────────────────

async function writeSnapshot(snapshots: MonthlySnapshot[]) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY required for --snapshot",
    );
    return;
  }

  // Group by month+provider+model and upsert
  const currentMonth = getCurrentMonth();
  const currentSnapshots = snapshots.filter(
    (s) => s.year_month === currentMonth,
  );

  if (currentSnapshots.length === 0) {
    console.log(`${c.dim}No data for ${currentMonth} to snapshot.${c.reset}`);
    return;
  }

  const rows = currentSnapshots.map((s) => ({
    year_month: s.year_month,
    provider: s.provider,
    model_id: s.model_id,
    total_input_tokens: s.total_input_tokens,
    total_output_tokens: s.total_output_tokens,
    total_cache_read: s.total_cache_read,
    total_cache_create: s.total_cache_create,
    calculated_api_cost: Number(s.calculated_api_cost),
    snapshot_at: new Date().toISOString(),
  }));

  const resp = await fetch(
    `${url}/rest/v1/usage_monthly_snapshots?on_conflict=year_month,provider,model_id`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Snapshot write failed: ${resp.status} ${body}`);
    return;
  }

  console.log(
    `${c.green}Wrote ${rows.length} snapshot rows for ${currentMonth}${c.reset}`,
  );
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const {
    period,
    daily,
    byProject,
    byModel,
    byProvider,
    hypothetical,
    roi,
    jsonOutput,
    snapshot,
    exportFormat,
    cacheRatio,
  } = parseUsageArgs(args);

  // Load env for Supabase access
  try {
    await import("../packages/shared/src/lib/load-env");
  } catch {
    /* ok if not in repo root */
  }

  // Fetch data from Supabase
  const data = await fetchUsageData(period);

  // Snapshot mode: write current month to snapshots table
  if (snapshot) {
    await writeSnapshot(data.snapshots);
    return;
  }

  // Export modes
  if (exportFormat === "csv") {
    renderCSV(data.snapshots, { hypothetical, cacheRatio });
    return;
  }

  if (jsonOutput || exportFormat === "json") {
    renderJSON(data, period, { hypothetical, cacheRatio });
    return;
  }

  // Terminal output
  renderSummary(data, period, { hypothetical, roi, cacheRatio });

  if (period === "all") {
    renderMonthlyBreakdown(data.snapshots, { hypothetical, cacheRatio });
  }

  if (daily) renderDaily(data);
  if (byProvider) renderByProvider(data.snapshots);
  if (byModel) renderByModel(data.snapshots);

  // Default: show daily if no specific view requested
  if (!daily && !byProvider && !byModel && !byProject && period !== "all") {
    renderDaily(data);
  }

  if (byProject) {
    console.log(
      `${c.dim}--by-project requires session-level data. Run cc-usage-sync.ts first, then query llm_usage.metadata->>'project'.${c.reset}`,
    );
  }
}

main().catch(console.error);

/**
 * Read-only Supabase client for usage data.
 *
 * Reads from:
 * - usage_monthly_snapshots (pre-aggregated by cc-usage-sync.ts)
 * - llm_usage (raw rows, for periods not yet snapshotted)
 */

import type { MonthlySnapshot, Provider } from "./types";
import { dedupeUsageRowsBySession } from "./session-dedupe";

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY required",
    );
  return { url, key };
}

async function supabaseGet<T>(path: string): Promise<T[]> {
  const { url, key } = getSupabaseConfig();
  const resp = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Supabase GET ${path} failed: ${resp.status} ${body}`);
  }
  return resp.json() as Promise<T[]>;
}

async function supabaseGetAll<T>(path: string): Promise<T[]> {
  const { url, key } = getSupabaseConfig();
  const PAGE_SIZE = 1000; // Supabase REST default cap.
  let offset = 0;
  const allRows: T[] = [];

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const resp = await fetch(
      `${url}/rest/v1/${path}${separator}limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Supabase GET ${path} failed: ${resp.status} ${body}`);
    }

    const rows = (await resp.json()) as T[];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

/**
 * Fetch monthly snapshots for a date range.
 * Returns all rows if no constraints given.
 */
export async function fetchMonthlySnapshots(opts?: {
  fromMonth?: string; // 'YYYY-MM' inclusive
  toMonth?: string; // 'YYYY-MM' inclusive
  provider?: Provider;
}): Promise<MonthlySnapshot[]> {
  let query = "usage_monthly_snapshots?select=*&order=year_month.asc";
  if (opts?.fromMonth) query += `&year_month=gte.${opts.fromMonth}`;
  if (opts?.toMonth) query += `&year_month=lte.${opts.toMonth}`;
  if (opts?.provider) query += `&provider=eq.${opts.provider}`;

  return supabaseGet<MonthlySnapshot>(query);
}

export interface RawUsageRow {
  created_at: string;
  model: string;
  source: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  tier: string;
  metadata: {
    session_id?: string;
    project?: string;
    estimation_method?: string;
    synced_at?: string;
  } | null;
  id?: string | number | null;
}

export async function fetchRawUsageRows(opts?: {
  fromDate?: string; // 'YYYY-MM-DD'
}): Promise<RawUsageRow[]> {
  let query =
    "llm_usage?select=id,created_at,model,source,input_tokens,output_tokens,cost_usd,cache_read_tokens,cache_creation_tokens,tier,metadata&order=created_at.asc,id.asc";
  if (opts?.fromDate) query += `&created_at=gte.${opts.fromDate}`;

  return dedupeUsageRowsBySession(await supabaseGetAll<RawUsageRow>(query));
}

/**
 * Fetch raw llm_usage rows, aggregated client-side by month/provider/model.
 * Used as fallback when snapshots haven't been populated yet.
 */
export async function fetchRawUsageAggregated(opts?: {
  fromDate?: string; // 'YYYY-MM-DD'
  provider?: string;
}): Promise<MonthlySnapshot[]> {
  const rows = await fetchRawUsageRows({ fromDate: opts?.fromDate });

  // Aggregate by month + provider + model
  const map = new Map<string, MonthlySnapshot>();

  for (const row of rows) {
    const yearMonth = row.created_at?.slice(0, 7) || "unknown";
    const provider = inferProvider(row.source, row.model);
    const modelId = row.model || "unknown";
    const key = `${yearMonth}|${provider}|${modelId}`;

    let snap = map.get(key);
    if (!snap) {
      snap = {
        year_month: yearMonth,
        provider,
        model_id: modelId,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_read: 0,
        total_cache_create: 0,
        calculated_api_cost: 0,
      };
      map.set(key, snap);
    }

    snap.total_input_tokens += row.input_tokens || 0;
    snap.total_output_tokens += row.output_tokens || 0;
    snap.total_cache_read += Number(row.cache_read_tokens) || 0;
    snap.total_cache_create += Number(row.cache_creation_tokens) || 0;
    snap.calculated_api_cost += Number(row.cost_usd) || 0;
  }

  return Array.from(map.values());
}

/**
 * Infer provider from llm_usage source/model fields.
 */
function inferProvider(source: string, model: string): Provider {
  if (source === "claude-code" || model.includes("claude")) return "anthropic";
  if (
    source === "codex-cli" ||
    model.includes("gpt") ||
    model.includes("codex")
  )
    return "openai";
  if (source === "cursor-cli" || source === "cursor") return "cursor";
  if (model.includes("gemini") || source.includes("gemini")) return "google";
  // AIDEV-TODO: add "local" provider type for these models instead of grouping under google
  if (
    model.includes("glm") ||
    model.includes("qwen") ||
    model.includes("llama") ||
    model.includes("deepseek")
  )
    return "google";
  return "anthropic"; // default
}

/**
 * Fetch Supabase API cost entries for a period (backward-compat with old cc-usage.ts).
 */
export interface SupabaseEntry {
  day: string;
  calls: number;
  cost: number;
  model: string;
  source: string;
  tier: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function fetchSupabaseCosts(
  period: string,
): Promise<SupabaseEntry[]> {
  const { url, key } = getSupabaseConfig();

  let dateFilter = "";
  const now = new Date();
  if (period === "today") {
    dateFilter = `&created_at=gte.${now.toISOString().slice(0, 10)}`;
  } else if (period === "week") {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    dateFilter = `&created_at=gte.${weekAgo.toISOString().slice(0, 10)}`;
  } else if (period === "month") {
    dateFilter = `&created_at=gte.${now.toISOString().slice(0, 8)}01`;
  }
  // period === "all" → no filter

  try {
    const data = await supabaseGetAll<any>(
      `llm_usage?select=id,created_at,model,source,cost_usd,tier,input_tokens,output_tokens,duration_ms,metadata${dateFilter}&order=created_at.desc,id.desc`,
    );
    return dedupeUsageRowsBySession(data).map((row) => ({
      day: row.created_at?.slice(0, 10) || "?",
      calls: 1,
      cost: Number(row.cost_usd) || 0,
      model: row.model || "unknown",
      source: row.source || "unknown",
      tier: row.tier || "paid",
      durationMs: row.duration_ms || 0,
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
    }));
  } catch {
    return [];
  }
}

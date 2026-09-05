/**
 * Finance data fetchers — pulls from llm_usage, subscriptions, payments.
 */

import { getSupabase } from "@golems/shared/lib/supabase-factory";

export interface LLMCostByModel {
  model: string;
  totalCost: number;
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface DailyCost {
  date: string;
  cost: number;
}

export interface SubscriptionSummary {
  service: string;
  amount: number;
  currency: string;
  frequency: string;
  status: string;
}

export interface EmailCategoryCount {
  category: string;
  count: number;
}

export interface FinanceData {
  llmCostsByModel: LLMCostByModel[];
  totalLLMCost: number;
  dailyCosts: DailyCost[];
  subscriptions: SubscriptionSummary[];
  monthlySubscriptionTotal: number;
  emailCategories: EmailCategoryCount[];
  totalEmails: number;
  fetchedAt: string;
}

export async function fetchFinanceData(): Promise<FinanceData> {
  const supabase = getSupabase();

  // LLM usage
  const { data: usage } = await supabase
    .from("llm_usage")
    .select("model, cost_usd, input_tokens, output_tokens, created_at");

  const modelStats = new Map<string, LLMCostByModel>();
  const dailyCostMap = new Map<string, number>();

  for (const u of usage ?? []) {
    const cost = Number(u.cost_usd) || 0;
    const existing = modelStats.get(u.model) ?? {
      model: u.model,
      totalCost: 0,
      totalCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    existing.totalCost += cost;
    existing.totalCalls++;
    existing.inputTokens += u.input_tokens ?? 0;
    existing.outputTokens += u.output_tokens ?? 0;
    modelStats.set(u.model, existing);

    // Daily costs (last 30 days)
    const date = u.created_at?.slice(0, 10);
    if (date) {
      dailyCostMap.set(date, (dailyCostMap.get(date) ?? 0) + cost);
    }
  }

  // Keep last 30 days of daily costs
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  const dailyCosts = [...dailyCostMap.entries()]
    .filter(([date]) => date >= cutoff)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, cost]) => ({ date, cost: Math.round(cost * 1000) / 1000 }));

  // Subscriptions
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("service_name, amount, currency, frequency, status");

  const subscriptions: SubscriptionSummary[] = (subs ?? []).map(
    (s: Record<string, unknown>) => ({
      service: s.service_name,
      amount: Number(s.amount) || 0,
      currency: s.currency ?? "USD",
      frequency: s.frequency ?? "monthly",
      status: s.status ?? "active",
    }),
  );

  const monthlySubscriptionTotal = subscriptions
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + s.amount, 0);

  // Email categories
  const { data: emails } = await supabase.from("emails").select("category");

  const catCounts = new Map<string, number>();
  for (const e of emails ?? []) {
    const cat = e.category ?? "uncategorized";
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }

  const totalLLMCost = [...modelStats.values()].reduce(
    (s, m) => s + m.totalCost,
    0,
  );

  return {
    llmCostsByModel: [...modelStats.values()].sort(
      (a, b) => b.totalCost - a.totalCost,
    ),
    totalLLMCost: Math.round(totalLLMCost * 100) / 100,
    dailyCosts,
    subscriptions,
    monthlySubscriptionTotal,
    emailCategories: [...catCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    totalEmails: emails?.length ?? 0,
    fetchedAt: new Date().toISOString(),
  };
}

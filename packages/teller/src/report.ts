/**
 * TellerGolem Report Module
 *
 * Generates monthly and annual financial reports from the payments table.
 */

import { getSupabase } from "@golems/shared/lib/supabase-factory";
import { getSubscriptionSummary } from "./db";
import type { MonthlyReport, TaxReport, TaxCategory } from "./types";

const ALL_CATEGORIES: TaxCategory[] = [
  "advertising", "insurance", "office", "software", "education",
  "travel", "meals", "professional-services", "other",
];

/**
 * Generate a monthly spending report for the given month.
 * Queries the payments table and aggregates spending by category and vendor.
 *
 * @param month - Month in YYYY-MM format
 * @returns Promise resolving to monthly report with totals by category and vendor
 */
export async function generateMonthlyReport(month: string): Promise<MonthlyReport> {
  const emptyCategories = Object.fromEntries(
    ALL_CATEGORIES.map((c) => [c, 0])
  ) as Record<TaxCategory, number>;

  const supabase = getSupabase();
  if (!supabase) {
    return { month, totalSpend: 0, byCategory: emptyCategories, byVendor: {}, subscriptionCount: 0 };
  }

  const startDate = `${month}-01`;
  const endDate = getLastDayOfMonth(month);

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .gte("paid_at", startDate)
    .lte("paid_at", endDate);

  if (error || !data || data.length === 0) {
    return {
      month,
      totalSpend: 0,
      byCategory: emptyCategories,
      byVendor: {},
      subscriptionCount: 0,
    };
  }

  const byCategory = { ...emptyCategories };
  const byVendor: Record<string, number> = {};
  let totalSpend = 0;

  for (const row of data) {
    const amount = Number(row.amount) || 0;
    const category: TaxCategory = ALL_CATEGORIES.includes(row.tax_category as TaxCategory)
      ? (row.tax_category as TaxCategory)
      : "other";
    const vendor = row.service_name || "Unknown";

    totalSpend += amount;
    byCategory[category] = (byCategory[category] || 0) + amount;
    byVendor[vendor] = (byVendor[vendor] || 0) + amount;
  }

  const subSummary = await getSubscriptionSummary();

  return {
    month,
    totalSpend,
    byCategory,
    byVendor,
    subscriptionCount: subSummary.services.length,
  };
}

/**
 * Generate an annual tax report for the given year.
 * Groups all payments by IRS Schedule C tax category with individual line items per vendor.
 *
 * @param year - Tax year (e.g. 2026)
 * @returns Promise resolving to tax report with deductible totals and item breakdowns
 */
export async function generateTaxReport(year: number): Promise<TaxReport> {
  const emptyByCategory = Object.fromEntries(
    ALL_CATEGORIES.map((c) => [c, { total: 0, items: [] as Array<{ vendor: string; amount: number }> }])
  ) as TaxReport["byCategory"];

  const supabase = getSupabase();
  if (!supabase) {
    return { year, totalDeductible: 0, byCategory: emptyByCategory };
  }

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .gte("paid_at", startDate)
    .lte("paid_at", endDate);

  if (error || !data || data.length === 0) {
    return { year, totalDeductible: 0, byCategory: emptyByCategory };
  }

  const byCategory = { ...emptyByCategory };
  // Deep clone to avoid shared array refs
  for (const cat of ALL_CATEGORIES) {
    byCategory[cat] = { total: 0, items: [] };
  }

  let totalDeductible = 0;

  for (const row of data) {
    const amount = Number(row.amount) || 0;
    const category: TaxCategory = ALL_CATEGORIES.includes(row.tax_category as TaxCategory)
      ? (row.tax_category as TaxCategory)
      : "other";
    const vendor = row.service_name || "Unknown";

    totalDeductible += amount;
    byCategory[category].total += amount;
    byCategory[category].items.push({ vendor, amount });
  }

  return { year, totalDeductible, byCategory };
}

/**
 * Format a monthly report as a readable Telegram message with category and vendor breakdowns.
 *
 * @param report - The monthly report to format
 * @returns Formatted text string ready for Telegram display
 */
export function formatMonthlyReportText(report: MonthlyReport): string {
  const lines: string[] = [];
  lines.push(`📊 Monthly Report: ${report.month}`);
  lines.push(`Total Spend: $${report.totalSpend.toFixed(2)}`);
  lines.push(`Active Subscriptions: ${report.subscriptionCount}`);
  lines.push("");
  lines.push("By Category:");
  for (const [cat, amount] of Object.entries(report.byCategory)) {
    if (amount > 0) {
      lines.push(`  ${cat}: $${amount.toFixed(2)}`);
    }
  }
  lines.push("");
  lines.push("By Vendor:");
  for (const [vendor, amount] of Object.entries(report.byVendor)) {
    lines.push(`  ${vendor}: $${amount.toFixed(2)}`);
  }
  return lines.join("\n");
}

/**
 * Format a tax report as readable text with line items per category for tax filing.
 *
 * @param report - The tax report to format
 * @returns Formatted text string with category totals and vendor itemizations
 */
export function formatTaxReportText(report: TaxReport): string {
  const lines: string[] = [];
  lines.push(`🧾 Tax Report: ${report.year}`);
  lines.push(`Total Deductible: $${report.totalDeductible.toFixed(2)}`);
  lines.push("");
  for (const [cat, data] of Object.entries(report.byCategory)) {
    if (data.total > 0) {
      lines.push(`${cat}: $${data.total.toFixed(2)}`);
      for (const item of data.items) {
        lines.push(`  - ${item.vendor}: $${item.amount.toFixed(2)}`);
      }
    }
  }
  return lines.join("\n");
}

/** Get the last day of a YYYY-MM month */
function getLastDayOfMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

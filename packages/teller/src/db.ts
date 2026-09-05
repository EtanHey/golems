/**
 * TellerGolem DB Layer
 *
 * Financial database operations (payments, subscriptions).
 * Uses supabase-factory directly — no offline queueing needed
 * since teller runs in the cloud.
 */

import { getSupabase, type SupabaseClient } from "@golems/shared/lib/supabase-factory";
import type { SubscriptionSummary } from "./types";

function getClient(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    throw new Error("SUPABASE_URL and key required for TellerGolem DB");
  }
  return client;
}

/**
 * Record a payment event.
 */
export async function recordPayment(
  payment: {
    subscription_id: string | null;
    email_id: string | null;
    amount: number;
    currency: string;
    paid_at: Date;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await getClient().from("payments").insert(payment);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Track or update a subscription.
 */
export async function trackSubscription(
  subscription: {
    service_name: string;
    amount: number;
    currency: string;
    frequency: string;
    status: string;
    first_seen: Date;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await getClient()
      .from("subscriptions")
      .upsert(subscription, { onConflict: "service_name" });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Get subscription summary for monthly report.
 */
export async function getSubscriptionSummary(): Promise<SubscriptionSummary> {
  const emptyResult: SubscriptionSummary = {
    totalMonthly: 0,
    services: [],
    newThisMonth: [],
    cancelledThisMonth: [],
  };

  const client = getSupabase();
  if (!client) return emptyResult;

  try {
    const { data: subs, error } = await client
      .from("subscriptions")
      .select("*")
      .eq("status", "active");

    if (error || !subs) return emptyResult;

    let totalMonthly = 0;
    const services = subs.map((sub: any) => {
      let monthlyAmount = sub.amount || 0;
      if (sub.frequency === "yearly") monthlyAmount = monthlyAmount / 12;
      totalMonthly += monthlyAmount;
      return {
        name: sub.service_name,
        amount: sub.amount,
        currency: sub.currency || "USD",
        status: sub.status,
      };
    });

    // New subscriptions this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let newThisMonth: string[] = [];
    try {
      const { data: newSubs } = await client
        .from("subscriptions")
        .select("service_name")
        .gte("first_seen", startOfMonth.toISOString());
      newThisMonth = (newSubs || []).map((s: any) => s.service_name);
    } catch { /* optional */ }

    let cancelledThisMonth: string[] = [];
    try {
      const { data: cancelledSubs } = await client
        .from("subscriptions")
        .select("service_name")
        .eq("status", "cancelled")
        .gte("created_at", startOfMonth.toISOString());
      cancelledThisMonth = (cancelledSubs || []).map((s: any) => s.service_name);
    } catch { /* optional */ }

    return { totalMonthly, services, newThisMonth, cancelledThisMonth };
  } catch {
    return emptyResult;
  }
}

/**
 * EmailGolem DB Client
 *
 * Supabase wrapper with offline resilience.
 * All operations queue locally when offline and sync when reconnected.
 */

// IMPORTANT: Load env FIRST - fixes launchd cwd issues
import "../lib/load-env";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../lib/supabase-factory";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type {
  Email,
  Subscription,
  Payment,
  QueuedItem,
  SubscriptionSummary,
  SafeResult,
} from "./types";
import { GOLEM_CATEGORIES } from "./router";

/** Offline queue path for storing failed DB operations */
export const OFFLINE_QUEUE_PATH =
  process.env.HOME + "/.golems-zikaron/offline-queue.json";

/**
 * Create Supabase client with credentials from env or custom config.
 * Uses shared factory for default case, custom createClient for overrides.
 */
export function createDbClient(config?: {
  url: string;
  key: string;
}): SupabaseClient {
  if (config) {
    return createClient(config.url, config.key);
  }
  const client = getSupabase();
  if (!client) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment",
    );
  }
  return client;
}

/**
 * Load the offline queue from disk
 */
export function loadLocalQueue(): QueuedItem[] {
  try {
    if (existsSync(OFFLINE_QUEUE_PATH)) {
      const content = readFileSync(OFFLINE_QUEUE_PATH, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error("[db-client] Failed to load offline queue:", err);
  }
  return [];
}

/**
 * Save the offline queue to disk
 */
function saveLocalQueue(queue: QueuedItem[]): void {
  try {
    const dir = dirname(OFFLINE_QUEUE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(OFFLINE_QUEUE_PATH, JSON.stringify(queue, null, 2));
  } catch (err) {
    console.error("[db-client] Failed to save offline queue:", err);
  }
}

/**
 * Append an item to the offline queue
 */
function appendToLocalQueue(item: Omit<QueuedItem, "id">): void {
  const queue = loadLocalQueue();
  const queuedItem: QueuedItem = {
    ...item,
    id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  queue.push(queuedItem);
  saveLocalQueue(queue);
}

/**
 * Remove an item from the offline queue by ID
 */
function removeFromQueue(id: string): void {
  const queue = loadLocalQueue();
  const filtered = queue.filter((item) => item.id !== id);
  saveLocalQueue(filtered);
}

/**
 * Clear the entire offline queue
 */
export function clearLocalQueue(): void {
  saveLocalQueue([]);
}

/**
 * Safe insert with offline queue fallback
 *
 * @param client - Supabase client
 * @param table - Table name
 * @param data - Data to insert
 * @returns Result with success/queued status
 */
export async function safeInsert(
  client: SupabaseClient,
  table: string,
  data: Record<string, unknown>,
): Promise<SafeResult> {
  try {
    const { error, data: result } = await client.from(table).insert(data);

    if (error) {
      // Queue for later sync
      appendToLocalQueue({ table, data, timestamp: new Date() });
      console.log(`[db-client] Offline: Queued ${table} insert for later sync`);
      return { success: false, queued: true, error: error.message };
    }

    return { success: true, data: result };
  } catch (err: unknown) {
    // Network error - queue for later
    appendToLocalQueue({ table, data, timestamp: new Date() });
    console.log(
      `[db-client] Network error: Queued ${table} insert for later sync`,
    );
    return {
      success: false,
      queued: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Safe upsert with offline queue fallback
 *
 * @param client - Supabase client
 * @param table - Table name
 * @param data - Data to upsert
 * @param conflictColumn - Column to check for conflicts
 * @returns Result with success/queued status
 */
export async function safeUpsert(
  client: SupabaseClient,
  table: string,
  data: Record<string, unknown>,
  conflictColumn: string,
): Promise<SafeResult> {
  try {
    const { error, data: result } = await client
      .from(table)
      .upsert(data, { onConflict: conflictColumn });

    if (error) {
      appendToLocalQueue({ table, data, timestamp: new Date() });
      return { success: false, queued: true, error: error.message };
    }

    return { success: true, data: result };
  } catch (err: unknown) {
    appendToLocalQueue({ table, data, timestamp: new Date() });
    return {
      success: false,
      queued: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sync offline queue items when back online
 *
 * @param client - Supabase client
 * @returns Sync results
 */
export async function syncOfflineQueue(
  client: SupabaseClient,
): Promise<{ synced: number; failed: number }> {
  const queue = loadLocalQueue();
  let synced = 0;
  let failed = 0;

  if (queue.length === 0) {
    return { synced: 0, failed: 0 };
  }

  console.log(`[db-client] Syncing ${queue.length} queued items...`);

  for (const item of queue) {
    try {
      const { error } = await client.from(item.table).insert(item.data);

      if (error) {
        console.error(
          `[db-client] Failed to sync item ${item.id}:`,
          error.message,
        );
        failed++;
      } else {
        console.log(`[db-client] Synced item ${item.id} to ${item.table}`);
        removeFromQueue(item.id);
        synced++;
      }
    } catch (err) {
      console.error(`[db-client] Network error syncing item ${item.id}`);
      failed++;
    }
  }

  console.log(`[db-client] Sync complete: ${synced} synced, ${failed} failed`);
  return { synced, failed };
}

/**
 * Get subscription summary for monthly report
 *
 * @param client - Supabase client
 * @returns Subscription summary
 */
export async function getSubscriptionSummary(
  client: SupabaseClient,
): Promise<SubscriptionSummary> {
  const emptyResult: SubscriptionSummary = {
    totalMonthly: 0,
    services: [],
    newThisMonth: [],
    cancelledThisMonth: [],
  };

  // Get active subscriptions
  let subs: Record<string, unknown>[] = [];
  try {
    const { data, error } = await client
      .from("subscriptions")
      .select("*")
      .eq("status", "active");

    if (error) {
      console.error("[db-client] Failed to get subscriptions:", error?.message);
      return emptyResult;
    }

    subs = data || [];
  } catch (err) {
    console.error("[db-client] Error fetching subscriptions:", err);
    return emptyResult;
  }

  // Calculate monthly total (convert yearly to monthly)
  let totalMonthly = 0;
  const services = subs.map((sub: Record<string, unknown>) => {
    let monthlyAmount = (sub.amount as number) || 0;

    if (sub.frequency === "yearly") {
      monthlyAmount = monthlyAmount / 12;
    }

    totalMonthly += monthlyAmount;

    return {
      name: sub.service_name as string,
      amount: sub.amount as number,
      currency: (sub.currency as string) || "USD",
      status: sub.status as string,
    };
  });

  // Get new subscriptions this month (separate try/catch so main result still works)
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  let newThisMonth: string[] = [];
  try {
    const { data: newSubs } = await client
      .from("subscriptions")
      .select("service_name")
      .gte("first_seen", startOfMonth.toISOString());

    newThisMonth = (newSubs || []).map(
      (s: Record<string, unknown>) => s.service_name as string,
    );
  } catch (err) {
    // Ignore - optional data
  }

  // Get cancelled this month (separate try/catch)
  let cancelledThisMonth: string[] = [];
  try {
    const { data: cancelledSubs } = await client
      .from("subscriptions")
      .select("service_name")
      .eq("status", "cancelled")
      .gte("created_at", startOfMonth.toISOString());

    cancelledThisMonth = (cancelledSubs || []).map(
      (s: Record<string, unknown>) => s.service_name as string,
    );
  } catch (err) {
    // Ignore - optional data
  }

  return {
    totalMonthly,
    services,
    newThisMonth,
    cancelledThisMonth,
  };
}

/**
 * Get recent emails for briefing
 *
 * @param client - Supabase client
 * @param hours - How many hours back to look (default 24)
 * @param minScore - Minimum score to include (default 0)
 * @returns Array of emails
 */
export async function getRecentEmails(
  client: SupabaseClient,
  hours: number = 24,
  minScore: number = 0,
): Promise<Email[]> {
  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    let query = client
      .from("emails")
      .select("*")
      .gte("received_at", since.toISOString());

    if (minScore > 0) {
      query = query.gte("score", minScore);
    }

    const { data, error } = await query.order("score", { ascending: false });

    if (error || !data) {
      console.error("[db-client] Failed to get recent emails:", error?.message);
      return [];
    }

    return data as Email[];
  } catch (err) {
    console.error("[db-client] Error getting recent emails:", err);
    return [];
  }
}

/**
 * Save scored email to database
 */
export async function saveEmail(
  client: SupabaseClient,
  email: Email,
): Promise<SafeResult> {
  return safeUpsert(client, "emails", email, "gmail_id");
}

/**
 * Track or update a subscription
 */
export async function trackSubscription(
  client: SupabaseClient,
  subscription: Subscription,
): Promise<SafeResult> {
  return safeUpsert(client, "subscriptions", subscription, "service_name");
}

/**
 * Record a payment
 */
export async function recordPayment(
  client: SupabaseClient,
  payment: Payment,
): Promise<SafeResult> {
  return safeInsert(client, "payments", payment);
}

/**
 * Mark email as notified
 */
export async function markNotified(
  client: SupabaseClient,
  emailId: string,
): Promise<SafeResult> {
  try {
    const { error } = await client
      .from("emails")
      .update({ notified: true })
      .eq("id", emailId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Get emails that need notification (score >= 10, not yet notified)
 */
export async function getUnnotifiedUrgentEmails(
  client: SupabaseClient,
): Promise<Email[]> {
  try {
    const { data, error } = await client
      .from("emails")
      .select("*")
      .gte("score", 10)
      .eq("notified", false)
      .order("received_at", { ascending: false });

    if (error || !data) {
      return [];
    }

    return data as Email[];
  } catch (err) {
    return [];
  }
}

/**
 * Get emails by target golem (based on category routing rules)
 * Since target_golem isn't stored in DB yet, we filter by category client-side.
 */
export async function getEmailsByGolem(
  client: SupabaseClient,
  golem: string,
  hours: number = 24,
): Promise<Email[]> {
  const categories = GOLEM_CATEGORIES[golem];
  if (!categories) return [];

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const { data, error } = await client
      .from("emails")
      .select("*")
      .gte("received_at", since.toISOString())
      .in("category", categories)
      .order("score", { ascending: false });

    if (error || !data) {
      if (error)
        console.error(
          "[db-client] Failed to get emails by golem:",
          error.message,
        );
      return [];
    }
    return data as Email[];
  } catch (err) {
    console.error("[db-client] Error getting emails by golem:", err);
    return [];
  }
}

/**
 * Get a single email by its ID (gmail_id or DB id)
 */
export async function getEmailById(
  client: SupabaseClient,
  emailId: string,
): Promise<Email | null> {
  try {
    const { data, error } = await client
      .from("emails")
      .select("*")
      .or(`gmail_id.eq.${emailId},id.eq.${emailId}`)
      .single();

    if (error || !data) return null;
    return data as Email;
  } catch {
    return null;
  }
}

// Default export for convenience
export default {
  createDbClient,
  safeInsert,
  safeUpsert,
  syncOfflineQueue,
  getSubscriptionSummary,
  getRecentEmails,
  saveEmail,
  trackSubscription,
  recordPayment,
  markNotified,
  getUnnotifiedUrgentEmails,
  getEmailsByGolem,
  getEmailById,
  loadLocalQueue,
  clearLocalQueue,
};

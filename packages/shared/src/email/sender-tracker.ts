/**
 * Email Sender Tracker
 *
 * Aggregates sender stats and tracks unsubscribe info.
 * Upserts into email_senders table after each email is processed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateLabel, createSenderFilter } from "./gmail-client";
import { logEvent } from "../lib/state-store";

/** Row shape returned by email_senders SELECT * queries */
export interface EmailSenderRow {
  email_address: string;
  display_name: string | null;
  category: string;
  total_emails: number;
  avg_score: number;
  last_email_at: string;
  unsubscribe_url: string | null;
  unsubscribe_email: string | null;
  unsubscribe_status: string | null;
  user_action: string | null;
  updated_at: string;
}

export interface SenderUpdate {
  email_address: string;
  display_name?: string;
  category: string;
  score: number;
  received_at: string;
  unsubscribe_url?: string;
  unsubscribe_email?: string;
}

/**
 * Parse List-Unsubscribe header (RFC 2369)
 * Format: <mailto:unsub@example.com>, <https://example.com/unsub>
 * Returns extracted URL and/or email
 */
export function parseListUnsubscribe(header: string | undefined): {
  url?: string;
  email?: string;
} {
  if (!header) return {};

  const result: { url?: string; email?: string } = {};

  // Extract all angle-bracket items
  const items = header.match(/<[^>]+>/g) || [];

  for (const item of items) {
    const value = item.slice(1, -1); // Remove < >
    if (value.startsWith("mailto:")) {
      result.email = value.replace("mailto:", "").split("?")[0];
    } else if (value.startsWith("http://") || value.startsWith("https://")) {
      result.url = value;
    }
  }

  return result;
}

/**
 * Determine sender category from email category
 */
export function senderCategoryFromEmail(emailCategory: string): string {
  switch (emailCategory) {
    case "promo":
      return "promo";
    case "newsletter":
      return "newsletter";
    case "job":
    case "interview":
      return "job";
    case "tech-update":
      return "tech";
    default:
      return "normal";
  }
}

/**
 * Upsert sender stats after processing an email.
 * Uses Supabase RPC-style upsert with running average.
 */
export async function trackSender(
  client: SupabaseClient,
  update: SenderUpdate,
): Promise<void> {
  const senderCategory = senderCategoryFromEmail(update.category);

  // First try to get existing sender for running average
  const { data: existing } = await client
    .from("email_senders")
    .select("total_emails, avg_score")
    .eq("email_address", update.email_address)
    .single();

  const prevTotal = existing?.total_emails ?? 0;
  const prevAvg = parseFloat(existing?.avg_score ?? "0");
  const newTotal = prevTotal + 1;
  const newAvg =
    prevTotal > 0
      ? ((prevAvg * prevTotal + update.score) / newTotal).toFixed(1)
      : update.score.toFixed(1);

  const record: Record<string, unknown> = {
    email_address: update.email_address,
    display_name: update.display_name || null,
    category: senderCategory,
    total_emails: newTotal,
    last_email_at: update.received_at,
    avg_score: parseFloat(newAvg),
    updated_at: new Date().toISOString(),
  };

  if (update.unsubscribe_url) {
    record.unsubscribe_url = update.unsubscribe_url;
  }
  if (update.unsubscribe_email) {
    record.unsubscribe_email = update.unsubscribe_email;
  }

  const { error } = await client
    .from("email_senders")
    .upsert(record, { onConflict: "email_address" });

  if (error) {
    console.error(
      `[SenderTracker] Failed to track ${update.email_address}:`,
      error.message,
    );
  }
}

/**
 * Get senders, optionally filtered by category or action
 */
export async function getSenders(
  client: SupabaseClient,
  options: {
    category?: string;
    userAction?: string | null;
    limit?: number;
    orderBy?: string;
  } = {},
): Promise<EmailSenderRow[]> {
  const {
    category,
    userAction,
    limit = 50,
    orderBy = "total_emails",
  } = options;

  let query = client
    .from("email_senders")
    .select("*")
    .order(orderBy, { ascending: false })
    .limit(limit);

  if (category) {
    query = query.eq("category", category);
  }

  if (userAction === null) {
    query = query.is("user_action", null);
  } else if (userAction) {
    query = query.eq("user_action", userAction);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[SenderTracker] Failed to get senders:", error.message);
    return [];
  }

  return (data as EmailSenderRow[]) || [];
}

/**
 * Apply Gmail filter to auto-label + skip inbox for unsubscribed/blocked senders.
 */
async function applyGmailFilter(emailAddress: string): Promise<void> {
  try {
    const labelId = await getOrCreateLabel("Golems/Unsubscribed");
    await createSenderFilter(emailAddress, labelId);
    console.log(`[SenderTracker] Gmail filter created for ${emailAddress}`);
  } catch (err: unknown) {
    console.error(
      `[SenderTracker] Gmail filter failed for ${emailAddress}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Set user action on a sender (keep/unsubscribe/block)
 */
export async function setSenderAction(
  client: SupabaseClient,
  emailAddress: string,
  action: "keep" | "unsubscribe" | "block",
): Promise<boolean> {
  const { error } = await client
    .from("email_senders")
    .update({
      user_action: action,
      updated_at: new Date().toISOString(),
    })
    .eq("email_address", emailAddress);

  if (error) {
    console.error(
      `[SenderTracker] Failed to set action for ${emailAddress}:`,
      error.message,
    );
    return false;
  }

  // Apply Gmail filter for unsubscribe/block actions
  if (action === "unsubscribe" || action === "block") {
    await applyGmailFilter(emailAddress);
  }

  return true;
}

/**
 * Attempt automated unsubscribe via List-Unsubscribe URL.
 * RFC 8058: POST to the URL with List-Unsubscribe=One-Click-Unsubscribe
 */
export async function attemptUnsubscribe(
  client: SupabaseClient,
  emailAddress: string,
): Promise<{ success: boolean; method: string; error?: string }> {
  // Get sender's unsubscribe info
  const { data: sender, error: fetchError } = await client
    .from("email_senders")
    .select("unsubscribe_url, unsubscribe_email")
    .eq("email_address", emailAddress)
    .single();

  if (fetchError || !sender) {
    return { success: false, method: "none", error: "Sender not found" };
  }

  // Try HTTP unsubscribe first (RFC 8058 one-click)
  if (sender.unsubscribe_url) {
    try {
      const response = await fetch(sender.unsubscribe_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "List-Unsubscribe=One-Click-Unsubscribe",
        redirect: "follow",
      });

      if (response.ok) {
        await client
          .from("email_senders")
          .update({
            unsubscribe_status: "requested",
            user_action: "unsubscribe",
            updated_at: new Date().toISOString(),
          })
          .eq("email_address", emailAddress);

        await applyGmailFilter(emailAddress);
        await logEvent(
          "email_unsubscribe_attempt",
          {
            sender: emailAddress,
            method: "http_post",
            success: true,
            gmail_filter: true,
          },
          "emailgolem",
        );
        return { success: true, method: "http-post" };
      }

      // If POST fails, try GET (some older services use GET links)
      const getResponse = await fetch(sender.unsubscribe_url, {
        method: "GET",
        redirect: "follow",
      });

      if (getResponse.ok) {
        await client
          .from("email_senders")
          .update({
            unsubscribe_status: "requested",
            user_action: "unsubscribe",
            updated_at: new Date().toISOString(),
          })
          .eq("email_address", emailAddress);

        await applyGmailFilter(emailAddress);
        await logEvent(
          "email_unsubscribe_attempt",
          {
            sender: emailAddress,
            method: "http_get",
            success: true,
            gmail_filter: true,
          },
          "emailgolem",
        );
        return { success: true, method: "http-get" };
      }

      await logEvent(
        "email_unsubscribe_attempt",
        {
          sender: emailAddress,
          method: "http",
          success: false,
          error: `HTTP ${response.status}`,
        },
        "emailgolem",
      );
      return {
        success: false,
        method: "http",
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await logEvent(
        "email_unsubscribe_attempt",
        {
          sender: emailAddress,
          method: "http",
          success: false,
          error: errMsg,
        },
        "emailgolem",
      );
      return {
        success: false,
        method: "http",
        error: errMsg,
      };
    }
  }

  // If only mailto: available, mark for manual action but still filter in Gmail
  if (sender.unsubscribe_email) {
    await client
      .from("email_senders")
      .update({
        unsubscribe_status: "requested",
        user_action: "unsubscribe",
        updated_at: new Date().toISOString(),
      })
      .eq("email_address", emailAddress);

    await applyGmailFilter(emailAddress);
    await logEvent(
      "email_unsubscribe_attempt",
      {
        sender: emailAddress,
        method: "mailto",
        success: false,
        gmail_filter: true,
        unsubscribe_email: sender.unsubscribe_email,
      },
      "emailgolem",
    );

    return {
      success: false,
      method: "mailto",
      error: `Manual: send email to ${sender.unsubscribe_email}`,
    };
  }

  await logEvent(
    "email_unsubscribe_attempt",
    { sender: emailAddress, method: "none", success: false },
    "emailgolem",
  );
  return {
    success: false,
    method: "none",
    error: "No unsubscribe mechanism available",
  };
}

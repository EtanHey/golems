#!/usr/bin/env bun
/**
 * EmailGolem - Smart Email Triage
 *
 * Main entry point. Runs every 10 minutes via launchd.
 *
 * Flow:
 * 1. Sync offline queue (if any)
 * 2. Fetch new emails from Gmail
 * 3. Score each email with Ollama
 * 4. Save to Supabase
 * 5. Notify immediately if score >= 10
 * 6. Track subscriptions for monthly digest
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  fetchRecentEmails,
  fetchEmailsSince,
  searchEmails,
  getEmailBodyText,
  type GmailEmail,
} from "./gmail-client";
import {
  scoreEmail,
  shouldNotifyImmediately,
  shouldTrackSubscription,
  type ScoredEmail,
  type EmailInput,
} from "./scorer";
import {
  createDbClient,
  saveEmail,
  trackSubscription,
  recordPayment,
  markNotified,
  syncOfflineQueue,
  type Email,
  type Subscription,
} from "./db-client";
import { determineTargetGolem } from "./router";
import { trackSender, parseListUnsubscribe } from "./sender-tracker";
import { logEvent } from "../lib/event-log";
import { sendNotification as sendTelegramNotification } from "../lib/telegram-direct";
import { getState, setState, reportServiceRun } from "../lib/state-store";
import type { SupabaseClient } from "@supabase/supabase-js";

// Configuration
const HOME = process.env.HOME || homedir();
const STATE_FILE = join(HOME, ".golems-zikaron/state.json");

// Category emojis for notifications
const CATEGORY_EMOJIS: Record<string, string> = {
  interview: "📅",
  urgent: "🚨",
  job: "💼",
  subscription: "💳",
  newsletter: "📰",
  promo: "🏷️",
  other: "📧",
};

// State interface
interface State {
  nightShiftTarget?: string;
  rotation?: string[];
  telegramChatId?: number | null;
  lastEmailCheck?: string;
  processedEmailIds?: string[];
}

async function loadStateAsync(): Promise<State> {
  // Try state-store first (works with both file and supabase backends)
  try {
    const lastEmailCheck = await getState<string>("lastEmailCheck");
    const processedEmailIds = await getState<string[]>("processedEmailIds");
    if (lastEmailCheck !== null) {
      return { lastEmailCheck, processedEmailIds: processedEmailIds || [] };
    }
  } catch {
    // Fall through to file
  }

  // Fallback to direct file read
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[EmailGolem] Failed to load state:", err);
  }
  return {};
}

// Legacy sync version for backward compat
function loadState(): State {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[EmailGolem] Failed to load state:", err);
  }
  return {};
}

async function saveStateAsync(state: Partial<State>) {
  // Write to state-store (handles both file and supabase)
  try {
    if (state.lastEmailCheck) {
      await setState("lastEmailCheck", state.lastEmailCheck);
    }
    if (state.processedEmailIds) {
      await setState("processedEmailIds", state.processedEmailIds);
    }
  } catch (err) {
    console.error("[EmailGolem] Failed to save state via state-store:", err);
  }

  // Also write to local file for backward compat (if file backend)
  try {
    const existing = loadState();
    const merged = { ...existing, ...state };
    writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2));
  } catch (err) {
    // In Supabase-backed runs there may be no local state file — that's fine
    if (process.env.STATE_BACKEND !== "supabase") {
      console.error("[EmailGolem] Failed to save local state:", err);
    }
  }
}

function saveState(state: State) {
  try {
    const existing = loadState();
    const merged = { ...existing, ...state };
    writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2));
  } catch (err) {
    console.error("[EmailGolem] Failed to save state:", err);
  }
}

/**
 * Send notification to Telegram via telegram-direct (supports both local and cloud modes)
 */
async function sendNotification(title: string, body: string) {
  console.log(`[EmailGolem] Sending notification: "${title}"`);
  const success = await sendTelegramNotification({
    title,
    body,
    source: "email",
    priority: "high",
  });
  if (success) {
    console.log(`[EmailGolem] Notification sent: "${title}"`);
  } else {
    console.error("[EmailGolem] Failed to send notification");
  }
}

/**
 * Convert GmailEmail to EmailInput for scorer
 */
function toEmailInput(gmail: GmailEmail, body?: string): EmailInput {
  return {
    id: gmail.id,
    subject: gmail.subject,
    from: gmail.from,
    snippet: gmail.snippet,
    body,
    receivedAt: gmail.receivedAt.toISOString(),
  };
}

/**
 * Convert ScoredEmail to DB Email format
 */
function toDbEmail(scored: ScoredEmail): Email {
  return {
    gmail_id: scored.id,
    subject: scored.subject,
    from_address: scored.from,
    snippet: scored.snippet,
    score: scored.score,
    category: scored.category,
    received_at: new Date(scored.receivedAt),
    scored_at: new Date(scored.scoredAt),
    notified: false,
  };
}

/**
 * Process a single email: score, save, notify if urgent
 */
async function processEmail(
  gmail: GmailEmail,
  db: SupabaseClient | null,
  dryRun: boolean,
): Promise<ScoredEmail> {
  // Fetch email body for better scoring accuracy (catches rejection vs interview, etc.)
  let bodyText: string | undefined;
  try {
    bodyText = await getEmailBodyText(gmail.id, 1000);
  } catch (err) {
    console.log(
      `  ⚠️  Could not fetch body for ${gmail.id} — scoring with subject+snippet only`,
      (err as Error).message,
    );
  }

  const input = toEmailInput(gmail, bodyText);
  console.log(`  📧 Scoring: ${input.subject.slice(0, 50)}...`);

  const scored = await scoreEmail(input);
  const routing = determineTargetGolem(scored.category, scored.score);
  console.log(
    `     Score: ${scored.score}/10 (${scored.category}) → ${routing.targetGolem}`,
  );

  if (dryRun) {
    console.log(`     [DRY-RUN] Would save to DB`);
    if (shouldNotifyImmediately(scored)) {
      console.log(`     [DRY-RUN] Would notify: ${scored.subject}`);
    }
    if (shouldTrackSubscription(scored)) {
      console.log(
        `     [DRY-RUN] Would track subscription: ${scored.subscription?.serviceName}`,
      );
    }
    return scored;
  }

  // Save to database
  if (db) {
    const dbEmail = toDbEmail(scored);
    const saveResult = await saveEmail(db, dbEmail);

    if (!saveResult.success) {
      console.log(`     Queued for later sync`);
    }

    // Track sender stats + unsubscribe info (fault-tolerant, won't fail pipeline)
    try {
      const unsubInfo = parseListUnsubscribe(gmail.listUnsubscribe);
      await trackSender(db, {
        email_address: scored.from,
        display_name: gmail.fromName,
        category: scored.category,
        score: scored.score,
        received_at: scored.receivedAt,
        unsubscribe_url: unsubInfo.url,
        unsubscribe_email: unsubInfo.email,
      });
    } catch (err) {
      console.error("[SenderTracker] Failed:", err);
    }

    // Log routing event (non-blocking, don't fail the pipeline)
    if (routing.targetGolem !== "emailgolem") {
      try {
        await logEvent(
          "email_routed",
          {
            subject: scored.subject,
            category: scored.category,
            score: scored.score,
            targetGolem: routing.targetGolem,
            reason: routing.reason,
          },
          "emailgolem",
        );
      } catch (err) {
        console.error("[EventLog] Failed to log email routing:", err);
      }
    }

    // Notify if urgent - with context!
    if (shouldNotifyImmediately(scored)) {
      const emoji = CATEGORY_EMOJIS[scored.category] || "📧";
      const title = `${emoji} ${scored.category.charAt(0).toUpperCase() + scored.category.slice(1)}`;

      // Build descriptive body with WHY this matters
      const fromName = scored.from.split("<")[0].trim() || scored.from;
      const lines = [
        `*From:* ${fromName}`,
        `*Subject:* ${scored.subject.slice(0, 80)}`,
        ``,
        `*Why:* ${scored.reason}`,
      ];
      const body = lines.join("\n");

      await sendNotification(title, body);
      console.log(`     🔔 Notification sent!`);

      // Mark as notified
      if (saveResult.data?.id) {
        await markNotified(db, saveResult.data.id);
      }
    }

    // Track subscription
    if (shouldTrackSubscription(scored) && scored.subscription) {
      const sub: Subscription = {
        service_name: scored.subscription.serviceName,
        amount: scored.subscription.amount,
        currency: "USD",
        frequency:
          scored.subscription.frequency === "unknown"
            ? null
            : scored.subscription.frequency,
        status: "active",
        last_payment: new Date(),
      };

      await trackSubscription(db, sub);
      console.log(`     💳 Subscription tracked: ${sub.service_name}`);

      // Record payment if amount is known
      if (scored.subscription.amount) {
        await recordPayment(db, {
          subscription_id: null, // Will be linked by service_name
          email_id: null,
          amount: scored.subscription.amount,
          currency: "USD",
          paid_at: new Date(),
        });
      }
    }
  }

  return scored;
}

/**
 * Main processing loop
 */
async function processEmails(
  options: { dryRun?: boolean; maxEmails?: number } = {},
) {
  const { dryRun = false, maxEmails = 20 } = options;

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`\n[${timestamp}] 📧 EmailGolem - Starting...\n`);

  if (dryRun) {
    console.log("⚠️  DRY-RUN MODE - No changes will be made\n");
  }

  // Load state (uses state-store: Supabase or local file)
  const state = await loadStateAsync();
  const processedIds = new Set(state.processedEmailIds || []);

  // Initialize DB client (may fail if offline)
  let db: SupabaseClient | null = null;
  try {
    db = createDbClient();
    console.log("✓ Supabase connected");

    // Sync any offline queue items first
    if (!dryRun) {
      const syncResult = await syncOfflineQueue(db);
      if (syncResult.synced > 0) {
        console.log(`✓ Synced ${syncResult.synced} queued items`);
      }
    }
  } catch (err) {
    console.log("⚠️  Supabase unavailable - will queue locally");
  }

  // Fetch emails
  let emails: GmailEmail[] = [];
  try {
    if (state.lastEmailCheck) {
      console.log(`\nFetching emails since ${state.lastEmailCheck}...`);
      const since = new Date(state.lastEmailCheck);
      emails = await fetchEmailsSince(since, maxEmails);
    } else {
      console.log(`\nFetching ${maxEmails} recent emails...`);
      emails = await fetchRecentEmails(maxEmails);
    }
    console.log(`✓ Found ${emails.length} emails`);
  } catch (err: unknown) {
    console.error(
      "❌ Gmail fetch failed:",
      err instanceof Error ? err.message : String(err),
    );
    // Still report that service ran (even on failure) so dashboard shows activity
    if (!dryRun) await reportServiceRun("lastEmailCheck");
    return;
  }

  // Filter out already-processed emails
  const newEmails = emails.filter((e) => !processedIds.has(e.id));
  console.log(`✓ ${newEmails.length} new emails to process\n`);

  if (newEmails.length === 0) {
    console.log("No new emails. Done.");
    // Report service ran even with no new emails
    if (!dryRun) await reportServiceRun("lastEmailCheck");
    return;
  }

  // Process each email
  const results: ScoredEmail[] = [];
  for (const email of newEmails) {
    const scored = await processEmail(email, db, dryRun);
    results.push(scored);
    processedIds.add(email.id);

    // Small delay between Ollama calls
    await new Promise((r) => setTimeout(r, 300));
  }

  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━");
  console.log("Summary:");

  const urgent = results.filter((r) => r.score >= 10);
  const briefing = results.filter((r) => r.score >= 7 && r.score < 10);
  const subscriptions = results.filter((r) => r.category === "subscription");
  const ignored = results.filter((r) => r.score < 5);

  console.log(`  🚨 Urgent: ${urgent.length}`);
  console.log(`  💼 For briefing: ${briefing.length}`);
  console.log(`  💳 Subscriptions: ${subscriptions.length}`);
  console.log(`  📭 Ignored: ${ignored.length}`);

  // Update state (writes to both state-store and local file)
  if (!dryRun) {
    await saveStateAsync({
      lastEmailCheck: new Date().toISOString(),
      processedEmailIds: Array.from(processedIds).slice(-500), // Keep last 500 IDs
    });
    // Report run to dashboard (always writes to Supabase)
    await reportServiceRun("lastEmailCheck");
    console.log("\n✓ State saved");
  }

  const endTime = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`\n[${endTime}] 📧 EmailGolem - Done!\n`);
}

/**
 * Search emails and display results
 */
async function runSearch(query: string, maxResults: number) {
  console.log(`\n🔍 Searching: "${query}" (max ${maxResults})\n`);

  try {
    const results = await searchEmails(query, maxResults);

    if (results.length === 0) {
      console.log("No emails found.");
      return;
    }

    console.log(`Found ${results.length} emails:\n`);

    for (const email of results) {
      const date = email.receivedAt.toISOString().split("T")[0];
      const from = email.fromName || email.from;
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📅 ${date} | From: ${from}`);
      console.log(`📧 ${email.subject}`);
      console.log(`   ${email.snippet.slice(0, 100)}...`);
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Total: ${results.length} emails`);
  } catch (err: unknown) {
    console.error(
      "❌ Search failed:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

/** Standard status interface for dashboard/Telegram */
export async function getStatus(): Promise<
  import("../lib/shared-types").GolemStatus
> {
  const lastRun = await getState<string>("lastEmailCheck");
  const summary = lastRun
    ? `Last check: ${new Date(lastRun).toLocaleString()}`
    : "Never run";
  return { name: "EmailGolem", healthy: !!lastRun, lastRun, summary };
}

/**
 * CLI
 */
async function main() {
  const args = process.argv.slice(2);

  // Handle search subcommand
  if (args[0] === "search") {
    const query = args
      .slice(1)
      .filter((a) => !a.startsWith("--"))
      .join(" ");
    const maxArg = args.find((a) => a.startsWith("--max="));
    const maxResults = maxArg ? parseInt(maxArg.split("=")[1], 10) : 20;

    if (!query) {
      console.log(`
Usage: bun run src/email-golem/index.ts search <query> [--max=N]

Examples:
  bun run src/email-golem/index.ts search "from:united.com confirmation"
  bun run src/email-golem/index.ts search "from:britishairways.com" --max=10
  bun run src/email-golem/index.ts search "subject:receipt after:2025/01/01"
  bun run src/email-golem/index.ts search "anthropic OR firecrawl"
`);
      process.exit(1);
    }

    await runSearch(query, maxResults);
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const maxEmailsArg = args.find((a) => a.startsWith("--max="));
  const maxEmails = maxEmailsArg
    ? parseInt(maxEmailsArg.split("=")[1], 10)
    : 20;

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
EmailGolem - Smart Email Triage

Usage:
  bun run src/email-golem/index.ts [options]
  bun run src/email-golem/index.ts search <query> [--max=N]

Commands:
  search <query>   Search emails using Gmail query syntax

Options:
  --dry-run, -n    Don't save to DB or send notifications
  --max=N          Maximum emails to fetch (default: 20)
  --help, -h       Show this help

Examples:
  bun run src/email-golem/index.ts --dry-run
  bun run src/email-golem/index.ts --max=50
  bun run src/email-golem/index.ts search "from:united.com"
  bun run src/email-golem/index.ts search "subject:receipt" --max=10
`);
    process.exit(0);
  }

  try {
    await processEmails({ dryRun, maxEmails });
    process.exit(0);
  } catch (err) {
    console.error("❌ EmailGolem failed:", err);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

// Exports for testing and briefing integration
export { processEmails, loadState, saveState, CATEGORY_EMOJIS, runSearch };
export { searchEmails } from "./gmail-client";

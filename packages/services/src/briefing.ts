#!/usr/bin/env bun
/**
 * Morning Briefing - 8 AM summary of overnight work
 *
 * Compiles:
 * - 24h Email digest (urgent, job updates, payments)
 * - Monthly subscription summary (on 1st of month)
 * - Soltome activity (posts, credits)
 * - Draft posts ready for approval
 */

import "@golems/shared/lib/load-env"; // MUST be first — loads .env for credentials

import { sendNotification } from "@golems/shared/lib/telegram-direct";
import {
  createDbClient,
  getRecentEmails,
  getSubscriptionSummary,
} from "@golems/shared/email/db-client";
import type { Email, SubscriptionSummary } from "@golems/shared/email/types";

import { generateMonthlyReport } from "@golems/teller/report";
import { reportServiceRun } from "@golems/shared/lib/state-store";
import {
  getTodayEvents,
  getEcosystemStatus,
  generateDailyPlan,
  formatPlanForTelegram,
} from "@golems/coach/index";


/**
 * Fetch 24h email digest from Supabase
 */
async function getEmailDigest(): Promise<{
  urgent: Email[];
  job: Email[];
  payments: Email[];
  total: number;
} | null> {
  try {
    const db = createDbClient();
    const emails = await getRecentEmails(db, 24, 5); // Last 24h, score >= 5

    const urgent = emails.filter((e) => (e.score ?? 0) >= 10);
    const job = emails.filter(
      (e) => e.category === "job" && (e.score ?? 0) >= 7 && (e.score ?? 0) < 10
    );
    const payments = emails.filter((e) => e.category === "subscription");

    return {
      urgent,
      job,
      payments,
      total: emails.length,
    };
  } catch (err) {
    console.log("[Briefing] Could not fetch email digest:", err);
    return null;
  }
}

/**
 * Format email digest section for Telegram
 */
function formatEmailDigest(digest: {
  urgent: Email[];
  job: Email[];
  payments: Email[];
  total: number;
}): string {
  let msg = "📧 *Emails (24h)*\n\n";

  if (digest.urgent.length > 0) {
    msg += "🔴 *Urgent* (already notified):\n";
    for (const e of digest.urgent.slice(0, 3)) {
      msg += `   → ${e.subject?.slice(0, 40) || "No subject"}...\n`;
    }
    msg += "\n";
  }

  if (digest.job.length > 0) {
    msg += "💼 *Job Updates:*\n";
    for (const e of digest.job.slice(0, 3)) {
      msg += `   → ${e.subject?.slice(0, 40) || "No subject"}\n`;
    }
    msg += "\n";
  }

  if (digest.payments.length > 0) {
    msg += "💳 *Payments:*\n";
    for (const e of digest.payments.slice(0, 3)) {
      msg += `   → ${e.subject?.slice(0, 40) || "No subject"}\n`;
    }
    msg += "\n";
  }

  // Summary line
  const parts = [];
  if (digest.job.length > 0) parts.push(`${digest.job.length} job updates`);
  if (digest.urgent.length > 0) parts.push(`${digest.urgent.length} alerts`);
  if (digest.payments.length > 0) parts.push(`${digest.payments.length} payments`);

  if (parts.length > 0) {
    msg += `_${parts.join(" • ")}_\n`;
  } else {
    msg += "_No notable emails_\n";
  }

  return msg;
}

/**
 * Format subscription summary for Telegram (monthly)
 */
function formatSubscriptionSummary(summary: SubscriptionSummary): string {
  const now = new Date();
  const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  let msg = `💳 *Subscriptions Report - ${monthName}*\n\n`;

  if (summary.services.length > 0) {
    msg += "*Active Services:*\n";
    for (const svc of summary.services) {
      const amount = svc.amount ? `$${svc.amount.toFixed(2)}` : "???";
      msg += `   → ${svc.name}: ${amount}\n`;
    }
    msg += `\n*Total:* \`$${summary.totalMonthly.toFixed(2)}/month\`\n`;
  } else {
    msg += "No tracked subscriptions\n";
  }

  if (summary.newThisMonth.length > 0) {
    msg += "\n*Changes this month:*\n";
    for (const name of summary.newThisMonth) {
      msg += `✅ Added: ${name}\n`;
    }
  }

  if (summary.cancelledThisMonth.length > 0) {
    for (const name of summary.cancelledThisMonth) {
      msg += `❌ Cancelled: ${name}\n`;
    }
  }

  return msg;
}

/**
 * Format TellerGolem spending section for Telegram (current month)
 */
async function formatTellerSummary(): Promise<string | null> {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const report = await generateMonthlyReport(currentMonth);

    if (report.totalSpend === 0) {
      return null;
    }

    let msg = `💰 *Spending - ${currentMonth}*\n`;
    msg += `Total: $${report.totalSpend.toFixed(2)}\n`;

    // Top 3 vendors by spend
    const vendors = Object.entries(report.byVendor)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    if (vendors.length > 0) {
      msg += "\n*Top Vendors:*\n";
      for (const [vendor, amount] of vendors) {
        msg += `   → ${vendor}: $${amount.toFixed(2)}\n`;
      }
    }

    return msg;
  } catch (err) {
    console.log("[Briefing] Could not fetch TellerGolem summary:", err);
    return null;
  }
}

/**
 * Check if today is the 1st of the month
 */
function isFirstOfMonth(): boolean {
  return new Date().getDate() === 1;
}

async function sendBriefing() {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] ☀️ Generating morning briefing...\n`);

  // Build briefing - concise and useful
  let msg = `☀️ *Morning Briefing*\n\n`;

  const separator = "━━━━━━━━━━━━━━━━━━━━━\n\n";

  // TellerGolem Spending Section (current month)
  const tellerSummary = await formatTellerSummary();
  if (tellerSummary) {
    msg += tellerSummary;
    msg += "\n" + separator;
  }

  // Email Digest Section (24h)
  const emailDigest = await getEmailDigest();
  if (emailDigest && emailDigest.total > 0) {
    msg += formatEmailDigest(emailDigest);
    msg += "\n" + separator;
  }

  // Monthly Subscription Summary (on 1st of month)
  if (isFirstOfMonth()) {
    try {
      const db = createDbClient();
      const subSummary = await getSubscriptionSummary(db);
      if (subSummary.services.length > 0) {
        msg += formatSubscriptionSummary(subSummary);
        msg += "\n" + separator;
      }
    } catch (err) {
      console.log("[Briefing] Could not fetch subscription summary:", err);
    }
  }

  // CoachGolem Daily Plan Section
  try {
    const [events, statuses] = await Promise.all([
      getTodayEvents().catch(() => []),
      getEcosystemStatus(),
    ]);
    const plan = generateDailyPlan(events, statuses);
    const planMsg = formatPlanForTelegram(plan);
    if (planMsg) {
      msg += "🗓 *Daily Plan*\n" + planMsg + "\n" + separator;
    }
  } catch (err) {
    console.log("[Briefing] Could not generate daily plan:", err);
  }

  // Send via telegram-direct (works in hosted and local runtimes)
  const sent = await sendNotification({
    title: "Morning Briefing",
    body: msg,
    source: "briefing",
  });
  const endTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${endTime}] ${sent ? "✅" : "❌"} Briefing ${sent ? "sent" : "FAILED to send"}!\n`);
  console.log(msg);

  // Report run to dashboard
  await reportServiceRun("lastBriefing");

}

// CLI
if (import.meta.main) {
  sendBriefing()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Briefing failed:", err);
      process.exit(1);
    });
}

export { sendBriefing };

#!/usr/bin/env bun
/**
 * Morning Briefing - 8 AM summary of overnight work
 *
 * Compiles:
 * - Soltome activity (posts, credits)
 * - Draft posts ready for approval
 */

import "@golems/shared/lib/load-env"; // MUST be first — loads .env for credentials

import { generateMonthlyReport } from "@golems/teller/report";
import {
  getTodayEvents,
  getEcosystemStatus,
  generateDailyPlan,
  formatPlanText,
} from "@golems/coach/index";


/**
 * Format TellerGolem spending section as text (current month)
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

  // CoachGolem Daily Plan Section
  try {
    const [events, statuses] = await Promise.all([
      getTodayEvents().catch(() => []),
      getEcosystemStatus(),
    ]);
    const plan = generateDailyPlan(events, statuses);
    const planMsg = formatPlanText(plan);
    if (planMsg) {
      msg += "🗓 *Daily Plan*\n" + planMsg + "\n" + separator;
    }
  } catch (err) {
    console.log("[Briefing] Could not generate daily plan:", err);
  }

  console.log("[Briefing] Summary generated\n");
  console.log(msg);


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

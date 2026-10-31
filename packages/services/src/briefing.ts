#!/usr/bin/env bun
/**
 * Morning Briefing - 8 AM summary of overnight work
 *
 * Compiles:
 * - Soltome activity (posts, credits)
 * - Draft posts ready for approval
 */

import "@golems/shared/lib/load-env"; // MUST be first — loads .env for credentials

import {
  getTodayEvents,
  getEcosystemStatus,
  generateDailyPlan,
  formatPlanText,
} from "@golems/coach/index";

async function sendBriefing() {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] ☀️ Generating morning briefing...\n`);

  // Build briefing - concise and useful
  let msg = `☀️ *Morning Briefing*\n\n`;

  const separator = "━━━━━━━━━━━━━━━━━━━━━\n\n";

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

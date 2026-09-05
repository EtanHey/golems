/**
 * Nudger for CoachGolem
 *
 * Sends morning plan and evening wrap-up to Telegram.
 */

import { sendNotification } from "@golems/shared/lib/telegram-direct";
import { formatPlanForTelegram } from "./schedule-engine";
import type { DailyPlan } from "./schedule-engine";

/**
 * Send the morning plan nudge to Telegram.
 */
export async function sendMorningNudge(plan: DailyPlan): Promise<void> {
  const message = formatPlanForTelegram(plan);
  await sendNotification({
    title: "CoachGolem",
    body: message,
  });
}

/**
 * Send evening wrap-up — what got done vs. what was planned.
 */
export async function sendEveningWrapup(
  planned: number,
  completed: number,
  missed: string[]
): Promise<void> {
  const lines: string[] = [];
  lines.push("Evening wrap-up");
  lines.push("");
  lines.push(`Completed: ${completed}/${planned}`);
  if (missed.length > 0) {
    lines.push("");
    lines.push("Missed:");
    for (const item of missed) {
      lines.push(`  - ${item}`);
    }
  }

  await sendNotification({
    title: "CoachGolem",
    body: lines.join("\n"),
  });
}

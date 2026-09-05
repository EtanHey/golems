/**
 * Morning Briefing Runner — Entry point for the proactive coach morning briefing.
 *
 * Gathers data from Calendar, Email, and the golem ecosystem.
 * Outputs to Telegram (background mode) or returns voice text (foreground mode).
 *
 * Dependency injection via BriefingDeps allows testing without real API calls.
 * Production deps are created by defaultDeps().
 */

import { getTodayEvents } from "./calendar-client";
import { getEcosystemStatus } from "./status-aggregator";
import { sendNotification } from "@golems/shared/lib/telegram-direct";
import { reportServiceRun } from "@golems/shared/lib/state-store";
import {
  createDbClient,
  getRecentEmails,
} from "@golems/shared/email/db-client";
import {
  synthesizeBriefing,
  formatForTelegram,
  formatForVoice,
  type MorningBriefingData,
  type MorningBriefing,
} from "./morning-briefing";
import type { CalendarEvent } from "./calendar-client";
import type { EcosystemStatus } from "./status-aggregator";
import type { Email } from "@golems/shared/email/types";

// --- Types ---

export interface BriefingDeps {
  getCalendarEvents: () => Promise<CalendarEvent[]>;
  getEmails: () => Promise<Email[]>;
  getEcosystem: () => Promise<EcosystemStatus>;
  sendTelegram: (opts: {
    title: string;
    body: string;
    source: string;
  }) => Promise<boolean>;
  reportRun: (key: string) => Promise<void>;
}

export interface BriefingOptions {
  mode: "telegram" | "voice";
  deps?: BriefingDeps;
}

export interface BriefingResult {
  success: boolean;
  channel: "telegram" | "voice";
  briefing: MorningBriefing | null;
  voiceText?: string;
  error?: string;
}

// --- Default Dependencies (production) ---

function defaultDeps(): BriefingDeps {
  return {
    getCalendarEvents: getTodayEvents,
    getEmails: async () => {
      const db = createDbClient();
      return getRecentEmails(db, 24, 5);
    },
    getEcosystem: getEcosystemStatus,
    sendTelegram: (opts) => sendNotification(opts),
    reportRun: (key) => reportServiceRun(key),
  };
}

// --- Runner ---

/**
 * Run the morning briefing.
 * Fetches all data concurrently, synthesizes, and outputs to the chosen channel.
 */
export async function runMorningBriefing(
  options: BriefingOptions,
): Promise<BriefingResult> {
  const { mode, deps = defaultDeps() } = options;

  // Gather all data concurrently — each source can fail independently
  const [calendar, emails, ecosystem] = await Promise.all([
    deps.getCalendarEvents().catch(() => [] as CalendarEvent[]),
    deps.getEmails().catch(() => null),
    deps.getEcosystem().catch(
      () =>
        ({
          timestamp: new Date().toISOString(),
          golems: [],
          healthy: 0,
          unhealthy: 0,
          summary: "Status unavailable",
        }) as EcosystemStatus,
    ),
  ]);

  // Synthesize
  const data: MorningBriefingData = {
    calendar,
    emails,
    ecosystem,
  };
  const briefing = synthesizeBriefing(data);

  // Output based on mode
  if (mode === "voice") {
    const voiceText = formatForVoice(briefing);
    await deps.reportRun("lastMorningBriefing");
    return { success: true, channel: "voice", briefing, voiceText };
  }

  // Telegram mode
  const telegramText = formatForTelegram(briefing);
  const sent = await deps.sendTelegram({
    title: "Morning Briefing",
    body: telegramText,
    source: "morning-briefing",
  });

  await deps.reportRun("lastMorningBriefing");

  if (!sent) {
    return {
      success: false,
      channel: "telegram",
      briefing,
      error: "Failed to send Telegram notification",
    };
  }

  return { success: true, channel: "telegram", briefing };
}

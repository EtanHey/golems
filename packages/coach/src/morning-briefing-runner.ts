/**
 * Morning Briefing Runner — Entry point for the proactive coach morning briefing.
 *
 * Gathers data from Calendar, Email, and the golem ecosystem.
 * Returns voice text only when explicitly requested.
 *
 * Dependency injection via BriefingDeps allows testing without real API calls.
 * Production deps are created by defaultDeps().
 */

import { getTodayEvents } from "./calendar-client";
import { getEcosystemStatus } from "./status-aggregator";
import { reportServiceRun } from "@golems/shared/lib/state-store";
import {
  createDbClient,
  getRecentEmails,
} from "@golems/shared/email/db-client";
import {
  synthesizeBriefing,
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
  reportRun: (key: string) => Promise<void>;
}

export interface BriefingOptions {
  mode: "voice";
  deps?: BriefingDeps;
}

export interface BriefingResult {
  success: boolean;
  channel: "voice";
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
  if (options.mode !== "voice") throw new Error("Morning briefing requires explicit voice mode");
  const { deps = defaultDeps() } = options;

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

  const voiceText = formatForVoice(briefing);
  await deps.reportRun("lastMorningBriefing");
  return { success: true, channel: "voice", briefing, voiceText };
}

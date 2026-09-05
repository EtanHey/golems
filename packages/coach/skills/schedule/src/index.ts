#!/usr/bin/env bun
/**
 * Schedule Skill Context Loader
 *
 * Called by run.sh to output current time context + today's events.
 * This gives Claude full awareness before any scheduling action.
 */

import "@golems/shared/lib/load-env";
import {
  getTimeContext,
  formatTimeContext,
} from "../../../src/schedule-engine";
import { loadProtocol } from "../../../src/protocol";
import { getEvents } from "../../../src/calendar-client";

const protocol = loadProtocol();
const ctx = getTimeContext(protocol);

// Time context
console.log(formatTimeContext(ctx));

// Phase-appropriate suggestion
const suggestions: Record<string, string> = {
  sleep: "You should be sleeping.",
  waking: "Just woke up — sunlight, hydrate, light movement.",
  "cortisol-peak": "NO caffeine yet. Morning routine time.",
  "peak-focus": "Peak focus window — schedule deep work NOW.",
  "sustained-work": "Good work zone — stay focused, take breaks.",
  "post-lunch-dip": "Energy dip — NSDR or light walk.",
  afternoon: "Afternoon — moderate work, meetings OK.",
  evening: "Evening — start winding down.",
  "wind-down": "Wind down — no code, prep for bed.",
  "late-night": "Go to sleep.",
};
console.log(`\nSuggestion: ${suggestions[ctx.phase] || ""}`);

// Today's events
console.log("\n---");
try {
  const start = new Date(`${ctx.dateStr}T00:00:00+02:00`);
  const end = new Date(`${ctx.dateStr}T23:59:59+02:00`);
  const events = await getEvents(start, end);

  if (events.length === 0) {
    console.log("No events today");
  } else {
    console.log("Today's events:");
    for (const e of events) {
      const s = e.start.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jerusalem",
      });
      const en = e.end.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jerusalem",
      });
      console.log(`  ${s} - ${en} | ${e.summary}`);
    }
  }
} catch {
  console.log("(calendar unavailable)");
}

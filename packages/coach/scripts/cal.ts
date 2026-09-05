#!/usr/bin/env bun
/**
 * Quick Calendar CLI for CoachGolem
 *
 * Usage:
 *   bun scripts/cal.ts today              # Show today's events
 *   bun scripts/cal.ts show 2026-02-28    # Show specific date
 *   bun scripts/cal.ts add "Title" 09:00 10:30 [colorId] [description]
 *   bun scripts/cal.ts add-date 2026-02-28 "Title" 09:00 10:30 [colorId] [description]
 *   bun scripts/cal.ts delete <eventId>
 *   bun scripts/cal.ts clear-after 16:00  # Delete today's events after 16:00
 *   bun scripts/cal.ts now                # Current time in Israel
 *   bun scripts/cal.ts context            # Full time context + today's events
 */

import "@golems/shared/lib/load-env";
import {
  getEvents,
  createEvent,
  deleteEvent,
  type NewEvent,
} from "../src/calendar-client";
import { getTimeContext, formatTimeContext } from "../src/schedule-engine";
import { loadProtocol } from "../src/protocol";

const TIMEZONE = "Asia/Jerusalem";

function now(): string {
  return new Date().toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

function todayDate(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

async function getDateEvents(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00+02:00`);
  const end = new Date(`${dateStr}T23:59:59+02:00`);
  return getEvents(start, end);
}

// --- Commands ---

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case "now": {
    console.log(`${now()} IST | ${todayDate()}`);
    break;
  }

  case "context": {
    const protocol = loadProtocol();
    const ctx = getTimeContext(protocol);
    console.log(formatTimeContext(ctx));
    console.log("---");
    const events = await getDateEvents(ctx.dateStr);
    if (events.length === 0) {
      console.log("No events today");
    } else {
      for (const e of events) {
        console.log(
          `  ${formatTime(e.start)} - ${formatTime(e.end)} | ${e.summary}`,
        );
      }
    }
    break;
  }

  case "today": {
    const date = todayDate();
    console.log(`--- ${date} (now: ${now()}) ---`);
    const events = await getDateEvents(date);
    if (events.length === 0) {
      console.log("No events");
    } else {
      for (const e of events) {
        console.log(
          `${formatTime(e.start)} - ${formatTime(e.end)} | ${e.summary} [${e.id.slice(0, 12)}]`,
        );
      }
    }
    break;
  }

  case "show": {
    const date = args[0] || todayDate();
    console.log(`--- ${date} (now: ${now()}) ---`);
    const events = await getDateEvents(date);
    if (events.length === 0) {
      console.log("No events");
    } else {
      for (const e of events) {
        console.log(
          `${formatTime(e.start)} - ${formatTime(e.end)} | ${e.summary} [${e.id.slice(0, 12)}]`,
        );
      }
    }
    break;
  }

  case "add": {
    const [summary, startTime, endTime, colorId, ...descParts] = args;
    if (!summary || !startTime || !endTime) {
      console.error(
        'Usage: bun scripts/cal.ts add "Title" 09:00 10:30 [colorId] [description]',
      );
      process.exit(1);
    }
    const event: NewEvent = {
      summary,
      date: todayDate(),
      startTime,
      endTime,
      colorId: colorId || undefined,
      description: descParts.join(" ") || undefined,
    };
    const created = await createEvent(event);
    console.log(
      `Created: ${formatTime(created.start)} - ${formatTime(created.end)} | ${created.summary}`,
    );
    break;
  }

  case "add-date": {
    const [date, summary, startTime, endTime, colorId, ...descParts] = args;
    if (!date || !summary || !startTime || !endTime) {
      console.error(
        'Usage: bun scripts/cal.ts add-date 2026-02-28 "Title" 09:00 10:30 [colorId] [description]',
      );
      process.exit(1);
    }
    const event: NewEvent = {
      summary,
      date,
      startTime,
      endTime,
      colorId: colorId || undefined,
      description: descParts.join(" ") || undefined,
    };
    const created = await createEvent(event);
    console.log(
      `Created: ${formatTime(created.start)} - ${formatTime(created.end)} | ${created.summary}`,
    );
    break;
  }

  case "delete": {
    const eventId = args[0];
    if (!eventId) {
      console.error("Usage: bun scripts/cal.ts delete <eventId>");
      process.exit(1);
    }
    await deleteEvent(eventId);
    console.log(`Deleted: ${eventId}`);
    break;
  }

  case "clear-after": {
    const afterTime = args[0];
    if (!afterTime) {
      console.error("Usage: bun scripts/cal.ts clear-after 16:00");
      process.exit(1);
    }
    const date = todayDate();
    const cutoff = new Date(`${date}T${afterTime}:00+02:00`);
    const events = await getDateEvents(date);
    let deleted = 0;
    for (const e of events) {
      if (e.start >= cutoff) {
        await deleteEvent(e.id);
        console.log(`Deleted: ${formatTime(e.start)} | ${e.summary}`);
        deleted++;
      }
    }
    console.log(`\nDeleted ${deleted} events after ${afterTime}`);
    break;
  }

  default:
    console.log(`Calendar CLI — ${now()} IST | ${todayDate()}`);
    console.log("");
    console.log("Commands:");
    console.log("  now                           Current time");
    console.log("  today                         Today's events");
    console.log("  show [date]                   Events for date");
    console.log('  add "Title" HH:MM HH:MM [colorId] [desc]');
    console.log('  add-date YYYY-MM-DD "Title" HH:MM HH:MM [colorId] [desc]');
    console.log("  delete <eventId>              Delete event");
    console.log("  clear-after HH:MM            Delete events after time");
    console.log("");
    console.log(
      "Color IDs: 10=Basil(routine) 7=Peacock(work) 3=Grape(event) 5=Banana(break)",
    );
}

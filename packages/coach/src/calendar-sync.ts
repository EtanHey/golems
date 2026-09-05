/**
 * Calendar → Supabase sync
 *
 * Fetches today's events from Google Calendar and upserts them
 * into the calendar_events table for dashboard display.
 */

import { getTodayEvents, type CalendarEvent } from "./calendar-client";
import { getSupabase } from "@golems/shared/lib/supabase-factory";

export async function syncCalendarToSupabase(): Promise<{
  synced: number;
  date: string;
}> {
  const events = await getTodayEvents();
  const supabase = getSupabase();

  // Determine today's date in Israel timezone
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

  if (events.length === 0) {
    // No events — clear today's rows
    const { error: delErr } = await supabase
      .from("calendar_events")
      .delete()
      .eq("event_date", today);
    if (delErr) throw new Error(`Calendar delete failed: ${delErr.message}`);
    return { synced: 0, date: today };
  }

  // Map CalendarEvents to DB rows
  const rows = events.map((e: CalendarEvent) => ({
    event_id: e.id,
    summary: e.summary,
    start_time: e.start.toISOString(),
    end_time: e.end.toISOString(),
    all_day: e.allDay,
    location: e.location ?? null,
    event_date: today,
    synced_at: new Date().toISOString(),
  }));

  // Upsert first, then remove stale events (avoids data loss if upsert fails)
  const { error } = await supabase
    .from("calendar_events")
    .upsert(rows, { onConflict: "event_id" });

  if (error) {
    throw new Error(`Calendar sync failed: ${error.message}`);
  }

  // Remove events that are no longer in Google Calendar for today
  const fetchedIds = events.map((e: CalendarEvent) => e.id);
  const { error: cleanupErr } = await supabase
    .from("calendar_events")
    .delete()
    .eq("event_date", today)
    .not("event_id", "in", `(${fetchedIds.join(",")})`);

  if (cleanupErr) {
    // Non-fatal: stale events remain but new data is safe
    console.warn(`Calendar cleanup warning: ${cleanupErr.message}`);
  }

  return { synced: events.length, date: today };
}

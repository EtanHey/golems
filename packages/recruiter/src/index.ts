/**
 * RecruiterGolem - Outreach & Interview Pipeline
 *
 * Handles auto-outreach for hot job matches, interview practice,
 * company research, and connection matching.
 *
 * Triggered by: JobGolem (hot matches), Telegram commands (/practice, /outreach)
 */

import type { GolemStatus } from "@golems/shared/lib/shared-types";
import { getSupabase } from "@golems/shared/lib/supabase-factory";

/** Standard status interface for dashboard/Telegram */
export async function getStatus(): Promise<GolemStatus> {
  const supabase = getSupabase();
  let draftCount = 0;

  if (supabase) {
    try {
      const { count } = await supabase
        .from("outreach_messages")
        .select("*", { count: "exact", head: true })
        .eq("status", "draft");
      draftCount = count || 0;
    } catch { /* optional */ }
  }

  return {
    name: "RecruiterGolem",
    healthy: true,
    lastRun: null,
    summary: `${draftCount} outreach drafts pending`,
    details: { draftCount },
  };
}

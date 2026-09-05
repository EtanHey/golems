/**
 * Activity data fetchers — golem events and service run stats.
 */

import { getSupabase } from "@golems/shared/lib/supabase-factory";

export interface GolemActivity {
  actor: string;
  eventCount: number;
  lastActive: string;
}

export interface EventTypeCount {
  type: string;
  count: number;
}

export interface ServiceRunSummary {
  service: string;
  totalRuns: number;
  successCount: number;
  failCount: number;
  avgDurationMs: number;
  lastRun: string;
}

export interface DailyActivity {
  date: string;
  events: number;
}

export interface ActivityData {
  golemActivity: GolemActivity[];
  topEventTypes: EventTypeCount[];
  serviceRuns: ServiceRunSummary[];
  dailyActivity: DailyActivity[];
  totalEvents: number;
  fetchedAt: string;
}

export async function fetchActivityData(): Promise<ActivityData> {
  const supabase = getSupabase();

  // Golem events
  const { data: events } = await supabase
    .from("golem_events")
    .select("actor, type, created_at")
    .order("created_at", { ascending: false })
    .limit(2000);

  const actorStats = new Map<string, { count: number; lastActive: string }>();
  const typeCounts = new Map<string, number>();
  const dailyMap = new Map<string, number>();

  for (const e of events ?? []) {
    // By actor
    const existing = actorStats.get(e.actor) ?? {
      count: 0,
      lastActive: e.created_at,
    };
    existing.count++;
    actorStats.set(e.actor, existing);

    // By type
    typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);

    // Daily (last 30 days)
    const date = e.created_at?.slice(0, 10);
    if (date) {
      dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
    }
  }

  // Service runs
  const { data: runs } = await supabase
    .from("service_runs")
    .select("service, status, duration_ms, started_at")
    .order("started_at", { ascending: false })
    .limit(500);

  const serviceMap = new Map<
    string,
    {
      runs: number;
      success: number;
      fail: number;
      totalMs: number;
      lastRun: string;
    }
  >();
  for (const r of runs ?? []) {
    const existing = serviceMap.get(r.service) ?? {
      runs: 0,
      success: 0,
      fail: 0,
      totalMs: 0,
      lastRun: r.started_at,
    };
    existing.runs++;
    if (r.status === "success") existing.success++;
    else if (r.status === "error" || r.status === "failed") existing.fail++;
    existing.totalMs += r.duration_ms ?? 0;
    serviceMap.set(r.service, existing);
  }

  // Keep last 30 days of daily activity
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  return {
    golemActivity: [...actorStats.entries()]
      .map(([actor, stats]) => ({
        actor,
        eventCount: stats.count,
        lastActive: stats.lastActive,
      }))
      .sort((a, b) => b.eventCount - a.eventCount),
    topEventTypes: [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    serviceRuns: [...serviceMap.entries()]
      .map(([service, s]) => ({
        service,
        totalRuns: s.runs,
        successCount: s.success,
        failCount: s.fail,
        avgDurationMs: s.runs > 0 ? Math.round(s.totalMs / s.runs) : 0,
        lastRun: s.lastRun,
      }))
      .sort((a, b) => b.totalRuns - a.totalRuns),
    dailyActivity: [...dailyMap.entries()]
      .filter(([date]) => date >= cutoff)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, events]) => ({ date, events })),
    totalEvents: events?.length ?? 0,
    fetchedAt: new Date().toISOString(),
  };
}

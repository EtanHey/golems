/**
 * Job market data fetchers — pulls stats from golem_jobs + scrape_activity.
 */

import { getSupabase } from "@golems/shared/lib/supabase-factory";

export interface JobStatusDistribution {
  status: string;
  count: number;
}

export interface TopTag {
  tag: string;
  count: number;
}

export interface MatchScoreBucket {
  range: string;
  count: number;
}

export interface WeeklyJobTrend {
  week: string;
  newJobs: number;
  applied: number;
}

export interface ScrapeStats {
  source: string;
  totalRuns: number;
  avgNewPerRun: number;
  lastRun: string;
}

export interface JobMarketData {
  totalJobs: number;
  statusDistribution: JobStatusDistribution[];
  topTags: TopTag[];
  matchScoreBuckets: MatchScoreBucket[];
  weeklyTrend: WeeklyJobTrend[];
  scrapeStats: ScrapeStats[];
  fetchedAt: string;
}

export async function fetchJobMarketData(): Promise<JobMarketData> {
  const supabase = getSupabase();

  // Status distribution
  const { data: jobs } = await supabase
    .from("golem_jobs")
    .select("status, tags, match_score, scraped_at, applied_at");

  const statusCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const scoreBuckets = new Map<string, number>();

  for (const job of jobs ?? []) {
    // Status
    const s = job.status ?? "unknown";
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);

    // Tags
    if (Array.isArray(job.tags)) {
      for (const tag of job.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    // Match score buckets
    const score = job.match_score;
    if (score != null) {
      const bucket =
        score >= 8
          ? "8-10 (Excellent)"
          : score >= 6
            ? "6-7 (Good)"
            : score >= 4
              ? "4-5 (Fair)"
              : "1-3 (Low)";
      scoreBuckets.set(bucket, (scoreBuckets.get(bucket) ?? 0) + 1);
    }
  }

  // Weekly trend (last 8 weeks)
  const weeklyTrend: WeeklyJobTrend[] = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekLabel = weekStart.toISOString().slice(5, 10);
    let newJobs = 0;
    let applied = 0;
    for (const job of jobs ?? []) {
      const scraped = new Date(job.scraped_at);
      if (scraped >= weekStart && scraped < weekEnd) newJobs++;
      if (job.applied_at) {
        const appliedAt = new Date(job.applied_at);
        if (appliedAt >= weekStart && appliedAt < weekEnd) applied++;
      }
    }
    weeklyTrend.push({ week: weekLabel, newJobs, applied });
  }

  // Scrape activity stats
  const { data: scrapes } = await supabase
    .from("scrape_activity")
    .select("source, new_saved, run_at")
    .order("run_at", { ascending: false })
    .limit(200);

  const sourceStats = new Map<
    string,
    { runs: number; totalNew: number; lastRun: string }
  >();
  for (const s of scrapes ?? []) {
    const existing = sourceStats.get(s.source) ?? {
      runs: 0,
      totalNew: 0,
      lastRun: s.run_at,
    };
    existing.runs++;
    existing.totalNew += s.new_saved ?? 0;
    sourceStats.set(s.source, existing);
  }

  return {
    totalJobs: jobs?.length ?? 0,
    statusDistribution: [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    topTags: [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    matchScoreBuckets: [...scoreBuckets.entries()]
      .map(([range, count]) => ({ range, count }))
      .sort((a, b) => a.range.localeCompare(b.range)),
    weeklyTrend,
    scrapeStats: [...sourceStats.entries()].map(([source, stats]) => ({
      source,
      totalRuns: stats.runs,
      avgNewPerRun:
        stats.runs > 0 ? Math.round(stats.totalNew / stats.runs) : 0,
      lastRun: stats.lastRun,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

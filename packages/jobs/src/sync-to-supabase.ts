#!/usr/bin/env bun
/**
 * Job Golem - Supabase Sync
 *
 * Syncs scraped jobs to etanheyman.com's Supabase database
 * for the ClaudeGolem Dashboard.
 *
 * Usage:
 *   bun src/job-golem/sync-to-supabase.ts [--dry-run]
 */

// IMPORTANT: Load env FIRST - fixes launchd cwd issues
import "@golems/shared/lib/load-env";

import { getSupabase } from "@golems/shared/lib/supabase-factory";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import type { JobListing } from "./scraper";
import { loadScrapedJobs } from "./scraper";
import type { MatchResult } from "./matcher";

const HOME = process.env.HOME;
if (!HOME) {
  throw new Error("HOME environment variable is required but not set");
}
const DATA_DIR = join(HOME, ".golems-zikaron/job-golem");
const JOBS_FILE = join(DATA_DIR, "scraped-jobs.json");
const SYNC_STATE_FILE = join(DATA_DIR, "sync-state.json");

// Supabase connection (uses same env as etanheyman.com)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface SyncState {
  lastSyncAt: string;
  syncedIds: string[];
}

function loadSyncState(): SyncState {
  try {
    if (existsSync(SYNC_STATE_FILE)) {
      return JSON.parse(readFileSync(SYNC_STATE_FILE, "utf-8"));
    }
  } catch {}
  return { lastSyncAt: "", syncedIds: [] };
}

function saveSyncState(state: SyncState) {
  writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Clear synced jobs from local storage to free disk space.
 * Only keeps jobs that failed to sync (if any).
 */
function clearSyncedJobs(syncedIds: string[]) {
  if (!existsSync(JOBS_FILE)) return;

  try {
    const jobs = loadScrapedJobs();
    const remaining = jobs.filter((j) => !syncedIds.includes(j.id));

    if (remaining.length === 0) {
      // All jobs synced - delete the file entirely
      unlinkSync(JOBS_FILE);
      console.log("[Cleanup] Deleted scraped-jobs.json (all synced)");
    } else {
      // Some jobs failed - keep only those
      writeFileSync(JOBS_FILE, JSON.stringify(remaining, null, 2));
      console.log(`[Cleanup] Kept ${remaining.length} unsynced jobs`);
    }
  } catch (err) {
    console.error("[Cleanup] Failed to clean up local jobs:", err);
  }
}

/**
 * Sync jobs to Supabase
 * @param filteredJobs - If provided, sync only these jobs (after prefiltering). Otherwise reads from file.
 * @param dryRun - If true, don't actually sync
 */
async function syncJobs(filteredJobs?: JobListing[], dryRun = false) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[Sync] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    console.log("[Sync] Set these in your .env or environment");
    process.exit(1);
  }

  const supabase = getSupabase()!;
  // Use provided filtered jobs OR fall back to file (for backward compat/CLI)
  const jobs = filteredJobs ?? loadScrapedJobs();
  const syncState = loadSyncState();

  if (filteredJobs) {
    console.log(`[Sync] Syncing ${jobs.length} pre-filtered jobs`);
  }

  console.log(`[Sync] Found ${jobs.length} scraped jobs`);
  console.log(`[Sync] ${syncState.syncedIds.length} already synced`);

  // Find jobs that haven't been synced
  const newJobs = jobs.filter((j) => !syncState.syncedIds.includes(j.id));
  console.log(`[Sync] ${newJobs.length} new jobs to sync`);

  if (newJobs.length === 0) {
    console.log("[Sync] Nothing to sync, all jobs already in database");
    return;
  }

  if (dryRun) {
    console.log("[Sync] DRY RUN - would sync these jobs:");
    for (const job of newJobs.slice(0, 10)) {
      console.log(`  - ${job.title} @ ${job.company} (${job.source})`);
    }
    if (newJobs.length > 10) {
      console.log(`  ... and ${newJobs.length - 10} more`);
    }
    return;
  }

  // Sync in batches
  const BATCH_SIZE = 50;
  let synced = 0;
  let errors = 0;

  for (let i = 0; i < newJobs.length; i += BATCH_SIZE) {
    const batch = newJobs.slice(i, i + BATCH_SIZE);

    const records = batch.map((job) => ({
      external_id: job.id,
      title: job.title,
      company: job.company,
      location: job.location || null,
      experience: job.experience || null,
      description: job.description || null,
      url: job.url,
      source: job.source,
      language: job.language,
      status: "new",
      scraped_at: job.scrapedAt,
    }));

    // Use ignoreDuplicates to only INSERT new jobs, never UPDATE existing ones
    // This preserves user-set status (saved, applied, rejected) on re-scrape
    const { data, error } = await supabase
      .from("golem_jobs")
      .upsert(records, { onConflict: "external_id", ignoreDuplicates: true })
      .select();

    if (error) {
      console.error(`[Sync] Batch error:`, error.message);
      errors += batch.length;
    } else {
      synced += batch.length;
      // Update sync state
      syncState.syncedIds.push(...batch.map((j) => j.id));
    }

    // Small delay between batches
    if (i + BATCH_SIZE < newJobs.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Save updated sync state
  syncState.lastSyncAt = new Date().toISOString();
  // Keep only last 1000 synced IDs to prevent unbounded growth
  if (syncState.syncedIds.length > 1000) {
    syncState.syncedIds = syncState.syncedIds.slice(-1000);
  }
  saveSyncState(syncState);

  console.log(`[Sync] Done: ${synced} synced, ${errors} errors`);

  // Clean up local storage after successful sync
  if (synced > 0 && errors === 0) {
    clearSyncedJobs(syncState.syncedIds);
  } else if (synced > 0) {
    // Partial success - only clear successfully synced jobs
    const successfulIds = newJobs.slice(0, synced).map((j) => j.id);
    clearSyncedJobs(successfulIds);
  }
}

/**
 * Normalize a score to the 1-10 range.
 * LLMs sometimes return scores on 0-100 scale instead of 1-10.
 */
function normalizeScore(score: number): number {
  if (score > 10) {
    // Likely on 0-100 scale — convert to 1-10
    return Math.max(1, Math.min(10, Math.round(score / 10)));
  }
  return Math.max(1, Math.min(10, score));
}

/** Sync match scores back to Supabase after Ollama scoring */
async function syncScores(matches: MatchResult[]) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[SyncScores] Missing Supabase env vars");
    return;
  }

  if (matches.length === 0) {
    console.log("[SyncScores] No scores to sync");
    return;
  }

  const supabase = getSupabase()!;
  let updated = 0;
  let errors = 0;

  for (const match of matches) {
    const normalizedScore = normalizeScore(match.score);
    if (normalizedScore !== match.score) {
      console.log(`[SyncScores] Normalized score ${match.score} → ${normalizedScore} for ${match.job.title}`);
    }

    const { error } = await supabase
      .from("golem_jobs")
      .update({
        match_score: normalizedScore,
        notes: match.reason,
        tags: match.highlights,
        match_reasons: match.highlights.length > 0 ? match.highlights : null,
      })
      .eq("external_id", match.job.id);

    if (error) {
      console.error(`[SyncScores] Error updating ${match.job.id}:`, error.message);
      errors++;
    } else {
      updated++;
    }
  }

  console.log(`[SyncScores] Updated ${updated} jobs with scores (${errors} errors)`);
}

// CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  syncJobs(undefined, dryRun).catch((err) => {
    console.error("[Sync] Fatal error:", err);
    process.exit(1);
  });
}

export interface ScrapeActivityEntry {
  source: string;
  total_found: number;
  new_saved: number;
  duplicates_skipped: number;
  errors: number;
  avg_description_length: number;
  no_description_count: number;
  id_like_title_count: number;
  no_company_count: number;
  duration_ms: number;
  notes?: string;
}

export async function logScrapeActivity(entries: ScrapeActivityEntry[]) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log("[ScrapeActivity] Skipping - no Supabase credentials");
    return;
  }

  const supabase = getSupabase()!;

  for (const entry of entries) {
    const { error } = await supabase.from("scrape_activity").insert({
      ...entry,
      run_at: new Date().toISOString(),
    });
    if (error) {
      console.error(`[ScrapeActivity] Failed to log ${entry.source}:`, error.message);
    }
  }

  console.log(`[ScrapeActivity] Logged ${entries.length} source activities`);
}

export { syncJobs, syncScores };

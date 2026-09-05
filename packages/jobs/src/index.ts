#!/usr/bin/env bun
/**
 * Job Golem - Main Runner
 *
 * Searches Israeli job boards, matches against your profile,
 * and sends top matches via Telegram.
 *
 * Schedule: 5-7 AM and 5-7 PM
 */

// MUST be first import - loads .env for launchd (runs from /)
import "@golems/shared/lib/load-env";

import { scrapeAllJobs } from "./scraper";
import { syncJobs, syncScores } from "./sync-to-supabase";
import { matchJobs, prefilterJobs, type MatchResult } from "./matcher";
import { writeFileSync, existsSync, readdirSync, unlinkSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { logEvent } from "@golems/shared/lib/event-log";
import { sendNotification } from "@golems/shared/lib/telegram-direct";
import { getState, reportServiceRun } from "@golems/shared/lib/state-store";

const HOME = process.env.HOME;
if (!HOME) throw new Error("HOME environment variable is required");
const RESULTS_DIR = join(HOME, ".golems-zikaron/job-golem/results");

// Ensure results directory exists
function ensureResultsDir() {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

// Send Telegram notification via telegram-direct (supports both local and cloud modes)
async function sendTelegram(title: string, body: string, priority: "default" | "high" = "default") {
  console.log(`[Telegram] Sending notification: "${title}"`);
  const success = await sendNotification({ title, body, source: "jobs", priority });
  if (success) {
    console.log("[Telegram] Notification sent successfully");
  } else {
    console.error("[Telegram] Failed to send notification");
  }
}

// Format job matches for Telegram - consolidated in one message
async function sendJobMatches(matches: MatchResult[]) {
  if (matches.length === 0) {
    console.log("[JobGolem] No new matches — skipping Telegram (no noise)");
    return;
  }

  // High-scoring matches (8+) get highlighted
  const hotMatches = matches.filter(m => m.score >= 8);

  // Build one consolidated message with context
  const lines: string[] = [`*${matches.length} Job Matches Found*\n`];

  // Show top matches — no links, drive to dashboard for actions (apply/dismiss)
  for (const match of matches.slice(0, 6)) {
    const emoji = match.score >= 8 ? "🔥" : match.score >= 7 ? "✨" : "👍";

    lines.push(`${emoji} *${match.score}/10* - ${match.job.title}`);
    lines.push(`📍 ${match.job.company} | ${match.job.location}`);
    if (match.reason) {
      lines.push(`💡 _${match.reason.slice(0, 80)}_`);
    }
    lines.push(""); // blank line between jobs
  }

  if (matches.length > 6) {
    lines.push(`+${matches.length - 6} more.`);
  }
  lines.push(`\n📊 [View all on dashboard](https://etanheyman.com/admin/golem/jobs)`);

  // High priority if we have hot matches
  const priority = hotMatches.length > 0 ? "high" : "default";
  const title = hotMatches.length > 0 ? `🔥 ${hotMatches.length} Hot Matches!` : "Job Matches";

  await sendTelegram(title, lines.join("\n"), priority);
}

// Save results to file
function saveResults(matches: MatchResult[]) {
  ensureResultsDir();
  const date = new Date().toISOString().split("T")[0];
  const time = new Date().toTimeString().split(" ")[0].replace(/:/g, "");
  const filename = join(RESULTS_DIR, `jobs-${date}-${time}.json`);

  writeFileSync(filename, JSON.stringify(matches, null, 2));
  console.log(`[Results] Saved to ${filename}`);

  return filename;
}

// Clean up old results files (keep last 7 days)
function cleanupOldResults() {
  if (!existsSync(RESULTS_DIR)) return;

  const MAX_AGE_DAYS = 7;
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;

  try {
    const files = readdirSync(RESULTS_DIR);
    for (const file of files) {
      if (!file.startsWith("jobs-") || !file.endsWith(".json")) continue;

      const filepath = join(RESULTS_DIR, file);
      const stats = statSync(filepath);

      if (stats.mtimeMs < cutoff) {
        unlinkSync(filepath);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[Cleanup] Deleted ${deleted} old result files (>7 days)`);
    }
  } catch (err) {
    console.error("[Cleanup] Failed to clean old results:", err);
  }
}

// Track if scrape is in progress (prevent concurrent runs)
// Use timestamp instead of boolean so stale locks auto-expire after 10 minutes
let scrapeStartedAt: number | null = null;
const SCRAPE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Main job search routine
export async function runJobSearch(): Promise<{ scraped: number; filtered: number; matched: number } | null> {
  // Prevent concurrent runs, but auto-expire stale locks after 10 minutes
  if (scrapeStartedAt !== null) {
    const elapsed = Date.now() - scrapeStartedAt;
    if (elapsed < SCRAPE_TIMEOUT_MS) {
      console.log("[Job Golem] Scrape already in progress, skipping...");
      return null;
    }
    console.log(`[Job Golem] Previous scrape timed out after ${Math.round(elapsed / 1000)}s, resetting...`);
  }

  const myStartTime = Date.now();
  scrapeStartedAt = myStartTime;
  try {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] 🤖 Job Golem starting...\n`);
  const startTime = Date.now();

  // 1. Scrape all job boards
  console.log("📡 Scraping job boards...");
  const allJobs = await scrapeAllJobs();

  if (allJobs.length === 0) {
    console.log("No new jobs found.");
    await sendTelegram("Job Golem", "No new jobs found today.");
    await reportServiceRun("lastJobRun");
    return { scraped: 0, filtered: 0, matched: 0 };
  }

  // 2. Quick keyword prefilter
  console.log("\n🔍 Pre-filtering by keywords...");
  const filtered = prefilterJobs(allJobs);
  console.log(`Filtered: ${filtered.length}/${allJobs.length} jobs match keywords`);

  if (filtered.length === 0) {
    await sendTelegram("Job Golem", `Scraped ${allJobs.length} jobs but none matched your keywords.`);
    await reportServiceRun("lastJobRun");
    return { scraped: allJobs.length, filtered: 0, matched: 0 };
  }

  // 3. AI scoring with Ollama
  console.log("\n🧠 Scoring with AI...");
  const matches = await matchJobs(filtered, 6);

  // 4. Save results
  const resultsFile = saveResults(matches);

  // 4.5. Log all matches to event log
  try {
    await Promise.allSettled(
      matches.map(match =>
        logEvent("job_match", {
          company: match.job.company,
          role: match.job.title,
          score: match.score,
          url: match.job.url,
        }, "jobgolem")
      )
    );
  } catch (err) {
    console.error("[EventLog] Failed to log job matches:", err);
    // Don't fail the whole run - event logging is optional
  }

  // 4.6. Auto-outreach for hot matches (score 8+)
  // Uses dynamic import so job-golem has no hard dependency on recruiter-golem
  const hotMatches = matches.filter(m => m.score >= 8);
  if (hotMatches.length > 0) {
    console.log(`\n🎯 Processing ${hotMatches.length} hot matches for outreach...`);
    try {
      const { processHotMatches, formatHotMatchSummary } = await import(
        "@golems/recruiter/auto-outreach"
      );

      const jobMatches = hotMatches.map(m => ({
        id: m.job.url,
        title: m.job.title,
        company: m.job.company,
        location: m.job.location || "Israel",
        url: m.job.url,
        techStack: [],
        description: m.job.description,
        score: m.score,
        reason: m.reason,
      }));

      const outreachResults = await processHotMatches(jobMatches);
      const totalDrafts = outreachResults.reduce((sum: number, r: any) => sum + r.draftsCreated, 0);

      console.log(`   ✅ Created ${totalDrafts} outreach drafts`);

      if (totalDrafts > 0) {
        const summary = formatHotMatchSummary(outreachResults);
        await sendTelegram("🎯 Outreach Ready", summary);
      }
    } catch (err) {
      console.error("[Outreach] Error processing hot matches:", err);
      // Don't fail the whole run - outreach is optional
    }
  }

  // 5. Sync to Supabase (for dashboard) - ONLY filtered jobs, not raw scrape
  console.log("\n☁️ Syncing to Supabase...");
  try {
    await syncJobs(filtered);  // Pass filtered jobs, not raw scrape
    // Also sync the match scores back
    await syncScores(matches);
  } catch (err) {
    console.error("[Sync] Failed to sync to Supabase:", err);
    // Don't fail the whole run - dashboard sync is optional
  }

  // 6. Send Telegram notifications (one per job)
  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log("\n📱 Sending Telegram notifications...");
  await sendJobMatches(matches);

  const endTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n[${endTime}] ✅ Job Golem finished in ${duration}s`);
  console.log(`   • Scraped: ${allJobs.length} jobs`);
  console.log(`   • Filtered: ${filtered.length} by keywords`);
  console.log(`   • Matched: ${matches.length} scored 6+`);

  // Clean up old result files
  cleanupOldResults();

  // Report run to dashboard
  await reportServiceRun("lastJobRun");

  return { scraped: allJobs.length, filtered: filtered.length, matched: matches.length };
  } finally {
    // Only clear lock if we still own it (prevents stale scrape from clearing new scrape's lock)
    if (scrapeStartedAt === myStartTime) {
      scrapeStartedAt = null;
    }
  }
}

/** Standard status interface for dashboard/Telegram */
export async function getStatus(): Promise<import("@golems/shared/lib/shared-types").GolemStatus> {
  const lastRun = await getState<string>("lastJobRun");
  const summary = lastRun
    ? `Last scrape: ${new Date(lastRun).toLocaleString()}`
    : "Never run";
  return { name: "JobGolem", healthy: !!lastRun, lastRun, summary };
}

// CLI
if (import.meta.main) {
  await runJobSearch();
}

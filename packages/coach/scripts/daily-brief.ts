#!/usr/bin/env bun
/**
 * Daily Brief Generator — CoachGolem
 *
 * Generates an Obsidian daily note with schedule, coaching advice,
 * and reflection prompts. Phone-friendly with collapsible callout drawers.
 *
 * Usage:
 *   bun scripts/daily-brief.ts              # Generate for today
 *   bun scripts/daily-brief.ts 2026-03-03   # Generate for specific date
 *   bun scripts/daily-brief.ts --dry-run    # Print to stdout, don't write file
 */

import "@golems/shared/lib/load-env";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getEvents } from "../src/calendar-client";
import { loadProtocol } from "../src/protocol";
import { getTimeContext, getIsraelDateStr } from "../src/schedule-engine";
import { generateCoaching } from "../src/coaching-engine";
import {
  getEcosystemStatus,
  registerAllGolems,
  getPendingWork,
} from "../src/status-aggregator";
import type { CalendarEvent } from "../src/calendar-client";
import {
  generateDailyNote,
  extractUserSections,
  mergeUserSections,
  type DailyData,
} from "../src/daily-brief";

// --- Config ---

const VAULT =
  process.env.OBSIDIAN_VAULT || join(process.env.HOME || homedir(), "Documents/Obsidian");
const DIARY_DIR = join(VAULT, "Personal", "Diary");

// --- Helpers ---

function dayName(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "Asia/Jerusalem",
  }).format(date);
}

// --- Data Fetching (all graceful) ---

async function fetchDailyData(targetDate: Date): Promise<DailyData> {
  const protocol = loadProtocol();
  const timeCtx = getTimeContext(protocol, targetDate);

  // Fetch calendar events for target date
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  const events = await getEvents(dayStart, dayEnd).catch(
    () => [] as CalendarEvent[],
  );

  // Try to get coaching advice
  let coaching = null;
  let pendingItems: string[] = [];

  try {
    await registerAllGolems();
    const status = await getEcosystemStatus();
    const pending = getPendingWork(status);
    pendingItems = pending.map(
      (w) => `[${w.priority.toUpperCase()}] ${w.item}`,
    );
    coaching = await generateCoaching({
      protocol,
      calendar: events,
      pending,
      dayOfWeek: dayName(targetDate),
    });
  } catch {
    // Coaching is optional — degrade gracefully
  }

  return {
    events,
    coaching,
    timeCtx,
    protocol,
    pendingItems,
  };
}

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

  // Parse target date
  let targetDate: Date;
  if (dateArg) {
    targetDate = new Date(`${dateArg}T12:00:00+02:00`); // Noon Israel time
  } else {
    targetDate = new Date();
  }

  const dateStr = getIsraelDateStr(targetDate);
  console.log(`Generating daily brief for ${dateStr}...`);

  // Fetch all data
  const data = await fetchDailyData(targetDate);

  // Generate markdown
  const markdown = generateDailyNote(data, targetDate);

  if (dryRun) {
    console.log("\n" + markdown);
    return;
  }

  // Write to Obsidian
  if (!existsSync(DIARY_DIR)) {
    mkdirSync(DIARY_DIR, { recursive: true });
  }

  const filePath = join(DIARY_DIR, `${dateStr}.md`);

  if (existsSync(filePath)) {
    // Don't overwrite user's reflections — only update auto-generated sections
    console.log(`${filePath} already exists — updating auto sections only`);
    const existing = readFileSync(filePath, "utf-8");
    const userSections = extractUserSections(existing);
    const merged = mergeUserSections(markdown, userSections);
    writeFileSync(filePath, merged);
    console.log(`Updated: ${filePath}`);
  } else {
    writeFileSync(filePath, markdown);
    console.log(`Created: ${filePath}`);
  }
}

main().catch((err) => {
  console.error("Daily brief failed:", err);
  process.exit(1);
});

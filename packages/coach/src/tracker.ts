/**
 * Compliance Tracker for CoachGolem
 *
 * Tracks what got done vs. what was planned.
 * Stores daily compliance data for weekly rollups.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { DailyPlan } from "./schedule-engine";

const HOME = process.env.HOME || "/tmp";
const TRACKER_DIR = join(HOME, ".golems-zikaron/coach");
const TRACKER_FILE = join(TRACKER_DIR, "compliance.json");

export interface DailyRecord {
  date: string;
  plannedMeetings: number;
  attendedMeetings: number;
  pendingItems: number;
  completedItems: number;
  notes?: string;
}

interface ComplianceData {
  records: DailyRecord[];
}

function ensureDir(): void {
  if (!existsSync(TRACKER_DIR)) {
    mkdirSync(TRACKER_DIR, { recursive: true });
  }
}

function loadData(): ComplianceData {
  ensureDir();
  try {
    return JSON.parse(readFileSync(TRACKER_FILE, "utf-8"));
  } catch {
    return { records: [] };
  }
}

function saveData(data: ComplianceData): void {
  ensureDir();
  // Keep last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  data.records = data.records.filter(
    (r) => new Date(r.date) >= cutoff
  );
  writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2));
}

/**
 * Record today's compliance from a plan.
 */
export function recordDay(plan: DailyPlan, completed: number): void {
  const data = loadData();

  // Replace existing record for today
  data.records = data.records.filter((r) => r.date !== plan.date);
  data.records.push({
    date: plan.date,
    plannedMeetings: plan.blocks.filter((b) => b.type === "meeting").length,
    attendedMeetings: plan.blocks.filter(
      (b) => b.type === "meeting" && new Date(`${plan.date}T${b.end}`) < new Date()
    ).length,
    pendingItems: plan.pendingItems.length,
    completedItems: completed,
  });

  saveData(data);
}

/**
 * Generate a weekly summary.
 */
export function getWeeklySummary(): {
  days: number;
  totalMeetings: number;
  attendedMeetings: number;
  totalPending: number;
  totalCompleted: number;
  completionRate: string;
} {
  const data = loadData();
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const weekRecords = data.records.filter(
    (r) => new Date(r.date) >= oneWeekAgo
  );

  const totalMeetings = weekRecords.reduce(
    (sum, r) => sum + r.plannedMeetings,
    0
  );
  const attendedMeetings = weekRecords.reduce(
    (sum, r) => sum + r.attendedMeetings,
    0
  );
  const totalPending = weekRecords.reduce(
    (sum, r) => sum + r.pendingItems,
    0
  );
  const totalCompleted = weekRecords.reduce(
    (sum, r) => sum + r.completedItems,
    0
  );

  const completionRate =
    totalPending > 0
      ? `${Math.round((totalCompleted / totalPending) * 100)}%`
      : "N/A";

  return {
    days: weekRecords.length,
    totalMeetings,
    attendedMeetings,
    totalPending,
    totalCompleted,
    completionRate,
  };
}

/**
 * Format weekly summary for Telegram.
 */
export function formatWeeklySummary(): string {
  const summary = getWeeklySummary();
  const lines: string[] = [];

  lines.push("Weekly Summary");
  lines.push("");
  lines.push(`Days tracked: ${summary.days}/7`);
  lines.push(
    `Meetings: ${summary.attendedMeetings}/${summary.totalMeetings} attended`
  );
  lines.push(`Task completion: ${summary.completionRate}`);
  lines.push(
    `Items: ${summary.totalCompleted}/${summary.totalPending} completed`
  );

  return lines.join("\n");
}

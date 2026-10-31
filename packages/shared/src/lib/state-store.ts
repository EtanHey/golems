/**
 * State Store - Local File Storage
 *
 * Abstracts golem state storage behind a unified API.
 * Backed by local JSON files.
 *
 * Covers three state types:
 * 1. Key-value state (state.json)
 * 2. Event log (event-log.json)
 * 3. Seen jobs (seen-jobs.json)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type { GolemActor, EventType, GolemEvent } from "./event-log";

// File paths (local mode) - GOLEMS_STATE_DIR overrides for testing
const GOLEMS_DIR = process.env.GOLEMS_STATE_DIR || join(homedir(), ".golems-zikaron");
const STATE_FILE = join(GOLEMS_DIR, "state.json");
const EVENT_LOG_FILE = join(GOLEMS_DIR, "event-log.json");
const SEEN_JOBS_FILE = join(GOLEMS_DIR, "job-golem", "seen-jobs.json");

const MAX_EVENTS = 100;

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ═══════════════════════════════════════════════════════
// Key-Value State (state.json)
// ═══════════════════════════════════════════════════════

/** Get a state value by key */
export async function getState<T = unknown>(key: string): Promise<T | null> {

  // File mode
  try {
    if (!existsSync(STATE_FILE)) return null;
    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    return (state[key] ?? null) as T;
  } catch {
    return null;
  }
}

/** Set a state value by key */
export async function setState<T = unknown>(key: string, value: T): Promise<void> {

  // File mode
  ensureDir(STATE_FILE);
  let state: Record<string, unknown> = {};
  try {
    if (existsSync(STATE_FILE)) {
      state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    }
  } catch { /* start fresh */ }

  state[key] = value;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ═══════════════════════════════════════════════════════
// Event Log (event-log.json)
// ═══════════════════════════════════════════════════════

/** Log a golem event */
export async function logEvent(
  type: EventType,
  data: Record<string, unknown>,
  actor: GolemActor = "claudegolem"
): Promise<void> {

  // File mode - delegate to existing event-log.ts logic
  ensureDir(EVENT_LOG_FILE);
  let events: GolemEvent[] = [];
  try {
    if (existsSync(EVENT_LOG_FILE)) {
      events = JSON.parse(readFileSync(EVENT_LOG_FILE, "utf-8"));
    }
  } catch { events = []; }

  events.push({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor,
    type,
    data,
  });

  if (events.length > MAX_EVENTS) {
    events = events.slice(-MAX_EVENTS);
  }

  writeFileSync(EVENT_LOG_FILE, JSON.stringify(events, null, 2));
}

/** Get recent events (last N hours) */
export async function getRecentEvents(hours: number = 24): Promise<GolemEvent[]> {

  // File mode
  if (!existsSync(EVENT_LOG_FILE)) return [];

  try {
    const events: GolemEvent[] = JSON.parse(readFileSync(EVENT_LOG_FILE, "utf-8"));
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return events.filter((e) => new Date(e.timestamp).getTime() > cutoff);
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════
// Seen Jobs (seen-jobs.json)
// ═══════════════════════════════════════════════════════

/** Check if a job has been seen */
export async function isJobSeen(jobId: string): Promise<boolean> {

  // File mode
  try {
    if (!existsSync(SEEN_JOBS_FILE)) return false;
    const seen: string[] = JSON.parse(readFileSync(SEEN_JOBS_FILE, "utf-8"));
    return seen.includes(jobId);
  } catch {
    return false;
  }
}

/** Mark a job as seen */
export async function markJobSeen(jobId: string): Promise<void> {

  // File mode
  ensureDir(SEEN_JOBS_FILE);
  let seen: string[] = [];
  try {
    if (existsSync(SEEN_JOBS_FILE)) {
      seen = JSON.parse(readFileSync(SEEN_JOBS_FILE, "utf-8"));
    }
  } catch { seen = []; }

  if (!seen.includes(jobId)) {
    seen.push(jobId);
    writeFileSync(SEEN_JOBS_FILE, JSON.stringify(seen, null, 2));
  }
}

/** Mark multiple jobs as seen at once */
export async function markJobsSeen(jobIds: string[]): Promise<void> {

  // File mode
  ensureDir(SEEN_JOBS_FILE);
  let seen: string[] = [];
  try {
    if (existsSync(SEEN_JOBS_FILE)) {
      seen = JSON.parse(readFileSync(SEEN_JOBS_FILE, "utf-8"));
    }
  } catch { seen = []; }

  const existing = new Set(seen);
  for (const id of jobIds) {
    if (!existing.has(id)) {
      seen.push(id);
    }
  }
  writeFileSync(SEEN_JOBS_FILE, JSON.stringify(seen, null, 2));
}

/** Get all seen job IDs (for compatibility with Set-based scraper) */
export async function getSeenJobIds(): Promise<Set<string>> {

  // File mode
  try {
    if (!existsSync(SEEN_JOBS_FILE)) return new Set();
    const seen: string[] = JSON.parse(readFileSync(SEEN_JOBS_FILE, "utf-8"));
    return new Set(seen);
  } catch {
    return new Set();
  }
}

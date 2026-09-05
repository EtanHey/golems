/**
 * State Store - Dual-mode State Abstraction
 *
 * Abstracts golem state storage behind a unified API.
 * Backed by local JSON files (default) or Supabase (cloud).
 *
 * ENV: STATE_BACKEND = "file" (default) | "supabase"
 *
 * Covers three state types:
 * 1. Key-value state (state.json → golem_state)
 * 2. Event log (event-log.json → golem_events)
 * 3. Seen jobs (seen-jobs.json → golem_seen_jobs)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { getSupabase, type SupabaseClient } from "./supabase-factory";
import type { GolemActor, EventType, GolemEvent } from "./event-log";

const STATE_BACKEND = process.env.STATE_BACKEND || "file";

// File paths (local mode) - GOLEMS_STATE_DIR overrides for testing
const GOLEMS_DIR = process.env.GOLEMS_STATE_DIR || join(homedir(), ".golems-zikaron");
const STATE_FILE = join(GOLEMS_DIR, "state.json");
const EVENT_LOG_FILE = join(GOLEMS_DIR, "event-log.json");
const SEEN_JOBS_FILE = join(GOLEMS_DIR, "job-golem", "seen-jobs.json");

const MAX_EVENTS = 100;

function getSupabaseOrThrow(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY required when STATE_BACKEND=supabase"
    );
  }
  return client;
}

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ═══════════════════════════════════════════════════════
// Key-Value State (state.json / golem_state)
// ═══════════════════════════════════════════════════════

/** Get a state value by key */
export async function getState<T = unknown>(key: string): Promise<T | null> {
  if (STATE_BACKEND === "supabase") {
    const { data, error } = await getSupabaseOrThrow()
      .from("golem_state")
      .select("value")
      .eq("key", key)
      .single();

    if (error || !data) return null;
    return data.value as T;
  }

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
  if (STATE_BACKEND === "supabase") {
    const { error } = await getSupabaseOrThrow()
      .from("golem_state")
      .upsert({ key, value, updated_at: new Date().toISOString() });

    if (error) {
      console.error(`[StateStore] Failed to set state "${key}":`, error.message);
    }
    return;
  }

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
// Event Log (event-log.json / golem_events)
// ═══════════════════════════════════════════════════════

/** Log a golem event */
export async function logEvent(
  type: EventType,
  data: Record<string, unknown>,
  actor: GolemActor = "claudegolem"
): Promise<void> {
  if (STATE_BACKEND === "supabase") {
    const { error } = await getSupabaseOrThrow()
      .from("golem_events")
      .insert({ actor, type, data, created_at: new Date().toISOString() });

    if (error) {
      console.error("[StateStore] Failed to log event:", error.message);
    }
    return;
  }

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
  if (STATE_BACKEND === "supabase") {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabaseOrThrow()
      .from("golem_events")
      .select("id, actor, type, data, created_at")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(MAX_EVENTS);

    if (error || !data) return [];

    return data.map((row) => ({
      id: row.id,
      timestamp: row.created_at,
      actor: row.actor as GolemActor,
      type: row.type as EventType,
      data: row.data,
    }));
  }

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
// Seen Jobs (seen-jobs.json / golem_seen_jobs)
// ═══════════════════════════════════════════════════════

/** Check if a job has been seen */
export async function isJobSeen(jobId: string): Promise<boolean> {
  if (STATE_BACKEND === "supabase") {
    const { data } = await getSupabaseOrThrow()
      .from("golem_seen_jobs")
      .select("job_id")
      .eq("job_id", jobId)
      .single();

    return !!data;
  }

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
  if (STATE_BACKEND === "supabase") {
    const { error } = await getSupabaseOrThrow()
      .from("golem_seen_jobs")
      .upsert({ job_id: jobId, seen_at: new Date().toISOString() });

    if (error) {
      console.error("[StateStore] Failed to mark job seen:", error.message);
    }
    return;
  }

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
  if (STATE_BACKEND === "supabase") {
    const rows = jobIds.map((id) => ({ job_id: id, seen_at: new Date().toISOString() }));
    const { error } = await getSupabaseOrThrow()
      .from("golem_seen_jobs")
      .upsert(rows);

    if (error) {
      console.error("[StateStore] Failed to mark jobs seen:", error.message);
    }
    return;
  }

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

// ═══════════════════════════════════════════════════════
// Service Run Reporting (always writes to Supabase for dashboard)
// ═══════════════════════════════════════════════════════

/**
 * Report a service run to Supabase for dashboard visibility.
 * Always writes to Supabase regardless of STATE_BACKEND setting.
 * This ensures local launchd services are visible on the dashboard.
 */
export async function reportServiceRun(key: string): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) return;

  try {
    const client = getSupabase();
    if (!client) return;
    const { error } = await client.from("golem_state").upsert({
      key,
      value: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error(`[StateStore] Supabase upsert error for "${key}":`, error.message);
    }
  } catch (err) {
    // Dashboard reporting is non-critical, never fail the service
    console.error(`[StateStore] Failed to report service run "${key}":`, err);
  }
}

/** Get all seen job IDs (for compatibility with Set-based scraper) */
export async function getSeenJobIds(): Promise<Set<string>> {
  if (STATE_BACKEND === "supabase") {
    const { data } = await getSupabaseOrThrow()
      .from("golem_seen_jobs")
      .select("job_id");

    return new Set((data || []).map((row) => row.job_id));
  }

  // File mode
  try {
    if (!existsSync(SEEN_JOBS_FILE)) return new Set();
    const seen: string[] = JSON.parse(readFileSync(SEEN_JOBS_FILE, "utf-8"));
    return new Set(seen);
  } catch {
    return new Set();
  }
}

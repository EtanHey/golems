#!/usr/bin/env bun
/**
 * Cloud Worker - Scheduler Entry Point
 *
 * Runs all cloud golems on timezone-aware schedules in a single process.
 * Can replace separate schedulers for email-golem and briefing.
 *
 * ══════════════════════════════════════════════════════════════
 * SCHEDULE (All times Israel/Asia/Jerusalem)
 * ══════════════════════════════════════════════════════════════
 *
 *   Email Golem:     Every 1h during 6am-7pm (skip 12pm lunch)
 *                    One final check at 10pm, OFF overnight (10pm-6am)
 *                    ~12 runs/day vs old 144 runs/day → 92% cost savings
 *
 *   Briefing:        8am daily
 * ══════════════════════════════════════════════════════════════
 *
 * ENV defaults (override as needed for the active host):
 *   LLM_BACKEND=haiku
 *   STATE_BACKEND=supabase
 *   TZ=Asia/Jerusalem
 *
 * Usage:
 *   bun run src/cloud-worker.ts                # Run everything
 *   bun run src/cloud-worker.ts --email-only   # Just email golem
 */

// Default cloud env vars (can be overridden)
if (!process.env.LLM_BACKEND) process.env.LLM_BACKEND = "haiku";
if (!process.env.STATE_BACKEND) process.env.STATE_BACKEND = "supabase";

// Catch unhandled errors before they crash the worker silently
import { installProcessGuards } from "@golems/shared/lib/process-guards";
installProcessGuards("cloud-worker");

// Axiom observability (lazy)
async function getAxiomHelpers() {
  const mod = await import("@golems/shared/lib/axiom");
  return {
    logServiceEvent: mod.logServiceEvent,
    logError: mod.logError,
    flushAxiom: mod.flushAxiom,
  };
}

// ALL imports are lazy — health endpoint must start before any module loads
async function getUsage() {
  const mod = await import("@golems/shared/lib/cloud-llm");
  return {
    getUsageStats: mod.getUsageStats,
    getUsageBySource: mod.getUsageBySource,
  };
}

async function getCostTracker() {
  const mod = await import("@golems/shared/lib/cost-tracker");
  return { getSupabaseUsageStats: mod.getSupabaseUsageStats };
}

// Lazy imports to avoid loading everything at startup
async function getEmailGolem() {
  const mod = await import("@golems/shared/email/index");
  return mod.processEmails;
}

async function getBriefing() {
  const mod = await import("./briefing");
  return mod.sendBriefing;
}

async function getCalendarSync() {
  const mod = await import("@golems/coach/calendar-sync");
  return mod.syncCalendarToSupabase;
}

// ═══════════════════════════════════════════════════════
// Safe execution wrapper
// ═══════════════════════════════════════════════════════

async function getServiceRunReporter() {
  return (await import("@golems/shared/lib/supabase-factory")).getSupabase();
}

async function safeRun(
  name: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const start = Date.now();
  const startedAt = new Date().toISOString();
  console.log(`[CloudWorker] Starting ${name}...`);

  let status = "success";
  let error: string | null = null;
  let result: Record<string, any> = {};

  try {
    const fnResult = await fn();
    if (fnResult && typeof fnResult === "object") {
      result = fnResult as Record<string, any>;
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[CloudWorker] ${name} completed (${elapsed}s)`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CloudWorker] ${name} FAILED (${elapsed}s):`, message);
    status = "error";
    error = message;
  }

  // Report to Axiom (fire-and-forget)
  try {
    const { logServiceEvent, logError: logAxiomError } =
      await getAxiomHelpers();
    const durationMs = Date.now() - start;
    logServiceEvent({
      service: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      event: "run",
      status: status === "success" ? "success" : "failure",
      duration_ms: durationMs,
      metadata: error ? { error } : result,
    });
    if (error) {
      logAxiomError({
        service: name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        error_message: error,
        error_type: "service_run_failure",
      });
    }
  } catch {
    // Non-critical
  }

  // Report service run to Supabase (fire-and-forget)
  try {
    const sb = await getServiceRunReporter();
    if (sb) {
      const durationMs = Date.now() - start;
      const endedAt = new Date().toISOString();
      sb.from("service_runs")
        .insert({
          service: name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
          started_at: startedAt,
          ended_at: endedAt,
          duration_ms: durationMs,
          status,
          result,
          error,
        })
        .then(({ error: dbErr }) => {
          if (dbErr)
            console.error(
              "[CloudWorker] service_runs insert failed:",
              dbErr.message,
            );
        })
        .catch((err: unknown) => {
          console.error(
            "[CloudWorker] service_runs network error:",
            err instanceof Error ? err.message : err,
          );
        });

      // Update golem_state timestamps + status for dashboard service status
      const stateKeyPrefixes: [string, string][] = [
        ["EmailGolem", "lastEmailCheck"],
        ["Briefing", "lastBriefing"],
        ["CalendarSync", "lastCalendarSync"],
      ];
      const stateKey = stateKeyPrefixes.find(([prefix]) =>
        name.startsWith(prefix),
      )?.[1];
      if (stateKey) {
        // Write plain timestamp to original key (consumers expect ISO string)
        sb.from("golem_state")
          .upsert(
            { key: stateKey, value: endedAt, updated_at: endedAt },
            { onConflict: "key" },
          )
          .then(({ error: stateErr }) => {
            if (stateErr)
              console.error(
                `[CloudWorker] golem_state ${stateKey} upsert failed:`,
                stateErr.message,
              );
          })
          .catch((err: unknown) => {
            console.error(
              `[CloudWorker] golem_state ${stateKey} network error:`,
              err instanceof Error ? err.message : err,
            );
          });
        // Write status metadata to separate key for dashboard health display
        const metaValue = JSON.stringify({
          time: endedAt,
          status,
          error: error?.slice(0, 200) ?? null,
        });
        sb.from("golem_state")
          .upsert(
            { key: `${stateKey}_meta`, value: metaValue, updated_at: endedAt },
            { onConflict: "key" },
          )
          .then(({ error: stateErr }) => {
            if (stateErr)
              console.error(
                `[CloudWorker] golem_state ${stateKey}_meta upsert failed:`,
                stateErr.message,
              );
          })
          .catch((err: unknown) => {
            console.error(
              `[CloudWorker] golem_state ${stateKey}_meta network error:`,
              err instanceof Error ? err.message : err,
            );
          });
      }
    }
  } catch (err) {
    console.warn(
      "[CloudWorker] Supabase reporting error:",
      err instanceof Error ? err.message : err,
    );
  }
}

// ═══════════════════════════════════════════════════════
// Timezone helpers
// ═══════════════════════════════════════════════════════

/** Returns current hour (0-23) in Israel timezone */
function getIsraelHour(): number {
  const now = new Date();
  const israelTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }),
  );
  return israelTime.getHours();
}

/** Returns current day of week in Israel timezone (0=Sun, 6=Sat) */
function getIsraelDay(): number {
  const now = new Date();
  const israelTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }),
  );
  return israelTime.getDay();
}

/** Israeli work week: Sunday (0) through Thursday (4) */
function isIsraeliWorkday(): boolean {
  const day = getIsraelDay();
  return day >= 0 && day <= 4; // Sun=0, Mon=1, Tue=2, Wed=3, Thu=4
}

/** Active hours: 6am-7pm Israel time (email runs hourly, skip lunch) */
function isActiveHours(): boolean {
  const hour = getIsraelHour();
  return hour >= 6 && hour < 19;
}

/** Lunch hour: 12pm Israel time (skip email check) */
function isLunchHour(): boolean {
  return getIsraelHour() === 12;
}

/** Late night check: 10pm Israel time (one final email check) */
function isLateNightCheck(): boolean {
  return getIsraelHour() === 22;
}

// ═══════════════════════════════════════════════════════
// Schedule helpers
// ═══════════════════════════════════════════════════════

/** Run a function at a specific hour (Israel time), checked every minute */
function scheduleDaily(
  name: string,
  hour: number,
  fn: () => Promise<unknown>,
): void {
  let lastRunDate = "";

  setInterval(() => {
    const currentHour = getIsraelHour();
    const today = new Date().toISOString().slice(0, 10);

    // Run once per day at the target hour
    if (currentHour === hour && lastRunDate !== today) {
      lastRunDate = today;
      safeRun(name, fn);
    }
  }, 60_000); // Check every minute
}

/**
 * Email Golem scheduler:
 *   6am-7pm: hourly (skip 12pm lunch)
 *   10pm: one final check
 *   10pm-6am: OFF completely
 */
function scheduleEmail(fn: () => Promise<unknown>): void {
  let lastRunKey = "";

  const check = () => {
    const hour = getIsraelHour();
    const today = new Date().toISOString().slice(0, 10);
    const runKey = `${today}-${hour}`;

    // Already ran this hour
    if (lastRunKey === runKey) return;

    // Active hours (6am-7pm) but skip lunch (12pm)
    if (isActiveHours() && !isLunchHour()) {
      lastRunKey = runKey;
      safeRun("EmailGolem", fn);
      return;
    }

    // Late night check (10pm)
    if (isLateNightCheck()) {
      lastRunKey = runKey;
      safeRun("EmailGolem (night)", fn);
      return;
    }

    // Otherwise: OFF (7pm-10pm gap, 10pm-6am sleep)
  };

  // Run immediately on startup if within active hours
  if (isActiveHours() || isLateNightCheck()) {
    lastRunKey = `${new Date().toISOString().slice(0, 10)}-${getIsraelHour()}`;
    safeRun("EmailGolem (initial)", fn);
  }

  // Check every 10 minutes
  setInterval(check, 10 * 60_000);
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

const args = process.argv.slice(2);
const emailOnly = args.includes("--email-only");
const singleMode = emailOnly;

console.log("[CloudWorker] Starting...");
console.log(`[CloudWorker] LLM_BACKEND=${process.env.LLM_BACKEND}`);
console.log(`[CloudWorker] STATE_BACKEND=${process.env.STATE_BACKEND}`);
console.log(
  `[CloudWorker] Israel time: ${new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" })}`,
);
console.log(
  `[CloudWorker] Work hours now: ${isActiveHours()}, Workday: ${isIsraeliWorkday()}`,
);

// ═══════════════════════════════════════════════════════
// Health endpoint FIRST (must respond before heavier golem imports)
// Starts before golem imports so crashes don't kill healthcheck.
// ═══════════════════════════════════════════════════════

const PORT = parseInt(process.env.PORT || "8080", 10);
const startTime = Date.now();
let golemStatus = "loading";
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      const { buildHealthResponse } = await import("./health");
      const health = buildHealthResponse({ golemStatus, startTime });
      return Response.json(
        {
          ...health.body,
          backend: process.env.LLM_BACKEND,
          stateBackend: process.env.STATE_BACKEND,
          israelTime: new Date().toLocaleString("en-US", {
            timeZone: "Asia/Jerusalem",
          }),
          isWorkHours: isActiveHours(),
          isWorkday: isIsraeliWorkday(),
        },
        { status: health.status },
      );
    }

    if (url.pathname === "/ready") {
      const { buildReadyResponse, checkDbConnectivity } =
        await import("./health");
      const dbConnected = await checkDbConnectivity();
      const ready = buildReadyResponse({ golemStatus, dbConnected });
      return Response.json(ready.body, { status: ready.status });
    }

    if (url.pathname === "/usage") {
      const validPeriods = ["today", "week", "month", "all"] as const;
      const rawPeriod = url.searchParams.get("period") || "today";
      const period = validPeriods.includes(rawPeriod as any)
        ? (rawPeriod as (typeof validPeriods)[number])
        : "today";

      // Try Supabase first (persistent, survives deploys)
      try {
        const { getSupabaseUsageStats } = await getCostTracker();
        const stats = await getSupabaseUsageStats(period);
        return Response.json({
          source: "supabase",
          period,
          ...stats,
        });
      } catch {
        // Fall back to in-memory stats
        const { getUsageStats, getUsageBySource } = await getUsage();
        return Response.json({
          source: "memory",
          period: "since-deploy",
          ...getUsageStats(),
          bySource: getUsageBySource(),
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[CloudWorker] Health endpoint on port ${PORT}`);

// ═══════════════════════════════════════════════════════
// Load and schedule golems (after health endpoint is up)
// ═══════════════════════════════════════════════════════

try {
  if (!singleMode) {
    const processEmails = await getEmailGolem();
    scheduleEmail(processEmails);

    const sendBriefing = await getBriefing();
    scheduleDaily("Briefing", 8, sendBriefing);

    // Calendar sync: 3 times/day to catch new events
    // 7am (morning), 12pm (midday), 6pm (evening)
    const syncCalendar = await getCalendarSync();
    for (const hour of [7, 12, 18]) {
      scheduleDaily("CalendarSync", hour, syncCalendar);
    }

    console.log("[CloudWorker] All services scheduled:");
    console.log(
      "  - EmailGolem: hourly 6am-7pm (skip lunch), 10pm final, OFF overnight",
    );
    console.log("  - Briefing: 8am Israel");
    console.log("  - CalendarSync: 7am, 12pm, 6pm Israel");
  } else if (emailOnly) {
    const processEmails = await getEmailGolem();
    scheduleEmail(processEmails);
    console.log("[CloudWorker] Email-only mode");
  }

  golemStatus = "running";
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[CloudWorker] Failed to load golems:", message);
  golemStatus = `error: ${message}`;
}

// Flush Axiom on shutdown
process.on("SIGTERM", async () => {
  console.log("[CloudWorker] SIGTERM received, flushing Axiom...");
  try {
    const { flushAxiom } = await getAxiomHelpers();
    await flushAxiom();
  } catch (err) {
    console.warn(
      "[CloudWorker] Axiom flush on shutdown failed:",
      err instanceof Error ? err.message : err,
    );
  }
  process.exit(0);
});

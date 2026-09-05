/**
 * Schedule Engine for CoachGolem
 *
 * Merges calendar events + golem ecosystem state into a daily plan.
 * Includes time-awareness: circadian phase tracking, anomaly detection,
 * and scheduling signals based on protocol wake/bed times.
 */

import type { CalendarEvent } from "./calendar-client";
import type { EcosystemStatus } from "./status-aggregator";
import { getPendingWork } from "./status-aggregator";
import type { CoachedPlan } from "./index";
import type { CoachProtocol } from "./protocol";

// --- Time Context Types ---

export type CircadianPhase =
  | "sleep"
  | "waking"
  | "cortisol-peak"
  | "peak-focus"
  | "sustained-work"
  | "post-lunch-dip"
  | "afternoon"
  | "evening"
  | "wind-down"
  | "late-night";

const PHASE_LABELS: Record<CircadianPhase, string> = {
  sleep: "Sleep",
  waking: "Just Woke Up",
  "cortisol-peak": "Cortisol Peak (delay caffeine)",
  "peak-focus": "Peak Focus Window",
  "sustained-work": "Sustained Work",
  "post-lunch-dip": "Post-Lunch Dip (NSDR time)",
  afternoon: "Afternoon",
  evening: "Evening",
  "wind-down": "Wind Down",
  "late-night": "Late Night",
};

export interface TimeContext {
  now: Date;
  timeStr: string; // "01:33" in Israel TZ
  dateStr: string; // "2026-02-27"
  dayOfWeek: string; // "Friday"

  // Circadian (relative to user's wake/bed pattern)
  phase: CircadianPhase;
  phaseLabel: string;
  hoursSinceWake: number;
  hoursUntilBed: number;

  // Scheduling signals
  caffeineOk: boolean;
  workoutWindow: boolean;
  peakFocus: boolean;
  shouldWindDown: boolean;

  // Anomaly detection
  anomaly: string | null;
}

// --- Time Context Engine ---

const TIMEZONE = "Asia/Jerusalem";

/** Parse "HH:MM" into hours as a number (e.g., "02:30" → 2.5) */
function parseTimeToHours(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h + m / 60;
}

/** Get current Israel time string (HH:MM) */
export function getIsraelTimeStr(now: Date): string {
  return now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

/** Get current Israel date string (YYYY-MM-DD) */
export function getIsraelDateStr(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Get Israel hour as a number (e.g., 14.5 for 14:30) */
function getIsraelHour(now: Date): number {
  const timeStr = getIsraelTimeStr(now);
  return parseTimeToHours(timeStr);
}

/** Get day of week in Israel timezone */
function getIsraelDayOfWeek(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
  }).format(now);
}

/**
 * Compute circadian phase from hours since wake.
 * Phases are relative to wake time, not wall clock.
 */
export function computeCircadianPhase(
  hoursSinceWake: number,
  hoursUntilBed: number,
): CircadianPhase {
  if (hoursSinceWake < 0) return "sleep";
  if (hoursSinceWake < 0.5) return "waking";
  if (hoursSinceWake < 2) return "cortisol-peak";
  if (hoursSinceWake < 4) return "peak-focus";
  if (hoursSinceWake < 7) return "sustained-work";
  if (hoursSinceWake < 8) return "post-lunch-dip";
  if (hoursSinceWake < 10) return "afternoon";
  if (hoursSinceWake < 12) return "evening";
  if (hoursUntilBed > 0) return "wind-down";
  return "late-night";
}

/**
 * Detect scheduling anomalies.
 */
export function detectAnomaly(
  israelHour: number,
  hoursSinceWake: number,
  hoursUntilBed: number,
): string | null {
  // Going to sleep before noon — probably didn't sleep well
  if (hoursSinceWake < 0 && israelHour < 12 && israelHour >= 6) {
    return "Going to sleep before noon — rough night?";
  }
  // Up 3+ hours past bed target
  if (hoursUntilBed <= -3) {
    return `${Math.abs(hoursUntilBed).toFixed(1)}h past bed target — sleep debt building`;
  }
  // Past bed target
  if (hoursUntilBed < 0 && hoursUntilBed > -3) {
    return "Past bed target — you should be sleeping";
  }
  // Awake 16+ hours — cognitive decline zone
  if (hoursSinceWake >= 16) {
    return `${hoursSinceWake.toFixed(1)}h awake — cognitive decline zone`;
  }
  return null;
}

/**
 * Get full time context relative to the user's protocol.
 * Pass `now` to override current time (for testing).
 */
export function getTimeContext(
  protocol: CoachProtocol,
  now?: Date,
): TimeContext {
  const currentTime = now ?? new Date();
  const israelHour = getIsraelHour(currentTime);
  const wakeH = parseTimeToHours(protocol.sleep.targetWake);
  const bedH = parseTimeToHours(protocol.sleep.targetBed);

  // Hours since wake — handles cross-midnight bed times
  let hoursSinceWake: number;
  if (bedH < wakeH) {
    // Bed is after midnight (e.g., bed=02:30, wake=10:30)
    if (israelHour >= wakeH) {
      // After wake, same day
      hoursSinceWake = israelHour - wakeH;
    } else if (israelHour < bedH) {
      // After midnight, before bed (still "today" from wake perspective)
      hoursSinceWake = 24 - wakeH + israelHour;
    } else {
      // Between bed and wake = sleeping
      hoursSinceWake = -(wakeH - israelHour);
    }
  } else {
    // Normal schedule (bed after wake, same day)
    hoursSinceWake = israelHour - wakeH;
  }

  // Hours until bed
  let hoursUntilBed: number;
  if (bedH < wakeH) {
    // Cross-midnight bed
    if (israelHour >= wakeH) {
      hoursUntilBed = 24 - israelHour + bedH;
    } else if (israelHour < bedH) {
      hoursUntilBed = bedH - israelHour;
    } else {
      // Between bed and wake (sleeping) — bed is "tomorrow"
      hoursUntilBed = 24 - israelHour + bedH;
    }
  } else {
    hoursUntilBed = bedH - israelHour;
  }

  const caffeineDelayH = protocol.huberman.caffeineDelay.minutesAfterWake / 60;
  const phase = computeCircadianPhase(hoursSinceWake, hoursUntilBed);

  return {
    now: currentTime,
    timeStr: getIsraelTimeStr(currentTime),
    dateStr: getIsraelDateStr(currentTime),
    dayOfWeek: getIsraelDayOfWeek(currentTime),

    phase,
    phaseLabel: PHASE_LABELS[phase],
    hoursSinceWake: Math.round(hoursSinceWake * 100) / 100,
    hoursUntilBed: Math.round(hoursUntilBed * 100) / 100,

    caffeineOk: hoursSinceWake >= caffeineDelayH,
    workoutWindow: hoursSinceWake >= 0 && hoursSinceWake <= 3,
    peakFocus: hoursSinceWake >= 2 && hoursSinceWake < 4,
    shouldWindDown:
      israelHour >= parseTimeToHours(protocol.sleep.hardCodingStop) &&
      israelHour < wakeH,

    anomaly: detectAnomaly(israelHour, hoursSinceWake, hoursUntilBed),
  };
}

/** Format TimeContext as a compact summary string */
export function formatTimeContext(ctx: TimeContext): string {
  const lines: string[] = [];
  lines.push(
    `${ctx.timeStr} IST | ${ctx.dayOfWeek} ${ctx.dateStr} | Phase: ${ctx.phase}`,
  );
  if (ctx.anomaly) {
    lines.push(`Warning: ${ctx.anomaly}`);
  }
  lines.push(
    `Hours awake: ${ctx.hoursSinceWake.toFixed(1)} | Until bed: ${ctx.hoursUntilBed.toFixed(1)} | Caffeine: ${ctx.caffeineOk ? "OK" : "NO"} | Focus: ${ctx.peakFocus ? "YES" : "NO"}`,
  );
  return lines.join("\n");
}

// --- Original Schedule Engine ---

export interface TimeBlock {
  start: string;
  end: string;
  type: "meeting" | "focus" | "break";
  title: string;
  source: "calendar" | "golem" | "habit";
}

export interface DailyPlan {
  date: string;
  greeting: string;
  blocks: TimeBlock[];
  pendingItems: string[];
  summary: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

/** Get greeting based on Israel timezone (not UTC) */
export function getGreeting(now?: Date): string {
  const hour = getIsraelHour(now ?? new Date());
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Generate a daily plan from calendar events and ecosystem status.
 */
export function generateDailyPlan(
  events: CalendarEvent[],
  statuses: EcosystemStatus,
): DailyPlan {
  const today = new Date();
  const date = getIsraelDateStr(today);

  // Convert non-allDay events to time blocks
  const blocks: TimeBlock[] = events
    .filter((e) => !e.allDay)
    .map((e) => ({
      start: formatTime(e.start),
      end: formatTime(e.end),
      type: "meeting" as const,
      title: e.summary,
      source: "calendar" as const,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));

  // Extract pending items from golem statuses
  const work = getPendingWork(statuses);
  const pendingItems = work.map(
    (w) => `[${w.priority.toUpperCase()}] ${w.item}`,
  );

  // Generate summary
  const meetingCount = blocks.length;
  const urgentCount = work.filter((w) => w.priority === "high").length;

  let summary: string;
  if (meetingCount === 0 && urgentCount === 0) {
    summary = `Clear day — ${work.length > 0 ? `${work.length} items to review` : "nothing pending"}`;
  } else {
    const parts: string[] = [];
    if (meetingCount > 0)
      parts.push(`${meetingCount} meeting${meetingCount > 1 ? "s" : ""}`);
    if (urgentCount > 0)
      parts.push(`${urgentCount} urgent item${urgentCount > 1 ? "s" : ""}`);
    summary = `Today: ${parts.join(", ")}`;
  }

  return {
    date,
    greeting: getGreeting(),
    blocks,
    pendingItems,
    summary,
  };
}

/**
 * Format a daily plan for Telegram.
 */
export function formatPlanForTelegram(plan: DailyPlan): string {
  const lines: string[] = [];

  lines.push(`${plan.greeting}!`);
  lines.push("");
  lines.push(plan.summary);

  if (plan.blocks.length > 0) {
    lines.push("");
    lines.push("Schedule:");
    for (const block of plan.blocks) {
      lines.push(`  ${block.start}–${block.end}  ${block.title}`);
    }
  }

  if (plan.pendingItems.length > 0) {
    lines.push("");
    lines.push("Pending:");
    for (const item of plan.pendingItems) {
      lines.push(`  ${item}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a coached plan for Telegram.
 * Includes coaching advice, workout, schedule, and protocol reminders.
 */
export function formatCoachedPlanForTelegram(coachedPlan: CoachedPlan): string {
  const { plan, coaching } = coachedPlan;
  const lines: string[] = [];

  lines.push(`${plan.greeting}!`);

  // Coaching advice
  lines.push("");
  lines.push(coaching.advice);

  // Workout
  lines.push("");
  lines.push(
    `Workout: ${coaching.workout.type} (${coaching.workout.duration})`,
  );
  if (coaching.workout.notes) {
    lines.push(`   ${coaching.workout.notes}`);
  }

  // Schedule
  if (plan.blocks.length > 0) {
    lines.push("");
    lines.push("Schedule:");
    for (const block of plan.blocks) {
      lines.push(`  ${block.start}–${block.end}  ${block.title}`);
    }
  }

  // Pending items
  if (plan.pendingItems.length > 0) {
    lines.push("");
    lines.push("Pending:");
    for (const item of plan.pendingItems.slice(0, 5)) {
      lines.push(`  ${item}`);
    }
  }

  // Huberman reminders
  if (coaching.hubermanReminders.length > 0) {
    lines.push("");
    lines.push("Reminders:");
    for (const r of coaching.hubermanReminders) {
      lines.push(`  ${r}`);
    }
  }

  return lines.join("\n");
}

/**
 * Daily Brief Generator — Pure markdown generation functions.
 *
 * Generates Obsidian-flavored markdown with callout drawers for phone-friendly
 * daily notes. Auto-generated schedule and coaching sections are open.
 * User input sections (check-in, reflections, debrief) are collapsed.
 */

import type { CalendarEvent } from "./calendar-client";
import type { CoachingOutput } from "./coaching-engine";
import type { CoachProtocol } from "./protocol";
import type { TimeContext } from "./schedule-engine";
import { getIsraelDateStr } from "./schedule-engine";

// --- Types ---

export interface DailyData {
  events: CalendarEvent[];
  coaching: CoachingOutput | null;
  timeCtx: TimeContext;
  protocol: CoachProtocol;
  pendingItems: string[];
}

// --- Helpers ---

function formatEventTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(date);
}

// --- Section Generators ---

export function generateScheduleSection(events: CalendarEvent[]): string {
  const nonAllDay = events.filter((e) => !e.allDay);

  if (nonAllDay.length === 0) {
    return `> [!example] Schedule
> _No events today — open day_`;
  }

  const lines: string[] = [];
  lines.push("> [!example] Schedule");

  for (const event of nonAllDay) {
    const start = formatEventTime(event.start);
    const end = formatEventTime(event.end);
    lines.push(`> \`${start}-${end}\` ${event.summary}`);
  }

  return lines.join("\n");
}

export function generateCoachingSection(data: DailyData): string {
  const { coaching, protocol } = data;

  const lines: string[] = [];
  lines.push("> [!tip] Coach Says");

  if (coaching) {
    lines.push(`> ${coaching.advice}`);
    lines.push(">");
    lines.push(
      `> **Workout:** ${coaching.workout.type} (${coaching.workout.duration})`,
    );
    if (coaching.workout.notes) {
      lines.push(`> _${coaching.workout.notes}_`);
    }
    lines.push(">");
    lines.push("> **Reminders:**");
    for (const r of coaching.hubermanReminders) {
      lines.push(`> - ${r}`);
    }
  } else {
    lines.push("> _LLM coaching unavailable — showing protocol reminders_");
    lines.push(">");
    lines.push(
      `> - Caffeine delay: ${protocol.huberman.caffeineDelay.minutesAfterWake} min after wake`,
    );
    lines.push(
      `> - NSDR: ${protocol.huberman.nsdr.durationMinutes}min at ${protocol.huberman.nsdr.idealTime}`,
    );
    lines.push(
      `> - Afternoon sun: ${protocol.huberman.afternoonLight.minMinutes}min at ${protocol.huberman.afternoonLight.idealTime}`,
    );
    lines.push(`> - Hard coding stop: ${protocol.sleep.hardCodingStop}`);
    lines.push(
      `> - Supplements: ${protocol.huberman.supplements.preSleep.map((s) => `${s.name} ${s.dose}`).join(", ")} — ${protocol.huberman.supplements.preSleep[0]?.minutesBeforeBed}min before bed`,
    );
  }

  return lines.join("\n");
}

export function generateMorningCheckIn(): string {
  return `> [!question]- Morning Check-in
> _Fill in when you wake up_
>
> How did I sleep?
>
> Energy (1-5):
>
> Mood (1-5):
>
> Today's intention:`;
}

export function generatePriorities(pendingItems: string[]): string {
  const lines: string[] = [];
  lines.push("> [!success] Priorities");
  lines.push("> _Top 3 for today — pick before starting anything_");
  lines.push(">");
  lines.push("> 1.");
  lines.push("> 2.");
  lines.push("> 3.");

  if (pendingItems.length > 0) {
    lines.push(">");
    lines.push("> **From golems:**");
    for (const item of pendingItems.slice(0, 5)) {
      lines.push(`> - ${item}`);
    }
  }

  return lines.join("\n");
}

export function generateReflections(): string {
  return `> [!note]- Reflections
> _Fill in during the day or evening_
>
> **What went well:**
>
>
> **What was hard:**
>
>
> **What surprised me:**
>`;
}

export function generateEveningDebrief(): string {
  return `> [!warning]- Evening Debrief
> _Fill in before bed_
>
> - [ ] Followed the plan? (1-5):
> - [ ] Ate 2 meals?
> - [ ] Worked out?
> - [ ] Job search done?
> - [ ] Chase walks done?
>
> **Biggest win:**
>
> **Biggest struggle:**
>
> **What would I do differently:**
>
> **Tomorrow's #1 priority:**
>`;
}

/**
 * Generate a complete daily note from fetched data.
 */
export function generateDailyNote(data: DailyData, targetDate: Date): string {
  const title = formatDate(targetDate);

  const sections: string[] = [];

  // Header
  sections.push(`# ${title}`);
  sections.push("");

  // Auto-generated sections (open)
  sections.push(generateScheduleSection(data.events));
  sections.push("");
  sections.push(generateCoachingSection(data));
  sections.push("");

  // User input: morning check-in (collapsed — tap to expand)
  sections.push(generateMorningCheckIn());
  sections.push("");

  // Priorities (open)
  sections.push(generatePriorities(data.pendingItems));
  sections.push("");

  // Separator
  sections.push("---");
  sections.push("");

  // User input: reflections (collapsed)
  sections.push(generateReflections());
  sections.push("");

  // User input: evening debrief (collapsed)
  sections.push(generateEveningDebrief());
  sections.push("");

  // Footer
  sections.push("---");
  sections.push(
    `_Generated by CoachGolem at ${data.timeCtx.timeStr} (Israel time)_`,
  );

  return sections.join("\n");
}

// --- Section Merge Logic ---

export interface UserSections {
  morningCheckIn: string | null;
  reflections: string | null;
  eveningDebrief: string | null;
}

/**
 * Extract user-filled content from existing daily note.
 * Returns non-null for sections where the user has written something.
 */
export function extractUserSections(content: string): UserSections {
  const sections: UserSections = {
    morningCheckIn: null,
    reflections: null,
    eveningDebrief: null,
  };

  const morningMatch = content.match(
    /> \[!question\][- ]* Morning Check-in\n([\s\S]*?)(?=\n> \[!|\n---)/,
  );
  if (morningMatch) {
    const body = morningMatch[1];
    if (/Energy \(1-5\):\s*\d/.test(body) || /Mood \(1-5\):\s*\d/.test(body)) {
      sections.morningCheckIn = morningMatch[0];
    }
  }

  const reflectMatch = content.match(
    /> \[!note\][- ]* Reflections\n([\s\S]*?)(?=\n> \[!|\n---)/,
  );
  if (reflectMatch) {
    const body = reflectMatch[1];
    // Strip template markers: bold headers, quote markers, italic placeholders
    const stripped = body
      .replace(/> \*\*.*?\*\*/g, "")
      .replace(/> _.*?_/g, "")
      .replace(/>/g, "")
      .trim();
    if (stripped.length > 0) {
      sections.reflections = reflectMatch[0];
    }
  }

  const debriefMatch = content.match(
    /> \[!warning\][- ]* Evening Debrief\n([\s\S]*?)(?=\n---)/,
  );
  if (debriefMatch) {
    const body = debriefMatch[1];
    if (body.includes("[x]") || /\*\*Biggest win:\*\*\s*\S/.test(body)) {
      sections.eveningDebrief = debriefMatch[0];
    }
  }

  return sections;
}

/**
 * Merge user-filled sections back into freshly generated note.
 * Auto-generated schedule and coaching sections get updated.
 * User sections are preserved if they have content.
 */
export function mergeUserSections(fresh: string, user: UserSections): string {
  let result = fresh;

  if (user.morningCheckIn) {
    result = result.replace(
      /> \[!question\][- ]* Morning Check-in\n[\s\S]*?(?=\n\n> \[!|$)/m,
      user.morningCheckIn,
    );
  }

  if (user.reflections) {
    result = result.replace(
      /> \[!note\][- ]* Reflections\n[\s\S]*?(?=\n\n> \[!|$)/m,
      user.reflections,
    );
  }

  if (user.eveningDebrief) {
    result = result.replace(
      /> \[!warning\][- ]* Evening Debrief\n[\s\S]*?(?=\n\n---|$)/m,
      user.eveningDebrief,
    );
  }

  return result;
}

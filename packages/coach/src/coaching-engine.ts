/**
 * LLM Coaching Engine
 *
 * Synthesizes protocol, calendar, and pending work into personalized coaching advice.
 * Uses Gemini Flash-Lite (free) via @golems/shared.
 */

import { runCloudFree } from "@golems/shared/lib/vercel-llm";
import type { CoachProtocol } from "./protocol";
import type { CalendarEvent } from "./calendar-client";
import type { PendingWorkItem } from "./status-aggregator";

export interface CoachingInput {
  protocol: CoachProtocol;
  calendar: CalendarEvent[];
  pending: PendingWorkItem[];
  dayOfWeek: string;
}

export interface CoachingOutput {
  advice: string;
  workout: { type: string; duration: string; notes: string };
  hubermanReminders: string[];
}

function computeHubermanReminders(
  protocol: CoachProtocol,
  wakeTime: string,
): string[] {
  const reminders: string[] = [];
  const [wakeH, wakeM] = wakeTime.split(":").map(Number);
  const wakeMinutes = wakeH * 60 + wakeM;

  // Caffeine delay
  const coffeeMinutes =
    wakeMinutes + protocol.huberman.caffeineDelay.minutesAfterWake;
  const coffeeH = Math.floor(coffeeMinutes / 60) % 24;
  const coffeeM = coffeeMinutes % 60;
  reminders.push(
    `Coffee OK after ${String(coffeeH).padStart(2, "0")}:${String(coffeeM).padStart(2, "0")}`,
  );

  // NSDR
  reminders.push(`NSDR: 10min at ${protocol.huberman.nsdr.idealTime}`);

  // Afternoon light
  reminders.push(
    `Sunlight: 10min at ${protocol.huberman.afternoonLight.idealTime}`,
  );

  // Last caffeine
  const [bedH, bedM] = protocol.sleep.targetBed.split(":").map(Number);
  const bedMinutes = (bedH < 12 ? bedH + 24 : bedH) * 60 + bedM;
  const lastCafMinutes =
    bedMinutes - protocol.huberman.lastCaffeine.hoursBeforeBed * 60;
  const lcH = Math.floor(lastCafMinutes / 60) % 24;
  const lcM = lastCafMinutes % 60;
  reminders.push(
    `Last caffeine by ${String(lcH).padStart(2, "0")}:${String(lcM).padStart(2, "0")}`,
  );

  // Supplements
  for (const supp of protocol.huberman.supplements.preSleep) {
    const suppMinutes = bedMinutes - supp.minutesBeforeBed;
    const sH = Math.floor(suppMinutes / 60) % 24;
    const sM = suppMinutes % 60;
    reminders.push(
      `${supp.name} (${supp.dose}) at ${String(sH).padStart(2, "0")}:${String(sM).padStart(2, "0")}`,
    );
  }

  // Coding stop
  reminders.push(`Hard coding stop: ${protocol.sleep.hardCodingStop}`);

  return reminders;
}

function pickWorkout(
  protocol: CoachProtocol,
  dayOfWeek: string,
): { type: string; duration: string; notes: string } {
  const injuries = protocol.body.injuries
    .map((i) => `${i.area}: avoid ${i.avoidMovements.join(", ")}`)
    .join(". ");

  // Alternate run/strength based on the configured weekly rhythm.
  const isRunDay = ["Sunday", "Monday", "Wednesday", "Friday"].includes(
    dayOfWeek,
  );
  if (isRunDay) {
    return {
      type: "walk + easy run",
      duration: "40-45 min",
      notes: `10min walk + 20-25min easy jog. ${injuries}`,
    };
  }

  return {
    type: "walk + bodyweight strength",
    duration: "35-40 min",
    notes: `10min walk + squats, lunges, glute bridges, dead bugs. ${injuries}`,
  };
}

/** Generate rule-based fallback (no LLM needed) */
function generateFallbackAdvice(input: CoachingInput): string {
  const focus =
    input.protocol.career.interviewPrepRotation[input.dayOfWeek] || "flex day";
  return `${input.dayOfWeek} focus: ${focus}. Start with the highest-priority item, protect the planned focus blocks, and keep the hard coding stop at ${input.protocol.sleep.hardCodingStop}.`;
}

/** Generate coaching advice using LLM */
export async function generateCoaching(
  input: CoachingInput,
): Promise<CoachingOutput> {
  const workout = pickWorkout(input.protocol, input.dayOfWeek);
  const hubermanReminders = computeHubermanReminders(
    input.protocol,
    input.protocol.sleep.targetWake,
  );

  // Try LLM for natural coaching advice
  let advice: string;
  try {
    const prompt = buildCoachingPrompt(input, workout);
    const llmResult = await runCloudFree(prompt, "coach");
    advice = llmResult || generateFallbackAdvice(input);
  } catch {
    advice = generateFallbackAdvice(input);
  }

  return { advice, workout, hubermanReminders };
}

function buildCoachingPrompt(
  input: CoachingInput,
  workout: CoachingOutput["workout"],
): string {
  const p = input.protocol;
  const meetings =
    input.calendar
      .filter((e) => !e.allDay)
      .map(
        (e) =>
          `${e.summary} (${e.start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" })})`,
      )
      .join(", ") || "none";
  const pendingStr =
    input.pending
      .slice(0, 5)
      .map((w) => `[${w.priority}] ${w.item}`)
      .join("; ") || "none";

  const interviewFocus =
    p.career.interviewPrepRotation[input.dayOfWeek] || "flex day";
  const injuryContext =
    p.body.injuries.length > 0
      ? p.body.injuries
          .map(
            (injury) =>
              `${injury.area} ${injury.type} (avoid ${injury.avoidMovements.join(", ")})`,
          )
          .join("; ")
      : "none configured";
  const isShabbat =
    input.dayOfWeek === "Friday" || input.dayOfWeek === "Saturday";

  return `You are a personal coach for a software developer. Be direct, casual, no fluff. Under 120 words.

CONTEXT:
- Day: ${input.dayOfWeek}${isShabbat ? " (Shabbat)" : ""}
- Injuries: ${injuryContext}
- Career phase: ${p.career.phase}; focus today: ${interviewFocus}
- Sleep target: bed ${p.sleep.targetBed}, wake ${p.sleep.targetWake}
- Coding stop: ${p.sleep.hardCodingStop}
- Meetings: ${meetings}
- Pending golem tasks: ${pendingStr}

WORKOUT PLAN: ${workout.type} (${workout.duration})

Generate a brief, personalized daily coaching message. Include:
1. How to approach today's highest-priority work
2. One specific tip about sleep routine or focus
3. If anything needs adjusting based on the data

Keep it motivating but real. No generic advice.`;
}

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { generateCoaching } from "../coaching-engine";
import type { CoachProtocol } from "../protocol";

let lastPrompt = "";

mock.module("@golems/shared/lib/vercel-llm", () => ({
  runCloudFree: async (prompt: string) => {
    lastPrompt = prompt;
    return null;
  },
}));

function makeProtocol(): CoachProtocol {
  return {
    sleep: {
      phase: "shift",
      currentDay: 7,
      targetBed: "02:30",
      targetWake: "10:30",
      hardCodingStop: "00:30",
      preSleepBufferMinutes: 120,
      windDownDuration: 120,
      baselines: {
        avgHRV: null,
        avgRHR: null,
        sleepNeed: 8,
        recoveryGreenThreshold: 67,
        recoveryYellowThreshold: 34,
      },
    },
    body: {
      injuries: [
        {
          area: "right knee",
          type: "strain",
          avoidMovements: ["high-impact jumping"],
          painThreshold: 3,
        },
      ],
      workoutTiming: "after-wake",
      workoutTypes: ["easy-run", "zone2", "bodyweight", "walk", "stretching"],
    },
    career: {
      phase: "active-search",
      interviewPrepRotation: {
        Sunday: "System Design",
        Monday: "Leetcode",
        Tuesday: "Code Review",
        Wednesday: "Optimization",
        Thursday: "Behavioral-Technical",
      },
      dailyApplicationTarget: 2,
      strategy: "quality-targeted",
    },
    schedule: {
      flowBlocks: 3,
      flowBlockMinutes: 90,
      breakMinutes: 15,
      shabbatAware: true,
    },
    huberman: {
      morningLight: { minMinutes: 5, cloudyMinutes: 20, withinMinutesOfWake: 60 },
      caffeineDelay: { minutesAfterWake: 120 },
      ultradianCycle: { focusMinutes: 90, breakMinutes: 15 },
      nsdr: { durationMinutes: 10, idealTime: "14:00" },
      afternoonLight: { minMinutes: 10, idealTime: "15:00" },
      preSleepNoFood: { hoursBeforeBed: 3 },
      preSleepNoScreens: { hoursBeforeBed: 2 },
      lastCaffeine: { hoursBeforeBed: 10 },
      roomTemp: { celsius: { min: 18, max: 20 } },
      supplements: {
        preSleep: [
          { name: "Magnesium L-Threonate", dose: "145mg", minutesBeforeBed: 60 },
          { name: "Apigenin", dose: "50mg", minutesBeforeBed: 60 },
        ],
      },
    },
    coaching: { tone: "direct-casual", language: "english", neverNag: true },
  };
}

function makeInput(dayOfWeek = "Monday") {
  return {
    protocol: makeProtocol(),
    calendar: [],
    pending: [],
    dayOfWeek,
  };
}

beforeEach(() => {
  lastPrompt = "";
});

describe("generateCoaching without biometric data", () => {
  test("uses protocol context without inventing a health state", async () => {
    const input = makeInput();
    input.protocol.career.phase = "career-transition";

    const result = await generateCoaching(input);

    expect(lastPrompt).toContain("right knee strain");
    expect(lastPrompt).toContain("avoid high-impact jumping");
    expect(lastPrompt).toContain("career-transition");
    expect(lastPrompt).not.toContain("left shoulder");
    expect(lastPrompt).not.toContain("active job search");
    expect(lastPrompt).not.toContain("HEALTH:");
    expect(lastPrompt).not.toContain("Recovery:");
    expect(result).not.toHaveProperty("healthSnapshot");
  });

  test("selects an easy run on a run day", async () => {
    const result = await generateCoaching(makeInput("Monday"));

    expect(result.workout.type).toBe("walk + easy run");
    expect(result.workout.duration).toBe("40-45 min");
    expect(result.workout.notes).not.toContain("Green day");
  });

  test("selects bodyweight strength on a strength day", async () => {
    const result = await generateCoaching(makeInput("Tuesday"));

    expect(result.workout.type).toBe("walk + bodyweight strength");
    expect(result.workout.duration).toBe("35-40 min");
  });

  test("keeps injury constraints in the workout", async () => {
    const result = await generateCoaching(makeInput());

    expect(result.workout.notes).toContain("right knee");
    expect(result.workout.notes).toContain("high-impact jumping");
  });

  test("fallback advice remains useful without an external health source", async () => {
    const result = await generateCoaching(makeInput("Monday"));

    expect(result.advice).toContain("Leetcode");
    expect(result.advice).toContain("00:30");
    expect(result.advice).not.toMatch(/recovery|hrv|sleep score/i);
  });

  test("includes calendar and pending work in the LLM prompt", async () => {
    const input = makeInput();
    input.calendar = [
      {
        id: "event-1",
        summary: "Client call",
        start: new Date("2026-03-03T12:00:00+02:00"),
        end: new Date("2026-03-03T13:00:00+02:00"),
        allDay: false,
        status: "confirmed" as const,
      },
    ];
    input.pending = [
      { source: "jobs", item: "Review two matches", priority: "high" as const },
    ];

    await generateCoaching(input);

    expect(lastPrompt).toContain("Client call");
    expect(lastPrompt).toContain("Review two matches");
  });
});

describe("protocol reminders", () => {
  test("calculates caffeine timing from the configured wake time", async () => {
    const result = await generateCoaching(makeInput());
    expect(result.hubermanReminders).toContain("Coffee OK after 12:30");
  });

  test("includes NSDR and afternoon sunlight", async () => {
    const result = await generateCoaching(makeInput());
    expect(result.hubermanReminders).toContain("NSDR: 10min at 14:00");
    expect(result.hubermanReminders).toContain("Sunlight: 10min at 15:00");
  });

  test("calculates the last caffeine cutoff", async () => {
    const result = await generateCoaching(makeInput());
    expect(result.hubermanReminders).toContain("Last caffeine by 16:30");
  });

  test("includes supplement timing", async () => {
    const result = await generateCoaching(makeInput());
    expect(result.hubermanReminders).toContain(
      "Magnesium L-Threonate (145mg) at 01:30",
    );
    expect(result.hubermanReminders).toContain("Apigenin (50mg) at 01:30");
  });

  test("includes the configured coding stop", async () => {
    const result = await generateCoaching(makeInput());
    expect(result.hubermanReminders).toContain("Hard coding stop: 00:30");
  });

  test("reflects custom wake and caffeine-delay values", async () => {
    const input = makeInput();
    input.protocol.huberman.caffeineDelay.minutesAfterWake = 90;
    input.protocol.sleep.targetWake = "08:00";

    const result = await generateCoaching(input);

    expect(result.hubermanReminders).toContain("Coffee OK after 09:30");
  });
});

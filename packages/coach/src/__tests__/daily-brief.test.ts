import { describe, expect, test } from "bun:test";
import {
  generateScheduleSection,
  generateCoachingSection,
  generateMorningCheckIn,
  generatePriorities,
  generateReflections,
  generateEveningDebrief,
  generateDailyNote,
  extractUserSections,
  mergeUserSections,
  type DailyData,
} from "../daily-brief";
import type { CoachProtocol } from "../protocol";

// --- Test Fixtures ---

const MOCK_PROTOCOL: CoachProtocol = {
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
      Tuesday: "Code Review",
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

function makeDailyData(overrides: Partial<DailyData> = {}): DailyData {
  return {
    events: [],
    coaching: null,
    timeCtx: {
      now: new Date("2026-03-03T12:00:00+02:00"),
      timeStr: "12:00",
      dateStr: "2026-03-03",
      dayOfWeek: "Tuesday",
      phase: "peak-focus",
      phaseLabel: "Peak Focus Window",
      hoursSinceWake: 1.5,
      hoursUntilBed: 14.5,
      caffeineOk: false,
      workoutWindow: true,
      peakFocus: false,
      shouldWindDown: false,
      anomaly: null,
    },
    protocol: MOCK_PROTOCOL,
    pendingItems: [],
    ...overrides,
  };
}

// --- Schedule Section Tests ---

describe("generateScheduleSection", () => {
  test("shows empty day message", () => {
    const result = generateScheduleSection([]);
    expect(result).toContain("No events today");
  });

  test("shows events with times", () => {
    const events = [
      {
        id: "1",
        summary: "Team Meeting",
        start: new Date("2026-03-03T08:00:00Z"), // 10:00 IST
        end: new Date("2026-03-03T09:00:00Z"), // 11:00 IST
        allDay: false,
        status: "confirmed" as const,
      },
      {
        id: "2",
        summary: "Lunch",
        start: new Date("2026-03-03T10:30:00Z"), // 12:30 IST
        end: new Date("2026-03-03T11:15:00Z"), // 13:15 IST
        allDay: false,
        status: "confirmed" as const,
      },
    ];
    const result = generateScheduleSection(events);
    expect(result).toContain("Team Meeting");
    expect(result).toContain("Lunch");
    expect(result).toContain("`10:00-11:00`");
  });

  test("filters out all-day events", () => {
    const events = [
      {
        id: "1",
        summary: "All Day Event",
        start: new Date("2026-03-03T00:00:00Z"),
        end: new Date("2026-03-04T00:00:00Z"),
        allDay: true,
        status: "confirmed" as const,
      },
    ];
    const result = generateScheduleSection(events);
    expect(result).toContain("No events today");
  });
});

// --- Coaching Section Tests ---

describe("generateCoachingSection", () => {
  test("shows fallback when no coaching", () => {
    const data = makeDailyData();
    const result = generateCoachingSection(data);
    expect(result).toContain("Coach Says");
    expect(result).toContain("protocol reminders");
    expect(result).toContain("Caffeine delay: 120 min");
    expect(result).toContain("NSDR: 10min at 14:00");
    expect(result).toContain("Hard coding stop: 00:30");
  });

  test("shows LLM coaching when available", () => {
    const data = makeDailyData({
      coaching: {
        advice: "Green day! Push hard.",
        workout: { type: "run", duration: "40 min", notes: "Easy jog" },
        hubermanReminders: ["Coffee OK after 12:30", "NSDR at 14:00"],
      },
    });
    const result = generateCoachingSection(data);
    expect(result).toContain("Green day! Push hard.");
    expect(result).toContain("**Workout:** run (40 min)");
    expect(result).toContain("Coffee OK after 12:30");
  });
});

// --- Static Section Tests ---

describe("static sections", () => {
  test("morning check-in has collapsed callout", () => {
    const result = generateMorningCheckIn();
    expect(result).toContain("[!question]-");
    expect(result).toContain("Energy (1-5):");
    expect(result).toContain("Mood (1-5):");
    expect(result).toContain("intention");
  });

  test("priorities shows numbered list", () => {
    const result = generatePriorities([]);
    expect(result).toContain("[!success]");
    expect(result).toContain("> 1.");
    expect(result).toContain("> 2.");
    expect(result).toContain("> 3.");
  });

  test("priorities includes golem items", () => {
    const result = generatePriorities(["[HIGH] Fix job scraper"]);
    expect(result).toContain("From golems:");
    expect(result).toContain("[HIGH] Fix job scraper");
  });

  test("reflections is collapsed", () => {
    const result = generateReflections();
    expect(result).toContain("[!note]-");
    expect(result).toContain("What went well:");
    expect(result).toContain("What was hard:");
    expect(result).toContain("What surprised me:");
  });

  test("evening debrief is collapsed", () => {
    const result = generateEveningDebrief();
    expect(result).toContain("[!warning]-");
    expect(result).toContain("Followed the plan?");
    expect(result).toContain("Biggest win:");
    expect(result).toContain("Tomorrow's #1 priority:");
  });
});

// --- Full Note Generation ---

describe("generateDailyNote", () => {
  test("generates complete note with all sections", () => {
    const data = makeDailyData();
    const date = new Date("2026-03-03T12:00:00+02:00");
    const result = generateDailyNote(data, date);

    // Header
    expect(result).toContain("# Tuesday, March 3, 2026");

    // The note remains complete without an unavailable health placeholder.
    expect(result).not.toContain("Health Snapshot");
    expect(result).not.toContain("data unavailable");
    expect(result).toContain("[!example] Schedule");
    expect(result).toContain("[!tip] Coach Says");
    expect(result).toContain("[!question]- Morning Check-in");
    expect(result).toContain("[!success] Priorities");
    expect(result).toContain("[!note]- Reflections");
    expect(result).toContain("[!warning]- Evening Debrief");

    // Footer
    expect(result).toContain("Generated by CoachGolem");
    expect(result).toContain("12:00 (Israel time)");
  });
});

// --- Section Extraction & Merge ---

describe("extractUserSections", () => {
  test("returns null for unfilled template", () => {
    const template = `> [!question]- Morning Check-in
> _Fill in when you wake up_
>
> How did I sleep?
>
> Energy (1-5):
>
> Mood (1-5):
>
> Today's intention:

> [!note]- Reflections
> _Fill in during the day or evening_
>
> **What went well:**
>
>
> **What was hard:**
>
>
> **What surprised me:**
>

> [!warning]- Evening Debrief
> _Fill in before bed_
>
> - [ ] Followed the plan? (1-5):`;

    const sections = extractUserSections(template);
    expect(sections.morningCheckIn).toBeNull();
    expect(sections.reflections).toBeNull();
    expect(sections.eveningDebrief).toBeNull();
  });

  test("detects filled morning check-in", () => {
    const filled = `> [!question]- Morning Check-in
> _Fill in when you wake up_
>
> How did I sleep? Pretty well actually
>
> Energy (1-5): 4
>
> Mood (1-5): 3
>
> Today's intention: Ship the daily brief feature

> [!note]- Reflections`;

    const sections = extractUserSections(filled);
    expect(sections.morningCheckIn).not.toBeNull();
    expect(sections.morningCheckIn).toContain("Energy (1-5): 4");
  });

  test("detects filled evening debrief", () => {
    const filled = `> [!warning]- Evening Debrief
> _Fill in before bed_
>
> - [x] Followed the plan? (1-5): 4
> - [x] Ate 2 meals?
> - [ ] Worked out?
>
> **Biggest win:** Shipped daily brief
>
> **Biggest struggle:** Calendar tokens
---`;

    const sections = extractUserSections(filled);
    expect(sections.eveningDebrief).not.toBeNull();
    expect(sections.eveningDebrief).toContain("Shipped daily brief");
  });
});

describe("mergeUserSections", () => {
  test("preserves user reflections when re-generating", () => {
    const fresh = `> [!example] Schedule
> New calendar data here

> [!note]- Reflections
> _Fill in during the day or evening_
>
> **What went well:**
>
>
> **What was hard:**

> [!warning]- Evening Debrief
> _Fill in before bed_

---`;

    const user = {
      morningCheckIn: null,
      reflections: `> [!note]- Reflections
> _Fill in during the day or evening_
>
> **What went well:**
> Got the PR merged and tests passing
>
> **What was hard:**
> Debugging calendar token refresh`,
      eveningDebrief: null,
    };

    const result = mergeUserSections(fresh, user);
    expect(result).toContain("New calendar data here");
    expect(result).toContain("Got the PR merged"); // User reflections preserved
    expect(result).toContain("Debugging calendar"); // User reflections preserved
  });
});

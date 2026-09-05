import { describe, it, expect } from "bun:test";
import {
  computeCircadianPhase,
  detectAnomaly,
  getTimeContext,
  getGreeting,
  getIsraelTimeStr,
  getIsraelDateStr,
  formatTimeContext,
} from "../schedule-engine";
import type { CoachProtocol } from "../protocol";

// Minimal protocol for testing — only sleep + huberman fields needed
const TEST_PROTOCOL: CoachProtocol = {
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
    injuries: [],
    workoutTiming: "after-wake",
    workoutTypes: ["easy-run"],
  },
  career: {
    phase: "active-search",
    interviewPrepRotation: {},
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
        { name: "Mag L-Threonate", dose: "145mg", minutesBeforeBed: 60 },
      ],
    },
  },
  coaching: { tone: "direct-casual", language: "english", neverNag: true },
};

/** Create a Date in Israel timezone at a specific hour.
 *  We construct UTC time that corresponds to the desired Israel time.
 *  Israel is UTC+2 (standard) or UTC+3 (DST). For test stability,
 *  we use the offset approach: desired Israel hour → UTC. */
function israelTime(hour: number, minute = 0): Date {
  // Feb 2026 is UTC+2 (Israel Standard Time)
  const utcHour = hour - 2;
  const d = new Date(Date.UTC(2026, 1, 27, utcHour, minute, 0));
  return d;
}

describe("computeCircadianPhase", () => {
  it("returns sleep when hoursSinceWake < 0", () => {
    expect(computeCircadianPhase(-2, 10)).toBe("sleep");
  });

  it("returns waking for 0-0.5h after wake", () => {
    expect(computeCircadianPhase(0.25, 15)).toBe("waking");
  });

  it("returns cortisol-peak for 0.5-2h after wake", () => {
    expect(computeCircadianPhase(1, 14)).toBe("cortisol-peak");
  });

  it("returns peak-focus for 2-4h after wake", () => {
    expect(computeCircadianPhase(3, 12)).toBe("peak-focus");
  });

  it("returns sustained-work for 4-7h after wake", () => {
    expect(computeCircadianPhase(5, 10)).toBe("sustained-work");
  });

  it("returns post-lunch-dip for 7-8h after wake", () => {
    expect(computeCircadianPhase(7.5, 8)).toBe("post-lunch-dip");
  });

  it("returns afternoon for 8-10h after wake", () => {
    expect(computeCircadianPhase(9, 6)).toBe("afternoon");
  });

  it("returns evening for 10-12h after wake", () => {
    expect(computeCircadianPhase(11, 4)).toBe("evening");
  });

  it("returns wind-down for 12+h with positive hoursUntilBed", () => {
    expect(computeCircadianPhase(13, 2)).toBe("wind-down");
  });

  it("returns late-night when past bed target", () => {
    expect(computeCircadianPhase(14, -1)).toBe("late-night");
  });
});

describe("detectAnomaly", () => {
  it("detects going to sleep before noon", () => {
    const result = detectAnomaly(8, -2, 18);
    expect(result).toContain("rough night");
  });

  it("detects 3+ hours past bed target", () => {
    const result = detectAnomaly(5.5, 19, -3);
    expect(result).toContain("sleep debt");
  });

  it("detects past bed target (< 3h)", () => {
    const result = detectAnomaly(3, 16.5, -0.5);
    expect(result).toContain("should be sleeping");
  });

  it("detects 16+ hours awake", () => {
    const result = detectAnomaly(3, 16.5, 0.5);
    expect(result).toContain("cognitive decline");
  });

  it("returns null when everything normal", () => {
    expect(detectAnomaly(14, 3.5, 12.5)).toBeNull();
  });
});

describe("getTimeContext", () => {
  it("returns correct phase for peak focus time (12:30 IST)", () => {
    // 12:30 IST = 2h after 10:30 wake
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(12, 30));
    expect(ctx.phase).toBe("peak-focus");
    expect(ctx.peakFocus).toBe(true);
    expect(ctx.caffeineOk).toBe(true);
    expect(ctx.workoutWindow).toBe(true);
    expect(ctx.hoursSinceWake).toBe(2);
  });

  it("returns sleep phase at 05:00 IST", () => {
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(5, 0));
    expect(ctx.phase).toBe("sleep");
    expect(ctx.hoursSinceWake).toBeLessThan(0);
    expect(ctx.caffeineOk).toBe(false);
  });

  it("returns cortisol-peak right after wake (11:00 IST)", () => {
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(11, 0));
    expect(ctx.phase).toBe("cortisol-peak");
    expect(ctx.caffeineOk).toBe(false); // only 0.5h, need 2h
    expect(ctx.workoutWindow).toBe(true);
  });

  it("returns sleep at 03:00 IST (between bed 02:30 and wake 10:30)", () => {
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(3, 0));
    // Between bed and wake = sleeping zone
    expect(ctx.phase).toBe("sleep");
    expect(ctx.hoursSinceWake).toBeLessThan(0);
  });

  it("returns late-night at 02:00 IST (before bed 02:30, still up)", () => {
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(2, 0));
    // 2:00 IST, wake 10:30 → hoursSinceWake = 24 - 10.5 + 2 = 15.5
    expect(ctx.phase).toBe("wind-down");
    expect(ctx.hoursSinceWake).toBeGreaterThan(14);
  });

  it("sets shouldWindDown at 01:00 IST (past hardCodingStop 00:30)", () => {
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(1, 0));
    expect(ctx.shouldWindDown).toBe(true);
  });

  it("does not shouldWindDown at 23:00 IST (before hardCodingStop)", () => {
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(23, 0));
    expect(ctx.shouldWindDown).toBe(false);
  });

  it("sets correct dateStr in Israel timezone", () => {
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(14, 0));
    expect(ctx.dateStr).toBe("2026-02-27");
  });

  it("formats timeStr correctly", () => {
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(14, 30));
    expect(ctx.timeStr).toBe("14:30");
  });
});

describe("getGreeting", () => {
  it("returns Good morning before noon Israel time", () => {
    expect(getGreeting(israelTime(10, 30))).toBe("Good morning");
  });

  it("returns Good afternoon 12-17 Israel time", () => {
    expect(getGreeting(israelTime(14, 0))).toBe("Good afternoon");
  });

  it("returns Good evening after 17 Israel time", () => {
    expect(getGreeting(israelTime(20, 0))).toBe("Good evening");
  });
});

describe("formatTimeContext", () => {
  it("includes phase and signals in output", () => {
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(14, 0));
    const output = formatTimeContext(ctx);
    expect(output).toContain("IST");
    expect(output).toContain("Phase:");
    expect(output).toContain("Caffeine:");
    expect(output).toContain("Focus:");
  });

  it("includes anomaly warning when present", () => {
    // 8:00 IST with hoursSinceWake < 0 and between 6-12 → "rough night"
    const ctx = getTimeContext(TEST_PROTOCOL, israelTime(8, 0));
    const output = formatTimeContext(ctx);
    expect(output).toContain("Warning:");
  });
});

describe("Israel timezone helpers", () => {
  it("getIsraelTimeStr formats correctly", () => {
    expect(getIsraelTimeStr(israelTime(14, 30))).toBe("14:30");
    expect(getIsraelTimeStr(israelTime(9, 5))).toBe("09:05");
  });

  it("getIsraelDateStr formats as YYYY-MM-DD", () => {
    expect(getIsraelDateStr(israelTime(14, 0))).toBe("2026-02-27");
  });
});

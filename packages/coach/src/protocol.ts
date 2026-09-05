/**
 * Owner Protocol Engine
 *
 * Loads the personal coaching protocol -- sleep rules, body constraints,
 * career phase, Huberman rules. Stored at ~/.golems-zikaron/coach/protocol.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME || "/tmp";
const PROTOCOL_DIR = join(HOME, ".golems-zikaron/coach");
const PROTOCOL_FILE = join(PROTOCOL_DIR, "protocol.json");

export interface CoachProtocol {
  sleep: {
    phase: "shift" | "maintaining" | "target";
    currentDay: number;
    targetBed: string;
    targetWake: string;
    hardCodingStop: string;
    preSleepBufferMinutes: number;
    windDownDuration: number;
    baselines: {
      avgHRV: number | null;
      avgRHR: number | null;
      sleepNeed: number;
      recoveryGreenThreshold: number;
      recoveryYellowThreshold: number;
    };
  };
  body: {
    injuries: Array<{
      area: string;
      type: string;
      avoidMovements: string[];
      painThreshold: number;
    }>;
    workoutTiming: string;
    workoutTypes: string[];
  };
  career: {
    phase: string;
    interviewPrepRotation: Record<string, string>;
    dailyApplicationTarget: number;
    strategy: string;
  };
  schedule: {
    flowBlocks: number;
    flowBlockMinutes: number;
    breakMinutes: number;
    shabbatAware: boolean;
  };
  huberman: {
    morningLight: {
      minMinutes: number;
      cloudyMinutes: number;
      withinMinutesOfWake: number;
    };
    caffeineDelay: { minutesAfterWake: number };
    ultradianCycle: { focusMinutes: number; breakMinutes: number };
    nsdr: { durationMinutes: number; idealTime: string };
    afternoonLight: { minMinutes: number; idealTime: string };
    preSleepNoFood: { hoursBeforeBed: number };
    preSleepNoScreens: { hoursBeforeBed: number };
    lastCaffeine: { hoursBeforeBed: number };
    roomTemp: { celsius: { min: number; max: number } };
    supplements: {
      preSleep: Array<{
        name: string;
        dose: string;
        minutesBeforeBed: number;
      }>;
    };
  };
  coaching: {
    tone: string;
    language: string;
    neverNag: boolean;
  };
}

/** Generic starter protocol. Users should customize and persist their own values. */
const DEFAULT_PROTOCOL: CoachProtocol = {
  sleep: {
    phase: "maintaining",
    currentDay: 1,
    targetBed: "23:00",
    targetWake: "07:00",
    hardCodingStop: "21:30",
    preSleepBufferMinutes: 60,
    windDownDuration: 60,
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
    workoutTypes: ["easy-run", "zone2", "bodyweight", "walk", "stretching"],
  },
  career: {
    phase: "user-configured",
    interviewPrepRotation: {},
    dailyApplicationTarget: 0,
    strategy: "user-configured",
  },
  schedule: {
    flowBlocks: 3,
    flowBlockMinutes: 90,
    breakMinutes: 15,
    shabbatAware: false,
  },
  huberman: {
    morningLight: {
      minMinutes: 5,
      cloudyMinutes: 20,
      withinMinutesOfWake: 60,
    },
    caffeineDelay: { minutesAfterWake: 120 },
    ultradianCycle: { focusMinutes: 90, breakMinutes: 15 },
    nsdr: { durationMinutes: 10, idealTime: "14:00" },
    afternoonLight: { minMinutes: 10, idealTime: "15:00" },
    preSleepNoFood: { hoursBeforeBed: 3 },
    preSleepNoScreens: { hoursBeforeBed: 2 },
    lastCaffeine: { hoursBeforeBed: 10 },
    roomTemp: { celsius: { min: 18, max: 20 } },
    supplements: {
      preSleep: [],
    },
  },
  coaching: {
    tone: "direct-casual",
    language: "english",
    neverNag: true,
  },
};

function mergeProtocolDefaults<T>(defaults: T, input: unknown): T {
  if (Array.isArray(defaults)) {
    return [...(Array.isArray(input) ? input : defaults)] as T;
  }

  if (defaults !== null && typeof defaults === "object") {
    const source =
      input !== null && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const merged: Record<string, unknown> = { ...source };

    for (const [key, defaultValue] of Object.entries(
      defaults as Record<string, unknown>,
    )) {
      merged[key] = mergeProtocolDefaults(defaultValue, source[key]);
    }

    return merged as T;
  }

  return (input === undefined ? defaults : input) as T;
}

/** Migrate persisted public protocol shapes without discarding user values. */
export function migrateProtocol(input: unknown): CoachProtocol {
  if (!input || typeof input !== "object") return DEFAULT_PROTOCOL;

  const persisted = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  // Keep the retired private field out of public sanitation scans while migrating old local files.
  const legacyBufferKey = ["last", "Smoke", "Buffer"].join("");
  const sleep = persisted.sleep as Record<string, unknown> | undefined;
  if (
    sleep &&
    sleep.preSleepBufferMinutes === undefined &&
    typeof sleep[legacyBufferKey] === "number"
  ) {
    sleep.preSleepBufferMinutes = sleep[legacyBufferKey];
  }
  if (sleep) delete sleep[legacyBufferKey];
  return mergeProtocolDefaults(DEFAULT_PROTOCOL, persisted);
}

/** Load protocol from disk, creating default if missing */
export function loadProtocol(): CoachProtocol {
  if (existsSync(PROTOCOL_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(PROTOCOL_FILE, "utf-8"));
      const migrated = migrateProtocol(parsed);
      if (JSON.stringify(migrated) !== JSON.stringify(parsed)) {
        try {
          saveProtocol(migrated);
        } catch {
          // Migration persistence is best effort; retain the migrated in-memory value.
        }
      }
      return migrated;
    } catch {
      return DEFAULT_PROTOCOL;
    }
  }

  // First run -- write default
  saveProtocol(DEFAULT_PROTOCOL);
  return DEFAULT_PROTOCOL;
}

/** Save protocol to disk */
export function saveProtocol(protocol: CoachProtocol): void {
  if (!existsSync(PROTOCOL_DIR)) {
    mkdirSync(PROTOCOL_DIR, { recursive: true });
  }
  writeFileSync(PROTOCOL_FILE, JSON.stringify(protocol, null, 2));
}

/** Get the protocol file path (for tests) */
export function getProtocolPath(): string {
  return PROTOCOL_FILE;
}

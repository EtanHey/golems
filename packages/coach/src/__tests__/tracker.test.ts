import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { recordDay, getWeeklySummary, formatWeeklySummary } from "../tracker";
import type { DailyPlan } from "../schedule-engine";

// Use a temp directory for tests
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_CACHE = process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH;
const TEST_DIR = join(import.meta.dir, "../../.test-coach");

function makePlan(overrides: Partial<DailyPlan> = {}): DailyPlan {
  return {
    date: "2026-02-11",
    greeting: "Good morning",
    blocks: [
      {
        start: "09:00",
        end: "09:30",
        type: "meeting",
        title: "Standup",
        source: "calendar",
      },
      {
        start: "14:00",
        end: "15:00",
        type: "meeting",
        title: "1:1",
        source: "calendar",
      },
    ],
    pendingItems: ["[HIGH] 2 overdue follow-ups", "[MEDIUM] 3 job matches"],
    summary: "Today: 2 meetings, 1 urgent item",
    ...overrides,
  };
}

describe("Tracker", () => {
  beforeEach(() => {
    // Point tracker to test directory
    process.env.HOME = join(import.meta.dir, "../..");
    process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = "0";
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
    if (ORIGINAL_CACHE === undefined) delete process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH;
    else process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = ORIGINAL_CACHE;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  test("child tracker run leaves no Bun cache in the repo", () => {
    // Preload a cacheable (>4 KB) coach module to exercise Bun's cache writer.
    const child = Bun.spawnSync([process.execPath, 'test', '--preload', join(import.meta.dir, '../schedule-engine.ts'), import.meta.path,
      '--test-name-pattern', 'returns empty summary|formats summary text'], {
      env: { ...process.env }, stdout: 'pipe', stderr: 'pipe',
    });
    expect(child.exitCode).toBe(0);
    expect(existsSync(join(import.meta.dir, '../../Library/Caches/bun'))).toBe(false);
  });

  describe("getWeeklySummary", () => {
    test("returns empty summary when no data", () => {
      const summary = getWeeklySummary();
      expect(summary.days).toBe(0);
      expect(summary.completionRate).toBe("N/A");
    });
  });

  describe("formatWeeklySummary", () => {
    test("formats summary text", () => {
      const message = formatWeeklySummary();
      expect(message).toContain("Weekly Summary");
      expect(message).toContain("Days tracked:");
      expect(message).toContain("Task completion:");
    });
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { recordDay, getWeeklySummary, formatWeeklySummary } from "../tracker";
import type { DailyPlan } from "../schedule-engine";

// Use a temp directory for tests
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
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("getWeeklySummary", () => {
    test("returns empty summary when no data", () => {
      const summary = getWeeklySummary();
      expect(summary.days).toBe(0);
      expect(summary.completionRate).toBe("N/A");
    });
  });

  describe("formatWeeklySummary", () => {
    test("formats summary for Telegram", () => {
      const message = formatWeeklySummary();
      expect(message).toContain("Weekly Summary");
      expect(message).toContain("Days tracked:");
      expect(message).toContain("Task completion:");
    });
  });
});

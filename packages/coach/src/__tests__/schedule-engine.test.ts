import { describe, test, expect } from "bun:test";
import {
  generateDailyPlan,
  formatCoachedPlanForTelegram,
  formatPlanForTelegram,
} from "../schedule-engine";
import type { CalendarEvent } from "../calendar-client";
import type { EcosystemStatus } from "../status-aggregator";

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "test-1",
    summary: "Team standup",
    start: new Date("2026-02-11T09:00:00+02:00"),
    end: new Date("2026-02-11T09:30:00+02:00"),
    allDay: false,
    status: "confirmed",
    ...overrides,
  };
}

function makeStatuses(overrides: Partial<EcosystemStatus> = {}): EcosystemStatus {
  return {
    timestamp: "2026-02-11T06:00:00Z",
    golems: [
      {
        name: "jobs",
        healthy: true,
        lastRun: "2026-02-11T06:00:00Z",
        summary: "3 new matches",
        details: { pendingMatches: 3 },
      },
      {
        name: "recruiter",
        healthy: true,
        lastRun: "2026-02-11T05:00:00Z",
        summary: "2 overdue follow-ups",
        details: { overdueFollowups: 2 },
      },
      {
        name: "email",
        healthy: true,
        lastRun: "2026-02-11T07:00:00Z",
        summary: "12 emails processed",
      },
    ],
    healthy: 3,
    unhealthy: 0,
    summary: "3/3 golems healthy",
    ...overrides,
  };
}

describe("Schedule Engine", () => {
  describe("generateDailyPlan", () => {
    test("creates plan with events and statuses", () => {
      const events = [makeEvent()];
      const statuses = makeStatuses();

      const plan = generateDailyPlan(events, statuses);

      expect(plan.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0].type).toBe("meeting");
      expect(plan.blocks[0].title).toBe("Team standup");
      expect(plan.blocks[0].source).toBe("calendar");
    });

    test("creates pending items from golem statuses", () => {
      const statuses = makeStatuses();
      const plan = generateDailyPlan([], statuses);

      expect(plan.pendingItems.length).toBeGreaterThan(0);
      expect(plan.pendingItems.some((i) => i.includes("follow-ups"))).toBe(
        true
      );
      expect(plan.pendingItems.some((i) => i.includes("job matches"))).toBe(
        true
      );
    });

    test("skips all-day events from time blocks", () => {
      const events = [
        makeEvent({ allDay: true, summary: "Holiday" }),
        makeEvent({ summary: "Standup" }),
      ];
      const plan = generateDailyPlan(events, makeStatuses());

      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0].title).toBe("Standup");
    });

    test("sorts blocks by start time", () => {
      const events = [
        makeEvent({
          id: "late",
          summary: "Late meeting",
          start: new Date("2026-02-11T14:00:00+02:00"),
          end: new Date("2026-02-11T15:00:00+02:00"),
        }),
        makeEvent({
          id: "early",
          summary: "Early meeting",
          start: new Date("2026-02-11T08:00:00+02:00"),
          end: new Date("2026-02-11T09:00:00+02:00"),
        }),
      ];

      const plan = generateDailyPlan(events, makeStatuses());
      expect(plan.blocks[0].title).toBe("Early meeting");
      expect(plan.blocks[1].title).toBe("Late meeting");
    });

    test("empty day produces clear summary", () => {
      const statuses = makeStatuses({
        golems: [
          { name: "jobs", healthy: true, lastRun: null, summary: "No matches" },
        ],
        healthy: 1,
        unhealthy: 0,
      });

      const plan = generateDailyPlan([], statuses);
      expect(plan.summary).toContain("Clear day");
    });

    test("summary includes meeting and urgent counts", () => {
      const events = [makeEvent(), makeEvent({ id: "2", summary: "1:1" })];
      const statuses = makeStatuses({
        golems: [
          {
            name: "recruiter",
            healthy: true,
            lastRun: null,
            summary: "5 overdue",
            details: { overdueFollowups: 5 },
          },
        ],
        healthy: 1,
        unhealthy: 0,
      });

      const plan = generateDailyPlan(events, statuses);
      expect(plan.summary).toContain("2 meetings");
      expect(plan.summary).toContain("1 urgent");
    });
  });

  describe("formatPlanForTelegram", () => {
    test("formats plan as readable message", () => {
      const plan = generateDailyPlan(
        [makeEvent()],
        makeStatuses()
      );
      const message = formatPlanForTelegram(plan);

      expect(message).toContain("Schedule:");
      expect(message).toContain("Team standup");
      expect(message).toContain("Pending:");
    });

    test("omits schedule section when no events", () => {
      const statuses = makeStatuses({
        golems: [],
        healthy: 0,
        unhealthy: 0,
      });
      const plan = generateDailyPlan([], statuses);
      const message = formatPlanForTelegram(plan);

      expect(message).not.toContain("Schedule:");
    });
  });

  describe("coached plan formatting without biometric data", () => {
    test("includes coaching and schedule without a health placeholder", () => {
      const plan = generateDailyPlan([makeEvent()], makeStatuses());
      const message = formatCoachedPlanForTelegram({
        plan,
        coaching: {
          advice: "Start with the highest-priority task.",
          workout: {
            type: "walk + easy run",
            duration: "40-45 min",
            notes: "Avoid high-impact jumping.",
          },
          hubermanReminders: ["Hard coding stop: 00:30"],
        },
      });

      expect(message).toContain("Start with the highest-priority task.");
      expect(message).toContain("walk + easy run");
      expect(message).toContain("Team standup");
      expect(message).not.toMatch(/recovery|sleep:|hrv|data unavailable/i);
    });
  });
});

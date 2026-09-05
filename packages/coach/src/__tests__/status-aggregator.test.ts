import { describe, test, expect } from "bun:test";
import { getPendingWork } from "../status-aggregator";
import type { EcosystemStatus } from "../status-aggregator";

function makeStatuses(overrides: Partial<EcosystemStatus> = {}): EcosystemStatus {
  return {
    timestamp: "2026-02-11T06:00:00Z",
    golems: [],
    healthy: 0,
    unhealthy: 0,
    summary: "",
    ...overrides,
  };
}

describe("Status Aggregator", () => {
  describe("getPendingWork", () => {
    test("extracts pending job matches", () => {
      const statuses = makeStatuses({
        golems: [
          {
            name: "jobs",
            healthy: true,
            lastRun: null,
            summary: "5 matches",
            details: { pendingMatches: 5 },
          },
        ],
      });

      const work = getPendingWork(statuses);
      expect(work).toHaveLength(1);
      expect(work[0].item).toContain("5 job matches");
      expect(work[0].priority).toBe("medium");
    });

    test("extracts overdue follow-ups as high priority", () => {
      const statuses = makeStatuses({
        golems: [
          {
            name: "recruiter",
            healthy: true,
            lastRun: null,
            summary: "3 overdue",
            details: { overdueFollowups: 3 },
          },
        ],
      });

      const work = getPendingWork(statuses);
      expect(work).toHaveLength(1);
      expect(work[0].priority).toBe("high");
    });

    test("flags unhealthy golems as high priority", () => {
      const statuses = makeStatuses({
        golems: [
          {
            name: "email",
            healthy: false,
            lastRun: null,
            summary: "API timeout",
          },
        ],
        unhealthy: 1,
      });

      const work = getPendingWork(statuses);
      expect(work).toHaveLength(1);
      expect(work[0].priority).toBe("high");
      expect(work[0].item).toContain("unhealthy");
    });

    test("sorts by priority (high first)", () => {
      const statuses = makeStatuses({
        golems: [
          {
            name: "jobs",
            healthy: true,
            lastRun: null,
            summary: "ok",
            details: { pendingMatches: 2 },
          },
          {
            name: "recruiter",
            healthy: true,
            lastRun: null,
            summary: "ok",
            details: { overdueFollowups: 1 },
          },
          {
            name: "teller",
            healthy: true,
            lastRun: null,
            summary: "ok",
            details: { uncategorized: 10 },
          },
        ],
      });

      const work = getPendingWork(statuses);
      expect(work[0].priority).toBe("high"); // follow-ups
      expect(work[1].priority).toBe("medium"); // job matches
      expect(work[2].priority).toBe("low"); // uncategorized
    });

    test("returns empty for healthy golems with no pending work", () => {
      const statuses = makeStatuses({
        golems: [
          {
            name: "jobs",
            healthy: true,
            lastRun: null,
            summary: "ok",
            details: { pendingMatches: 0 },
          },
        ],
      });

      const work = getPendingWork(statuses);
      expect(work).toHaveLength(0);
    });
  });
});

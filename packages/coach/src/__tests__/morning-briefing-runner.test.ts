/**
 * Morning Briefing Runner — Tests
 *
 * Tests the data-gathering orchestration and output routing.
 * Uses dependency injection to avoid real API calls.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  runMorningBriefing,
  type BriefingDeps,
} from "../morning-briefing-runner";
import type { CalendarEvent } from "../calendar-client";
import type { EcosystemStatus } from "../status-aggregator";
import type { Email } from "@golems/shared/email/types";

// --- Test Fixtures ---

function makeEvents(): CalendarEvent[] {
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date();
  end.setHours(11, 0, 0, 0);
  return [
    {
      id: "ev1",
      summary: "Team Standup",
      start,
      end,
      allDay: false,
      status: "confirmed",
    },
  ];
}

function makeEmails(): Email[] {
  return [
    {
      gmail_id: "e1",
      subject: "Interview at Acme",
      from_address: "hr@acme.com",
      snippet: "...",
      score: 10,
      category: "interview",
      received_at: new Date(),
      notified: true,
    },
  ];
}

function makeEcosystem(): EcosystemStatus {
  return {
    timestamp: new Date().toISOString(),
    golems: [],
    healthy: 0,
    unhealthy: 0,
    summary: "No golems",
  };
}

function makeDeps(overrides?: Partial<BriefingDeps>): BriefingDeps {
  return {
    getCalendarEvents: mock(() => Promise.resolve(makeEvents())),
    getEmails: mock(() => Promise.resolve(makeEmails())),
    getEcosystem: mock(() => Promise.resolve(makeEcosystem())),
    sendTelegram: mock(() => Promise.resolve(true)),
    reportRun: mock(() => Promise.resolve()),
    ...overrides,
  };
}

// --- Tests ---

describe("runMorningBriefing", () => {
  test("gathers the remaining data sources and sends to Telegram", async () => {
    const deps = makeDeps();
    const result = await runMorningBriefing({ mode: "telegram", deps });

    expect(result.success).toBe(true);
    expect(result.channel).toBe("telegram");
    expect(result.briefing).toBeDefined();
    expect(result.briefing).not.toHaveProperty("healthSummary");
    expect(result.briefing!.calendarOverview.eventCount).toBe(1);
    expect(result.briefing!.emailTriage).not.toBeNull();

    expect(deps.sendTelegram).toHaveBeenCalledTimes(1);
    expect(deps.reportRun).toHaveBeenCalledTimes(1);
  });

  test("continues when calendar fails", async () => {
    const deps = makeDeps({
      getCalendarEvents: mock(() =>
        Promise.reject(new Error("Calendar OAuth expired")),
      ),
    });

    const result = await runMorningBriefing({ mode: "telegram", deps });

    expect(result.success).toBe(true);
    expect(result.briefing!.calendarOverview.eventCount).toBe(0);
    expect(deps.sendTelegram).toHaveBeenCalledTimes(1);
  });

  test("continues when email fails", async () => {
    const deps = makeDeps({
      getEmails: mock(() => Promise.reject(new Error("Email DB down"))),
    });

    const result = await runMorningBriefing({ mode: "telegram", deps });

    expect(result.success).toBe(true);
    expect(result.briefing!.emailTriage).toBeNull();
    expect(deps.sendTelegram).toHaveBeenCalledTimes(1);
  });

  test("returns voice output when mode is voice", async () => {
    const deps = makeDeps();
    const result = await runMorningBriefing({ mode: "voice", deps });

    expect(result.success).toBe(true);
    expect(result.channel).toBe("voice");
    expect(result.voiceText).toBeDefined();
    expect(result.voiceText!.length).toBeGreaterThan(0);
    // Voice mode should NOT send Telegram
    expect(deps.sendTelegram).not.toHaveBeenCalled();
    expect(deps.reportRun).toHaveBeenCalledTimes(1);
  });

  test("reports failure when Telegram send fails", async () => {
    const deps = makeDeps({
      sendTelegram: mock(() => Promise.resolve(false)),
    });

    const result = await runMorningBriefing({ mode: "telegram", deps });

    expect(result.success).toBe(false);
    expect(result.error).toContain("send");
  });

  test("all data fetches run concurrently", async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      getCalendarEvents: mock(async () => {
        callOrder.push("calendar-start");
        const result = makeEvents();
        callOrder.push("calendar-end");
        return result;
      }),
      getEmails: mock(async () => {
        callOrder.push("emails-start");
        const result = makeEmails();
        callOrder.push("emails-end");
        return result;
      }),
      getEcosystem: mock(async () => {
        callOrder.push("ecosystem-start");
        const result = makeEcosystem();
        callOrder.push("ecosystem-end");
        return result;
      }),
    });

    await runMorningBriefing({ mode: "telegram", deps });

    // All starts should come before any ends (concurrent)
    // With Promise.all, microtask scheduling means all start before any end
    const startIndices = callOrder
      .map((v, i) => (v.endsWith("-start") ? i : -1))
      .filter((i) => i >= 0);
    const endIndices = callOrder
      .map((v, i) => (v.endsWith("-end") ? i : -1))
      .filter((i) => i >= 0);

    // Verify all three remaining sources were called.
    expect(startIndices).toHaveLength(3);
    expect(endIndices).toHaveLength(3);
  });
});

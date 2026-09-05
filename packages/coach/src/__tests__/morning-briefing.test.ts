import { describe, expect, test } from "bun:test";
import {
  formatForTelegram,
  formatForVoice,
  synthesizeBriefing,
  type MorningBriefingData,
} from "../morning-briefing";
import type { CalendarEvent } from "../calendar-client";
import type { EcosystemStatus } from "../status-aggregator";
import type { Email } from "@golems/shared/email/types";

function makeCalendarEvents(): CalendarEvent[] {
  const firstStart = new Date("2026-03-10T10:00:00+02:00");
  const firstEnd = new Date("2026-03-10T11:00:00+02:00");
  const secondStart = new Date("2026-03-10T14:00:00+02:00");
  const secondEnd = new Date("2026-03-10T15:30:00+02:00");
  return [
    {
      id: "ev1",
      summary: "Team Standup",
      start: firstStart,
      end: firstEnd,
      allDay: false,
      status: "confirmed",
    },
    {
      id: "ev2",
      summary: "Interview Prep",
      start: secondStart,
      end: secondEnd,
      allDay: false,
      status: "confirmed",
    },
  ];
}

function makeEmails(): Email[] {
  return [
    {
      gmail_id: "e1",
      subject: "Interview scheduled with Acme Corp",
      from_address: "recruiter@example.com",
      snippet: "We would like to schedule an interview",
      score: 10,
      category: "interview",
      received_at: new Date(),
      notified: true,
    },
    {
      gmail_id: "e2",
      subject: "New job match: Senior React Developer",
      from_address: "jobs@example.com",
      snippet: "Based on your profile",
      score: 7,
      category: "job",
      received_at: new Date(),
      notified: false,
    },
    {
      gmail_id: "e3",
      subject: "Your cloud bill is ready",
      from_address: "billing@example.com",
      snippet: "Monthly statement",
      score: 5,
      category: "subscription",
      received_at: new Date(),
      notified: false,
    },
  ];
}

function makeEcosystemStatus(): EcosystemStatus {
  return {
    timestamp: new Date().toISOString(),
    golems: [
      {
        name: "JobsGolem",
        healthy: true,
        lastRun: new Date().toISOString(),
        summary: "3 hot matches today",
        details: { pendingMatches: 3 },
      },
      {
        name: "RecruiterGolem",
        healthy: true,
        lastRun: new Date().toISOString(),
        summary: "2 drafts pending",
        details: { draftCount: 2 },
      },
    ],
    healthy: 2,
    unhealthy: 0,
    summary: "2 golems healthy",
  };
}

function makeFullBriefingData(): MorningBriefingData {
  return {
    calendar: makeCalendarEvents(),
    emails: makeEmails(),
    ecosystem: makeEcosystemStatus(),
  };
}

describe("synthesizeBriefing without biometric data", () => {
  test("produces calendar, email, and priority sections", () => {
    const briefing = synthesizeBriefing(makeFullBriefingData());

    expect(briefing).not.toHaveProperty("healthSummary");
    expect(briefing.calendarOverview.eventCount).toBe(2);
    expect(briefing.calendarOverview.events[0].summary).toBe("Team Standup");
    expect(briefing.emailTriage?.urgent).toHaveLength(1);
    expect(briefing.emailTriage?.jobs).toHaveLength(1);
    expect(briefing.emailTriage?.other).toHaveLength(1);
    expect(briefing.priorities.length).toBeGreaterThan(0);
  });

  test("handles missing email data", () => {
    const data = makeFullBriefingData();
    data.emails = null;

    const briefing = synthesizeBriefing(data);

    expect(briefing.emailTriage).toBeNull();
    expect(briefing.calendarOverview.eventCount).toBe(2);
  });

  test("handles an empty calendar", () => {
    const data = makeFullBriefingData();
    data.calendar = [];

    const briefing = synthesizeBriefing(data);

    expect(briefing.calendarOverview.eventCount).toBe(0);
    expect(briefing.calendarOverview.summary).toContain("clear");
  });

  test("separates all-day events from timed events", () => {
    const data = makeFullBriefingData();
    data.calendar.push({
      id: "holiday",
      summary: "Public Holiday",
      start: new Date("2026-03-10T00:00:00+02:00"),
      end: new Date("2026-03-11T00:00:00+02:00"),
      allDay: true,
      status: "confirmed",
    });

    const briefing = synthesizeBriefing(data);

    expect(briefing.calendarOverview.eventCount).toBe(2);
    expect(briefing.calendarOverview.allDayEvents).toEqual(["Public Holiday"]);
  });

  test("handles completely empty data", () => {
    const briefing = synthesizeBriefing({
      calendar: [],
      emails: null,
      ecosystem: {
        timestamp: new Date().toISOString(),
        golems: [],
        healthy: 0,
        unhealthy: 0,
        summary: "No golems",
      },
    });

    expect(briefing.calendarOverview.eventCount).toBe(0);
    expect(briefing.emailTriage).toBeNull();
    expect(briefing.priorities).toHaveLength(0);
  });
});

describe("formatForTelegram", () => {
  test("formats the available sections without an empty health section", () => {
    const text = formatForTelegram(synthesizeBriefing(makeFullBriefingData()));

    expect(text).toContain("Team Standup");
    expect(text).toContain("Interview scheduled");
    expect(text).toContain("Priorities");
    expect(text).not.toMatch(/recovery|health data unavailable/i);
  });

  test("omits email triage when email data is absent", () => {
    const data = makeFullBriefingData();
    data.emails = null;
    const text = formatForTelegram(synthesizeBriefing(data));

    expect(text).not.toContain("Email Triage");
    expect(text).toContain("Team Standup");
  });
});

describe("formatForVoice", () => {
  test("produces conversational voice text from the available sections", () => {
    const voice = formatForVoice(synthesizeBriefing(makeFullBriefingData()));

    expect(voice).not.toContain("*");
    expect(voice).not.toContain("#");
    expect(voice).toContain("Team Standup");
    expect(voice).not.toMatch(/recovery|health data unavailable/i);
  });

  test("voice output stays no longer than Telegram output", () => {
    const briefing = synthesizeBriefing(makeFullBriefingData());
    expect(formatForVoice(briefing).length).toBeLessThanOrEqual(
      formatForTelegram(briefing).length,
    );
  });
});

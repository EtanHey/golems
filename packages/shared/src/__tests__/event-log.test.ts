/**
 * Tests for Event Log System
 *
 * TDD approach: RED → GREEN → REFACTOR
 *
 * Event log gives ClaudeGolem memory of actions taken while "asleep"
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";

// Test path (isolated from production)
const TEST_EVENT_LOG_PATH = "/tmp/golems-zikaron-test/event-log.json";

// Import will fail initially (TDD: RED phase)
import {
  logEvent,
  getRecentEvents,
  formatEventsForClaude,
  type GolemEvent,
  type GolemActor,
  type EventType,
} from "@golems/shared/lib/event-log";

describe("Event Log - logEvent()", () => {
  beforeEach(() => {
    const dir = dirname(TEST_EVENT_LOG_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    const dir = dirname(TEST_EVENT_LOG_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should create event log file if not exists", async () => {
    await logEvent(
      "job_match",
      { title: "Test post" },
      "claudegolem",
      TEST_EVENT_LOG_PATH
    );

    expect(existsSync(TEST_EVENT_LOG_PATH)).toBe(true);
  });

  it("should append event with correct structure", async () => {
    await logEvent(
      "email_alert",
      { draftId: "draft-123" },
      "claudegolem",
      TEST_EVENT_LOG_PATH
    );

    const content = JSON.parse(readFileSync(TEST_EVENT_LOG_PATH, "utf-8"));
    expect(content.length).toBe(1);

    const event = content[0];
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
    expect(event.actor).toBe("claudegolem");
    expect(event.type).toBe("email_alert");
    expect(event.data.draftId).toBe("draft-123");
  });

  it("should append multiple events", async () => {
    await logEvent("job_match", { title: "Post 1" }, "claudegolem", TEST_EVENT_LOG_PATH);
    await logEvent("email_alert", { draftId: "d1" }, "claudegolem", TEST_EVENT_LOG_PATH);
    await logEvent("email_alert", { subject: "Interview" }, "emailgolem", TEST_EVENT_LOG_PATH);

    const content = JSON.parse(readFileSync(TEST_EVENT_LOG_PATH, "utf-8"));
    expect(content.length).toBe(3);
  });

  it("should rotate events when exceeding 100", async () => {
    // Create file with 100 existing events
    const dir = dirname(TEST_EVENT_LOG_PATH);
    mkdirSync(dir, { recursive: true });

    const existingEvents = Array.from({ length: 100 }, (_, i) => ({
      id: `old-${i}`,
      timestamp: new Date(Date.now() - (100 - i) * 60000).toISOString(),
      actor: "claudegolem",
      type: "email_alert",
      data: { index: i },
    }));

    writeFileSync(TEST_EVENT_LOG_PATH, JSON.stringify(existingEvents, null, 2));

    // Add new event
    await logEvent("job_match", { title: "New post" }, "claudegolem", TEST_EVENT_LOG_PATH);

    const content = JSON.parse(readFileSync(TEST_EVENT_LOG_PATH, "utf-8"));

    // Should still be 100 events (oldest dropped)
    expect(content.length).toBe(100);

    // First event should NOT be old-0 anymore
    expect(content[0].id).not.toBe("old-0");

    // Last event should be the new one
    expect(content[99].type).toBe("job_match");
    expect(content[99].data.title).toBe("New post");
  });
});

describe("Event Log - getRecentEvents()", () => {
  beforeEach(() => {
    const dir = dirname(TEST_EVENT_LOG_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    const dir = dirname(TEST_EVENT_LOG_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should return empty array if no events", async () => {
    const events = await getRecentEvents(24, TEST_EVENT_LOG_PATH);
    expect(events.length).toBe(0);
  });

  it("should return events from last N hours", async () => {
    const dir = dirname(TEST_EVENT_LOG_PATH);
    mkdirSync(dir, { recursive: true });

    const now = Date.now();
    const events = [
      // 30 hours ago - should NOT be included
      {
        id: "old-1",
        timestamp: new Date(now - 30 * 60 * 60 * 1000).toISOString(),
        actor: "claudegolem",
        type: "email_alert",
        data: { old: true },
      },
      // 12 hours ago - should be included
      {
        id: "recent-1",
        timestamp: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
        actor: "claudegolem",
        type: "job_match",
        data: { title: "Recent post" },
      },
      // 2 hours ago - should be included
      {
        id: "recent-2",
        timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        actor: "emailgolem",
        type: "email_alert",
        data: { subject: "Interview" },
      },
    ];

    writeFileSync(TEST_EVENT_LOG_PATH, JSON.stringify(events, null, 2));

    const recentEvents = await getRecentEvents(24, TEST_EVENT_LOG_PATH);

    expect(recentEvents.length).toBe(2);
    expect(recentEvents[0].id).toBe("recent-1");
    expect(recentEvents[1].id).toBe("recent-2");
  });

  it("should use default 24 hours if not specified", async () => {
    const dir = dirname(TEST_EVENT_LOG_PATH);
    mkdirSync(dir, { recursive: true });

    const now = Date.now();
    const events = [
      {
        id: "within-24h",
        timestamp: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
        actor: "claudegolem",
        type: "job_match",
        data: {},
      },
    ];

    writeFileSync(TEST_EVENT_LOG_PATH, JSON.stringify(events, null, 2));

    // Call without hours parameter
    const recentEvents = await getRecentEvents(undefined, TEST_EVENT_LOG_PATH);
    expect(recentEvents.length).toBe(1);
  });
});

describe("Event Log - formatEventsForClaude()", () => {
  it("should return empty message for no events", () => {
    const formatted = formatEventsForClaude([]);
    expect(formatted).toBe("No recent events.");
  });

  it("should format job_match with JobGolem attribution", () => {
    const events: GolemEvent[] = [
      {
        id: "1",
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
        actor: "jobgolem",
        type: "job_match",
        data: { company: "Google", role: "SWE", score: 9 },
      },
    ];

    const formatted = formatEventsForClaude(events);

    expect(formatted).toContain("JobGolem");
    expect(formatted).toContain("found job match");
    expect(formatted).toContain("Google");
    expect(formatted).toContain("2h ago");
  });

  it("should format email_alert with YOU prefix for claudegolem", () => {
    const events: GolemEvent[] = [
      {
        id: "2",
        timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4h ago
        actor: "claudegolem",
        type: "email_alert",
        data: { subject: "Interview invitation" },
      },
    ];

    const formatted = formatEventsForClaude(events);

    expect(formatted).toContain("YOU");
    expect(formatted).toContain("sent alert");
    expect(formatted).toContain("Interview invitation");
  });

  it("should format email_alert with EmailGolem attribution", () => {
    const events: GolemEvent[] = [
      {
        id: "3",
        timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6h ago
        actor: "emailgolem",
        type: "email_alert",
        data: { subject: "Interview at Microsoft" },
      },
    ];

    const formatted = formatEventsForClaude(events);

    expect(formatted).toContain("EmailGolem");
    expect(formatted).toContain("sent alert");
    expect(formatted).toContain("Interview at Microsoft");
  });

  it("should format email_routed", () => {
    const events: GolemEvent[] = [
      {
        id: "4",
        timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1h ago
        actor: "emailgolem",
        type: "email_routed",
        data: { subject: "Job offer", targetGolem: "recruitergolem" },
      },
    ];

    const formatted = formatEventsForClaude(events);

    expect(formatted).toContain("EmailGolem");
    expect(formatted).toContain("routed");
  });

  it("should format nightshift_pr", () => {
    const events: GolemEvent[] = [
      {
        id: "5",
        timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), // 8h ago
        actor: "nightshift",
        type: "nightshift_pr",
        data: { repo: "songscript", prNumber: 42 },
      },
    ];

    const formatted = formatEventsForClaude(events);

    expect(formatted).toContain("NightShift");
    expect(formatted).toContain("created PR");
    expect(formatted).toContain("songscript#42");
  });

  it("should format multiple events in chronological order", () => {
    const now = Date.now();
    const events: GolemEvent[] = [
      {
        id: "1",
        timestamp: new Date(now - 6 * 60 * 60 * 1000).toISOString(), // oldest
        actor: "emailgolem",
        type: "email_alert",
        data: { subject: "Email 1" },
      },
      {
        id: "2",
        timestamp: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
        actor: "claudegolem",
        type: "email_alert",
        data: { title: "Draft 1" },
      },
      {
        id: "3",
        timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString(), // most recent
        actor: "claudegolem",
        type: "job_match",
        data: { title: "Post 1" },
      },
    ];

    const formatted = formatEventsForClaude(events);
    const lines = formatted.split("\n").filter((l) => l.startsWith("-"));

    // Most recent first
    expect(lines[0]).toContain("2h ago");
    expect(lines[1]).toContain("4h ago");
    expect(lines[2]).toContain("6h ago");
  });
});

describe("Event Log - Edge Cases", () => {
  beforeEach(() => {
    const dir = dirname(TEST_EVENT_LOG_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    const dir = dirname(TEST_EVENT_LOG_PATH);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should handle corrupted JSON gracefully", async () => {
    const dir = dirname(TEST_EVENT_LOG_PATH);
    mkdirSync(dir, { recursive: true });

    writeFileSync(TEST_EVENT_LOG_PATH, "this is not valid json");

    // Should not throw, should return empty
    const events = await getRecentEvents(24, TEST_EVENT_LOG_PATH);
    expect(events.length).toBe(0);
  });

  it("should handle missing data fields gracefully in format", () => {
    const events: GolemEvent[] = [
      {
        id: "1",
        timestamp: new Date().toISOString(),
        actor: "jobgolem",
        type: "job_match",
        data: {}, // missing company/role
      },
    ];

    // Should not throw
    const formatted = formatEventsForClaude(events);
    expect(formatted).toBeDefined();
    expect(formatted).toContain("found job match");
  });

  it("should format time as minutes when less than 1 hour", () => {
    const events: GolemEvent[] = [
      {
        id: "1",
        timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
        actor: "claudegolem",
        type: "job_match",
        data: { title: "Recent" },
      },
    ];

    const formatted = formatEventsForClaude(events);
    expect(formatted).toContain("30m ago");
  });
});

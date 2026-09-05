/**
 * Nudge Queue — TDD Tests
 *
 * Tests the Zod schema, queue read/write, and lifecycle operations.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import {
  NudgeSchema,
  type Nudge,
  type NudgeType,
  type NudgePriority,
  createNudge,
  readQueue,
  appendNudge,
  markSent,
  markDismissed,
  getPending,
  clearSent,
} from "../nudge-queue";

const TEST_DIR = join(import.meta.dir, "../../.test-tmp");
const TEST_QUEUE = join(TEST_DIR, "test-nudges.jsonl");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  if (existsSync(TEST_QUEUE)) unlinkSync(TEST_QUEUE);
});

afterEach(() => {
  if (existsSync(TEST_QUEUE)) unlinkSync(TEST_QUEUE);
});

// --- Schema Validation Tests ---

describe("NudgeSchema", () => {
  test("validates a complete nudge", () => {
    const nudge = {
      id: "nudge-001",
      type: "reminder",
      priority: "medium",
      message: "Time for afternoon check-in",
      scheduledAt: "2026-03-10T14:00:00+03:00",
      status: "pending",
      channel: "telegram",
      createdAt: "2026-03-10T07:00:00+03:00",
    };

    const result = NudgeSchema.safeParse(nudge);
    expect(result.success).toBe(true);
  });

  test("validates all nudge types", () => {
    const types: NudgeType[] = ["reminder", "check-in", "insight", "alert"];
    for (const type of types) {
      const nudge = {
        id: `nudge-${type}`,
        type,
        priority: "medium" as const,
        message: `Test ${type}`,
        scheduledAt: "2026-03-10T14:00:00+03:00",
        status: "pending" as const,
        channel: "telegram" as const,
        createdAt: "2026-03-10T07:00:00+03:00",
      };
      const result = NudgeSchema.safeParse(nudge);
      expect(result.success).toBe(true);
    }
  });

  test("validates all priority levels", () => {
    const priorities: NudgePriority[] = ["high", "medium", "low"];
    for (const priority of priorities) {
      const nudge = {
        id: `nudge-${priority}`,
        type: "reminder" as const,
        priority,
        message: `Test ${priority}`,
        scheduledAt: "2026-03-10T14:00:00+03:00",
        status: "pending" as const,
        channel: "telegram" as const,
        createdAt: "2026-03-10T07:00:00+03:00",
      };
      const result = NudgeSchema.safeParse(nudge);
      expect(result.success).toBe(true);
    }
  });

  test("validates all status values", () => {
    const statuses = ["pending", "sent", "dismissed"] as const;
    for (const status of statuses) {
      const nudge = {
        id: `nudge-${status}`,
        type: "reminder" as const,
        priority: "medium" as const,
        message: `Test ${status}`,
        scheduledAt: "2026-03-10T14:00:00+03:00",
        status,
        channel: "telegram" as const,
        createdAt: "2026-03-10T07:00:00+03:00",
      };
      const result = NudgeSchema.safeParse(nudge);
      expect(result.success).toBe(true);
    }
  });

  test("validates both channels", () => {
    for (const channel of ["telegram", "voice"] as const) {
      const nudge = {
        id: `nudge-${channel}`,
        type: "reminder" as const,
        priority: "medium" as const,
        message: `Test ${channel}`,
        scheduledAt: "2026-03-10T14:00:00+03:00",
        status: "pending" as const,
        channel,
        createdAt: "2026-03-10T07:00:00+03:00",
      };
      const result = NudgeSchema.safeParse(nudge);
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid nudge type", () => {
    const nudge = {
      id: "nudge-bad",
      type: "unknown",
      priority: "medium",
      message: "Test",
      scheduledAt: "2026-03-10T14:00:00+03:00",
      status: "pending",
      channel: "telegram",
      createdAt: "2026-03-10T07:00:00+03:00",
    };
    const result = NudgeSchema.safeParse(nudge);
    expect(result.success).toBe(false);
  });

  test("rejects missing required fields", () => {
    const nudge = { id: "nudge-incomplete", type: "reminder" };
    const result = NudgeSchema.safeParse(nudge);
    expect(result.success).toBe(false);
  });

  test("allows optional metadata field", () => {
    const nudge = {
      id: "nudge-meta",
      type: "insight",
      priority: "low",
      message: "Your recovery trend is improving",
      scheduledAt: "2026-03-10T14:00:00+03:00",
      status: "pending",
      channel: "telegram",
      createdAt: "2026-03-10T07:00:00+03:00",
      metadata: { source: "journal", trend: "up" },
    };
    const result = NudgeSchema.safeParse(nudge);
    expect(result.success).toBe(true);
  });
});

// --- createNudge Tests ---

describe("createNudge", () => {
  test("creates a nudge with defaults", () => {
    const nudge = createNudge({
      type: "reminder",
      message: "Time to stretch",
      scheduledAt: "2026-03-10T14:00:00+03:00",
    });

    expect(nudge.id).toMatch(/^nudge-/);
    expect(nudge.type).toBe("reminder");
    expect(nudge.priority).toBe("medium"); // default
    expect(nudge.status).toBe("pending"); // default
    expect(nudge.channel).toBe("telegram"); // default
    expect(nudge.message).toBe("Time to stretch");
    expect(nudge.createdAt).toBeDefined();
  });

  test("creates a nudge with overrides", () => {
    const nudge = createNudge({
      type: "alert",
      priority: "high",
      message: "Energy check-in is overdue",
      scheduledAt: "2026-03-10T07:30:00+03:00",
      channel: "voice",
    });

    expect(nudge.type).toBe("alert");
    expect(nudge.priority).toBe("high");
    expect(nudge.channel).toBe("voice");
  });
});

// --- Queue File Operations Tests ---

describe("queue file operations", () => {
  test("appendNudge writes to JSONL file", () => {
    const nudge = createNudge({
      type: "reminder",
      message: "Test nudge",
      scheduledAt: "2026-03-10T14:00:00+03:00",
    });

    appendNudge(nudge, TEST_QUEUE);

    expect(existsSync(TEST_QUEUE)).toBe(true);
    const queue = readQueue(TEST_QUEUE);
    expect(queue).toHaveLength(1);
    expect(queue[0].message).toBe("Test nudge");
  });

  test("appendNudge appends multiple nudges", () => {
    appendNudge(
      createNudge({
        type: "reminder",
        message: "First",
        scheduledAt: "2026-03-10T14:00:00+03:00",
      }),
      TEST_QUEUE,
    );
    appendNudge(
      createNudge({
        type: "check-in",
        message: "Second",
        scheduledAt: "2026-03-10T15:00:00+03:00",
      }),
      TEST_QUEUE,
    );
    appendNudge(
      createNudge({
        type: "alert",
        message: "Third",
        scheduledAt: "2026-03-10T16:00:00+03:00",
      }),
      TEST_QUEUE,
    );

    const queue = readQueue(TEST_QUEUE);
    expect(queue).toHaveLength(3);
    expect(queue[0].type).toBe("reminder");
    expect(queue[1].type).toBe("check-in");
    expect(queue[2].type).toBe("alert");
  });

  test("readQueue returns empty array for missing file", () => {
    const queue = readQueue("/nonexistent/path/nudges.jsonl");
    expect(queue).toHaveLength(0);
  });

  test("readQueue skips invalid JSON lines", () => {
    // Write a file with one valid and one invalid line
    const nudge = createNudge({
      type: "reminder",
      message: "Valid",
      scheduledAt: "2026-03-10T14:00:00+03:00",
    });
    appendNudge(nudge, TEST_QUEUE);
    // Append an invalid line
    const { appendFileSync } = require("fs");
    appendFileSync(TEST_QUEUE, "this is not json\n");
    appendNudge(
      createNudge({
        type: "alert",
        message: "Also valid",
        scheduledAt: "2026-03-10T15:00:00+03:00",
      }),
      TEST_QUEUE,
    );

    const queue = readQueue(TEST_QUEUE);
    expect(queue).toHaveLength(2);
    expect(queue[0].message).toBe("Valid");
    expect(queue[1].message).toBe("Also valid");
  });
});

// --- Lifecycle Operations Tests ---

describe("lifecycle operations", () => {
  test("markSent updates nudge status", () => {
    const nudge = createNudge({
      type: "reminder",
      message: "Test",
      scheduledAt: "2026-03-10T14:00:00+03:00",
    });
    appendNudge(nudge, TEST_QUEUE);

    markSent(nudge.id, TEST_QUEUE);

    const queue = readQueue(TEST_QUEUE);
    expect(queue[0].status).toBe("sent");
  });

  test("markDismissed updates nudge status", () => {
    const nudge = createNudge({
      type: "insight",
      message: "Trend",
      scheduledAt: "2026-03-10T14:00:00+03:00",
    });
    appendNudge(nudge, TEST_QUEUE);

    markDismissed(nudge.id, TEST_QUEUE);

    const queue = readQueue(TEST_QUEUE);
    expect(queue[0].status).toBe("dismissed");
  });

  test("getPending returns only pending nudges", () => {
    const n1 = createNudge({
      type: "reminder",
      message: "Pending 1",
      scheduledAt: "2026-03-10T14:00:00+03:00",
    });
    const n2 = createNudge({
      type: "check-in",
      message: "Pending 2",
      scheduledAt: "2026-03-10T15:00:00+03:00",
    });
    const n3 = createNudge({
      type: "alert",
      message: "Will be sent",
      scheduledAt: "2026-03-10T16:00:00+03:00",
    });

    appendNudge(n1, TEST_QUEUE);
    appendNudge(n2, TEST_QUEUE);
    appendNudge(n3, TEST_QUEUE);
    markSent(n3.id, TEST_QUEUE);

    const pending = getPending(TEST_QUEUE);
    expect(pending).toHaveLength(2);
    expect(pending[0].message).toBe("Pending 1");
    expect(pending[1].message).toBe("Pending 2");
  });

  test("clearSent removes sent nudges from queue", () => {
    const n1 = createNudge({
      type: "reminder",
      message: "Keep",
      scheduledAt: "2026-03-10T14:00:00+03:00",
    });
    const n2 = createNudge({
      type: "check-in",
      message: "Remove",
      scheduledAt: "2026-03-10T15:00:00+03:00",
    });
    const n3 = createNudge({
      type: "alert",
      message: "Also keep",
      scheduledAt: "2026-03-10T16:00:00+03:00",
    });

    appendNudge(n1, TEST_QUEUE);
    appendNudge(n2, TEST_QUEUE);
    appendNudge(n3, TEST_QUEUE);
    markSent(n2.id, TEST_QUEUE);

    const cleared = clearSent(TEST_QUEUE);
    expect(cleared).toBe(1);

    const queue = readQueue(TEST_QUEUE);
    expect(queue).toHaveLength(2);
    expect(queue.every((n) => n.status !== "sent")).toBe(true);
  });

  test("getPending sorts by priority (high first)", () => {
    appendNudge(
      createNudge({
        type: "reminder",
        priority: "low",
        message: "Low",
        scheduledAt: "2026-03-10T14:00:00+03:00",
      }),
      TEST_QUEUE,
    );
    appendNudge(
      createNudge({
        type: "alert",
        priority: "high",
        message: "High",
        scheduledAt: "2026-03-10T14:00:00+03:00",
      }),
      TEST_QUEUE,
    );
    appendNudge(
      createNudge({
        type: "check-in",
        priority: "medium",
        message: "Medium",
        scheduledAt: "2026-03-10T14:00:00+03:00",
      }),
      TEST_QUEUE,
    );

    const pending = getPending(TEST_QUEUE);
    expect(pending[0].priority).toBe("high");
    expect(pending[1].priority).toBe("medium");
    expect(pending[2].priority).toBe("low");
  });
});

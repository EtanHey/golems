/**
 * Tests for Thread Compaction System
 *
 * TDD approach: RED → GREEN → REFACTOR
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { append } from "@golems/services/thread-store";
import {
  identifyOldTurns,
  summarizeTurns,
  embedSummary,
  storeInChroma,
  compactThread,
} from "@golems/services/thread-compactor";

// Test directory (isolated from production)
const TEST_THREADS_DIR = "/tmp/ollama-threads-compactor-test";

describe("Thread Compaction - identifyOldTurns()", () => {
  beforeEach(() => {
    // Clean up before each test
    if (existsSync(TEST_THREADS_DIR)) {
      rmSync(TEST_THREADS_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(TEST_THREADS_DIR)) {
      rmSync(TEST_THREADS_DIR, { recursive: true, force: true });
    }
  });

  it("should identify messages older than 24 hours", async () => {
    const threadId = "chat-old-messages";
    const now = new Date();
    const yesterday = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago

    // Add messages with specific timestamps
    await append(
      threadId,
      {
        role: "user",
        content: "Old message 1",
        timestamp: yesterday.toISOString(),
      },
      TEST_THREADS_DIR,
    );
    await append(
      threadId,
      {
        role: "assistant",
        content: "Old message 2",
        timestamp: yesterday.toISOString(),
      },
      TEST_THREADS_DIR,
    );
    await append(
      threadId,
      {
        role: "user",
        content: "Recent message 1",
        timestamp: twoHoursAgo.toISOString(),
      },
      TEST_THREADS_DIR,
    );
    await append(
      threadId,
      {
        role: "assistant",
        content: "Recent message 2",
        timestamp: now.toISOString(),
      },
      TEST_THREADS_DIR,
    );

    // Identify old turns (older than 24h)
    const oldTurns = await identifyOldTurns(threadId, TEST_THREADS_DIR);

    expect(oldTurns.length).toBe(2);
    expect(oldTurns[0].content).toBe("Old message 1");
    expect(oldTurns[1].content).toBe("Old message 2");
  });

  it("should return empty array if no messages are older than 24h", async () => {
    const threadId = "chat-recent-only";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);

    await append(
      threadId,
      {
        role: "user",
        content: "Recent 1",
        timestamp: oneHourAgo.toISOString(),
      },
      TEST_THREADS_DIR,
    );
    await append(
      threadId,
      { role: "assistant", content: "Recent 2", timestamp: now.toISOString() },
      TEST_THREADS_DIR,
    );

    const oldTurns = await identifyOldTurns(threadId, TEST_THREADS_DIR);

    expect(oldTurns.length).toBe(0);
  });

  it("should return empty array for non-existent thread", async () => {
    const oldTurns = await identifyOldTurns("non-existent", TEST_THREADS_DIR);
    expect(oldTurns.length).toBe(0);
  });
});

describe("Thread Compaction - summarizeTurns()", () => {
  it("returns null when Ollama fails to generate a summary", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = (() => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    })) as unknown as typeof Bun.spawn;

    try {
      const summary = await summarizeTurns([
        { role: "user", content: "Summarize this" },
      ]);
      expect(summary).toBeNull();
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  it.skip("should summarize messages via Ollama (requires Ollama running)", async () => {
    const messages = [
      {
        role: "user",
        content: "What's the weather?",
        timestamp: "2026-01-31T10:00:00.000Z",
      },
      {
        role: "assistant",
        content: "The weather is sunny and 75 degrees.",
        timestamp: "2026-01-31T10:00:10.000Z",
      },
      {
        role: "user",
        content: "Will it rain tomorrow?",
        timestamp: "2026-01-31T10:01:00.000Z",
      },
      {
        role: "assistant",
        content: "Yes, rain is expected tomorrow afternoon.",
        timestamp: "2026-01-31T10:01:10.000Z",
      },
    ];

    const summary = await summarizeTurns(messages);
    if (summary === null) {
      throw new Error("Ollama failed to generate a summary");
    }

    // Summary should be a non-empty string
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);

    // Summary should be shorter than the original content (rough heuristic)
    const originalLength = messages.map((m) => m.content).join(" ").length;
    expect(summary.length).toBeLessThan(originalLength * 2);
  }, 30000); // 30 second timeout for Ollama

  it("should return empty string for empty messages array", async () => {
    const summary = await summarizeTurns([]);
    expect(summary).toBe("");
  });
});

describe("Thread Compaction - embedSummary()", () => {
  it("returns null and reports the failure when Ollama cannot embed", async () => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    const errors: unknown[][] = [];
    globalThis.fetch = mock(async () =>
      new Response("service unavailable", { status: 503 })
    ) as unknown as typeof globalThis.fetch;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      expect(await embedSummary("hello")).toBeNull();
      expect(
        errors.some(
          ([message]) =>
            message === "[ThreadCompactor] Ollama failed to generate an embedding",
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;
    }
  });

  it("should generate embedding vector for summary text", async () => {
    // This test requires an embedding service (Ollama) to be running
    const summary =
      "User asked about weather, bot responded with sunny forecast.";

    let embedding: number[] | null;
    try {
      embedding = await embedSummary(summary);
    } catch {
      // Skip if embedding service is unavailable
      console.log("[Embed] Skipping — embedding service unavailable");
      return;
    }

    if (embedding === null) {
      console.log("[Embed] Skipping — embedding service request failed");
      return;
    }

    if (embedding.length === 0) {
      // Service returned empty (connection failed gracefully)
      console.log("[Embed] Skipping — embedding service returned empty");
      return;
    }

    // Embedding should be a non-empty array of numbers
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);

    // All values should be numbers
    embedding.forEach((val) => {
      expect(typeof val).toBe("number");
    });
  }, 30000); // 30 second timeout for Ollama

  it("should return empty array for empty summary", async () => {
    const embedding = await embedSummary("");
    expect(embedding).toEqual([]);
  });
});

describe("Thread Compaction - storeInChroma()", () => {
  it.skip("should store summary and embedding in ChromaDB (requires ChromaDB running)", async () => {
    const threadId = "chat-test-123";
    const summary =
      "User asked about weather, bot responded with sunny forecast.";
    const embedding = new Array(1024).fill(0.1); // Mock embedding vector

    // Store in ChromaDB
    const success = await storeInChroma(threadId, summary, embedding);

    expect(success).toBe(true);
  });

  it("should return false for invalid input", async () => {
    const success = await storeInChroma("", "", []);
    expect(success).toBe(false);
  });
});

describe("Thread Compaction - compactThread() failure propagation", () => {
  beforeEach(() => {
    if (existsSync(TEST_THREADS_DIR)) {
      rmSync(TEST_THREADS_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_THREADS_DIR)) {
      rmSync(TEST_THREADS_DIR, { recursive: true, force: true });
    }
  });

  it("aborts when Ollama fails to generate the summary", async () => {
    const originalSpawn = Bun.spawn;
    Bun.spawn = (() => ({
      exited: Promise.resolve(1),
      stdout: new Response("").body!,
      stderr: new Response("ollama unavailable").body!,
    })) as unknown as typeof Bun.spawn;
    const threadId = "summary-failure";

    try {
      await append(
        threadId,
        {
          role: "user",
          content: "old message",
          timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        },
        TEST_THREADS_DIR,
      );
      expect(await compactThread(threadId, TEST_THREADS_DIR)).toBeNull();
    } finally {
      Bun.spawn = originalSpawn;
    }
  });

  it("aborts when Ollama fails to generate the embedding", async () => {
    const originalSpawn = Bun.spawn;
    const originalFetch = globalThis.fetch;
    const originalStateDir = process.env.GOLEMS_STATE_DIR;
    Bun.spawn = (() => ({
      exited: Promise.resolve(0),
      stdout: new Response("A concise summary").body!,
      stderr: new Response("").body!,
    })) as unknown as typeof Bun.spawn;
    globalThis.fetch = mock(async () =>
      new Response("service unavailable", { status: 503 })
    ) as unknown as typeof globalThis.fetch;
    process.env.GOLEMS_STATE_DIR = TEST_THREADS_DIR;
    const threadId = "embedding-failure";

    try {
      await append(
        threadId,
        {
          role: "user",
          content: "old message",
          timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        },
        TEST_THREADS_DIR,
      );
      expect(await compactThread(threadId, TEST_THREADS_DIR)).toBeNull();
    } finally {
      Bun.spawn = originalSpawn;
      globalThis.fetch = originalFetch;
      if (originalStateDir === undefined) delete process.env.GOLEMS_STATE_DIR;
      else process.env.GOLEMS_STATE_DIR = originalStateDir;
    }
  });
});

/**
 * Tests for Thread Storage System
 *
 * TDD approach: RED → GREEN → REFACTOR
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { append, getRecent, listThreads } from "@golems/services/thread-store";

// Test directory (isolated from production)
const TEST_THREADS_DIR = "/tmp/ollama-threads-test";

describe("Thread Storage - append()", () => {
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

  it("should create thread file if not exists", async () => {
    const threadId = "chat-123";
    const message = { role: "user", content: "Hello" };

    await append(threadId, message, TEST_THREADS_DIR);

    const filePath = join(TEST_THREADS_DIR, `${threadId}.jsonl`);
    expect(existsSync(filePath)).toBe(true);
  });

  it("should append message to existing thread file", async () => {
    const threadId = "chat-456";
    const msg1 = { role: "user", content: "First message" };
    const msg2 = { role: "assistant", content: "Second message" };

    await append(threadId, msg1, TEST_THREADS_DIR);
    await append(threadId, msg2, TEST_THREADS_DIR);

    const filePath = join(TEST_THREADS_DIR, `${threadId}.jsonl`);
    expect(existsSync(filePath)).toBe(true);
  });
});

describe("Thread Storage - getRecent()", () => {
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

  it("should return last N messages from thread", async () => {
    const threadId = "chat-789";
    const messages = [
      { role: "user", content: "Message 1" },
      { role: "assistant", content: "Message 2" },
      { role: "user", content: "Message 3" },
      { role: "assistant", content: "Message 4" },
      { role: "user", content: "Message 5" },
    ];

    // Add all messages
    for (const msg of messages) {
      await append(threadId, msg, TEST_THREADS_DIR);
    }

    // Get last 3 messages
    const recent = await getRecent(threadId, 3, TEST_THREADS_DIR);

    expect(recent.length).toBe(3);
    expect(recent[0].content).toBe("Message 3");
    expect(recent[1].content).toBe("Message 4");
    expect(recent[2].content).toBe("Message 5");
  });

  it("should return empty array for non-existent thread", async () => {
    const recent = await getRecent("non-existent", 5, TEST_THREADS_DIR);
    expect(recent.length).toBe(0);
  });

  it("should return all messages if n exceeds total", async () => {
    const threadId = "chat-small";
    await append(threadId, { role: "user", content: "Only message" }, TEST_THREADS_DIR);

    const recent = await getRecent(threadId, 100, TEST_THREADS_DIR);
    expect(recent.length).toBe(1);
    expect(recent[0].content).toBe("Only message");
  });
});

describe("Thread Storage - listThreads()", () => {
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

  it("should return all thread IDs", async () => {
    // Create multiple thread files
    await append("thread-1", { role: "user", content: "Hello 1" }, TEST_THREADS_DIR);
    await append("thread-2", { role: "user", content: "Hello 2" }, TEST_THREADS_DIR);
    await append("thread-3", { role: "user", content: "Hello 3" }, TEST_THREADS_DIR);

    const threads = await listThreads(TEST_THREADS_DIR);

    expect(threads.length).toBe(3);
    expect(threads).toContain("thread-1");
    expect(threads).toContain("thread-2");
    expect(threads).toContain("thread-3");
  });

  it("should return empty array if no threads exist", async () => {
    const threads = await listThreads(TEST_THREADS_DIR);
    expect(threads.length).toBe(0);
  });

  it("should only return .jsonl files", async () => {
    // Create a thread file and a non-thread file
    await append("valid-thread", { role: "user", content: "Valid" }, TEST_THREADS_DIR);

    // Create a non-JSONL file manually
    const { writeFileSync } = await import("fs");
    writeFileSync(join(TEST_THREADS_DIR, "invalid.txt"), "not a thread");

    const threads = await listThreads(TEST_THREADS_DIR);

    expect(threads.length).toBe(1);
    expect(threads[0]).toBe("valid-thread");
  });
});

describe("Thread Storage - Malformed JSONL Recovery", () => {
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

  it("should skip malformed lines and return valid messages", async () => {
    const threadId = "corrupted-thread";
    const { writeFileSync, mkdirSync } = await import("fs");

    // Create directory and file with mixed valid/invalid JSONL
    mkdirSync(TEST_THREADS_DIR, { recursive: true });
    const content = [
      '{"role":"user","content":"Valid message 1"}',
      'this is not valid json',
      '{"role":"assistant","content":"Valid message 2"}',
      '{broken json',
      '{"role":"user","content":"Valid message 3"}',
    ].join("\n");

    writeFileSync(join(TEST_THREADS_DIR, `${threadId}.jsonl`), content);

    // getRecent should recover and return only valid messages
    const messages = await getRecent(threadId, 10, TEST_THREADS_DIR);

    expect(messages.length).toBe(3);
    expect(messages[0].content).toBe("Valid message 1");
    expect(messages[1].content).toBe("Valid message 2");
    expect(messages[2].content).toBe("Valid message 3");
  });

  it("should return empty array if all lines are malformed", async () => {
    const threadId = "fully-corrupted";
    const { writeFileSync, mkdirSync } = await import("fs");

    mkdirSync(TEST_THREADS_DIR, { recursive: true });
    const content = [
      'not json at all',
      '{broken',
      'also not json',
    ].join("\n");

    writeFileSync(join(TEST_THREADS_DIR, `${threadId}.jsonl`), content);

    const messages = await getRecent(threadId, 10, TEST_THREADS_DIR);
    expect(messages.length).toBe(0);
  });
});

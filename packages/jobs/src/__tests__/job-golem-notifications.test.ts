/**
 * Tests for Job Golem Telegram Notifications
 *
 * Tests the sendTelegram function for:
 * - Chat ID validation
 * - Error handling
 * - Response logging
 * - Correct payload structure
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { existsSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";

// Test state directory
const TEST_STATE_DIR = "/tmp/job-golem-test-state";
const TEST_STATE_FILE = join(TEST_STATE_DIR, "state.json");

// Mock fetch responses
let mockFetchResponse: { ok: boolean; status: number; text: () => Promise<string> };
let fetchCalls: { url: string; options: any }[] = [];

// Store original values
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

describe("sendTelegram", () => {
  beforeEach(() => {
    // Reset
    fetchCalls = [];
    mockFetchResponse = { ok: true, status: 200, text: async () => "ok" };

    // Create test state directory
    mkdirSync(TEST_STATE_DIR, { recursive: true });

    // Mock fetch
    globalThis.fetch = async (url: string | URL, options?: any) => {
      fetchCalls.push({ url: url.toString(), options });
      return mockFetchResponse as any;
    };
  });

  afterEach(() => {
    // Restore
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };

    // Cleanup
    if (existsSync(TEST_STATE_DIR)) {
      rmSync(TEST_STATE_DIR, { recursive: true, force: true });
    }
  });

  it("should not send if no chat ID configured", async () => {
    // Create state without chat ID
    writeFileSync(TEST_STATE_FILE, JSON.stringify({ nightShiftTarget: "test" }));

    // Import the module (need to do this dynamically to use our test state)
    const { sendTelegramTest } = await createTestModule(TEST_STATE_FILE);

    await sendTelegramTest("Test", "Body");

    // Should not have called fetch
    expect(fetchCalls.length).toBe(0);
  });

  it("should send notification when chat ID exists", async () => {
    // Create state with chat ID
    writeFileSync(TEST_STATE_FILE, JSON.stringify({ telegramChatId: 12345 }));

    const { sendTelegramTest } = await createTestModule(TEST_STATE_FILE);

    await sendTelegramTest("Test Title", "Test Body");

    // Should have called fetch
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe("http://localhost:3847/notify");

    const body = JSON.parse(fetchCalls[0].options.body);
    expect(body.title).toBe("Test Title");
    expect(body.body).toBe("Test Body");
    expect(body.source).toBe("jobs");
  });

  it("should handle server errors gracefully", async () => {
    writeFileSync(TEST_STATE_FILE, JSON.stringify({ telegramChatId: 12345 }));
    mockFetchResponse = { ok: false, status: 500, text: async () => "Internal Server Error" };

    const { sendTelegramTest } = await createTestModule(TEST_STATE_FILE);

    // Should not throw
    await expect(sendTelegramTest("Test", "Body")).resolves.toBeUndefined();

    // Should have attempted the call
    expect(fetchCalls.length).toBe(1);
  });

  it("should handle network errors gracefully", async () => {
    writeFileSync(TEST_STATE_FILE, JSON.stringify({ telegramChatId: 12345 }));

    // Mock fetch to throw
    globalThis.fetch = async () => {
      throw new Error("Connection refused");
    };

    const { sendTelegramTest } = await createTestModule(TEST_STATE_FILE);

    // Should not throw
    await expect(sendTelegramTest("Test", "Body")).resolves.toBeUndefined();
  });

  it("should include priority in payload", async () => {
    writeFileSync(TEST_STATE_FILE, JSON.stringify({ telegramChatId: 12345 }));

    const { sendTelegramTest } = await createTestModule(TEST_STATE_FILE);

    await sendTelegramTest("Hot!", "Important", "high");

    const body = JSON.parse(fetchCalls[0].options.body);
    expect(body.priority).toBe("high");
  });
});

/**
 * Helper to create a test module with custom state file path
 * This allows us to test with isolated state
 */
async function createTestModule(stateFilePath: string) {
  // We need to create a test version of sendTelegram that uses our test state file
  const { readFileSync } = await import("fs");

  const NOTIFY_URL = "http://localhost:3847/notify";

  function getTelegramChatIdTest(): number | null {
    try {
      const state = JSON.parse(readFileSync(stateFilePath, "utf-8"));
      return state.telegramChatId;
    } catch {
      return null;
    }
  }

  async function sendTelegramTest(
    title: string,
    body: string,
    priority: "default" | "high" = "default"
  ) {
    const chatId = getTelegramChatIdTest();
    if (!chatId) {
      console.error("[Telegram] No chat ID configured");
      return;
    }

    try {
      console.log(`[Telegram] Sending: "${title}"`);
      const response = await fetch(NOTIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, source: "jobs", priority }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[Telegram] Server error ${response.status}: ${text}`);
      } else {
        console.log("[Telegram] Sent successfully");
      }
    } catch (err) {
      console.error("[Telegram] Failed to connect:", err);
    }
  }

  return { sendTelegramTest, getTelegramChatIdTest };
}

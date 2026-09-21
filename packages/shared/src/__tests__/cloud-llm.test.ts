import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { runHaiku, runHaikuJSON, _resetClient } from "@golems/shared/lib/cloud-llm";
import { z } from "zod";

const scoreResultSchema = z.object({
  score: z.number(),
  category: z.string(),
});

// Create a mock Anthropic client (replaces mock.module which can't cross workspace boundaries)
const mockCreate = mock(() =>
  Promise.resolve({
    content: [{ type: "text", text: '{"score": 8, "category": "job"}' }],
  })
);

const mockClient = {
  messages: { create: mockCreate },
} as any;

describe("cloud-llm", () => {
  beforeEach(() => {
    mockCreate.mockClear();
    _resetClient(mockClient);
  });

  afterEach(() => {
    _resetClient(null);
  });

  describe("runHaiku", () => {
    it("returns text from Haiku response", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Hello from Haiku" }],
      });

      const result = await runHaiku("Say hello", "test");
      expect(result).toBe("Hello from Haiku");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("passes correct model and prompt", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
      });

      await runHaiku("Test prompt", "email-golem");

      expect(mockCreate).toHaveBeenCalledWith({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Test prompt" }],
      });
    });

    it("returns null on error", async () => {
      mockCreate.mockRejectedValueOnce(new Error("API error"));

      const result = await runHaiku("fail", "test");
      expect(result).toBeNull();
    });

    it("returns empty string when no text block", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [],
      });

      const result = await runHaiku("empty", "test");
      expect(result).toBe("");
    });
  });

  describe("runHaikuJSON", () => {
    it("parses JSON from response", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: 'Here is the result: {"score": 8, "category": "job"}' }],
      });

      const result = await runHaikuJSON("Score this", scoreResultSchema, "test");
      expect(result).toEqual({ score: 8, category: "job" });
    });

    it("rejects parsed JSON that does not match the caller schema", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: '{"score": "8", "category": "job"}' }],
      });

      const result = await runHaikuJSON("Score this", scoreResultSchema, "test");
      expect(result).toBeNull();
    });

    it("returns null on empty response", async () => {
      mockCreate.mockRejectedValueOnce(new Error("API error"));

      const result = await runHaikuJSON("fail", scoreResultSchema, "test");
      expect(result).toBeNull();
    });

    it("returns null when response has no JSON", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "No JSON here, just text." }],
      });

      const result = await runHaikuJSON("no json", scoreResultSchema, "test");
      expect(result).toBeNull();
    });

    it("handles nested JSON objects", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: "text",
          text: '{"name": "Test", "nested": {"key": "value"}, "arr": [1, 2]}',
        }],
      });

      const nestedSchema = z.object({
        name: z.string(),
        nested: z.object({ key: z.string() }),
        arr: z.array(z.number()),
      });
      const result = await runHaikuJSON("nested", nestedSchema, "test");
      expect(result?.name).toBe("Test");
      expect(result?.nested.key).toBe("value");
    });
  });
});

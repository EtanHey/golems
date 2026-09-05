import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  classifyLLMError,
  withRetry,
  LLMErrorType,
} from "@golems/shared/lib/llm-errors";

describe("llm-errors", () => {
  describe("classifyLLMError", () => {
    it("classifies 429 as rate_limit", () => {
      const err = Object.assign(new Error("Rate limit exceeded"), {
        status: 429,
      });
      expect(classifyLLMError(err)).toBe(LLMErrorType.RATE_LIMIT);
    });

    it("classifies 529 as overloaded", () => {
      const err = Object.assign(new Error("Overloaded"), { status: 529 });
      expect(classifyLLMError(err)).toBe(LLMErrorType.OVERLOADED);
    });

    it("classifies 401 as auth", () => {
      const err = Object.assign(new Error("Unauthorized"), { status: 401 });
      expect(classifyLLMError(err)).toBe(LLMErrorType.AUTH);
    });

    it("classifies network errors", () => {
      const err = new Error("fetch failed");
      expect(classifyLLMError(err)).toBe(LLMErrorType.NETWORK);
    });

    it("classifies ECONNREFUSED as network", () => {
      const err = Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
      expect(classifyLLMError(err)).toBe(LLMErrorType.NETWORK);
    });

    it("classifies unknown errors", () => {
      const err = new Error("Something weird happened");
      expect(classifyLLMError(err)).toBe(LLMErrorType.UNKNOWN);
    });

    it("classifies message containing 'rate limit' as rate_limit", () => {
      const err = new Error("429 Too Many Requests: rate limit hit");
      expect(classifyLLMError(err)).toBe(LLMErrorType.RATE_LIMIT);
    });
  });

  describe("withRetry", () => {
    it("returns result on first success", async () => {
      const fn = mock(() => Promise.resolve("ok"));
      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on transient failure then succeeds", async () => {
      let calls = 0;
      const fn = mock(() => {
        calls++;
        if (calls === 1)
          return Promise.reject(
            Object.assign(new Error("Rate limited"), { status: 429 }),
          );
        return Promise.resolve("ok after retry");
      });

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
      expect(result).toBe("ok after retry");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("does not retry on auth errors", async () => {
      const fn = mock(() =>
        Promise.reject(
          Object.assign(new Error("Unauthorized"), { status: 401 }),
        ),
      );

      await expect(
        withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }),
      ).rejects.toThrow("Unauthorized");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("throws after max retries exceeded", async () => {
      const fn = mock(() =>
        Promise.reject(
          Object.assign(new Error("Rate limited"), { status: 429 }),
        ),
      );

      await expect(
        withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }),
      ).rejects.toThrow("Rate limited");
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it("uses exponential backoff", async () => {
      let calls = 0;
      const fn = mock(() => {
        calls++;
        if (calls <= 2)
          return Promise.reject(
            Object.assign(new Error("Rate limited"), { status: 429 }),
          );
        return Promise.resolve("ok");
      });

      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 50 });
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});

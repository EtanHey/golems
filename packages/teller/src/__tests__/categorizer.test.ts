/**
 * TellerGolem Categorizer Tests (TDD)
 *
 * Tests expense categorization and vendor extraction.
 * Uses spyOn instead of mock.module to avoid global test pollution.
 */

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import * as llm from "@golems/shared/lib/llm";
import { categorizeExpense, extractVendor } from "@golems/teller/categorizer";
import type { CategorizedExpense, ScoredEmail } from "@golems/teller/types";

let mockRunOllamaJSON = mock<() => Promise<CategorizedExpense | null>>();

const makeEmail = (overrides: Partial<ScoredEmail> = {}): ScoredEmail => ({
  id: "test-1",
  from: "Netflix <billing@netflix.com>",
  subject: "Your monthly subscription",
  snippet: "Your Netflix subscription of $15.99 has been charged.",
  category: "subscription",
  score: 5,
  receivedAt: "2026-01-15T10:00:00Z",
  ...overrides,
});

describe("TellerGolem Categorizer", () => {
  beforeEach(() => {
    mockRunOllamaJSON = mock<() => Promise<CategorizedExpense | null>>();
    spyOn(llm, "runLLMJSON").mockImplementation((...args: unknown[]) => mockRunOllamaJSON());
    spyOn(llm, "runLLM").mockImplementation(async () => "");
  });

  afterEach(() => {
    mock.restore();
  });

  describe("extractVendor", () => {
    it("extracts name from 'Name <email>' format", () => {
      expect(extractVendor("Netflix <billing@netflix.com>")).toBe("Netflix");
    });

    it("extracts name with spaces", () => {
      expect(extractVendor("Google Cloud <noreply@google.com>")).toBe(
        "Google Cloud"
      );
    });

    it("returns raw email when no display name", () => {
      expect(extractVendor("billing@netflix.com")).toBe("billing@netflix.com");
    });

    it("returns plain name as-is", () => {
      expect(extractVendor("Netflix")).toBe("Netflix");
    });

    it("handles empty string", () => {
      expect(extractVendor("")).toBe("Unknown");
    });
  });

  describe("categorizeExpense", () => {
    it("returns LLM result when valid", async () => {
      const llmResult: CategorizedExpense = {
        category: "software",
        confidence: 0.95,
        reasoning: "Netflix is a software/streaming subscription",
        vendor: "Netflix",
      };
      mockRunOllamaJSON.mockResolvedValueOnce(llmResult);

      const result = await categorizeExpense(makeEmail());

      expect(result.category).toBe("software");
      expect(result.confidence).toBe(0.95);
      expect(result.vendor).toBe("Netflix");
    });

    it("fills vendor from email sender when LLM omits it", async () => {
      const llmResult: CategorizedExpense = {
        category: "software",
        confidence: 0.9,
        reasoning: "Streaming service",
        vendor: "",
      };
      mockRunOllamaJSON.mockResolvedValueOnce(llmResult);

      const result = await categorizeExpense(makeEmail());

      expect(result.vendor).toBe("Netflix");
    });

    it("falls back to 'other' when LLM returns null", async () => {
      mockRunOllamaJSON.mockResolvedValueOnce(null);

      const result = await categorizeExpense(makeEmail());

      expect(result.category).toBe("other");
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toBe("Failed to categorize");
      expect(result.vendor).toBe("Netflix");
    });

    it("falls back to 'other' when LLM returns invalid category", async () => {
      const llmResult = {
        category: "entertainment" as any,
        confidence: 0.8,
        reasoning: "Entertainment subscription",
        vendor: "Netflix",
      };
      mockRunOllamaJSON.mockResolvedValueOnce(llmResult);

      const result = await categorizeExpense(makeEmail());

      expect(result.category).toBe("other");
      expect(result.confidence).toBe(0);
      expect(result.vendor).toBe("Netflix");
    });

    it("preserves amount from LLM result", async () => {
      const llmResult: CategorizedExpense = {
        category: "software",
        confidence: 0.95,
        reasoning: "Streaming subscription",
        amount: 15.99,
        vendor: "Netflix",
      };
      mockRunOllamaJSON.mockResolvedValueOnce(llmResult);

      const result = await categorizeExpense(makeEmail());

      expect(result.amount).toBe(15.99);
    });
  });
});

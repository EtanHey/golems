/**
 * Agent Runner Tests (TDD)
 *
 * Tests the unified multi-model agent runner.
 */

import { describe, it, expect } from "bun:test";
import {
  type AgentBackend,
  type AgentRunResult,
  getAvailableBackends,
  sanitizeFilename,
} from "@golems/shared/lib/agent-runner";

describe("Agent Runner", () => {
  describe("AgentBackend type", () => {
    it("includes all supported backends", () => {
      // All helper backends + local backends
      const backends: AgentBackend[] = ["gemini", "cursor", "codex", "kiro", "haiku", "ollama", "claude"];
      expect(backends).toContain("gemini");
      expect(backends).toContain("cursor");
      expect(backends).toContain("codex");
      expect(backends).toContain("kiro");
      expect(backends).toContain("haiku");
      expect(backends).toContain("ollama");
      expect(backends).toContain("claude");
    });
  });

  describe("AgentRunResult shape", () => {
    it("has expected fields", () => {
      const result: AgentRunResult = {
        output: "test output",
        success: true,
        backend: "gemini",
      };
      expect(result.output).toBe("test output");
      expect(result.success).toBe(true);
      expect(result.backend).toBe("gemini");
    });

    it("can include error field", () => {
      const result: AgentRunResult = {
        output: "",
        success: false,
        backend: "ollama",
        error: "Connection failed",
      };
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("can include outputPath field", () => {
      const result: AgentRunResult = {
        output: "research content",
        success: true,
        backend: "cursor",
        outputPath: "/tmp/research.md",
      };
      expect(result.outputPath).toBe("/tmp/research.md");
    });

    it("works with all helper backends", () => {
      const helperBackends: AgentBackend[] = ["gemini", "kiro", "codex", "cursor", "glm", "haiku"];
      for (const backend of helperBackends) {
        const result: AgentRunResult = { output: "", success: true, backend };
        expect(result.backend).toBe(backend);
      }
    });
  });

  describe("sanitizeFilename", () => {
    it("lowercases and replaces special chars", () => {
      expect(sanitizeFilename("Hello World!")).toBe("hello-world");
    });

    it("collapses multiple dashes", () => {
      expect(sanitizeFilename("a---b")).toBe("a-b");
    });

    it("trims leading/trailing dashes", () => {
      expect(sanitizeFilename("--test--")).toBe("test");
    });

    it("truncates to 100 chars", () => {
      const long = "a".repeat(150);
      expect(sanitizeFilename(long).length).toBeLessThanOrEqual(100);
    });

    it("returns 'unnamed' for empty input", () => {
      expect(sanitizeFilename("")).toBe("unnamed");
    });

    it("returns 'unnamed' for all-special-char input", () => {
      expect(sanitizeFilename("!!!")).toBe("unnamed");
    });
  });

  describe("getAvailableBackends", () => {
    it("always includes ollama and claude", () => {
      const backends = getAvailableBackends();
      expect(Array.isArray(backends)).toBe(true);
      expect(backends).toContain("ollama");
      expect(backends).toContain("claude");
    });

    it("returns only AgentBackend values", () => {
      const validBackends = new Set(["gemini", "cursor", "codex", "kiro", "glm", "haiku", "ollama", "claude"]);
      const backends = getAvailableBackends();
      for (const b of backends) {
        expect(validBackends.has(b)).toBe(true);
      }
    });
  });
});

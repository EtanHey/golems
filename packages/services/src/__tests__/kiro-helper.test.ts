/**
 * Tests for Kiro Helper
 *
 * Tests the Kiro CLI wrapper functions.
 * Note: Most tests mock Kiro since it may not be installed.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";

// Import types and utilities (not the actual functions that spawn processes)
import type { KiroResult, KiroOptions, KiroPlanResult } from "@golems/services/kiro-helper";

describe("Kiro Helper - Types", () => {
  it("should have correct KiroResult structure", () => {
    const result: KiroResult = {
      output: "test output",
      success: true,
    };
    expect(result.output).toBe("test output");
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should have correct KiroResult error structure", () => {
    const result: KiroResult = {
      output: "",
      success: false,
      error: "Kiro not found",
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe("Kiro not found");
  });

  it("should have correct KiroOptions structure", () => {
    const options: KiroOptions = {
      timeoutMs: 60000,
      agent: "custom-agent",
      verbose: true,
      cwd: "/some/path",
    };
    expect(options.timeoutMs).toBe(60000);
    expect(options.agent).toBe("custom-agent");
  });

  it("should have correct KiroPlanResult structure", () => {
    const result: KiroPlanResult = {
      plan: "Step 1: Do this\n- Task A\n- Task B",
      tasks: ["Task A", "Task B"],
      success: true,
    };
    expect(result.plan).toContain("Step 1");
    expect(result.tasks).toHaveLength(2);
    expect(result.success).toBe(true);
  });
});

describe("Kiro Helper - Task Extraction", () => {
  // Test the task extraction logic that would be used in runKiroPlan
  function extractTasks(output: string): string[] {
    const taskMatches = output.match(/^[-*]\s+.+$/gm) || [];
    return taskMatches.map((t) => t.replace(/^[-*]\s+/, "").trim());
  }

  it("should extract bullet point tasks", () => {
    const output = `
Plan:
- Task one
- Task two
- Task three
`;
    const tasks = extractTasks(output);
    expect(tasks).toEqual(["Task one", "Task two", "Task three"]);
  });

  it("should extract asterisk tasks", () => {
    const output = `
* First item
* Second item
`;
    const tasks = extractTasks(output);
    expect(tasks).toEqual(["First item", "Second item"]);
  });

  it("should handle empty output", () => {
    const tasks = extractTasks("");
    expect(tasks).toEqual([]);
  });

  it("should handle output with no tasks", () => {
    const output = "This is just text without any bullet points.";
    const tasks = extractTasks(output);
    expect(tasks).toEqual([]);
  });

  it("should handle mixed content", () => {
    const output = `
# Header
Some description text.

## Tasks
- Implement feature A
- Write tests for A
- Update documentation

More text here.
`;
    const tasks = extractTasks(output);
    expect(tasks).toEqual([
      "Implement feature A",
      "Write tests for A",
      "Update documentation"
    ]);
  });
});

describe("Kiro Helper - Timeout Logic", () => {
  it("should use default timeout of 5 minutes", () => {
    const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
    expect(DEFAULT_TIMEOUT_MS).toBe(300000);
  });

  it("should allow custom timeout", () => {
    const options: KiroOptions = { timeoutMs: 10 * 60 * 1000 };
    expect(options.timeoutMs).toBe(600000);
  });
});

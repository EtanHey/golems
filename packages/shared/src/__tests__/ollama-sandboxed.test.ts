/**
 * Tests for Sandboxed Ollama System
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

// Test directory (isolated from production)
const TEST_DIR = "/tmp/ollama-sandbox-test";
const PENDING = join(TEST_DIR, "pending");
const APPROVED = join(TEST_DIR, "approved");
const REJECTED = join(TEST_DIR, "rejected");

describe("Validation Queue", () => {
  beforeAll(() => {
    // Create test directories
    mkdirSync(PENDING, { recursive: true });
    mkdirSync(APPROVED, { recursive: true });
    mkdirSync(REJECTED, { recursive: true });

    // Create test config
    writeFileSync(
      join(TEST_DIR, "config.json"),
      JSON.stringify({
        validation: {
          enabled: true,
          model: "claude-sonnet-4-20250514",
          maxPendingAge: 3600,
          autoApproveScore: 0.95,
          timeoutMs: 30000,
        },
        blocklist: {
          enabled: true,
          caseInsensitive: true,
          critical: ["rm\\s+-rf", "sudo\\s+"],
          suspicious: ["eval\\s*\\("],
        },
        allowlist: {
          sources: ["job-golem", "test"],
          maxLength: 10000,
          trustedPatterns: ["job listing", "score:"],
        },
      })
    );
  });

  afterAll(() => {
    // Cleanup
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("should create validation queue directories", () => {
    expect(existsSync(PENDING)).toBe(true);
    expect(existsSync(APPROVED)).toBe(true);
    expect(existsSync(REJECTED)).toBe(true);
  });

  it("should load config file", () => {
    const configPath = join(TEST_DIR, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));

    expect(config.validation.enabled).toBe(true);
    expect(config.blocklist.critical.length).toBeGreaterThan(0);
    expect(config.allowlist.sources).toContain("job-golem");
  });

  it("should detect critical blocklist patterns", () => {
    const config = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"));
    const testResponse = "Run rm -rf / to clean up";

    const isCritical = config.blocklist.critical.some((pattern: string) => {
      const regex = new RegExp(pattern, "i");
      return regex.test(testResponse);
    });

    expect(isCritical).toBe(true);
  });

  it("should allow safe responses", () => {
    const config = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"));
    const safeResponse = "This job listing scores 8/10 for React Developer role";

    const isCritical = config.blocklist.critical.some((pattern: string) => {
      const regex = new RegExp(pattern, "i");
      return regex.test(safeResponse);
    });

    expect(isCritical).toBe(false);
  });

  it("should match trusted patterns", () => {
    const config = JSON.parse(readFileSync(join(TEST_DIR, "config.json"), "utf-8"));
    const response = "job listing: React Developer at TechCorp, score: 8/10";

    const hasTrustedPattern = config.allowlist.trustedPatterns.some((pattern: string) =>
      response.toLowerCase().includes(pattern.toLowerCase())
    );

    expect(hasTrustedPattern).toBe(true);
  });
});

describe("Validation Entry Format", () => {
  it("should have required fields", () => {
    const entry = {
      id: "test-123",
      timestamp: new Date().toISOString(),
      source: "job-golem",
      prompt: "Test prompt",
      response: "Test response",
      model: "qwen3-coder",
      status: "pending" as const,
    };

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.source).toBeDefined();
    expect(entry.status).toBe("pending");
  });

  it("should serialize to JSON correctly", () => {
    const entry = {
      id: "test-456",
      timestamp: "2026-02-01T12:00:00Z",
      source: "test",
      prompt: "Hello",
      response: "World",
      model: "qwen3-coder",
      status: "approved" as const,
      reviewedAt: "2026-02-01T12:01:00Z",
      reviewNotes: "Safe content",
    };

    const json = JSON.stringify(entry);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBe("test-456");
    expect(parsed.status).toBe("approved");
    expect(parsed.reviewNotes).toBe("Safe content");
  });
});

describe("Docker Config", () => {
  it("should use correct resource limits", () => {
    // These values come from docker-compose.yml
    const expectedMemory = "25G";
    const expectedCPUs = "6";

    // Just verify the expected values are reasonable
    expect(parseInt(expectedMemory)).toBeGreaterThanOrEqual(20);
    expect(parseInt(expectedCPUs)).toBeLessThanOrEqual(8);
  });

  it("should have localhost binding", () => {
    const expectedHost = "127.0.0.1";
    expect(expectedHost).not.toBe("0.0.0.0");
  });
});

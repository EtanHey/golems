import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  checkStaleLogs,
  checkLargeFiles,
  checkEnvVars,
  checkConfigFile,
  checkServiceRunning,
  runMaintenanceChecks,
  formatReport,
  type MaintenanceReport,
  type MaintenanceCheck,
} from "@golems/shared/lib/maintainer-golem";

const TEST_DIR = join(tmpdir(), `golems-maintainer-test-${Date.now()}`);

describe("maintainer-golem", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ─── Individual Checks ──────────────────────────────────────

  test("checkStaleLogs returns ok for missing directory", () => {
    const result = checkStaleLogs(join(TEST_DIR, "nonexistent"));
    expect(result.severity).toBe("ok");
    expect(result.category).toBe("files");
  });

  test("checkStaleLogs returns ok for empty directory", () => {
    const logsDir = join(TEST_DIR, "logs");
    mkdirSync(logsDir);
    const result = checkStaleLogs(logsDir);
    expect(result.severity).toBe("ok");
  });

  test("checkStaleLogs detects files older than threshold", () => {
    const logsDir = join(TEST_DIR, "logs");
    mkdirSync(logsDir);

    // Create files — they'll be ~0 days old
    writeFileSync(join(logsDir, "recent.log"), "content");
    // With maxAge=-1, even freshly created files are "stale"
    const result = checkStaleLogs(logsDir, -1);
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("stale log files");
  });

  test("checkLargeFiles returns ok for missing directory", () => {
    const result = checkLargeFiles(join(TEST_DIR, "nonexistent"));
    expect(result.severity).toBe("ok");
    expect(result.category).toBe("files");
  });

  test("checkLargeFiles returns ok for small files", () => {
    writeFileSync(join(TEST_DIR, "small.txt"), "hello");
    const result = checkLargeFiles(TEST_DIR);
    expect(result.severity).toBe("ok");
    expect(result.message).toContain("No files");
  });

  test("checkEnvVars detects missing vars", () => {
    // HOME should exist, NONEXISTENT_VAR should not
    const result = checkEnvVars(["HOME", "NONEXISTENT_GOLEMS_VAR_123"]);
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("1 env vars missing");
    expect(result.detail).toContain("NONEXISTENT_GOLEMS_VAR_123");
  });

  test("checkEnvVars returns ok when all present", () => {
    const result = checkEnvVars(["HOME", "PATH"]);
    expect(result.severity).toBe("ok");
  });

  test("checkEnvVars returns error for many missing", () => {
    const result = checkEnvVars(["FAKE_A", "FAKE_B", "FAKE_C"]);
    expect(result.severity).toBe("error");
    expect(result.message).toContain("3 env vars missing");
  });

  test("checkConfigFile returns warn for missing file", () => {
    const result = checkConfigFile(join(TEST_DIR, "nonexistent.yaml"));
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("golems config init");
  });

  test("checkConfigFile returns error for empty file", () => {
    const path = join(TEST_DIR, "config.yaml");
    writeFileSync(path, "");
    const result = checkConfigFile(path);
    expect(result.severity).toBe("error");
    expect(result.message).toContain("empty");
  });

  test("checkConfigFile returns ok for valid file", () => {
    const path = join(TEST_DIR, "config.yaml");
    writeFileSync(path, "reposPath: /home/user/Gits\n");
    const result = checkConfigFile(path);
    expect(result.severity).toBe("ok");
  });

  test("checkServiceRunning handles non-running service", () => {
    const result = checkServiceRunning("nonexistent-process-name-xyz", "Test Service");
    expect(result.severity).toBe("warn");
    expect(result.name).toContain("Test Service");
  });

  // ─── Report ─────────────────────────────────────────────────

  test("runMaintenanceChecks produces a report", () => {
    const report = runMaintenanceChecks({
      reposPath: TEST_DIR,
      stateDir: TEST_DIR,
      configPath: join(TEST_DIR, "config.yaml"),
    });
    expect(report.timestamp).toBeTruthy();
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.summary.total).toBe(report.checks.length);
    expect(report.summary.ok + report.summary.warn + report.summary.error).toBe(
      report.summary.total
    );
  });

  test("formatReport produces readable output", () => {
    const report: MaintenanceReport = {
      timestamp: new Date().toISOString(),
      checks: [
        { name: "Test Check", category: "config", severity: "ok", message: "All good" },
        { name: "Warning Check", category: "files", severity: "warn", message: "Needs attention", detail: "file.log" },
        { name: "Error Check", category: "deps", severity: "error", message: "Critical issue" },
      ],
      summary: { total: 3, ok: 1, warn: 1, error: 1 },
    };

    const formatted = formatReport(report);
    expect(formatted).toContain("✓");
    expect(formatted).toContain("⚠");
    expect(formatted).toContain("✗");
    expect(formatted).toContain("Summary: 3 checks");
    expect(formatted).toContain("1 ok");
    expect(formatted).toContain("1 warnings");
    expect(formatted).toContain("1 errors");
  });

  test("formatReport groups by category", () => {
    const report: MaintenanceReport = {
      timestamp: new Date().toISOString(),
      checks: [
        { name: "Dep Check", category: "deps", severity: "ok", message: "ok" },
        { name: "File Check", category: "files", severity: "ok", message: "ok" },
        { name: "Config Check", category: "config", severity: "ok", message: "ok" },
      ],
      summary: { total: 3, ok: 3, warn: 0, error: 0 },
    };

    const formatted = formatReport(report);
    expect(formatted).toContain("Dependencies");
    expect(formatted).toContain("File System");
    expect(formatted).toContain("Configuration");
  });
});

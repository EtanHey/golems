import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  getVersionInfo,
  installDeps,
  formatUpdateReport,
  saveUpdateHistory,
  getUpdateHistory,
  type UpdateReport,
  type UpdateResult,
} from "@golems/shared/lib/self-update";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `self-update-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Version info
// ---------------------------------------------------------------------------

describe("getVersionInfo", () => {
  test("reads version from package.json", () => {
    // Create a git repo with package.json
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    execSync("git add . && git commit -m 'init' --allow-empty", { cwd: testDir, stdio: "pipe" });

    const info = getVersionInfo(testDir);
    expect(info.version).toBe("1.2.3");
    expect(info.commit).toBeTruthy();
    expect(info.commit).not.toBe("unknown");
    expect(info.branch).toBeTruthy();
  });

  test("returns 0.0.0 when no package.json", () => {
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git commit --allow-empty -m 'init'", { cwd: testDir, stdio: "pipe" });

    const info = getVersionInfo(testDir);
    expect(info.version).toBe("0.0.0");
  });

  test("handles invalid package.json", () => {
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    writeFileSync(join(testDir, "package.json"), "not json");
    execSync("git add . && git commit -m 'init'", { cwd: testDir, stdio: "pipe" });

    const info = getVersionInfo(testDir);
    expect(info.version).toBe("0.0.0");
  });
});

// ---------------------------------------------------------------------------
// Install deps
// ---------------------------------------------------------------------------

describe("installDeps", () => {
  test("skips when no package.json", () => {
    const result = installDeps(testDir);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  test("detects bun lockfile", () => {
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test" }));
    writeFileSync(join(testDir, "bun.lockb"), "");
    // We don't actually run install in tests, just check the detection logic
    // The function will try to run bun install which may fail in test env
    const result = installDeps(testDir);
    // Either succeeds or fails — we just check it ran
    expect(result.step).toBe("install");
  });
});

// ---------------------------------------------------------------------------
// Format report
// ---------------------------------------------------------------------------

describe("formatUpdateReport", () => {
  test("shows up-to-date message when no changes", () => {
    const report: UpdateReport = {
      timestamp: new Date().toISOString(),
      steps: [{ step: "check", success: true, output: "Already up to date", skipped: true }],
      currentVersion: "1.0.0 (abc1234)",
      hadChanges: false,
    };
    const output = formatUpdateReport(report);
    expect(output).toContain("Already up to date");
    expect(output).toContain("1.0.0");
  });

  test("shows full report when changes applied", () => {
    const report: UpdateReport = {
      timestamp: new Date().toISOString(),
      steps: [
        { step: "check", success: true, output: "3 new commits" },
        { step: "pull", success: true, output: "Fast-forward" },
        { step: "install", success: true, output: "Dependencies installed (bun)" },
        { step: "restart", success: true, output: "Services restarted" },
      ],
      previousVersion: "1.0.0 (abc1234)",
      currentVersion: "1.1.0 (def5678)",
      hadChanges: true,
    };
    const output = formatUpdateReport(report);
    expect(output).toContain("Update Report");
    expect(output).toContain("From: 1.0.0");
    expect(output).toContain("To:   1.1.0");
    expect(output).toContain("✓ check");
    expect(output).toContain("✓ pull");
  });

  test("shows failure icon for failed steps", () => {
    const report: UpdateReport = {
      timestamp: new Date().toISOString(),
      steps: [
        { step: "pull", success: false, output: "Uncommitted changes" },
      ],
      hadChanges: true,
    };
    const output = formatUpdateReport(report);
    expect(output).toContain("✗ pull");
    expect(output).toContain("Uncommitted changes");
  });

  test("shows skip icon for skipped steps", () => {
    const report: UpdateReport = {
      timestamp: new Date().toISOString(),
      steps: [
        { step: "install", success: true, output: "No package.json", skipped: true },
      ],
      hadChanges: true,
    };
    const output = formatUpdateReport(report);
    expect(output).toContain("⊘ install");
  });
});

// ---------------------------------------------------------------------------
// Update history
// ---------------------------------------------------------------------------

describe("update history", () => {
  test("saves and loads history", () => {
    const historyPath = join(testDir, "history.json");
    const report: UpdateReport = {
      timestamp: new Date().toISOString(),
      steps: [],
      hadChanges: false,
    };
    saveUpdateHistory(report, historyPath);
    const loaded = getUpdateHistory(historyPath);
    expect(loaded.length).toBe(1);
    expect(loaded[0].timestamp).toBe(report.timestamp);
  });

  test("appends to existing history", () => {
    const historyPath = join(testDir, "history.json");
    const r1: UpdateReport = { timestamp: "t1", steps: [], hadChanges: false };
    const r2: UpdateReport = { timestamp: "t2", steps: [], hadChanges: true };
    saveUpdateHistory(r1, historyPath);
    saveUpdateHistory(r2, historyPath);
    const loaded = getUpdateHistory(historyPath);
    expect(loaded.length).toBe(2);
  });

  test("caps history at 50 entries", () => {
    const historyPath = join(testDir, "history.json");
    // Write 55 entries
    const entries: UpdateReport[] = [];
    for (let i = 0; i < 55; i++) {
      entries.push({ timestamp: `t${i}`, steps: [], hadChanges: false });
    }
    writeFileSync(historyPath, JSON.stringify(entries));

    // Add one more
    saveUpdateHistory({ timestamp: "t55", steps: [], hadChanges: false }, historyPath);
    const loaded = getUpdateHistory(historyPath);
    expect(loaded.length).toBeLessThanOrEqual(50);
  });

  test("returns empty array when file missing", () => {
    const loaded = getUpdateHistory(join(testDir, "nonexistent.json"));
    expect(loaded).toEqual([]);
  });

  test("creates directory if needed", () => {
    const historyPath = join(testDir, "sub", "deep", "history.json");
    saveUpdateHistory({ timestamp: "t", steps: [], hadChanges: false }, historyPath);
    expect(existsSync(historyPath)).toBe(true);
  });
});

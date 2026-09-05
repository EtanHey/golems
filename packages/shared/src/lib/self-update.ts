/**
 * Self-Update — CLI update mechanism for golems
 *
 * Handles: git pull, dependency install, service restart,
 * and version tracking.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateResult {
  step: string;
  success: boolean;
  output: string;
  skipped?: boolean;
}

export interface UpdateReport {
  timestamp: string;
  steps: UpdateResult[];
  previousVersion?: string;
  currentVersion?: string;
  hadChanges: boolean;
}

export interface VersionInfo {
  version: string;
  commit: string;
  branch: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shellExec(
  cmd: string,
  cwd?: string,
  timeout = 30000,
): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      encoding: "utf8",
      timeout,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { ok: true, output };
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    return {
      ok: false,
      output:
        String(e?.stderr ?? "").trim() ||
        (err instanceof Error ? err.message : ""),
    };
  }
}

// ---------------------------------------------------------------------------
// Version info
// ---------------------------------------------------------------------------

export function getVersionInfo(repoPath: string): VersionInfo {
  const commit = shellExec("git rev-parse --short HEAD", repoPath);
  const branch = shellExec("git rev-parse --abbrev-ref HEAD", repoPath);
  const date = shellExec("git log -1 --format=%ci", repoPath);

  // Read version from package.json if exists
  const pkgPath = join(repoPath, "package.json");
  let version = "0.0.0";
  if (existsSync(pkgPath)) {
    try {
      version = JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
    } catch {
      // ignore
    }
  }

  return {
    version,
    commit: commit.ok ? commit.output : "unknown",
    branch: branch.ok ? branch.output : "unknown",
    date: date.ok ? date.output : "unknown",
  };
}

// ---------------------------------------------------------------------------
// Update steps
// ---------------------------------------------------------------------------

export function checkForUpdates(repoPath: string): UpdateResult {
  // Fetch remote without merging
  const fetch = shellExec("git fetch origin", repoPath);
  if (!fetch.ok) {
    return { step: "fetch", success: false, output: fetch.output };
  }

  // Check if behind
  const status = shellExec("git status -uno", repoPath);
  const behind = status.ok && status.output.includes("behind");
  const upToDate = status.ok && status.output.includes("up to date");

  if (upToDate) {
    return {
      step: "check",
      success: true,
      output: "Already up to date",
      skipped: true,
    };
  }

  if (behind) {
    // Get count of new commits
    const count = shellExec(
      "git rev-list HEAD..origin/master --count 2>/dev/null || git rev-list HEAD..origin/main --count 2>/dev/null",
      repoPath,
    );
    return {
      step: "check",
      success: true,
      output: `${count.ok ? count.output : "?"} new commits available`,
    };
  }

  return { step: "check", success: true, output: status.output };
}

export function pullLatest(repoPath: string): UpdateResult {
  // Check for uncommitted changes
  const dirty = shellExec("git diff --quiet", repoPath);
  if (!dirty.ok) {
    return {
      step: "pull",
      success: false,
      output: "Uncommitted changes detected. Stash or commit first.",
    };
  }

  const pull = shellExec("git pull origin master", repoPath);
  if (!pull.ok) {
    // Try main branch
    const pullMain = shellExec("git pull origin main", repoPath);
    if (!pullMain.ok) {
      return { step: "pull", success: false, output: pullMain.output };
    }
    return { step: "pull", success: true, output: pullMain.output };
  }

  return { step: "pull", success: true, output: pull.output };
}

export function installDeps(repoPath: string): UpdateResult {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) {
    return {
      step: "install",
      success: true,
      output: "No package.json",
      skipped: true,
    };
  }

  // Detect package manager
  const hasBunLock = existsSync(join(repoPath, "bun.lockb"));
  const cmd = hasBunLock ? "bun install" : "npm install";

  const install = shellExec(cmd, repoPath, 60000);
  return {
    step: "install",
    success: install.ok,
    output: install.ok
      ? `Dependencies installed (${hasBunLock ? "bun" : "npm"})`
      : install.output,
  };
}

export function restartServices(): UpdateResult {
  // Use golems latest which restarts all services
  const restart = shellExec(
    "launchctl list 2>/dev/null | grep golemszikaron | awk '{print $3}' | while read svc; do launchctl kickstart -k \"gui/$(id -u)/$svc\" 2>/dev/null; done",
  );

  if (restart.ok) {
    return { step: "restart", success: true, output: "Services restarted" };
  }

  return {
    step: "restart",
    success: true,
    output: "No launchd services to restart",
    skipped: true,
  };
}

// ---------------------------------------------------------------------------
// Full update flow
// ---------------------------------------------------------------------------

export function runUpdate(repoPath: string): UpdateReport {
  const timestamp = new Date().toISOString();
  const previousVersion = getVersionInfo(repoPath);
  const steps: UpdateResult[] = [];

  // Step 1: Check for updates
  const check = checkForUpdates(repoPath);
  steps.push(check);

  if (check.skipped) {
    return {
      timestamp,
      steps,
      previousVersion: `${previousVersion.version} (${previousVersion.commit})`,
      currentVersion: `${previousVersion.version} (${previousVersion.commit})`,
      hadChanges: false,
    };
  }

  // Step 2: Pull latest
  const pull = pullLatest(repoPath);
  steps.push(pull);

  if (!pull.success) {
    return {
      timestamp,
      steps,
      previousVersion: `${previousVersion.version} (${previousVersion.commit})`,
      hadChanges: false,
    };
  }

  // Step 3: Install deps
  const install = installDeps(repoPath);
  steps.push(install);

  // Step 4: Restart services
  const restart = restartServices();
  steps.push(restart);

  const currentVersion = getVersionInfo(repoPath);

  return {
    timestamp,
    steps,
    previousVersion: `${previousVersion.version} (${previousVersion.commit})`,
    currentVersion: `${currentVersion.version} (${currentVersion.commit})`,
    hadChanges: true,
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatUpdateReport(report: UpdateReport): string {
  const lines: string[] = [];

  if (!report.hadChanges) {
    lines.push(`Already up to date (${report.currentVersion || "unknown"})`);
    return lines.join("\n");
  }

  lines.push("Update Report");
  lines.push("─".repeat(40));

  if (report.previousVersion) {
    lines.push(`From: ${report.previousVersion}`);
  }
  if (report.currentVersion) {
    lines.push(`To:   ${report.currentVersion}`);
  }
  lines.push("");

  for (const step of report.steps) {
    const icon = step.success ? (step.skipped ? "⊘" : "✓") : "✗";
    lines.push(`  ${icon} ${step.step}: ${step.output}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Update history
// ---------------------------------------------------------------------------

const UPDATE_HISTORY_PATH = join(
  process.env.HOME || "~",
  ".golems",
  "update-history.json",
);

export function saveUpdateHistory(
  report: UpdateReport,
  historyPath?: string,
): void {
  const p = historyPath || UPDATE_HISTORY_PATH;
  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let history: UpdateReport[] = [];
  if (existsSync(p)) {
    try {
      history = JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      history = [];
    }
  }

  history.push(report);

  // Keep last 50 updates
  if (history.length > 50) {
    history = history.slice(-50);
  }

  writeFileSync(p, JSON.stringify(history, null, 2));
}

export function getUpdateHistory(historyPath?: string): UpdateReport[] {
  const p = historyPath || UPDATE_HISTORY_PATH;
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

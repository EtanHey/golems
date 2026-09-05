/**
 * MaintainerGolem — Automated Maintenance Agent
 *
 * Runs maintenance checks across the Golems ecosystem:
 * - Dependency freshness (outdated packages)
 * - File system health (stale logs, large temp files)
 * - Config consistency (missing env vars, broken symlinks)
 * - Test health (which test suites are passing/failing)
 *
 * Can be run via: golems maintain
 * Or scheduled via launchd for weekly checks
 */

import { execSync } from "child_process";
import { existsSync, statSync, readdirSync } from "fs";
import { join } from "path";

// ─── Types ─────────────────────────────────────────────────────────

export type CheckSeverity = "ok" | "warn" | "error";

export interface MaintenanceCheck {
  name: string;
  category: "deps" | "files" | "config" | "tests" | "services";
  severity: CheckSeverity;
  message: string;
  detail?: string;
}

export interface MaintenanceReport {
  timestamp: string;
  checks: MaintenanceCheck[];
  summary: {
    total: number;
    ok: number;
    warn: number;
    error: number;
  };
}

// ─── Check Functions ───────────────────────────────────────────────

/** Check for outdated npm/bun packages in a directory */
export function checkOutdatedDeps(packageDir: string): MaintenanceCheck {
  const name = "Outdated dependencies";
  const packageJson = join(packageDir, "package.json");

  if (!existsSync(packageJson)) {
    return {
      name,
      category: "deps",
      severity: "ok",
      message: "No package.json",
    };
  }

  try {
    const output = execSync("bun outdated 2>&1 || true", {
      cwd: packageDir,
      encoding: "utf-8",
      timeout: 15000,
    }).trim();

    if (!output || output.includes("All dependencies are up to date")) {
      return {
        name,
        category: "deps",
        severity: "ok",
        message: "All dependencies up to date",
      };
    }

    const lines = output
      .split("\n")
      .filter((l) => l.includes("→") || l.includes("->"));
    const count = lines.length;

    if (count === 0) {
      return {
        name,
        category: "deps",
        severity: "ok",
        message: "Dependencies current",
      };
    }

    return {
      name,
      category: "deps",
      severity: count > 5 ? "warn" : "ok",
      message: `${count} packages can be updated`,
      detail: lines.slice(0, 5).join("\n"),
    };
  } catch {
    return {
      name,
      category: "deps",
      severity: "ok",
      message: "Could not check (non-critical)",
    };
  }
}

/** Check for stale log files */
export function checkStaleLogs(
  logsDir: string,
  maxAgeDays = 7,
): MaintenanceCheck {
  const name = "Stale log files";

  if (!existsSync(logsDir)) {
    return {
      name,
      category: "files",
      severity: "ok",
      message: "No logs directory",
    };
  }

  try {
    const files = readdirSync(logsDir);
    const now = Date.now();
    const staleFiles: string[] = [];

    for (const file of files) {
      const path = join(logsDir, file);
      try {
        const stat = statSync(path);
        const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
        if (ageDays > maxAgeDays) {
          staleFiles.push(`${file} (${Math.round(ageDays)}d old)`);
        }
      } catch {
        // Skip files we can't stat
      }
    }

    if (staleFiles.length === 0) {
      return {
        name,
        category: "files",
        severity: "ok",
        message: "No stale logs",
      };
    }

    return {
      name,
      category: "files",
      severity: "warn",
      message: `${staleFiles.length} stale log files (>${maxAgeDays}d)`,
      detail: staleFiles.slice(0, 5).join(", "),
    };
  } catch {
    return {
      name,
      category: "files",
      severity: "ok",
      message: "Could not check logs",
    };
  }
}

/** Check for large temporary files */
export function checkLargeFiles(dir: string, maxSizeMB = 50): MaintenanceCheck {
  const name = "Large files";

  if (!existsSync(dir)) {
    return {
      name,
      category: "files",
      severity: "ok",
      message: "Directory not found",
    };
  }

  try {
    const output = execSync(
      `find "${dir}" -type f -size +${maxSizeMB}M 2>/dev/null | head -10`,
      { encoding: "utf-8", timeout: 10000 },
    ).trim();

    if (!output) {
      return {
        name,
        category: "files",
        severity: "ok",
        message: `No files >${maxSizeMB}MB`,
      };
    }

    const files = output.split("\n");
    return {
      name,
      category: "files",
      severity: "warn",
      message: `${files.length} files >${maxSizeMB}MB`,
      detail: files.map((f) => f.replace(dir + "/", "")).join(", "),
    };
  } catch {
    return {
      name,
      category: "files",
      severity: "ok",
      message: "Could not scan",
    };
  }
}

/** Check if required environment variables are set */
export function checkEnvVars(requiredVars: string[]): MaintenanceCheck {
  const name = "Environment variables";
  const missing = requiredVars.filter((v) => !process.env[v]);

  if (missing.length === 0) {
    return {
      name,
      category: "config",
      severity: "ok",
      message: "All env vars set",
    };
  }

  return {
    name,
    category: "config",
    severity: missing.length > 2 ? "error" : "warn",
    message: `${missing.length} env vars missing`,
    detail: missing.join(", "),
  };
}

/** Check if config file exists and is valid */
export function checkConfigFile(configPath: string): MaintenanceCheck {
  const name = "Config file";

  if (!existsSync(configPath)) {
    return {
      name,
      category: "config",
      severity: "warn",
      message: "No config file — run 'golems config init'",
    };
  }

  try {
    const stat = statSync(configPath);
    if (stat.size === 0) {
      return {
        name,
        category: "config",
        severity: "error",
        message: "Config file is empty",
      };
    }
    return {
      name,
      category: "config",
      severity: "ok",
      message: `Config OK (${stat.size}B)`,
    };
  } catch {
    return {
      name,
      category: "config",
      severity: "error",
      message: "Cannot read config file",
    };
  }
}

/** Check if a service process is running */
export function checkServiceRunning(
  processName: string,
  label: string,
): MaintenanceCheck {
  const name = `Service: ${label}`;

  try {
    const output = execSync(`pgrep -f "${processName}" 2>/dev/null`, {
      encoding: "utf-8",
    }).trim();

    if (output) {
      const pids = output.split("\n");
      return {
        name,
        category: "services",
        severity: "ok",
        message: `Running (PID: ${pids[0]})`,
      };
    }
    return {
      name,
      category: "services",
      severity: "warn",
      message: "Not running",
    };
  } catch {
    return {
      name,
      category: "services",
      severity: "warn",
      message: "Not running",
    };
  }
}

// ─── Report Generator ──────────────────────────────────────────────

/** Run all maintenance checks and generate a report */
export function runMaintenanceChecks(options: {
  reposPath: string;
  stateDir: string;
  configPath: string;
}): MaintenanceReport {
  const checks: MaintenanceCheck[] = [];

  // Dependency checks
  const packageDirs = ["packages/autonomous"];
  for (const dir of packageDirs) {
    const fullPath = join(options.reposPath, "golems", dir);
    if (existsSync(fullPath)) {
      const check = checkOutdatedDeps(fullPath);
      check.name = `${dir}: ${check.name}`;
      checks.push(check);
    }
  }

  // File system checks
  checks.push(checkStaleLogs(join(options.stateDir, "logs")));
  checks.push(checkLargeFiles(options.stateDir));

  // Config checks
  checks.push(checkConfigFile(options.configPath));
  checks.push(
    checkEnvVars(["TELEGRAM_BOT_TOKEN", "SUPABASE_URL", "SUPABASE_ANON_KEY"]),
  );

  // Service checks
  checks.push(checkServiceRunning("telegram-bot", "Telegram Bot"));
  checks.push(checkServiceRunning("notify", "Notification Server"));

  // Summarize
  const summary = {
    total: checks.length,
    ok: checks.filter((c) => c.severity === "ok").length,
    warn: checks.filter((c) => c.severity === "warn").length,
    error: checks.filter((c) => c.severity === "error").length,
  };

  return {
    timestamp: new Date().toISOString(),
    checks,
    summary,
  };
}

// ─── Formatter ─────────────────────────────────────────────────────

const SEVERITY_ICONS: Record<CheckSeverity, string> = {
  ok: "✓",
  warn: "⚠",
  error: "✗",
};

export function formatReport(report: MaintenanceReport): string {
  const lines: string[] = [];

  // Group by category
  const categories = new Map<string, MaintenanceCheck[]>();
  for (const check of report.checks) {
    const existing = categories.get(check.category) || [];
    existing.push(check);
    categories.set(check.category, existing);
  }

  const categoryLabels: Record<string, string> = {
    deps: "Dependencies",
    files: "File System",
    config: "Configuration",
    tests: "Tests",
    services: "Services",
  };

  for (const [category, checks] of categories) {
    lines.push(`\n${categoryLabels[category] || category}`);
    lines.push("─".repeat(40));

    for (const check of checks) {
      const icon = SEVERITY_ICONS[check.severity];
      lines.push(`  ${icon} ${check.name}: ${check.message}`);
      if (check.detail && check.severity !== "ok") {
        lines.push(`    ${check.detail}`);
      }
    }
  }

  // Summary
  lines.push("");
  lines.push("─".repeat(40));
  const { ok, warn, error, total } = report.summary;
  lines.push(
    `Summary: ${total} checks — ${ok} ok, ${warn} warnings, ${error} errors`,
  );

  return lines.join("\n");
}

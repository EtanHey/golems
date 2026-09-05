/**
 * Quality Sweep — Automated codebase quality checks
 *
 * Runs a suite of quality checks: test counts, file organization,
 * export hygiene, documentation coverage, and health metrics.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckSeverity = "pass" | "warn" | "fail";

export interface CheckResult {
  name: string;
  severity: CheckSeverity;
  message: string;
  details?: string;
}

export interface SweepReport {
  timestamp: string;
  duration: number;
  checks: CheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    total: number;
  };
}

// ---------------------------------------------------------------------------
// File utilities
// ---------------------------------------------------------------------------

function findFiles(dir: string, ext: string, maxDepth: number = 5): string[] {
  const results: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth || !existsSync(current)) return;
    try {
      const entries = readdirSync(current);
      for (const entry of entries) {
        if (
          entry.startsWith(".") ||
          entry === "node_modules" ||
          entry === "dist"
        )
          continue;
        const fullPath = join(current, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            walk(fullPath, depth + 1);
          } else if (extname(entry) === ext) {
            results.push(fullPath);
          }
        } catch {
          // skip inaccessible files
        }
      }
    } catch {
      // skip inaccessible dirs
    }
  }

  walk(dir, 0);
  return results;
}

function countLines(filepath: string): number {
  try {
    const content = readFileSync(filepath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

export function checkTestFiles(srcDir: string): CheckResult {
  const testDir = join(srcDir, "__tests__");
  if (!existsSync(testDir)) {
    return {
      name: "Test directory",
      severity: "fail",
      message: "No __tests__ directory found",
    };
  }

  const testFiles = findFiles(testDir, ".ts");
  if (testFiles.length === 0) {
    return {
      name: "Test files",
      severity: "fail",
      message: "No test files found",
    };
  }

  const totalLines = testFiles.reduce((sum, f) => sum + countLines(f), 0);

  if (testFiles.length < 5) {
    return {
      name: "Test coverage",
      severity: "warn",
      message: `Only ${testFiles.length} test files (${totalLines} lines)`,
      details: testFiles.map((f) => f.split("/").pop()).join(", "),
    };
  }

  return {
    name: "Test coverage",
    severity: "pass",
    message: `${testFiles.length} test files, ${totalLines} lines`,
  };
}

export function checkSourceFiles(srcDir: string): CheckResult {
  const libDir = join(srcDir, "lib");
  if (!existsSync(libDir)) {
    return {
      name: "Lib directory",
      severity: "warn",
      message: "No lib/ directory found",
    };
  }

  const libFiles = findFiles(libDir, ".ts");
  const totalLines = libFiles.reduce((sum, f) => sum + countLines(f), 0);

  return {
    name: "Source modules",
    severity: "pass",
    message: `${libFiles.length} lib modules, ${totalLines} lines`,
    details: libFiles.map((f) => f.split("/").pop()).join(", "),
  };
}

export function checkPackageJson(pkgDir: string): CheckResult {
  const pkgPath = join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) {
    return {
      name: "package.json",
      severity: "fail",
      message: "No package.json found",
    };
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const issues: string[] = [];

    if (!pkg.name) issues.push("missing name");
    if (!pkg.version) issues.push("missing version");
    if (!pkg.description) issues.push("missing description");
    if (!pkg.scripts) issues.push("missing scripts");

    if (issues.length > 0) {
      return {
        name: "package.json",
        severity: "warn",
        message: `Issues: ${issues.join(", ")}`,
      };
    }

    return {
      name: "package.json",
      severity: "pass",
      message: `${pkg.name}@${pkg.version}`,
    };
  } catch {
    return { name: "package.json", severity: "fail", message: "Invalid JSON" };
  }
}

export function checkClaudeMd(pkgDir: string): CheckResult {
  const claudeMdPath = join(pkgDir, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) {
    return {
      name: "CLAUDE.md",
      severity: "warn",
      message: "No CLAUDE.md found",
    };
  }

  const lines = countLines(claudeMdPath);
  if (lines < 20) {
    return {
      name: "CLAUDE.md",
      severity: "warn",
      message: `Only ${lines} lines — might be sparse`,
    };
  }

  return { name: "CLAUDE.md", severity: "pass", message: `${lines} lines` };
}

export function checkGitStatus(repoDir: string): CheckResult {
  try {
    // Check for bare repo first (git status doesn't work on bare repos)
    const isBare = execSync("git rev-parse --is-bare-repository", {
      cwd: repoDir,
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (isBare === "true") {
      return {
        name: "Git status",
        severity: "pass",
        message: "Bare repository",
      };
    }

    const output = execSync("git status --porcelain", {
      cwd: repoDir,
      stdio: "pipe",
    }).toString();
    const lines = output.trim().split("\n").filter(Boolean);

    if (lines.length === 0) {
      return {
        name: "Git status",
        severity: "pass",
        message: "Clean working tree",
      };
    }

    const untracked = lines.filter((l) => l.startsWith("??")).length;
    const modified = lines.filter(
      (l) => l.startsWith(" M") || l.startsWith("M "),
    ).length;

    return {
      name: "Git status",
      severity: "warn",
      message: `${lines.length} changes (${modified} modified, ${untracked} untracked)`,
    };
  } catch {
    return {
      name: "Git status",
      severity: "fail",
      message: "Not a git repo or git unavailable",
    };
  }
}

export function checkTypeScript(srcDir: string): CheckResult {
  const tsFiles = findFiles(srcDir, ".ts");
  const jsFiles = findFiles(srcDir, ".js");

  if (tsFiles.length === 0) {
    return {
      name: "TypeScript",
      severity: "warn",
      message: "No .ts files found",
    };
  }

  const totalTs = tsFiles.reduce((sum, f) => sum + countLines(f), 0);

  if (jsFiles.length > 0) {
    return {
      name: "TypeScript",
      severity: "warn",
      message: `${tsFiles.length} .ts files (${totalTs} lines), ${jsFiles.length} .js files remaining`,
    };
  }

  return {
    name: "TypeScript",
    severity: "pass",
    message: `${tsFiles.length} files, ${totalTs} lines — all TypeScript`,
  };
}

export function checkEnvFile(pkgDir: string): CheckResult {
  const envPath = join(pkgDir, ".env");
  const envExamplePath = join(pkgDir, ".env.example");

  if (!existsSync(envPath) && !existsSync(envExamplePath)) {
    return {
      name: "Environment",
      severity: "pass",
      message: "No .env files (ok for libraries)",
    };
  }

  if (existsSync(envPath) && !existsSync(envExamplePath)) {
    return {
      name: "Environment",
      severity: "warn",
      message: ".env exists but no .env.example for documentation",
    };
  }

  return {
    name: "Environment",
    severity: "pass",
    message: ".env and .env.example both present",
  };
}

export function checkReadme(pkgDir: string): CheckResult {
  const readmePath = join(pkgDir, "README.md");
  if (!existsSync(readmePath)) {
    return {
      name: "README.md",
      severity: "warn",
      message: "No README.md found",
    };
  }

  const lines = countLines(readmePath);
  if (lines < 10) {
    return {
      name: "README.md",
      severity: "warn",
      message: `Only ${lines} lines — might be sparse`,
    };
  }

  return { name: "README.md", severity: "pass", message: `${lines} lines` };
}

export function checkLicense(repoDir: string): CheckResult {
  const licensePath = join(repoDir, "LICENSE");
  const licMdPath = join(repoDir, "LICENSE.md");

  if (existsSync(licensePath) || existsSync(licMdPath)) {
    return {
      name: "License",
      severity: "pass",
      message: "License file present",
    };
  }

  return {
    name: "License",
    severity: "warn",
    message: "No LICENSE file found",
  };
}

export function checkBinExecutable(pkgDir: string): CheckResult {
  const binDir = join(pkgDir, "bin");
  if (!existsSync(binDir)) {
    return {
      name: "CLI binary",
      severity: "pass",
      message: "No bin/ directory (ok for libraries)",
    };
  }

  const files = readdirSync(binDir);
  const nonExecutable: string[] = [];

  for (const f of files) {
    try {
      const fullPath = join(binDir, f);
      const stat = statSync(fullPath);
      // Check if executable (any exec bit set)
      if ((stat.mode & 0o111) === 0) {
        nonExecutable.push(f);
      }
    } catch {
      // skip
    }
  }

  if (nonExecutable.length > 0) {
    return {
      name: "CLI binary",
      severity: "warn",
      message: `Non-executable: ${nonExecutable.join(", ")}`,
    };
  }

  return {
    name: "CLI binary",
    severity: "pass",
    message: `${files.length} bin files, all executable`,
  };
}

// ---------------------------------------------------------------------------
// Full sweep
// ---------------------------------------------------------------------------

export function runSweep(pkgDir: string, repoDir?: string): SweepReport {
  const start = Date.now();
  const srcDir = join(pkgDir, "src");
  const repo = repoDir || pkgDir;

  const checks: CheckResult[] = [
    checkPackageJson(pkgDir),
    checkClaudeMd(pkgDir),
    checkReadme(pkgDir),
    checkLicense(repo),
    checkGitStatus(repo),
    checkSourceFiles(srcDir),
    checkTestFiles(srcDir),
    checkTypeScript(srcDir),
    checkEnvFile(pkgDir),
    checkBinExecutable(pkgDir),
  ];

  const summary = {
    pass: checks.filter((c) => c.severity === "pass").length,
    warn: checks.filter((c) => c.severity === "warn").length,
    fail: checks.filter((c) => c.severity === "fail").length,
    total: checks.length,
  };

  return {
    timestamp: new Date().toISOString(),
    duration: Date.now() - start,
    checks,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const SEVERITY_ICONS: Record<CheckSeverity, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✗",
};

export function formatCheckResult(result: CheckResult): string {
  const icon = SEVERITY_ICONS[result.severity];
  return `  ${icon} ${result.name}: ${result.message}`;
}

export function formatSweepReport(report: SweepReport): string {
  const lines: string[] = [];

  lines.push("Quality Sweep Report");
  lines.push(`  Date: ${report.timestamp}`);
  lines.push(`  Duration: ${report.duration}ms`);
  lines.push("");

  for (const check of report.checks) {
    lines.push(formatCheckResult(check));
  }

  lines.push("");
  lines.push("Summary:");
  lines.push(
    `  ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
  );

  const score = Math.round((report.summary.pass / report.summary.total) * 100);
  lines.push(`  Score: ${score}%`);

  return lines.join("\n");
}

export function formatCompactSweep(report: SweepReport): string {
  const score = Math.round((report.summary.pass / report.summary.total) * 100);
  return `Quality: ${score}% (${report.summary.pass}/${report.summary.total} pass, ${report.summary.warn} warn, ${report.summary.fail} fail)`;
}

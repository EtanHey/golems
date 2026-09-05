import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import {
  checkTestFiles,
  checkSourceFiles,
  checkPackageJson,
  checkClaudeMd,
  checkGitStatus,
  checkTypeScript,
  checkEnvFile,
  checkReadme,
  checkLicense,
  checkBinExecutable,
  runSweep,
  formatCheckResult,
  formatSweepReport,
  formatCompactSweep,
  type CheckResult,
  type SweepReport,
} from "@golems/shared/lib/quality-sweep";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `sweep-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

function setupPackage(opts?: {
  pkg?: boolean;
  readme?: boolean;
  claude?: boolean;
  src?: boolean;
  tests?: boolean;
  lib?: boolean;
  env?: boolean;
  envExample?: boolean;
  bin?: boolean;
}): void {
  const o = opts || {};

  if (o.pkg !== false) {
    writeFileSync(join(testDir, "package.json"), JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      description: "Test package",
      scripts: { test: "bun test" },
    }));
  }

  if (o.readme) {
    writeFileSync(join(testDir, "README.md"), "# Test\n".repeat(20));
  }

  if (o.claude) {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Claude\n".repeat(25));
  }

  if (o.src !== false) {
    mkdirSync(join(testDir, "src"), { recursive: true });
  }

  if (o.lib) {
    mkdirSync(join(testDir, "src", "lib"), { recursive: true });
    writeFileSync(join(testDir, "src", "lib", "module.ts"), "export const x = 1;\n".repeat(10));
  }

  if (o.tests) {
    mkdirSync(join(testDir, "src", "__tests__"), { recursive: true });
    writeFileSync(join(testDir, "src", "__tests__", "module.test.ts"), "test('works', () => {});\n".repeat(10));
  }

  if (o.env) {
    writeFileSync(join(testDir, ".env"), "KEY=value");
  }

  if (o.envExample) {
    writeFileSync(join(testDir, ".env.example"), "KEY=");
  }

  if (o.bin) {
    mkdirSync(join(testDir, "bin"), { recursive: true });
    const binPath = join(testDir, "bin", "cli");
    writeFileSync(binPath, "#!/bin/bash\necho hi");
    chmodSync(binPath, 0o755);
  }
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

describe("checkTestFiles", () => {
  test("fail when no __tests__ directory", () => {
    mkdirSync(join(testDir, "src"), { recursive: true });
    const result = checkTestFiles(join(testDir, "src"));
    expect(result.severity).toBe("fail");
  });

  test("fail when empty __tests__", () => {
    mkdirSync(join(testDir, "src", "__tests__"), { recursive: true });
    const result = checkTestFiles(join(testDir, "src"));
    expect(result.severity).toBe("fail");
  });

  test("warn when few test files", () => {
    setupPackage({ tests: true });
    const result = checkTestFiles(join(testDir, "src"));
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("1 test");
  });

  test("pass when enough test files", () => {
    mkdirSync(join(testDir, "src", "__tests__"), { recursive: true });
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(testDir, "src", "__tests__", `test-${i}.ts`), "test();\n".repeat(10));
    }
    const result = checkTestFiles(join(testDir, "src"));
    expect(result.severity).toBe("pass");
    expect(result.message).toContain("6 test");
  });
});

describe("checkSourceFiles", () => {
  test("warn when no lib directory", () => {
    mkdirSync(join(testDir, "src"), { recursive: true });
    const result = checkSourceFiles(join(testDir, "src"));
    expect(result.severity).toBe("warn");
  });

  test("pass with lib modules", () => {
    setupPackage({ lib: true });
    const result = checkSourceFiles(join(testDir, "src"));
    expect(result.severity).toBe("pass");
    expect(result.message).toContain("1 lib");
  });
});

describe("checkPackageJson", () => {
  test("fail when missing", () => {
    const result = checkPackageJson(testDir);
    expect(result.severity).toBe("fail");
  });

  test("pass with complete package.json", () => {
    setupPackage();
    const result = checkPackageJson(testDir);
    expect(result.severity).toBe("pass");
    expect(result.message).toContain("test-pkg");
  });

  test("warn with incomplete package.json", () => {
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test" }));
    const result = checkPackageJson(testDir);
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("missing");
  });

  test("fail with invalid JSON", () => {
    writeFileSync(join(testDir, "package.json"), "not json{");
    const result = checkPackageJson(testDir);
    expect(result.severity).toBe("fail");
  });
});

describe("checkClaudeMd", () => {
  test("warn when missing", () => {
    const result = checkClaudeMd(testDir);
    expect(result.severity).toBe("warn");
  });

  test("pass with substantial CLAUDE.md", () => {
    setupPackage({ claude: true });
    const result = checkClaudeMd(testDir);
    expect(result.severity).toBe("pass");
  });

  test("warn when sparse", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Short\nHello\n");
    const result = checkClaudeMd(testDir);
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("sparse");
  });
});

describe("checkReadme", () => {
  test("warn when missing", () => {
    const result = checkReadme(testDir);
    expect(result.severity).toBe("warn");
  });

  test("pass with substantial README", () => {
    setupPackage({ readme: true });
    const result = checkReadme(testDir);
    expect(result.severity).toBe("pass");
  });
});

describe("checkEnvFile", () => {
  test("pass when no env files (library)", () => {
    const result = checkEnvFile(testDir);
    expect(result.severity).toBe("pass");
  });

  test("warn when .env without .env.example", () => {
    setupPackage({ env: true });
    const result = checkEnvFile(testDir);
    expect(result.severity).toBe("warn");
  });

  test("pass when both .env and .env.example", () => {
    setupPackage({ env: true, envExample: true });
    const result = checkEnvFile(testDir);
    expect(result.severity).toBe("pass");
  });
});

describe("checkTypeScript", () => {
  test("warn when no .ts files", () => {
    mkdirSync(join(testDir, "src"), { recursive: true });
    const result = checkTypeScript(join(testDir, "src"));
    expect(result.severity).toBe("warn");
  });

  test("pass with .ts files only", () => {
    setupPackage({ lib: true });
    const result = checkTypeScript(join(testDir, "src"));
    expect(result.severity).toBe("pass");
    expect(result.message).toContain("all TypeScript");
  });

  test("warn with mixed .ts and .js", () => {
    setupPackage({ lib: true });
    writeFileSync(join(testDir, "src", "old.js"), "const x = 1;");
    const result = checkTypeScript(join(testDir, "src"));
    expect(result.severity).toBe("warn");
    expect(result.message).toContain(".js files");
  });
});

describe("checkBinExecutable", () => {
  test("pass when no bin directory", () => {
    const result = checkBinExecutable(testDir);
    expect(result.severity).toBe("pass");
  });

  test("pass with executable bin", () => {
    setupPackage({ bin: true });
    const result = checkBinExecutable(testDir);
    expect(result.severity).toBe("pass");
  });

  test("warn with non-executable bin", () => {
    mkdirSync(join(testDir, "bin"), { recursive: true });
    const binPath = join(testDir, "bin", "cli");
    writeFileSync(binPath, "#!/bin/bash\necho hi");
    chmodSync(binPath, 0o644);
    const result = checkBinExecutable(testDir);
    expect(result.severity).toBe("warn");
    expect(result.message).toContain("Non-executable");
  });
});

describe("checkGitStatus", () => {
  test("reports on actual git repo", () => {
    execFileSync("git", ["init", "-q", testDir]);
    const result = checkGitStatus(testDir);
    // Either pass or warn — just check it runs
    expect(["pass", "warn"]).toContain(result.severity);
  });

  test("fail for non-git directory", () => {
    const result = checkGitStatus(testDir);
    expect(result.severity).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// Full sweep
// ---------------------------------------------------------------------------

describe("runSweep", () => {
  test("returns complete report", () => {
    setupPackage({ readme: true, claude: true, lib: true, tests: true });
    const report = runSweep(testDir);
    expect(report.timestamp).toBeTruthy();
    expect(report.duration).toBeGreaterThanOrEqual(0);
    expect(report.checks.length).toBe(10);
    expect(report.summary.total).toBe(10);
    expect(report.summary.pass + report.summary.warn + report.summary.fail).toBe(10);
  });

  test("all checks run without throwing", () => {
    // Run on real package
    const report = runSweep(
      "/Users/example/Gits/golems/packages/autonomous",
      "/Users/example/Gits/golems"
    );
    expect(report.checks.length).toBe(10);
    expect(report.summary.pass).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

describe("formatters", () => {
  test("formatCheckResult shows icon and message", () => {
    const result: CheckResult = { name: "Test", severity: "pass", message: "All good" };
    const output = formatCheckResult(result);
    expect(output).toContain("✓");
    expect(output).toContain("Test");
    expect(output).toContain("All good");
  });

  test("formatCheckResult shows warn icon", () => {
    const result: CheckResult = { name: "Test", severity: "warn", message: "Needs work" };
    expect(formatCheckResult(result)).toContain("⚠");
  });

  test("formatCheckResult shows fail icon", () => {
    const result: CheckResult = { name: "Test", severity: "fail", message: "Broken" };
    expect(formatCheckResult(result)).toContain("✗");
  });

  test("formatSweepReport shows full report", () => {
    setupPackage({ readme: true, claude: true, lib: true, tests: true });
    const report = runSweep(testDir);
    const output = formatSweepReport(report);
    expect(output).toContain("Quality Sweep Report");
    expect(output).toContain("Summary:");
    expect(output).toContain("Score:");
  });

  test("formatCompactSweep shows one-liner", () => {
    setupPackage({ readme: true, claude: true, lib: true, tests: true });
    const report = runSweep(testDir);
    const output = formatCompactSweep(report);
    expect(output).toContain("Quality:");
    expect(output).toContain("%");
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createEmptyState,
  loadState,
  saveState,
  markStepCompleted,
  markStepSkipped,
  isStepCompleted,
  getPendingSteps,
  getWizardSteps,
  checkRepoClaudeMd,
  checkRepoMcpConfig,
  checkRepoSkillsDir,
  checkConfigFile,
  runWiringChecks,
  loadErrors,
  saveErrors,
  logWiringErrors,
  getUnresolvedErrors,
  wireRepo,
  formatWiringReport,
  formatStateReport,
  type WizardState,
  type WiringCheck,
  type WiringError,
} from "@golems/shared/lib/wizard-state";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `wizard-state-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

describe("state persistence", () => {
  test("createEmptyState returns valid default", () => {
    const state = createEmptyState();
    expect(state.version).toBe(1);
    expect(state.completedSteps).toEqual([]);
    expect(state.wiredRepos).toEqual([]);
    expect(state.selectedServices).toEqual([]);
    expect(state.errors).toEqual([]);
    expect(state.lastRun).toBeUndefined();
  });

  test("loadState returns empty when file missing", () => {
    const state = loadState(join(testDir, "nonexistent.json"));
    expect(state.version).toBe(1);
    expect(state.completedSteps).toEqual([]);
  });

  test("loadState returns empty on corrupt JSON", () => {
    const p = join(testDir, "corrupt.json");
    writeFileSync(p, "not json!");
    const state = loadState(p);
    expect(state.version).toBe(1);
  });

  test("saveState creates directory and writes file", () => {
    const p = join(testDir, "sub", "state.json");
    const state = createEmptyState();
    state.selectedServices = ["telegram"];
    saveState(state, p);
    expect(existsSync(p)).toBe(true);
    const loaded = loadState(p);
    expect(loaded.selectedServices).toEqual(["telegram"]);
    expect(loaded.lastRun).toBeTruthy();
  });

  test("saveState roundtrips all fields", () => {
    const p = join(testDir, "state.json");
    const state = createEmptyState();
    state.selectedServices = ["telegram", "email"];
    markStepCompleted(state, "preflight");
    wireRepo(state, "/tmp/test-repo", "test-repo");
    saveState(state, p);

    const loaded = loadState(p);
    expect(loaded.selectedServices).toEqual(["telegram", "email"]);
    expect(loaded.completedSteps.length).toBe(1);
    expect(loaded.wiredRepos.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Step tracking
// ---------------------------------------------------------------------------

describe("step tracking", () => {
  test("markStepCompleted adds step with timestamp", () => {
    const state = createEmptyState();
    markStepCompleted(state, "preflight");
    expect(state.completedSteps.length).toBe(1);
    expect(state.completedSteps[0].id).toBe("preflight");
    expect(state.completedSteps[0].completedAt).toBeTruthy();
    expect(state.completedSteps[0].name).toBe("Pre-flight checks");
  });

  test("markStepCompleted updates existing step", () => {
    const state = createEmptyState();
    markStepSkipped(state, "preflight");
    expect(state.completedSteps[0].skippedAt).toBeTruthy();

    markStepCompleted(state, "preflight");
    expect(state.completedSteps.length).toBe(1);
    expect(state.completedSteps[0].completedAt).toBeTruthy();
    expect(state.completedSteps[0].skippedAt).toBeUndefined();
  });

  test("markStepSkipped records skip time", () => {
    const state = createEmptyState();
    markStepSkipped(state, "deploy");
    expect(state.completedSteps[0].skippedAt).toBeTruthy();
    expect(state.completedSteps[0].completedAt).toBeUndefined();
  });

  test("isStepCompleted returns correct values", () => {
    const state = createEmptyState();
    expect(isStepCompleted(state, "preflight")).toBe(false);
    markStepCompleted(state, "preflight");
    expect(isStepCompleted(state, "preflight")).toBe(true);
    expect(isStepCompleted(state, "core-setup")).toBe(false);
  });

  test("isStepCompleted returns false for skipped steps", () => {
    const state = createEmptyState();
    markStepSkipped(state, "deploy");
    expect(isStepCompleted(state, "deploy")).toBe(false);
  });

  test("getPendingSteps returns uncompleted steps", () => {
    const state = createEmptyState();
    markStepCompleted(state, "preflight");
    markStepCompleted(state, "core-setup");
    const pending = getPendingSteps(state);
    expect(pending.length).toBe(getWizardSteps().length - 2);
    expect(pending.find((s) => s.id === "preflight")).toBeUndefined();
    expect(pending.find((s) => s.id === "services")).toBeTruthy();
  });

  test("getWizardSteps returns all 7 steps", () => {
    const steps = getWizardSteps();
    expect(steps.length).toBe(7);
    expect(steps[0].id).toBe("preflight");
    expect(steps[6].id).toBe("postflight");
  });

  test("unknown step ID still tracks with id as name", () => {
    const state = createEmptyState();
    markStepCompleted(state, "custom-step");
    expect(state.completedSteps[0].name).toBe("custom-step");
  });
});

// ---------------------------------------------------------------------------
// Wiring checks
// ---------------------------------------------------------------------------

describe("wiring checks", () => {
  test("checkRepoClaudeMd passes when file exists", () => {
    writeFileSync(join(testDir, "CLAUDE.md"), "# Test");
    const result = checkRepoClaudeMd(testDir, "test-repo");
    expect(result.passed).toBe(true);
    expect(result.category).toBe("claude-md");
    expect(result.suggestedFix).toBeUndefined();
  });

  test("checkRepoClaudeMd fails when file missing", () => {
    const result = checkRepoClaudeMd(testDir, "test-repo");
    expect(result.passed).toBe(false);
    expect(result.suggestedFix).toContain("Create CLAUDE.md");
  });

  test("checkRepoMcpConfig passes when file exists", () => {
    writeFileSync(join(testDir, ".mcp.json"), "{}");
    const result = checkRepoMcpConfig(testDir, "test-repo");
    expect(result.passed).toBe(true);
    expect(result.category).toBe("mcp-config");
  });

  test("checkRepoMcpConfig fails when file missing", () => {
    const result = checkRepoMcpConfig(testDir, "test-repo");
    expect(result.passed).toBe(false);
  });

  test("checkRepoSkillsDir passes with populated dir", () => {
    const skillsDir = join(testDir, ".claude", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "skill.md"), "# Skill");
    const result = checkRepoSkillsDir(testDir, "test-repo");
    expect(result.passed).toBe(true);
    expect(result.message).toContain("1 skill(s)");
    expect(result.name).toBe("test-repo/.claude/skills");
  });

  test("checkRepoSkillsDir ignores a legacy .claude/commands dir", () => {
    const cmdDir = join(testDir, ".claude", "commands");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, "skill.md"), "# Skill");
    const result = checkRepoSkillsDir(testDir, "test-repo");
    expect(result.passed).toBe(false);
  });

  test("checkRepoSkillsDir fails with empty dir", () => {
    const skillsDir = join(testDir, ".claude", "skills");
    mkdirSync(skillsDir, { recursive: true });
    const result = checkRepoSkillsDir(testDir, "test-repo");
    expect(result.passed).toBe(false);
  });

  test("checkRepoSkillsDir fails when dir missing", () => {
    const result = checkRepoSkillsDir(testDir, "test-repo");
    expect(result.passed).toBe(false);
    expect(result.category).toBe("skills");
  });

  test("runWiringChecks with mock repos", () => {
    // Create a fake repo
    const repoDir = join(testDir, "golems");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, "CLAUDE.md"), "# Test");

    const checks = runWiringChecks({
      reposBasePath: testDir,
      checkHelpers: false,
      checkServices: false,
    });

    // Should have at least the config check + whatever repos exist
    expect(checks.length).toBeGreaterThan(0);
    const configCheck = checks.find((c) => c.name === "config.yaml");
    expect(configCheck).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Error logging
// ---------------------------------------------------------------------------

describe("error logging", () => {
  test("loadErrors returns empty array when file missing", () => {
    const errors = loadErrors(join(testDir, "nonexistent.json"));
    expect(errors).toEqual([]);
  });

  test("saveErrors creates file", () => {
    const p = join(testDir, "errors.json");
    const errors: WiringError[] = [
      {
        id: "err-1",
        repo: "test",
        category: "claude-md",
        message: "Missing CLAUDE.md",
        foundAt: new Date().toISOString(),
      },
    ];
    saveErrors(errors, p);
    const loaded = loadErrors(p);
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe("err-1");
  });

  test("logWiringErrors creates new errors for failures", () => {
    const errorsPath = join(testDir, "errors.json");
    const checks: WiringCheck[] = [
      {
        name: "test/CLAUDE.md",
        repo: "test",
        passed: false,
        message: "Missing",
        category: "claude-md",
        suggestedFix: "Create it",
      },
    ];
    const newErrors = logWiringErrors(checks, errorsPath);
    expect(newErrors.length).toBe(1);
    expect(newErrors[0].category).toBe("claude-md");

    const all = loadErrors(errorsPath);
    expect(all.length).toBe(1);
  });

  test("logWiringErrors resolves passing errors", () => {
    const errorsPath = join(testDir, "errors.json");

    // First: create an error
    const failChecks: WiringCheck[] = [
      { name: "test/CLAUDE.md", repo: "test", passed: false, message: "Missing", category: "claude-md" },
    ];
    logWiringErrors(failChecks, errorsPath);

    // Then: resolve it
    const passChecks: WiringCheck[] = [
      { name: "test/CLAUDE.md", repo: "test", passed: true, message: "Found", category: "claude-md" },
    ];
    logWiringErrors(passChecks, errorsPath);

    const unresolved = getUnresolvedErrors(errorsPath);
    expect(unresolved.length).toBe(0);

    const all = loadErrors(errorsPath);
    expect(all.length).toBe(1);
    expect(all[0].resolvedAt).toBeTruthy();
  });

  test("logWiringErrors does not duplicate existing errors", () => {
    const errorsPath = join(testDir, "errors.json");
    const checks: WiringCheck[] = [
      { name: "test/CLAUDE.md", repo: "test", passed: false, message: "Missing", category: "claude-md" },
    ];
    logWiringErrors(checks, errorsPath);
    logWiringErrors(checks, errorsPath);

    const all = loadErrors(errorsPath);
    expect(all.length).toBe(1);
  });

  test("getUnresolvedErrors filters resolved", () => {
    const errorsPath = join(testDir, "errors.json");
    const errors: WiringError[] = [
      { id: "err-1", repo: "a", category: "claude-md", message: "Missing", foundAt: "2026-01-01T00:00:00Z" },
      { id: "err-2", repo: "b", category: "mcp-config", message: "Missing", foundAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-02T00:00:00Z" },
    ];
    saveErrors(errors, errorsPath);
    const unresolved = getUnresolvedErrors(errorsPath);
    expect(unresolved.length).toBe(1);
    expect(unresolved[0].id).toBe("err-1");
  });
});

// ---------------------------------------------------------------------------
// Wire repo
// ---------------------------------------------------------------------------

describe("wireRepo", () => {
  test("adds new repo to state", () => {
    const state = createEmptyState();
    writeFileSync(join(testDir, "CLAUDE.md"), "# Docs");
    const repo = wireRepo(state, testDir, "my-repo");
    expect(repo.name).toBe("my-repo");
    expect(repo.hasClaudeMd).toBe(true);
    expect(repo.hasMcpConfig).toBe(false);
    expect(state.wiredRepos.length).toBe(1);
  });

  test("updates existing repo", () => {
    const state = createEmptyState();
    wireRepo(state, testDir, "my-repo");
    expect(state.wiredRepos[0].hasMcpConfig).toBe(false);

    writeFileSync(join(testDir, ".mcp.json"), "{}");
    wireRepo(state, testDir, "my-repo");
    expect(state.wiredRepos.length).toBe(1);
    expect(state.wiredRepos[0].hasMcpConfig).toBe(true);
  });

  test("wiredAt timestamp is set", () => {
    const state = createEmptyState();
    const repo = wireRepo(state, testDir, "test");
    expect(repo.wiredAt).toBeTruthy();
    expect(new Date(repo.wiredAt).getTime()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

describe("formatters", () => {
  test("formatWiringReport shows pass/fail counts", () => {
    const checks: WiringCheck[] = [
      { name: "a", repo: "r", passed: true, message: "ok", category: "claude-md" },
      { name: "b", repo: "r", passed: false, message: "missing", category: "mcp-config", suggestedFix: "create it" },
      { name: "c", repo: "r", passed: true, message: "ok", category: "skills" },
    ];
    const report = formatWiringReport(checks);
    expect(report).toContain("Passed: 2/3");
    expect(report).toContain("[FAIL] b: missing");
    expect(report).toContain("Fix: create it");
    expect(report).toContain("[OK]   a");
  });

  test("formatStateReport shows all sections", () => {
    const state = createEmptyState();
    markStepCompleted(state, "preflight");
    markStepSkipped(state, "deploy");
    state.selectedServices = ["telegram"];
    wireRepo(state, testDir, "test-repo");
    state.lastRun = "2026-01-15T10:00:00Z";

    const report = formatStateReport(state);
    expect(report).toContain("Wizard State");
    expect(report).toContain("2026-01-15T10:00:00Z");
    expect(report).toContain("[DONE] Pre-flight checks");
    expect(report).toContain("[SKIP] Deploy services");
    expect(report).toContain("[    ] Core setup");
    expect(report).toContain("test-repo");
    expect(report).toContain("telegram");
  });

  test("formatWiringReport with all passing", () => {
    const checks: WiringCheck[] = [
      { name: "a", repo: "r", passed: true, message: "ok", category: "claude-md" },
    ];
    const report = formatWiringReport(checks);
    expect(report).toContain("Passed: 1/1");
    expect(report).not.toContain("[FAIL]");
  });
});

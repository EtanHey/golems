/**
 * Wizard State — persistence, wiring checks, and error logging
 *
 * Tracks wizard progress across runs, validates repo wiring,
 * and logs errors for NightShift/morning review.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WizardStep {
  id: string;
  name: string;
  completedAt?: string;
  skippedAt?: string;
  error?: string;
}

export interface WiredRepo {
  path: string;
  name: string;
  wiredAt: string;
  hasClaudeMd: boolean;
  hasMcpConfig: boolean;
  hasSkills: boolean;
}

export interface WizardState {
  version: number;
  lastRun?: string;
  completedSteps: WizardStep[];
  wiredRepos: WiredRepo[];
  selectedServices: string[];
  errors: WiringError[];
}

export interface WiringError {
  id: string;
  repo: string;
  category: "claude-md" | "mcp-config" | "skills" | "cli-helper" | "service" | "config" | "rules";
  message: string;
  suggestedFix?: string;
  foundAt: string;
  resolvedAt?: string;
}

export interface WiringCheck {
  name: string;
  repo: string;
  passed: boolean;
  message: string;
  category: WiringError["category"];
  suggestedFix?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STATE_PATH = join(
  process.env.HOME || "~",
  ".golems",
  "wizard-state.json"
);

const DEFAULT_ERRORS_PATH = join(
  process.env.HOME || "~",
  ".golems",
  "wiring-errors.json"
);

const KNOWN_REPOS = [
  { name: "golems", subpath: "Gits/golems" },
  { name: "songscript", subpath: "Gits/songscript" },
  { name: "zikaron", subpath: "Gits/zikaron" },
  { name: "taskowl", subpath: "Gits/taskowl" },
  { name: "union", subpath: "Gits/union" },
  { name: "rudy", subpath: "Gits/rudy" },
];

const WIZARD_STEPS = [
  { id: "preflight", name: "Pre-flight checks" },
  { id: "core-setup", name: "Core setup" },
  { id: "services", name: "Service selection" },
  { id: "secrets", name: "Secrets configuration" },
  { id: "deploy", name: "Deploy services" },
  { id: "verify", name: "Verify health" },
  { id: "postflight", name: "Generate setup log" },
];

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

export function getDefaultStatePath(): string {
  return DEFAULT_STATE_PATH;
}

export function createEmptyState(): WizardState {
  return {
    version: 1,
    completedSteps: [],
    wiredRepos: [],
    selectedServices: [],
    errors: [],
  };
}

export function loadState(statePath?: string): WizardState {
  const p = statePath || DEFAULT_STATE_PATH;
  if (!existsSync(p)) {
    return createEmptyState();
  }
  try {
    const raw = readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    return {
      version: data.version || 1,
      lastRun: data.lastRun,
      completedSteps: data.completedSteps || [],
      wiredRepos: data.wiredRepos || [],
      selectedServices: data.selectedServices || [],
      errors: data.errors || [],
    };
  } catch {
    return createEmptyState();
  }
}

export function saveState(state: WizardState, statePath?: string): void {
  const p = statePath || DEFAULT_STATE_PATH;
  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  state.lastRun = new Date().toISOString();
  writeFileSync(p, JSON.stringify(state, null, 2));
}

export function markStepCompleted(state: WizardState, stepId: string): void {
  const existing = state.completedSteps.find((s) => s.id === stepId);
  if (existing) {
    existing.completedAt = new Date().toISOString();
    delete existing.error;
    delete existing.skippedAt;
  } else {
    const def = WIZARD_STEPS.find((s) => s.id === stepId);
    state.completedSteps.push({
      id: stepId,
      name: def?.name || stepId,
      completedAt: new Date().toISOString(),
    });
  }
}

export function markStepSkipped(state: WizardState, stepId: string): void {
  const existing = state.completedSteps.find((s) => s.id === stepId);
  if (existing) {
    existing.skippedAt = new Date().toISOString();
  } else {
    const def = WIZARD_STEPS.find((s) => s.id === stepId);
    state.completedSteps.push({
      id: stepId,
      name: def?.name || stepId,
      skippedAt: new Date().toISOString(),
    });
  }
}

export function isStepCompleted(state: WizardState, stepId: string): boolean {
  return state.completedSteps.some(
    (s) => s.id === stepId && s.completedAt != null
  );
}

export function getPendingSteps(state: WizardState): typeof WIZARD_STEPS {
  return WIZARD_STEPS.filter(
    (s) => !state.completedSteps.some((cs) => cs.id === s.id && cs.completedAt)
  );
}

export function getWizardSteps(): typeof WIZARD_STEPS {
  return [...WIZARD_STEPS];
}

// ---------------------------------------------------------------------------
// Wiring checks
// ---------------------------------------------------------------------------

function shellExec(cmd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, { encoding: "utf8", timeout: 10000 }).trim();
    return { ok: true, output };
  } catch {
    return { ok: false, output: "" };
  }
}

export function checkRepoClaudeMd(repoPath: string, repoName: string): WiringCheck {
  const claudeMdPath = join(repoPath, "CLAUDE.md");
  const exists = existsSync(claudeMdPath);
  return {
    name: `${repoName}/CLAUDE.md`,
    repo: repoName,
    passed: exists,
    message: exists
      ? `CLAUDE.md found at ${repoPath}`
      : `CLAUDE.md missing at ${repoPath}`,
    category: "claude-md",
    suggestedFix: exists ? undefined : `Create CLAUDE.md in ${repoPath}`,
  };
}

export function checkRepoMcpConfig(repoPath: string, repoName: string): WiringCheck {
  const mcpPath = join(repoPath, ".mcp.json");
  const exists = existsSync(mcpPath);
  return {
    name: `${repoName}/.mcp.json`,
    repo: repoName,
    passed: exists,
    message: exists
      ? `.mcp.json found at ${repoPath}`
      : `.mcp.json missing at ${repoPath}`,
    category: "mcp-config",
    suggestedFix: exists ? undefined : `Create .mcp.json in ${repoPath} with golems MCP servers`,
  };
}

export function checkRepoSkillsDir(repoPath: string, repoName: string): WiringCheck {
  // AIDEV-NOTE: .claude/skills, never .claude/commands — Claude Code walks
  // commands/**/*.md recursively, so a skill dir symlinked there exposes every
  // workflows/ and references/ sub-file as its own listed "skill".
  const skillsDir = join(repoPath, ".claude", "skills");
  const name = `${repoName}/.claude/skills`;
  const exists = existsSync(skillsDir);
  if (!exists) {
    return {
      name,
      repo: repoName,
      passed: false,
      message: `.claude/skills directory missing at ${repoPath}`,
      category: "skills",
      suggestedFix: `mkdir -p ${repoPath}/.claude/skills && symlink golem-powers`,
    };
  }

  // Check if it has any content
  try {
    const entries = readdirSync(skillsDir);
    const hasSkills = entries.length > 0;
    return {
      name,
      repo: repoName,
      passed: hasSkills,
      message: hasSkills
        ? `${entries.length} skill(s) found in ${skillsDir}`
        : `No skills in ${skillsDir}`,
      category: "skills",
      suggestedFix: hasSkills ? undefined : `Symlink golem-powers into ${skillsDir}`,
    };
  } catch {
    return {
      name,
      repo: repoName,
      passed: false,
      message: `Error reading ${skillsDir}`,
      category: "skills",
    };
  }
}

export function checkRepoRules(repoPath: string, repoName: string): WiringCheck {
  const rulesDir = join(repoPath, ".claude", "rules");
  const claudeMdPath = join(repoPath, "CLAUDE.md");

  // Check for deprecated @context: syntax
  let hasDeprecatedContexts = false;
  if (existsSync(claudeMdPath)) {
    try {
      const content = readFileSync(claudeMdPath, "utf-8");
      hasDeprecatedContexts = /^@context:/m.test(content);
    } catch {}
  }

  const rulesExist = existsSync(rulesDir);
  let ruleCount = 0;
  if (rulesExist) {
    try {
      ruleCount = readdirSync(rulesDir).filter(f => f.endsWith(".md")).length;
    } catch {}
  }

  if (hasDeprecatedContexts) {
    return {
      name: `${repoName}/.claude/rules`,
      repo: repoName,
      passed: false,
      message: `CLAUDE.md has deprecated @context: syntax — migrate to .claude/rules/`,
      category: "rules",
      suggestedFix: `Run: golems rules check ${repoPath}`,
    };
  }

  return {
    name: `${repoName}/.claude/rules`,
    repo: repoName,
    passed: rulesExist && ruleCount > 0,
    message: rulesExist
      ? `${ruleCount} rule(s) in .claude/rules/`
      : `.claude/rules/ not found (optional but recommended)`,
    category: "rules",
    suggestedFix: !rulesExist
      ? `Run: golems rules export base ${repoPath}`
      : ruleCount === 0
        ? `Rules dir exists but is empty. Run: golems rules export base ${repoPath}`
        : undefined,
  };
}

export function checkCliHelper(name: string, versionFlag: string): WiringCheck {
  const result = shellExec(`${name} ${versionFlag} 2>&1`);
  return {
    name: `CLI: ${name}`,
    repo: "system",
    passed: result.ok,
    message: result.ok
      ? `${name} available: ${result.output.split("\n")[0]}`
      : `${name} not found`,
    category: "cli-helper",
    suggestedFix: result.ok ? undefined : `Install ${name}`,
  };
}

export function checkConfigFile(): WiringCheck {
  const configPath = join(process.env.HOME || "~", ".golems", "config.yaml");
  const exists = existsSync(configPath);
  return {
    name: "config.yaml",
    repo: "system",
    passed: exists,
    message: exists
      ? `Config found at ${configPath}`
      : `Config missing at ${configPath}`,
    category: "config",
    suggestedFix: exists ? undefined : `Run: golems init`,
  };
}

export function checkServiceRunning(name: string, checkCmd: string): WiringCheck {
  const result = shellExec(checkCmd);
  const running = result.ok && result.output.length > 0;
  return {
    name: `Service: ${name}`,
    repo: "system",
    passed: running,
    message: running ? `${name} is running` : `${name} is not running`,
    category: "service",
    suggestedFix: running ? undefined : `Start ${name} with: golems start ${name}`,
  };
}

export interface CheckOptions {
  reposBasePath?: string;
  checkHelpers?: boolean;
  checkServices?: boolean;
}

export function runWiringChecks(options: CheckOptions = {}): WiringCheck[] {
  const basePath = options.reposBasePath || join(process.env.HOME || "~", "Gits");
  const checks: WiringCheck[] = [];

  // Check each known repo
  for (const repo of KNOWN_REPOS) {
    const repoPath = join(basePath, repo.subpath.replace("Gits/", ""));
    if (!existsSync(repoPath)) continue;

    checks.push(checkRepoClaudeMd(repoPath, repo.name));
    checks.push(checkRepoMcpConfig(repoPath, repo.name));
    checks.push(checkRepoSkillsDir(repoPath, repo.name));
    checks.push(checkRepoRules(repoPath, repo.name));
  }

  // Check config
  checks.push(checkConfigFile());

  // CLI helpers
  if (options.checkHelpers !== false) {
    checks.push(checkCliHelper("bun", "--version"));
    checks.push(checkCliHelper("git", "--version"));
  }

  // Services
  if (options.checkServices) {
    checks.push(
      checkServiceRunning("telegram", "pgrep -fl telegram-bot")
    );
    checks.push(
      checkServiceRunning("notify-server", "curl -s --max-time 2 http://localhost:3847/health")
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Error logging
// ---------------------------------------------------------------------------

export function loadErrors(errorsPath?: string): WiringError[] {
  const p = errorsPath || DEFAULT_ERRORS_PATH;
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

export function saveErrors(errors: WiringError[], errorsPath?: string): void {
  const p = errorsPath || DEFAULT_ERRORS_PATH;
  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(p, JSON.stringify(errors, null, 2));
}

export function logWiringErrors(checks: WiringCheck[], errorsPath?: string): WiringError[] {
  const existing = loadErrors(errorsPath);
  const newErrors: WiringError[] = [];

  for (const check of checks) {
    if (check.passed) {
      // Resolve any matching existing error
      const match = existing.find(
        (e) => e.repo === check.repo && e.category === check.category && !e.resolvedAt
      );
      if (match) {
        match.resolvedAt = new Date().toISOString();
      }
      continue;
    }

    // Check if already logged
    const alreadyLogged = existing.find(
      (e) => e.repo === check.repo && e.category === check.category && !e.resolvedAt
    );
    if (alreadyLogged) continue;

    const error: WiringError = {
      id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      repo: check.repo,
      category: check.category,
      message: check.message,
      suggestedFix: check.suggestedFix,
      foundAt: new Date().toISOString(),
    };
    existing.push(error);
    newErrors.push(error);
  }

  saveErrors(existing, errorsPath);
  return newErrors;
}

export function getUnresolvedErrors(errorsPath?: string): WiringError[] {
  return loadErrors(errorsPath).filter((e) => !e.resolvedAt);
}

// ---------------------------------------------------------------------------
// Wire new repo
// ---------------------------------------------------------------------------

export function wireRepo(
  state: WizardState,
  repoPath: string,
  repoName: string
): WiredRepo {
  const repo: WiredRepo = {
    path: repoPath,
    name: repoName,
    wiredAt: new Date().toISOString(),
    hasClaudeMd: existsSync(join(repoPath, "CLAUDE.md")),
    hasMcpConfig: existsSync(join(repoPath, ".mcp.json")),
    hasSkills: existsSync(join(repoPath, ".claude", "commands")),
  };

  // Replace existing or add new
  const idx = state.wiredRepos.findIndex((r) => r.path === repoPath);
  if (idx >= 0) {
    state.wiredRepos[idx] = repo;
  } else {
    state.wiredRepos.push(repo);
  }

  return repo;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatWiringReport(checks: WiringCheck[]): string {
  const lines: string[] = ["Wiring Check Report", "=".repeat(50), ""];

  const passed = checks.filter((c) => c.passed);
  const failed = checks.filter((c) => !c.passed);

  lines.push(`Passed: ${passed.length}/${checks.length}`);
  lines.push("");

  if (failed.length > 0) {
    lines.push("Issues:");
    for (const c of failed) {
      lines.push(`  [FAIL] ${c.name}: ${c.message}`);
      if (c.suggestedFix) {
        lines.push(`         Fix: ${c.suggestedFix}`);
      }
    }
    lines.push("");
  }

  if (passed.length > 0) {
    lines.push("Passing:");
    for (const c of passed) {
      lines.push(`  [OK]   ${c.name}`);
    }
  }

  return lines.join("\n");
}

export function formatStateReport(state: WizardState): string {
  const lines: string[] = ["Wizard State", "=".repeat(50), ""];

  lines.push(`Last run: ${state.lastRun || "never"}`);
  lines.push(`Version: ${state.version}`);
  lines.push("");

  // Steps
  const steps = getWizardSteps();
  lines.push("Steps:");
  for (const step of steps) {
    const completed = state.completedSteps.find(
      (s) => s.id === step.id && s.completedAt
    );
    const skipped = state.completedSteps.find(
      (s) => s.id === step.id && s.skippedAt
    );
    const icon = completed ? "[DONE]" : skipped ? "[SKIP]" : "[    ]";
    lines.push(`  ${icon} ${step.name}`);
  }
  lines.push("");

  // Repos
  if (state.wiredRepos.length > 0) {
    lines.push("Wired Repos:");
    for (const repo of state.wiredRepos) {
      const flags = [
        repo.hasClaudeMd ? "CLAUDE.md" : "",
        repo.hasMcpConfig ? ".mcp.json" : "",
        repo.hasSkills ? "skills" : "",
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`  ${repo.name}: ${flags || "none"}`);
    }
    lines.push("");
  }

  // Services
  if (state.selectedServices.length > 0) {
    lines.push(`Services: ${state.selectedServices.join(", ")}`);
    lines.push("");
  }

  // Errors
  const unresolved = state.errors.filter((e) => !e.resolvedAt);
  if (unresolved.length > 0) {
    lines.push(`Unresolved errors: ${unresolved.length}`);
    for (const err of unresolved) {
      lines.push(`  [${err.category}] ${err.repo}: ${err.message}`);
    }
  }

  return lines.join("\n");
}

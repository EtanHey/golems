#!/usr/bin/env bun
/**
 * Night Shift v5 - Deep Pre-Scan + Structured Handoff
 *
 * Improvements over v4:
 * - Two-phase pre-scan: fast bash analysis → CLI agent prioritization
 * - Structured findings: Claude gets specific files, TODOs, and test failures
 * - Fresh sessions: no --resume, prevents old context pollution
 * - Longer timeouts: 60s pre-scan, 10min Claude
 * - Better Claude prompt: specific tasks, not "find something"
 */

import "@golems/shared/lib/load-env"; // MUST be first — loads .env for Supabase credentials under launchd

import { $ } from "bun";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import {
  defaultWorktreePath,
  resolveExistingWorktreePath,
} from "./worktree-path";
// Absolute paths for tools (launchd runs from /, not package root)
const HOME = process.env.HOME || homedir();
const REPOS_PATH = process.env.REPOS_PATH || `${HOME}/Gits`;
const STATE_FILE = join(HOME, ".golems-zikaron/state.json");
const FIX_LIST_FILE = join(HOME, ".golems-zikaron/nightshift-fixes.json");
const CLAUDE_BIN = `${HOME}/.local/bin/claude`;
const GEMINI_BIN = `${HOME}/.nvm/versions/node/v22.0.0/bin/gemini`;
const KIRO_BIN = `${HOME}/.local/bin/kiro-cli`;
const CURSOR_BIN = `${HOME}/.local/bin/cursor`;
const GH_BIN =
  ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].find((p) => existsSync(p)) ||
  "gh";

// ─── State Management ──────────────────────────────────────────────

interface State {
  nightShiftTarget: string;
  rotation: string[];
  telegramChatId: number | null;
  lastNightShift?: string;
  lastPrUrl?: string;
  nightShiftPRs?: { url: string; repo: string; createdAt: string }[];
}

interface FixItem {
  id: string;
  repo: string;
  tool: string;
  error: string;
  createdAt: string;
  resolved: boolean;
}

function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {
      nightShiftTarget: "songscript",
      rotation: ["songscript", "brainlayer", "claude-golem"],
      telegramChatId: null,
    };
  }
}

function saveState(state: State) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadFixList(): FixItem[] {
  try {
    return JSON.parse(readFileSync(FIX_LIST_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveFixList(fixes: FixItem[]) {
  writeFileSync(FIX_LIST_FILE, JSON.stringify(fixes, null, 2));
}

function addFixItem(repo: string, tool: string, error: string) {
  const fixes = loadFixList();
  fixes.push({
    id: `fix-${Date.now()}`,
    repo,
    tool,
    error: error.slice(0, 200),
    createdAt: new Date().toISOString(),
    resolved: false,
  });
  saveFixList(fixes);
  console.log(`[FixList] Added: ${tool} failure in ${repo}`);
}

function getPendingFixes(repo?: string): FixItem[] {
  return loadFixList().filter((f) => !f.resolved && (!repo || f.repo === repo));
}

function resolveFixItem(id: string) {
  const fixes = loadFixList();
  const fix = fixes.find((f) => f.id === id);
  if (fix) fix.resolved = true;
  saveFixList(fixes);
}

// ─── Telegram ──────────────────────────────────────────────────────

function getTelegramToken(): string {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const envFile = readFileSync(
      join(HOME, "Gits/golems/packages/claude/.env"),
      "utf-8",
    );
    const match = envFile.match(/TELEGRAM_BOT_TOKEN=(.+)/);
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

async function sendTelegram(message: string) {
  const token = getTelegramToken();
  const state = loadState();
  const chatId = state.telegramChatId;

  if (!token || !chatId) {
    console.log("[Telegram] No token/chat ID, skipping notification");
    console.log("[Telegram] Message:", message);
    return;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`[Telegram] API error ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error("[Telegram] Network error:", err);
  }
}

// ─── Pre-Scan: Structured Analysis ──────────────────────────────────

/** Structured findings from the two-phase pre-scan */
interface PreScanFindings {
  todos: { file: string; line: number; text: string }[];
  testFailures: string[];
  recentChanges: string[];
  cliSuggestion: string | null;
  summary: string;
}

/**
 * Run a CLI agent with a proper timeout that actually kills the process.
 * Returns trimmed stdout or null on failure/timeout.
 */
async function runCliAgent(
  name: string,
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number = 60000,
): Promise<string | null> {
  if (!existsSync(bin)) return null;

  try {
    const proc = Bun.spawn([bin, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await Promise.race([
      proc.exited.then(() => "done" as const),
      Bun.sleep(timeoutMs).then(() => "timeout" as const),
    ]);

    if (result === "timeout") {
      proc.kill(9);
      await Promise.race([proc.exited, Bun.sleep(2000)]);
      console.log(`[${name}] Timed out after ${timeoutMs / 1000}s, skipping`);
      return null;
    }

    const output = (await new Response(proc.stdout).text()).trim();
    if (output && output.length > 10) {
      return output;
    }
  } catch (err) {
    console.log(`[${name}] Failed (non-critical):`, String(err).slice(0, 100));
  }

  return null;
}

/**
 * Phase 1: Fast bash-based analysis.
 * Greps TODOs, runs tests, checks git log — no CLI agents needed.
 */
async function bashPreScan(repoPath: string): Promise<{
  todos: PreScanFindings["todos"];
  testFailures: string[];
  recentChanges: string[];
}> {
  const todos: PreScanFindings["todos"] = [];
  const testFailures: string[] = [];
  const recentChanges: string[] = [];

  // 1. Grep for TODOs/FIXMEs (fast, reliable)
  try {
    const todoOutput =
      await $`cd ${repoPath} && grep -rn "TODO\|FIXME\|HACK\|XXX" --include="*.ts" --include="*.tsx" --include="*.py" -l 2>/dev/null | head -20`.text();
    const files = todoOutput.trim().split("\n").filter(Boolean);

    for (const file of files.slice(0, 10)) {
      try {
        const matches =
          await $`cd ${repoPath} && grep -n "TODO\|FIXME\|HACK\|XXX" "${file}" 2>/dev/null | head -3`.text();
        for (const match of matches.trim().split("\n").filter(Boolean)) {
          const lineMatch = match.match(/^(\d+):(.*)/);
          if (lineMatch) {
            todos.push({
              file: file.replace(repoPath + "/", ""),
              line: parseInt(lineMatch[1]),
              text: lineMatch[2].trim().slice(0, 120),
            });
          }
        }
      } catch {}
    }
  } catch {}

  // 2. Run tests to find failures (if test command exists)
  try {
    const hasBunTest = existsSync(join(repoPath, "package.json"));
    if (hasBunTest) {
      const testProc = Bun.spawn(
        ["bun", "test", "--bail", "--timeout", "30000"],
        {
          cwd: repoPath,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      const testResult = await Promise.race([
        testProc.exited.then(() => "done" as const),
        Bun.sleep(45000).then(() => "timeout" as const),
      ]);

      if (testResult === "timeout") {
        testProc.kill(9);
        await Promise.race([testProc.exited, Bun.sleep(2000)]);
      } else {
        const stderr = await new Response(testProc.stderr).text();
        const exitCode = testProc.exitCode;
        if (exitCode !== 0 && stderr) {
          // Extract failing test names
          const failLines = stderr
            .split("\n")
            .filter(
              (l) =>
                l.includes("FAIL") || l.includes("✗") || l.includes("error"),
            )
            .slice(0, 5);
          testFailures.push(...failLines.map((l) => l.trim()).filter(Boolean));
        }
      }
    }
  } catch {}

  // 3. Recent git log — what changed recently?
  try {
    const log =
      await $`cd ${repoPath} && git log --oneline -10 --no-merges`.text();
    recentChanges.push(...log.trim().split("\n").filter(Boolean).slice(0, 5));
  } catch {}

  console.log(
    `[BashScan] Found: ${todos.length} TODOs, ${testFailures.length} test failures, ${recentChanges.length} recent changes`,
  );
  return { todos, testFailures, recentChanges };
}

/**
 * Phase 2: CLI agent analyzes bash findings and picks the best improvement.
 * Falls back gracefully — if all agents fail, bash findings alone are enough.
 */
async function cliPrioritize(
  repoPath: string,
  bashFindings: Awaited<ReturnType<typeof bashPreScan>>,
): Promise<string | null> {
  const findingsText = [
    bashFindings.todos.length > 0
      ? `TODOs found:\n${bashFindings.todos
          .slice(0, 8)
          .map((t) => `  ${t.file}:${t.line} — ${t.text}`)
          .join("\n")}`
      : "No TODOs found.",
    bashFindings.testFailures.length > 0
      ? `Test failures:\n${bashFindings.testFailures.join("\n")}`
      : "All tests pass.",
    bashFindings.recentChanges.length > 0
      ? `Recent commits:\n${bashFindings.recentChanges.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = `Here are findings from a codebase scan:\n\n${findingsText}\n\nPick the SINGLE most impactful item to fix. Prioritize: test failures > real bugs in TODOs > missing error handling > type improvements. Output ONLY:\n1. The file path and line number\n2. What exactly to change (1-2 sentences)\n3. Why it matters (1 sentence)`;

  // Try gemini → kiro → cursor (first success wins)
  // Gemini: use flash model (free tier has quota, pro is often exhausted)
  for (const [name, bin, args, timeout] of [
    ["Gemini", GEMINI_BIN, ["-m", "gemini-2.5-flash", "-p", prompt], 60000],
    ["Kiro", KIRO_BIN, ["-p", prompt], 60000],
    ["Cursor", CURSOR_BIN, ["agent", prompt, "--output-format", "text"], 75000],
  ] as const) {
    const result = await runCliAgent(
      name,
      bin,
      args as string[],
      repoPath,
      timeout as number,
    );
    if (result) {
      console.log(`[${name}] Priority: ${result.slice(0, 200)}...`);
      return result;
    }
  }

  console.log("[PreScan] CLI agents unavailable, using bash findings directly");
  return null;
}

/**
 * Full two-phase pre-scan: bash analysis → CLI prioritization.
 * Always returns findings (bash phase never fails), CLI is optional enrichment.
 */
async function deepPreScan(repoPath: string): Promise<PreScanFindings> {
  // Phase 1: Fast bash analysis (always works)
  const bashFindings = await bashPreScan(repoPath);

  // Phase 2: CLI agent picks the best item (optional)
  const cliSuggestion = await cliPrioritize(repoPath, bashFindings);

  // Build summary for Claude
  const parts: string[] = [];
  if (bashFindings.testFailures.length > 0) {
    parts.push(`${bashFindings.testFailures.length} failing test(s)`);
  }
  if (bashFindings.todos.length > 0) {
    parts.push(`${bashFindings.todos.length} TODO(s)`);
  }
  if (cliSuggestion) {
    parts.push("CLI agent has a specific suggestion");
  }
  const summary =
    parts.length > 0 ? parts.join(", ") : "Clean scan — look deeper";

  return {
    todos: bashFindings.todos,
    testFailures: bashFindings.testFailures,
    recentChanges: bashFindings.recentChanges,
    cliSuggestion,
    summary,
  };
}

// ─── Git Operations ────────────────────────────────────────────────

interface NightShiftResult {
  repo: string;
  prUrl?: string;
  improvement?: string;
  success: boolean;
  error?: string;
}

export async function createWorktree(
  repoPath: string,
  branchName: string,
): Promise<string> {
  const worktreeName = `nightshift-${Date.now()}`;
  const worktreePath = defaultWorktreePath(repoPath, worktreeName);
  mkdirSync(join(repoPath, ".worktrees"), { recursive: true });

  try {
    await $`cd ${repoPath} && git worktree add ${worktreePath} -b ${branchName}`;
  } catch {
    await $`cd ${repoPath} && git worktree add ${worktreePath} ${branchName}`;
  }

  // Link node_modules + copy .env
  try {
    await $`cd ${worktreePath} && ln -s ${repoPath}/node_modules node_modules 2>/dev/null || true`;
  } catch {}
  try {
    await $`cp ${repoPath}/.env ${worktreePath}/.env 2>/dev/null || true`;
  } catch {}

  return worktreePath;
}

async function cleanupWorktree(repoPath: string, worktreePath: string) {
  const cleanupPath = existsSync(worktreePath)
    ? worktreePath
    : resolveExistingWorktreePath(repoPath, basename(worktreePath), existsSync);
  try {
    await $`cd ${repoPath} && git worktree remove ${cleanupPath} --force`;
  } catch {
    try {
      rmSync(cleanupPath, { recursive: true, force: true });
      await $`cd ${repoPath} && git worktree prune`;
    } catch (e) {
      console.error("[Cleanup] Failed:", e);
    }
  }
}

// ─── Core: Claude Implementation ──────────────────────────────────

const repoSouls: Record<string, string> = {
  songscript: `SongScript: Language learning through song lyrics + transliteration. Tech: TanStack Start, Convex, Bun. Check CLAUDE.md for Convex build rules.`,
  brainlayer: `BrainLayer: Memory layer that indexes Claude Code conversations for search/retrieval.`,
  "claude-golem": `Ralph (claude-golem): Autonomous AI coding loop. Runs PRD stories.`,
};

async function runClaudeOnRepo(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  repo: string,
  findings: PreScanFindings,
  fixItems?: FixItem[],
): Promise<{ success: boolean; prUrl?: string; improvement?: string }> {
  console.log(`[Claude] Working in ${worktreePath}`);

  const soul = repoSouls[repo] || `Read CLAUDE.md to understand this project.`;

  // Build structured context from pre-scan findings
  let findingsBlock = "";

  // Test failures are highest priority
  if (findings.testFailures.length > 0) {
    findingsBlock += `\n## FAILING TESTS (fix these first!)\n${findings.testFailures.map((f) => `- ${f}`).join("\n")}\n`;
  }

  // CLI agent's specific suggestion
  if (findings.cliSuggestion) {
    findingsBlock += `\n## RECOMMENDED FIX (from pre-scan analysis)\n${findings.cliSuggestion}\n`;
  }

  // TODOs with file paths
  if (findings.todos.length > 0) {
    findingsBlock += `\n## TODOs FOUND IN CODEBASE\n${findings.todos
      .slice(0, 8)
      .map((t) => `- ${t.file}:${t.line} — ${t.text}`)
      .join("\n")}\n`;
  }

  // Previous failures
  if (fixItems && fixItems.length > 0) {
    findingsBlock += `\n## PREVIOUS FAILURES (from last run)\n${fixItems.map((f) => `- ${f.tool}: ${f.error}`).join("\n")}\n`;
  }

  const claudePrompt = `You are Night Shift — autonomous improvement system for ${repo}.

Project: ${soul}

# PRE-SCAN FINDINGS
${findingsBlock || "No specific issues found — explore the codebase for improvements."}

# YOUR TASK
Pick the SINGLE highest-impact item from the findings above and fix it.
Priority order: failing tests > bugs > TODOs > type safety > error handling.

# RULES
1. VERIFY you are NOT on master/main: run \`git branch\`
2. Check open PRs: \`gh pr list --state open --limit 10\` — don't duplicate
3. Read CLAUDE.md for project conventions
4. Make ONE focused change (don't refactor everything)
5. Run tests after your change: \`bun test\` (or project-specific test command)
6. Stage and commit: \`git add -A && git commit -m "nightshift: [what you fixed]"\`
7. Do NOT push — the orchestrator handles that

# OUTPUT
On success, output exactly: DONE: [brief description, max 40 chars]
If nothing actionable, output: NOTHING_TO_FIX`;

  try {
    // Fresh session each run — prevents old context from drowning out findings
    // Strip ANTHROPIC_API_KEY so Claude uses subscription auth (not a potentially stale API key)
    const { ANTHROPIC_API_KEY: _stripKey, ...cleanEnv } = process.env;
    const proc = Bun.spawn(
      [CLAUDE_BIN, "--dangerously-skip-permissions", "-p", claudePrompt],
      {
        cwd: worktreePath,
        stdout: "pipe",
        stderr: "pipe",
        env: cleanEnv,
      },
    );

    // 10 minute timeout — Claude needs time to explore, implement, and test
    const raceResult = await Promise.race([
      proc.exited.then(() => "done" as const),
      Bun.sleep(600000).then(() => "timeout" as const),
    ]);

    if (raceResult === "timeout") {
      proc.kill(9); // SIGKILL
      await Promise.race([proc.exited, Bun.sleep(2000)]); // cleanup
      console.error("[Claude] Timeout after 10 minutes");
      addFixItem(repo, "claude", "Timeout after 10 minutes");
      return { success: false, improvement: "Claude timed out" };
    }

    const output = await new Response(proc.stdout).text();
    console.log(`[Claude] Output: ${output.slice(0, 200)}...`);

    if (output.includes("NOTHING_TO_FIX")) {
      return { success: false, improvement: "No improvements found" };
    }

    const doneMatch = output.match(/DONE:\s*(.+)/);
    const improvement = doneMatch ? doneMatch[1].trim() : "Improvement made";

    // Check for actual commits
    const hasCommits =
      await $`cd ${worktreePath} && git log origin/main..HEAD --oneline 2>/dev/null || git log origin/master..HEAD --oneline 2>/dev/null || echo ""`.text();

    if (!hasCommits.trim()) {
      return { success: false, improvement };
    }

    const diffStat =
      await $`cd ${worktreePath} && git diff --stat origin/main...HEAD 2>/dev/null || git diff --stat origin/master...HEAD 2>/dev/null || echo ""`.text();

    if (
      !diffStat.trim() ||
      (diffStat.includes("0 insertions") && diffStat.includes("0 deletions"))
    ) {
      return { success: false, improvement: "No file changes made" };
    }

    console.log(`[Git] Changes: ${diffStat.trim().split("\n").pop()}`);

    // Push and create PR
    await $`cd ${worktreePath} && git push -u origin ${branchName}`;

    const title = `Night Shift: ${improvement.slice(0, 45)}`;
    const body = `Automated improvement by Golems Night Shift.\n\n${improvement}`;

    const prProc = Bun.spawn(
      [GH_BIN, "pr", "create", "--title", title, "--body", body],
      {
        cwd: worktreePath,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    await prProc.exited;
    const prUrl = (await new Response(prProc.stdout).text()).trim();
    const prErr = await new Response(prProc.stderr).text();

    if (prErr && !prUrl) {
      console.error("[GitHub] PR error:", prErr);
      addFixItem(repo, "gh-pr", prErr.slice(0, 200));
    }

    if (prUrl) console.log(`[GitHub] PR created: ${prUrl}`);

    // Mark related fixes as resolved
    if (fixItems) {
      for (const fix of fixItems) resolveFixItem(fix.id);
    }

    return { success: true, prUrl, improvement };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Claude/Git] Failed:", msg);
    addFixItem(repo, "claude-git", msg.slice(0, 200));
    return { success: false };
  }
}

// ─── Batch Loop: Process All Repos ─────────────────────────────────

async function processRepo(
  repo: string,
  state: State,
): Promise<NightShiftResult> {
  const repoPath = `${REPOS_PATH}/${repo}`;
  const result: NightShiftResult = {
    repo,
    success: false,
  };

  if (!existsSync(repoPath)) {
    console.log(`[Skip] Repo not found: ${repoPath}`);
    result.error = "Repo not found";
    return result;
  }

  console.log(`\n── Processing: ${repo} ──\n`);

  // 1. Deep two-phase pre-scan (bash analysis → CLI prioritization)
  const findings = await deepPreScan(repoPath);
  console.log(`[PreScan] Summary: ${findings.summary}`);

  // 2. Check fix list for this repo
  const fixes = getPendingFixes(repo);
  if (fixes.length > 0) {
    console.log(`[FixList] ${fixes.length} pending fixes for ${repo}`);
  }

  // 3. Create worktree and run Claude
  const branchName = `nightshift/${new Date().toISOString().split("T")[0]}-${Date.now() % 10000}`;
  let worktreePath: string | null = null;

  try {
    worktreePath = await createWorktree(repoPath, branchName);

    const { success, prUrl, improvement } = await runClaudeOnRepo(
      repoPath,
      worktreePath,
      branchName,
      repo,
      findings,
      fixes,
    );

    result.improvement = improvement;
    result.prUrl = prUrl;
    result.success = success;

    if (success && prUrl) {
      state.lastPrUrl = prUrl;
      if (!state.nightShiftPRs) state.nightShiftPRs = [];
      state.nightShiftPRs.push({
        url: prUrl,
        repo,
        createdAt: new Date().toISOString(),
      });
      saveState(state);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = msg;
    addFixItem(repo, "worktree", msg.slice(0, 200));
  } finally {
    if (worktreePath) {
      await cleanupWorktree(repoPath, worktreePath);
    }
  }

  return result;
}

// ─── Main Entry Point ──────────────────────────────────────────────

async function nightShift(): Promise<NightShiftResult[]> {
  const state = loadState();
  const rotation = state.rotation || [
    "songscript",
    "brainlayer",
    "claude-golem",
  ];

  // Check weekly schedule first — if today has an assigned repo, use it
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayDay = DAYS[new Date().getDay()];
  const scheduledRepo = (state as any).weeklySchedule?.[todayDay];

  const target = scheduledRepo || state.nightShiftTarget || rotation[0];
  if (scheduledRepo) {
    console.log(
      `[Schedule] Using weekly schedule: ${todayDay} → ${scheduledRepo}`,
    );
  }
  const targetIdx = rotation.indexOf(target);
  const orderedRepos = [
    ...rotation.slice(targetIdx >= 0 ? targetIdx : 0),
    ...rotation.slice(0, targetIdx >= 0 ? targetIdx : 0),
  ];

  console.log(`\n🌙 Night Shift v6 starting (parallel)...`);
  console.log(`📁 Repos: ${orderedRepos.join(" + ")}`);
  console.log(`⏰ Time: ${new Date().toLocaleString()}`);

  const pendingFixes = getPendingFixes();
  if (pendingFixes.length > 0) {
    console.log(`🔧 Pending fixes: ${pendingFixes.length}`);
  }
  console.log("");

  await sendTelegram(
    `🌙 *Night Shift v6 Starting (Parallel)*\n\nRepos: ${orderedRepos.join(" + ")}\nPending fixes: ${pendingFixes.length}`,
  );

  // AIDEV-NOTE: Phase 16 — Process all repos in parallel (max 3 concurrent)
  // Phase 1: Pre-scan all repos in parallel
  console.log("[Batch] Phase 1: Pre-scanning all repos in parallel...");
  const preScanResults = await Promise.allSettled(
    orderedRepos.map(async (repo) => {
      const repoPath = `${REPOS_PATH}/${repo}`;
      if (!existsSync(repoPath)) return { repo, findings: null };
      const findings = await deepPreScan(repoPath);
      console.log(`[PreScan] ${repo}: ${findings.summary}`);
      return { repo, findings };
    }),
  );

  // Collect successful pre-scans
  const reposToProcess: { repo: string; findings: PreScanFindings }[] = [];
  for (const result of preScanResults) {
    if (result.status === "fulfilled" && result.value.findings) {
      reposToProcess.push({
        repo: result.value.repo,
        findings: result.value.findings,
      });
    }
  }

  // Phase 2: Process repos in parallel (max 3 concurrent)
  console.log(
    `[Batch] Phase 2: Processing ${reposToProcess.length} repos in parallel...`,
  );
  const MAX_CONCURRENT = 3;

  const results: NightShiftResult[] = [];

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < reposToProcess.length; i += MAX_CONCURRENT) {
    const batch = reposToProcess.slice(i, i + MAX_CONCURRENT);

    const batchResults = await Promise.allSettled(
      batch.map(({ repo }) => processRepo(repo, state)),
    );

    batchResults.forEach((result, batchIdx) => {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        const repo = batch[batchIdx]?.repo ?? "unknown";
        console.error(`[Batch] Failed on ${repo}:`, result.reason);
        addFixItem(repo, "batch", String(result.reason).slice(0, 200));
        results.push({ repo, success: false, error: String(result.reason) });
      }
    });
  }

  // ═══ Summary ═══
  state.lastNightShift = new Date().toISOString();

  // Rotate target for next run
  const nextIdx = (targetIdx + 1) % rotation.length;
  state.nightShiftTarget = rotation[nextIdx];
  saveState(state);

  // Sync key state values to Supabase (so dashboard can see night shift data)
  try {
    const { reportServiceRun, setState: setSupabaseState } =
      await import("@golems/shared/lib/state-store");
    // reportServiceRun always writes to Supabase regardless of STATE_BACKEND
    await reportServiceRun("lastNightShift");
    // Also sync dashboard-visible values
    await Promise.allSettled([
      setSupabaseState("nightShiftTarget", state.nightShiftTarget),
      setSupabaseState("nightShiftPRs", state.nightShiftPRs || []),
    ]);
    console.log("[NightShift] Synced state to Supabase");
  } catch (err) {
    console.error("[NightShift] Failed to sync to Supabase:", err);
    // Non-fatal — local state is always the source of truth for night shift
  }

  const successCount = results.filter((r) => r.success).length;
  const prUrls = results
    .filter((r) => r.prUrl)
    .map((r) => r.prUrl)
    .join("\n");

  // Build detailed summary
  const resultDetails = results
    .map((r) => {
      const status = r.success
        ? "✅"
        : r.improvement?.includes("timed out")
          ? "⏰"
          : "—";
      return `${status} ${r.repo}: ${r.improvement || r.error || "skipped"}`;
    })
    .join("\n");

  await sendTelegram(
    `🌙 *Night Shift v6 Complete*\n\n` +
      `${resultDetails}\n\n` +
      `PRs: ${successCount}/${results.length}\n` +
      `${prUrls ? prUrls + "\n" : ""}` +
      `Next: ${rotation[nextIdx]}`,
  );

  return results;
}

// Run if called directly
if (import.meta.main) {
  nightShift()
    .then((results) => {
      const success = results.some((r) => r.success);
      console.log(
        "\n✅ Night Shift complete:",
        JSON.stringify(
          results.map((r) => ({
            repo: r.repo,
            success: r.success,
            pr: r.prUrl || "none",
          })),
          null,
          2,
        ),
      );
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error("\n❌ Night Shift error:", err);
      process.exit(1);
    });
}

export { nightShift, sendTelegram };

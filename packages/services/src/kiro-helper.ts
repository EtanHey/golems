/**
 * Kiro Helper - Spawn Kiro CLI for research, planning, and task execution
 *
 * Kiro is AWS's AI CLI with:
 * - Custom agents (JSON config)
 * - Knowledge base (persistent, semantic search)
 * - Planning mode (structured implementation plans)
 * - MCP integration
 *
 * This helper wraps Kiro CLI for use in the content pipeline and other golems.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

const HOME = process.env.HOME || homedir();
const GITS = join(HOME, "Gits");
const KIRO_BIN = "/usr/local/bin/kiro"; // Adjust if different
const NOTIFY_URL = "http://localhost:3847/notify";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

export interface KiroResult {
  output: string;
  success: boolean;
  error?: string;
}

export interface KiroOptions {
  timeoutMs?: number;
  agent?: string;        // Custom agent name
  verbose?: boolean;
  cwd?: string;          // Working directory
}

export interface KiroPlanResult {
  plan: string;
  tasks: string[];
  success: boolean;
  error?: string;
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

/**
 * Send a notification via the Telegram notification server.
 */
async function sendNotification(
  title: string,
  body: string,
  priority: "default" | "high" = "default"
): Promise<void> {
  try {
    await fetch(NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, source: "kiro-helper", priority }),
    });
  } catch (err) {
    console.error("[KiroHelper] Notification failed:", err);
  }
}

/**
 * Run a command with timeout, returning stdout and success status.
 */
async function runWithTimeout(
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; success: boolean; timedOut: boolean }> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const result = await Promise.race([proc.exited, timeoutPromise]);

  if (result === "timeout") {
    proc.kill();
    return {
      stdout: "",
      stderr: `Process timed out after ${timeoutMs / 1000}s`,
      success: false,
      timedOut: true,
    };
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = result as number;

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    success: exitCode === 0,
    timedOut: false,
  };
}

/**
 * Check if Kiro CLI is installed
 */
export async function isKiroAvailable(): Promise<boolean> {
  try {
    const result = await runWithTimeout([KIRO_BIN, "--version"], GITS, 5000);
    return result.success;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════
// MAIN EXPORTS
// ═══════════════════════════════════════════════════════

/**
 * Run Kiro CLI with a prompt.
 *
 * @param prompt - The prompt/task for Kiro
 * @param options - Timeout, agent, verbosity options
 * @returns Output and success status
 *
 * @example
 * const result = await runKiro("Research how the content pipeline works");
 */
export async function runKiro(
  prompt: string,
  options: KiroOptions = {}
): Promise<KiroResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    agent,
    verbose = false,
    cwd = GITS,
  } = options;

  // Check if Kiro is available
  const available = await isKiroAvailable();
  if (!available) {
    return {
      output: "",
      success: false,
      error: "Kiro CLI not installed or not in PATH",
    };
  }

  if (verbose) {
    console.log(`[KiroHelper] Running: ${prompt.slice(0, 50)}...`);
    console.log(`[KiroHelper] CWD: ${cwd}`);
    if (agent) console.log(`[KiroHelper] Agent: ${agent}`);
  }

  // Build command
  const args = [KIRO_BIN, "-p"]; // -p for print mode (non-interactive)

  if (agent) {
    args.push("--agent", agent);
  }

  args.push(prompt);

  try {
    const result = await runWithTimeout(args, cwd, timeoutMs);

    if (result.timedOut) {
      const error = `Kiro timed out after ${timeoutMs / 1000}s`;
      await sendNotification("Kiro Timeout", error, "high");
      return { output: "", success: false, error };
    }

    if (!result.success) {
      const error = result.stderr || "Unknown error";
      console.error(`[KiroHelper] Failed:`, error);
      return { output: "", success: false, error };
    }

    if (verbose) {
      console.log(`[KiroHelper] Success: ${result.stdout.length} chars`);
    }

    return {
      output: result.stdout,
      success: true,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[KiroHelper] Exception:`, error);
    return { output: "", success: false, error };
  }
}

/**
 * Run Kiro with a custom agent.
 *
 * @param agentName - Name of the agent (from ~/.kiro/agents/ or .kiro/agents/)
 * @param prompt - The task for the agent
 * @param options - Additional options
 */
export async function runKiroAgent(
  agentName: string,
  prompt: string,
  options: Omit<KiroOptions, "agent"> = {}
): Promise<KiroResult> {
  return runKiro(prompt, { ...options, agent: agentName });
}

/**
 * Run Kiro in planning mode.
 * Uses the built-in planning agent to create implementation plans.
 *
 * @param task - The task to plan
 * @param options - Additional options
 */
export async function runKiroPlan(
  task: string,
  options: Omit<KiroOptions, "agent"> = {}
): Promise<KiroPlanResult> {
  const result = await runKiro(
    `/plan ${task}`,
    { ...options, timeoutMs: options.timeoutMs || 10 * 60 * 1000 } // Plans can take longer
  );

  if (!result.success) {
    return {
      plan: "",
      tasks: [],
      success: false,
      error: result.error,
    };
  }

  // Try to extract tasks from the plan output
  const taskMatches = result.output.match(/^[-*]\s+.+$/gm) || [];
  const tasks = taskMatches.map((t) => t.replace(/^[-*]\s+/, "").trim());

  return {
    plan: result.output,
    tasks,
    success: true,
  };
}

/**
 * Escape string for Kiro prompt (escape backslashes and double quotes)
 */
function escapeForKiroPrompt(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Add content to Kiro's knowledge base.
 * Useful for persistent context across sessions.
 *
 * @param topic - Topic/title for the knowledge entry
 * @param content - The content to store
 * @param options - Additional options
 */
export async function addToKnowledgeBase(
  topic: string,
  content: string,
  options: KiroOptions = {}
): Promise<KiroResult> {
  // SECURITY: Escape quotes to prevent prompt injection
  const safeTopic = escapeForKiroPrompt(topic);
  const safeContent = escapeForKiroPrompt(content);
  const prompt = `/kb add "${safeTopic}" "${safeContent}"`;
  return runKiro(prompt, options);
}

/**
 * Search Kiro's knowledge base.
 *
 * @param query - Search query
 * @param options - Additional options
 */
export async function searchKnowledgeBase(
  query: string,
  options: KiroOptions = {}
): Promise<KiroResult> {
  // SECURITY: Escape quotes to prevent prompt injection
  const safeQuery = escapeForKiroPrompt(query);
  const prompt = `/kb search "${safeQuery}"`;
  return runKiro(prompt, options);
}

// ═══════════════════════════════════════════════════════
// CLI (for testing)
// ═══════════════════════════════════════════════════════

if (import.meta.main) {
  const [, , command, ...args] = process.argv;

  if (command === "check") {
    const available = await isKiroAvailable();
    console.log(`Kiro available: ${available}`);
    process.exit(available ? 0 : 1);
  }

  if (command === "run" && args.length > 0) {
    const prompt = args.join(" ");
    console.log(`\n[CLI] Running: ${prompt}\n`);
    const result = await runKiro(prompt, { verbose: true });

    if (result.success) {
      console.log(`\n[CLI] Output:\n${result.output}`);
    } else {
      console.error(`\n[CLI] Failed: ${result.error}`);
      process.exit(1);
    }
  } else if (command === "plan" && args.length > 0) {
    const task = args.join(" ");
    console.log(`\n[CLI] Planning: ${task}\n`);
    const result = await runKiroPlan(task, { verbose: true });

    if (result.success) {
      console.log(`\n[CLI] Plan:\n${result.plan}`);
      console.log(`\n[CLI] Tasks: ${result.tasks.length}`);
    } else {
      console.error(`\n[CLI] Failed: ${result.error}`);
      process.exit(1);
    }
  } else {
    console.log(`
Kiro Helper CLI

Usage:
  bun src/kiro-helper.ts check              # Check if Kiro is available
  bun src/kiro-helper.ts run <prompt>       # Run Kiro with a prompt
  bun src/kiro-helper.ts plan <task>        # Run Kiro planning mode

Examples:
  bun src/kiro-helper.ts check
  bun src/kiro-helper.ts run "Explain the content pipeline"
  bun src/kiro-helper.ts plan "Add dark mode to the app"
`);
  }
}

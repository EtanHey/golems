/**
 * Cursor Helper - Spawn Cursor CLI for research and verification
 *
 * Uses Cursor's `agent` command with Gemini for semantic codebase search.
 * Output is saved to ~/.golems-zikaron/research/ mirroring the ~/Gits tree.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

const HOME = process.env.HOME || homedir();
const GITS = join(HOME, "Gits");
const RESEARCH_BASE = join(HOME, ".golems-zikaron/research/gits");
const NOTIFY_URL = "http://localhost:3847/notify";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MODEL = "gemini-3-flash";

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

export interface ResearchResult {
  output: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface VerificationResult {
  confidence: number;
  corrections: string[];
  success: boolean;
  error?: string;
}

export interface CursorOptions {
  timeoutMs?: number;
  model?: string;
  verbose?: boolean;
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

/**
 * Sanitize a topic/filename for filesystem use.
 * Only allows alphanumeric, dash, underscore.
 */
function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

/**
 * Ensure directory exists, creating parent directories as needed.
 */
function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

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
      body: JSON.stringify({ title, body, source: "cursor-helper", priority }),
    });
    console.log(`[CursorHelper] Notified: ${title}`);
  } catch (err) {
    console.error("[CursorHelper] Notification failed:", err);
  }
}

/**
 * Run a command with timeout, returning stdout and success status.
 */
async function runWithTimeout(
  args: string[],
  cwd: string,
  stdin: string | undefined,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; success: boolean; timedOut: boolean }> {
  const proc = Bun.spawn(args, {
    cwd,
    stdin: stdin ? new Response(stdin) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Race between process completion and timeout
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

// ═══════════════════════════════════════════════════════
// MAIN EXPORTS
// ═══════════════════════════════════════════════════════

/**
 * Run Cursor CLI for codebase research.
 *
 * @param repo - Repository path relative to ~/Gits (e.g., "golems/packages/ralph")
 * @param topic - Research topic (used for filename and prompt)
 * @param prompt - Full research prompt (should include @codebase directive)
 * @param options - Timeout, model, verbosity options
 * @returns Research output and success status
 *
 * @example
 * const result = await runCursorResearch(
 *   "golems/packages/ralph",
 *   "prd-execution",
 *   "Research how Ralph executes PRD stories. Use @codebase to find entry points."
 * );
 * // Writes to ~/.golems-zikaron/research/gits/golems/packages/ralph/prd-execution.md
 */
export async function runCursorResearch(
  repo: string,
  topic: string,
  prompt: string,
  options: CursorOptions = {}
): Promise<ResearchResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, model = DEFAULT_MODEL, verbose = false } = options;

  // Validate repo path
  const repoPath = join(GITS, repo);
  if (!existsSync(repoPath)) {
    const error = `Repository not found: ${repoPath}`;
    console.error(`[CursorHelper] ${error}`);
    return { output: "", success: false, error };
  }

  // Prepare output path
  const sanitizedTopic = sanitizeFilename(topic);
  const outputDir = join(RESEARCH_BASE, repo);
  const outputPath = join(outputDir, `${sanitizedTopic}.md`);

  ensureDir(outputDir);

  if (verbose) {
    console.log(`[CursorHelper] Research: ${repo} / ${topic}`);
    console.log(`[CursorHelper] Output: ${outputPath}`);
    console.log(`[CursorHelper] Timeout: ${timeoutMs / 1000}s`);
  }

  // Build command - using `agent` CLI from Cursor
  // Note: Shell escaping is critical here to prevent injection
  const args = [
    "agent",
    "-p", // Non-interactive (print mode)
    "--output-format",
    "text",
    "--model",
    model,
    prompt, // Prompt is passed as argument, not via shell interpolation
  ];

  try {
    const result = await runWithTimeout(args, repoPath, undefined, timeoutMs);

    if (result.timedOut) {
      const error = `Research timed out after ${timeoutMs / 1000}s`;
      await sendNotification("Cursor Timeout", `${repo}/${topic}: ${error}`, "high");
      return { output: "", success: false, error };
    }

    if (!result.success) {
      const error = result.stderr || "Unknown error";
      console.error(`[CursorHelper] Research failed:`, error);
      await sendNotification("Cursor Error", `${repo}/${topic}: ${error.slice(0, 100)}`, "high");
      return { output: "", success: false, error };
    }

    // Write output to research directory
    writeFileSync(outputPath, result.stdout);

    if (verbose) {
      console.log(`[CursorHelper] Success: ${result.stdout.length} chars written`);
    }

    return {
      output: result.stdout,
      success: true,
      outputPath,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[CursorHelper] Exception:`, error);
    await sendNotification("Cursor Exception", `${repo}/${topic}: ${error.slice(0, 100)}`, "high");
    return { output: "", success: false, error };
  }
}

/**
 * Run Cursor CLI to verify a draft against research and codebase.
 *
 * @param draftPath - Path to draft file (JSON with claims section)
 * @param researchPath - Path to research file used for the draft
 * @param options - Timeout, model, verbosity options
 * @returns Confidence score (0-100) and list of corrections needed
 *
 * @example
 * const result = await runCursorVerification(
 *   "~/.golems-zikaron/drafts/gits/golems/zikaron.json",
 *   "~/.golems-zikaron/research/gits/golems/zikaron/architecture.md"
 * );
 * // Returns { confidence: 85, corrections: [], success: true }
 */
export async function runCursorVerification(
  draftPath: string,
  researchPath: string,
  options: CursorOptions = {}
): Promise<VerificationResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, model = DEFAULT_MODEL, verbose = false } = options;

  // Expand ~ in paths
  const expandedDraftPath = draftPath.replace(/^~/, HOME);
  const expandedResearchPath = researchPath.replace(/^~/, HOME);

  // Validate paths
  if (!existsSync(expandedDraftPath)) {
    const error = `Draft not found: ${expandedDraftPath}`;
    console.error(`[CursorHelper] ${error}`);
    return { confidence: 0, corrections: [], success: false, error };
  }

  if (!existsSync(expandedResearchPath)) {
    const error = `Research not found: ${expandedResearchPath}`;
    console.error(`[CursorHelper] ${error}`);
    return { confidence: 0, corrections: [], success: false, error };
  }

  // Read files
  let draftContent: string;
  let researchContent: string;
  try {
    draftContent = readFileSync(expandedDraftPath, "utf-8");
    researchContent = readFileSync(expandedResearchPath, "utf-8");
  } catch (err) {
    const error = `Failed to read files: ${err}`;
    return { confidence: 0, corrections: [], success: false, error };
  }

  // Determine repo from research path for cwd
  // Research path format: ~/.golems-zikaron/research/gits/{repo}/{topic}.md
  const repoMatch = expandedResearchPath.match(/research\/gits\/(.+?)\/[^/]+\.md$/);
  const repo = repoMatch ? repoMatch[1] : "";
  const repoPath = repo ? join(GITS, repo) : GITS;

  if (verbose) {
    console.log(`[CursorHelper] Verification: ${draftPath}`);
    console.log(`[CursorHelper] Against: ${researchPath}`);
    console.log(`[CursorHelper] Repo: ${repoPath}`);
  }

  // Build verification prompt
  const verificationPrompt = `You are verifying a content draft against research and the actual codebase.

## Research (source of claims):
${researchContent.slice(0, 5000)}

## Draft to verify:
${draftContent.slice(0, 5000)}

## Task:
1. Use @codebase to verify each technical claim in the draft
2. Check file paths, function names, and code behavior mentioned
3. Return a JSON object with:
   - confidence: number 0-100 (percent of claims verified correct)
   - corrections: string[] (list of incorrect claims with what's actually true)

Only output the JSON, no explanation. Example:
{"confidence": 85, "corrections": ["Runner.ts is at src/runner.ts not lib/runner.ts"]}`;

  const args = [
    "agent",
    "-p",
    "--output-format",
    "text",
    "--model",
    model,
    verificationPrompt,
  ];

  try {
    const result = await runWithTimeout(args, repoPath, undefined, timeoutMs);

    if (result.timedOut) {
      const error = `Verification timed out after ${timeoutMs / 1000}s`;
      await sendNotification("Verification Timeout", error, "high");
      return { confidence: 0, corrections: [], success: false, error };
    }

    if (!result.success) {
      const error = result.stderr || "Unknown error";
      console.error(`[CursorHelper] Verification failed:`, error);
      await sendNotification("Verification Error", error.slice(0, 100), "high");
      return { confidence: 0, corrections: [], success: false, error };
    }

    // Parse JSON from output
    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const error = "No JSON found in verification output";
      console.error(`[CursorHelper] ${error}`);
      console.error(`[CursorHelper] Raw output: ${result.stdout.slice(0, 200)}`);
      return { confidence: 0, corrections: [], success: false, error };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as { confidence: number; corrections: string[] };

      // Validate parsed structure
      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
      const corrections = Array.isArray(parsed.corrections) ? parsed.corrections : [];

      if (verbose) {
        console.log(`[CursorHelper] Confidence: ${confidence}%`);
        console.log(`[CursorHelper] Corrections: ${corrections.length}`);
      }

      return {
        confidence,
        corrections,
        success: true,
      };
    } catch (parseErr) {
      const error = `JSON parse error: ${parseErr}`;
      console.error(`[CursorHelper] ${error}`);
      return { confidence: 0, corrections: [], success: false, error };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[CursorHelper] Exception:`, error);
    await sendNotification("Verification Exception", error.slice(0, 100), "high");
    return { confidence: 0, corrections: [], success: false, error };
  }
}

// ═══════════════════════════════════════════════════════
// UTILITY EXPORTS
// ═══════════════════════════════════════════════════════

/**
 * Get the research output path for a given repo and topic.
 */
export function getResearchPath(repo: string, topic: string): string {
  const sanitizedTopic = sanitizeFilename(topic);
  return join(RESEARCH_BASE, repo, `${sanitizedTopic}.md`);
}

/**
 * Check if research exists for a given repo and topic.
 */
export function hasResearch(repo: string, topic: string): boolean {
  return existsSync(getResearchPath(repo, topic));
}

/**
 * Read existing research for a given repo and topic.
 */
export function readResearch(repo: string, topic: string): string | null {
  const path = getResearchPath(repo, topic);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// CLI (for testing)
// ═══════════════════════════════════════════════════════

if (import.meta.main) {
  const [, , command, ...args] = process.argv;

  if (command === "research" && args.length >= 2) {
    const [repo, topic] = args;
    const prompt =
      args[2] ||
      `Research ${topic} in this codebase. Use @codebase to find:
1. Main entry points and core files
2. Key functions/classes related to ${topic}
3. Data flow and dependencies
4. Configuration and environment

Output a comprehensive technical overview.`;

    console.log(`\n[CLI] Research: ${repo} / ${topic}\n`);
    const result = await runCursorResearch(repo, topic, prompt, { verbose: true });

    if (result.success) {
      console.log(`\n[CLI] Output written to: ${result.outputPath}`);
      console.log(`[CLI] Length: ${result.output.length} chars`);
    } else {
      console.error(`\n[CLI] Failed: ${result.error}`);
      process.exit(1);
    }
  } else if (command === "verify" && args.length >= 2) {
    const [draftPath, researchPath] = args;
    console.log(`\n[CLI] Verify: ${draftPath}\n`);
    const result = await runCursorVerification(draftPath, researchPath, { verbose: true });

    if (result.success) {
      console.log(`\n[CLI] Confidence: ${result.confidence}%`);
      console.log(`[CLI] Corrections: ${result.corrections.length}`);
      if (result.corrections.length > 0) {
        console.log(`[CLI] Issues:\n${result.corrections.map((c) => `  - ${c}`).join("\n")}`);
      }
    } else {
      console.error(`\n[CLI] Failed: ${result.error}`);
      process.exit(1);
    }
  } else {
    console.log(`
Cursor Helper CLI

Usage:
  bun src/cursor-helper.ts research <repo> <topic> [prompt]
  bun src/cursor-helper.ts verify <draft-path> <research-path>

Examples:
  bun src/cursor-helper.ts research golems/packages/ralph prd-execution
  bun src/cursor-helper.ts verify ~/.golems-zikaron/drafts/test.json ~/.golems-zikaron/research/gits/golems/test.md
`);
  }
}

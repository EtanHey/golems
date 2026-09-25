/**
 * Codex CLI JSONL parser.
 *
 * Parses ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl files.
 *
 * Event types:
 * - session_meta: session ID, cwd, model_provider
 * - turn_context: model name per turn
 * - event_msg type=token_count: cumulative token usage (use last one)
 *
 * OpenAI uses implicit caching — cached_input_tokens exposed, but
 * no cache_creation metric. cacheCreateTokens = 0 always.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export interface CodexSessionUsage {
  sessionId: string;
  project: string;
  model: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  reasoningTokens: number;
  apiCalls: number;
  costUsd: number;
}

/**
 * Parse a single Codex JSONL session from its lines.
 */
export function parseCodexSession(
  lines: string[],
  filename: string,
): CodexSessionUsage {
  let sessionId = filename.replace(".jsonl", "");
  let project = "";
  let model = "unknown";
  let timestamp = "";
  let apiCalls = 0;

  // Token counts — we want the LAST token_count event (cumulative totals)
  let lastInput = 0;
  let lastOutput = 0;
  let lastCachedInput = 0;
  let lastReasoning = 0;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const type = obj.type;

      if (type === "session_meta") {
        const p = obj.payload;
        if (p?.id) sessionId = p.id;
        if (p?.timestamp) timestamp = p.timestamp;
        if (p?.cwd) {
          // Extract project name from cwd
          const match = p.cwd.match(/\/([^/]+)$/);
          project = match ? match[1] : p.cwd;
        }
      } else if (type === "turn_context") {
        if (obj.payload?.model) model = obj.payload.model;
      } else if (type === "event_msg" && obj.payload?.type === "token_count") {
        const usage = obj.payload.info?.total_token_usage;
        if (usage) {
          lastInput = usage.input_tokens || 0;
          lastOutput = usage.output_tokens || 0;
          lastCachedInput = usage.cached_input_tokens || 0;
          lastReasoning = usage.reasoning_output_tokens || 0;
          apiCalls++;
        }
      }
    } catch {
      /* skip malformed lines */
    }
  }

  return {
    sessionId,
    project,
    model,
    timestamp,
    inputTokens: Math.max(lastInput - lastCachedInput, 0),
    outputTokens: lastOutput,
    cacheReadTokens: lastCachedInput,
    cacheCreateTokens: 0, // OpenAI implicit caching — no write metric
    reasoningTokens: lastReasoning,
    apiCalls,
    costUsd: 0, // calculated by caller via pricing.ts
  };
}

/**
 * Scan ~/.codex/sessions/ for all sessions since cutoffDate.
 */
export function scanCodexSessions(cutoffDate: Date): CodexSessionUsage[] {
  const home = process.env.HOME;
  if (!home) return [];

  const sessionsDir = join(home, ".codex", "sessions");
  return scanCodexRoots([sessionsDir], cutoffDate);
}

export function scanCodexRoots(
  roots: string[],
  cutoffDate: Date,
): CodexSessionUsage[] {
  const sessions: CodexSessionUsage[] = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const files = findCodexJsonlFiles(root);

    for (const filePath of files) {
      let mtime: Date;
      try {
        mtime = statSync(filePath).mtime;
      } catch {
        continue;
      }

      const session = parseCodexFile(filePath, cutoffDate, mtime);
      if (session) sessions.push(session);
    }
  }

  return sessions;
}

function findCodexJsonlFiles(root: string): string[] {
  const files: string[] = [];
  const entries = safeReaddir(root);

  for (const entry of entries) {
    const fullPath = join(root, entry);
    if (isDir(fullPath)) {
      files.push(...findCodexJsonlFiles(fullPath));
    } else if (entry.startsWith("rollout-") && entry.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseCodexFile(
  filePath: string,
  cutoffDate: Date,
  fallbackMtime: Date,
): CodexSessionUsage | null {
  const file = filePath.split("/").pop() || filePath;
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const session = parseCodexSession(lines, file);

    // Filter by actual session timestamp
    const sessionTime = Date.parse(session.timestamp || "");
    const effectiveTime = Number.isNaN(sessionTime)
      ? fallbackMtime.getTime()
      : sessionTime;
    if (effectiveTime < cutoffDate.getTime()) return null;
    if (Number.isNaN(sessionTime)) {
      session.timestamp = fallbackMtime.toISOString();
    }

    if (session.apiCalls > 0) {
      return session;
    }
  } catch {
    /* skip unreadable */
  }

  return null;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

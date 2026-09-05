/**
 * Claude Code JSONL parser.
 *
 * Parses live ~/.claude/projects/<project>/<session>.jsonl transcripts and
 * archived Claude archive directories, including nested subagent JSONLs.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { basename, join, relative } from "path";

export interface ClaudeSessionUsage {
  sessionId: string;
  project: string;
  model: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  apiCalls: number;
  costUsd: number;
}

export function parseClaudeSession(
  lines: string[],
  sessionId: string,
  project: string,
): ClaudeSessionUsage {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;
  let apiCalls = 0;
  let model = "unknown";
  let firstTimestamp = "";
  const usageByMessageId = new Map<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreateTokens: number;
    }
  >();

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type !== "assistant") continue;

      const msg = obj.message;
      if (!msg || typeof msg !== "object") continue;

      const usage = msg.usage;
      if (!usage) continue;

      if (!firstTimestamp && obj.timestamp) firstTimestamp = obj.timestamp;
      if (msg.model) model = msg.model;

      const sample = {
        inputTokens: Number(usage.input_tokens) || 0,
        outputTokens: Number(usage.output_tokens) || 0,
        cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
        cacheCreateTokens: Number(usage.cache_creation_input_tokens) || 0,
      };
      const messageId = typeof msg.id === "string" ? msg.id : "";
      if (messageId) {
        const previous = usageByMessageId.get(messageId);
        usageByMessageId.set(
          messageId,
          previous
            ? {
                inputTokens: Math.max(previous.inputTokens, sample.inputTokens),
                outputTokens: Math.max(
                  previous.outputTokens,
                  sample.outputTokens,
                ),
                cacheReadTokens: Math.max(
                  previous.cacheReadTokens,
                  sample.cacheReadTokens,
                ),
                cacheCreateTokens: Math.max(
                  previous.cacheCreateTokens,
                  sample.cacheCreateTokens,
                ),
              }
            : sample,
        );
      } else {
        totalInput += sample.inputTokens;
        totalOutput += sample.outputTokens;
        totalCacheRead += sample.cacheReadTokens;
        totalCacheCreate += sample.cacheCreateTokens;
        apiCalls++;
      }
    } catch {
      /* skip malformed lines */
    }
  }

  for (const usage of usageByMessageId.values()) {
    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;
    totalCacheRead += usage.cacheReadTokens;
    totalCacheCreate += usage.cacheCreateTokens;
    apiCalls++;
  }

  return {
    sessionId,
    project,
    model,
    timestamp: firstTimestamp,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheCreateTokens: totalCacheCreate,
    apiCalls,
    costUsd: 0,
  };
}

export function scanClaudeLiveSessions(cutoffDate: Date): ClaudeSessionUsage[] {
  const home = process.env.HOME;
  if (!home) return [];
  return scanClaudeRoots([join(home, ".claude", "projects")], cutoffDate, {
    activeProjectsRoot: true,
  });
}

export function scanClaudeRoots(
  roots: string[],
  cutoffDate: Date,
  opts: { activeProjectsRoot?: boolean } = {},
): ClaudeSessionUsage[] {
  const sessions: ClaudeSessionUsage[] = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const files = findJsonlFiles(root);

    for (const filePath of files) {
      let mtime: Date;
      try {
        mtime = statSync(filePath).mtime;
      } catch {
        continue;
      }

      const project = opts.activeProjectsRoot
        ? inferActiveProject(root, filePath)
        : inferArchiveProject(filePath);
      const session = parseClaudeFile(
        filePath,
        project,
        cutoffDate,
        claudeSessionId(root, filePath, Boolean(opts.activeProjectsRoot)),
        mtime,
      );
      if (session) sessions.push(session);
    }
  }

  return sessions;
}

function parseClaudeFile(
  filePath: string,
  project: string,
  cutoffDate: Date,
  sessionId: string,
  fallbackMtime: Date,
): ClaudeSessionUsage | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const session = parseClaudeSession(lines, sessionId, project);

    const sessionTime = Date.parse(session.timestamp || "");
    const effectiveTime = Number.isNaN(sessionTime)
      ? fallbackMtime.getTime()
      : sessionTime;
    if (effectiveTime < cutoffDate.getTime()) return null;
    if (Number.isNaN(sessionTime)) {
      session.timestamp = fallbackMtime.toISOString();
    }

    if (session.apiCalls > 0) return session;
  } catch {
    /* skip unreadable */
  }

  return null;
}

function claudeSessionId(
  root: string,
  filePath: string,
  activeProjectsRoot: boolean,
): string {
  const relativeId = stripJsonlExt(relative(root, filePath));
  const parts = relativeId.split(/[\\/]+/).filter(Boolean);

  if (activeProjectsRoot && parts.length === 2) {
    return basename(filePath, ".jsonl");
  }
  if (!activeProjectsRoot && parts.at(-1) === parts.at(-2)) {
    return parts.at(-1)!;
  }
  if (!activeProjectsRoot && parts.length === 1) {
    return basename(filePath, ".jsonl");
  }

  return parts.join("/");
}

function stripJsonlExt(path: string): string {
  return path.endsWith(".jsonl") ? path.slice(0, -".jsonl".length) : path;
}

function findJsonlFiles(root: string): string[] {
  const files: string[] = [];
  const entries = safeReaddir(root);

  for (const entry of entries) {
    const fullPath = join(root, entry);
    if (isDir(fullPath)) {
      files.push(...findJsonlFiles(fullPath));
    } else if (entry.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }

  return files;
}

function inferActiveProject(root: string, filePath: string): string {
  const relative = filePath.slice(root.length + 1);
  const projectSlug = relative.split("/")[0] || "root";
  return normalizeProjectSlug(projectSlug);
}

export function inferArchiveProject(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  const archiveIndex = parts.findIndex((p) => p.startsWith("archive-"));
  if (archiveIndex > 0) return normalizeProjectSlug(parts[archiveIndex - 1]!);

  const claudeArchiveIndex = parts.indexOf(".claude-archive");
  if (claudeArchiveIndex >= 0 && parts[claudeArchiveIndex + 1]) {
    return normalizeProjectSlug(parts[claudeArchiveIndex + 1]!);
  }

  return normalizeProjectSlug(parts.at(-2) || "root");
}

function normalizeProjectSlug(slug: string): string {
  return slug
    .replace(/^Users-[^-]+-/, "")
    .replace(/^-Users-[^-]+-/, "")
    .replace(/-/g, "/");
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

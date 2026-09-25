/**
 * Cursor CLI JSONL parser.
 *
 * Parses ~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl
 *
 * Cursor transcripts have NO native token counts. We estimate API-equivalent
 * tokens from the transcript itself (≈4 chars/token):
 * - assistant output includes text plus tool_use payloads
 * - assistant input is the replayed visible transcript context before each turn
 *
 * Cache metrics are always 0 — Cursor doesn't expose cache data in transcripts.
 * Model is unknown — transcripts don't include model info, defaults to "cursor-auto".
 */

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { basename, dirname, join, relative } from "path";

const CHARS_PER_TOKEN = 4;

export interface CursorSessionUsage {
  sessionId: string;
  project: string;
  model: string;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  userMessages: number;
  assistantMessages: number;
  apiCalls: number;
  costUsd: number;
}

/**
 * Parse a single Cursor JSONL session from its lines.
 */
export function parseCursorSession(
  lines: string[],
  sessionUuid: string,
  projectSlug: string,
): CursorSessionUsage {
  let userMessages = 0;
  let assistantMessages = 0;
  let inputChars = 0;
  let outputChars = 0;
  let contextChars = 0;
  let timestamp = "";

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!timestamp && typeof obj.timestamp === "string") {
        timestamp = obj.timestamp;
      }

      const role = obj.role;
      const content = obj.message?.content;
      if (!Array.isArray(content)) continue;

      const charCount = countContentChars(content);

      if (role === "user") {
        userMessages++;
        contextChars += charCount;
      } else if (role === "assistant") {
        assistantMessages++;
        inputChars += contextChars;
        outputChars += charCount;
        contextChars += charCount;
      }
    } catch {
      /* skip malformed lines */
    }
  }

  // Normalize project slug: "Users-<username>-Gits-songscript" → "Gits/songscript"
  // Strip the leading "Users-<username>-" prefix generically (any username)
  const project = projectSlug.replace(/^Users-[^-]+-/, "").replace(/-/g, "/");

  return {
    sessionId: sessionUuid,
    project,
    model: "cursor-auto", // Cursor transcripts don't expose model info
    timestamp,
    inputTokens: Math.ceil(inputChars / CHARS_PER_TOKEN),
    outputTokens: Math.ceil(outputChars / CHARS_PER_TOKEN),
    cacheReadTokens: 0, // Not available in Cursor transcripts
    cacheCreateTokens: 0,
    userMessages,
    assistantMessages,
    apiCalls: assistantMessages, // Each assistant response = 1 API call
    costUsd: 0, // calculated by caller
  };
}

function countContentChars(content: unknown[]): number {
  let charCount = 0;

  for (const block of content) {
    if (!block || typeof block !== "object") continue;

    const record = block as Record<string, unknown>;
    if (record.type === "text") {
      if (typeof record.text === "string") {
        charCount += record.text.length;
      }
      continue;
    }

    if (record.type === "tool_use") {
      if (typeof record.name === "string") {
        charCount += record.name.length;
      }
      charCount += stableSerializedLength(record.input);
    }
  }

  return charCount;
}

function stableSerializedLength(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return JSON.stringify(value)?.length || 0;
  } catch {
    return 0;
  }
}

/**
 * Scan ~/.cursor/projects/ for all agent transcript sessions since cutoffDate.
 */
export function scanCursorSessions(
  cutoffDate: Date,
  projectsDir?: string,
): CursorSessionUsage[] {
  const home = process.env.HOME;
  if (!home && !projectsDir) return [];

  const root = projectsDir || join(home!, ".cursor", "projects");
  if (!existsSync(root)) return [];

  const sessions: CursorSessionUsage[] = [];
  const projectDirs = safeReaddir(root);

  for (const projectSlug of projectDirs) {
    const projectDir = join(root, projectSlug);
    sessions.push(...scanCursorProject(projectDir, projectSlug, cutoffDate));
  }

  return sessions;
}

export function scanCursorRoots(
  roots: string[],
  cutoffDate: Date,
): CursorSessionUsage[] {
  const sessions: CursorSessionUsage[] = [];

  for (const root of roots) {
    if (!isDir(root)) continue;

    if (isDir(join(root, "agent-transcripts"))) {
      sessions.push(...scanCursorProject(root, basename(root), cutoffDate));
    } else if (isCursorTranscriptRoot(root)) {
      sessions.push(
        ...scanCursorTranscriptRoot(root, basename(dirname(root)), cutoffDate),
      );
    } else {
      sessions.push(...scanCursorSessions(cutoffDate, root));
    }
  }

  return sessions;
}

export function scanCursorProject(
  projectDir: string,
  projectSlug: string,
  cutoffDate: Date,
): CursorSessionUsage[] {
  const transcriptsDir = join(projectDir, "agent-transcripts");
  if (!isDir(transcriptsDir)) return [];

  return scanCursorTranscriptRoot(transcriptsDir, projectSlug, cutoffDate);
}

function scanCursorTranscriptRoot(
  transcriptsDir: string,
  projectSlug: string,
  cutoffDate: Date,
): CursorSessionUsage[] {
  const sessions: CursorSessionUsage[] = [];
  const jsonlFiles = findJsonlFiles(transcriptsDir);

  for (const jsonlFile of jsonlFiles) {
    let mtime: Date;
    try {
      mtime = statSync(jsonlFile).mtime;
    } catch {
      continue;
    }

    try {
      const content = readFileSync(jsonlFile, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      const session = parseCursorSession(
        lines,
        cursorSessionId(transcriptsDir, jsonlFile),
        projectSlug,
      );

      const sessionTime = Date.parse(session.timestamp || "");
      if (!session.timestamp || Number.isNaN(sessionTime)) {
        session.timestamp = mtime.toISOString();
      }
      if (Date.parse(session.timestamp) < cutoffDate.getTime()) continue;

      if (session.apiCalls > 0) {
        sessions.push(session);
      }
    } catch {
      /* skip unreadable */
    }
  }

  return sessions;
}

function cursorSessionId(transcriptsDir: string, jsonlFile: string): string {
  const relativeId = stripJsonlExt(relative(transcriptsDir, jsonlFile));
  const parts = relativeId.split(/[\\/]+/).filter(Boolean);

  if (parts.length === 2 && parts[0] === parts[1]) {
    return parts[0]!;
  }

  return parts.join("/");
}

function stripJsonlExt(path: string): string {
  return path.endsWith(".jsonl") ? path.slice(0, -".jsonl".length) : path;
}

function isCursorTranscriptRoot(root: string): boolean {
  return safeReaddir(root).some((entry) => {
    const sessionDir = join(root, entry);
    if (!isDir(sessionDir)) return false;
    if (isDir(join(sessionDir, "agent-transcripts"))) return false;
    return findJsonlFiles(sessionDir).length > 0;
  });
}

function findJsonlFiles(root: string): string[] {
  const files: string[] = [];
  const entries = safeReaddir(root);

  for (const entry of entries) {
    const path = join(root, entry);
    if (isDir(path)) {
      files.push(...findJsonlFiles(path));
    } else if (entry.endsWith(".jsonl")) {
      files.push(path);
    }
  }

  return files;
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

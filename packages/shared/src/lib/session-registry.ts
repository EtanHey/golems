/**
 * Per-Repo Session Registry
 *
 * Maps repos to their Claude session configuration:
 * - Session name (for --resume)
 * - Personality/role description
 * - Emoji for terminal tabs
 * - MCP servers needed
 * - Private flag (won't show on website)
 *
 * Used by: NightShift, golems sessions CLI, iTerm tab naming
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

// ─── Types ─────────────────────────────────────────────────────────

export interface RepoSession {
  /** Repo directory name under reposPath */
  repo: string;
  /** Display emoji for terminal/iTerm tabs */
  emoji: string;
  /** Short role description */
  personality: string;
  /** Claude --resume session name */
  sessionName: string;
  /** MCP servers this repo uses */
  mcpServers: string[];
  /** Don't show on public website */
  private: boolean;
  /** Full path to repo (resolved at runtime) */
  path?: string;
}

export interface ActiveSession {
  pid: number;
  repo: string;
  cpu: string;
  memory: string;
  started: string;
  session?: RepoSession;
}

// ─── Registry ──────────────────────────────────────────────────────

const REGISTRY: RepoSession[] = [
  {
    repo: "golems",
    emoji: "🧿",
    personality: "Golem ecosystem architect",
    sessionName: "golems-claude",
    mcpServers: ["zikaron", "golems-email", "golems-jobs"],
    private: false,
  },
  {
    repo: "songscript",
    emoji: "🎵",
    personality: "WhisperX music pipeline specialist",
    sessionName: "songscript-claude",
    mcpServers: [],
    private: true,
  },
  {
    repo: "zikaron",
    emoji: "🧠",
    personality: "Memory system maintainer",
    sessionName: "zikaron-claude",
    mcpServers: ["zikaron"],
    private: false,
  },
  {
    repo: "taskowl",
    emoji: "🏠",
    personality: "Real estate app developer",
    sessionName: "taskowl-claude",
    mcpServers: [],
    private: true,
  },
  {
    repo: "union",
    emoji: "🤝",
    personality: "Union platform developer",
    sessionName: "union-claude",
    mcpServers: [],
    private: false,
  },
  {
    repo: "etanheyman.com",
    emoji: "🌐",
    personality: "Portfolio site developer",
    sessionName: "portfolio-claude",
    mcpServers: [],
    private: false,
  },
  {
    repo: "rudy",
    emoji: "📦",
    personality: "Rudy monorepo maintainer",
    sessionName: "rudy-claude",
    mcpServers: [],
    private: false,
  },
];

/** Get all registered repo sessions */
export function getRegistry(): RepoSession[] {
  return REGISTRY;
}

/** Get public repos only (for website display) */
export function getPublicRepos(): RepoSession[] {
  return REGISTRY.filter((r) => !r.private);
}

/** Get session config for a specific repo */
export function getRepoSession(repo: string): RepoSession | undefined {
  return REGISTRY.find(
    (r) => r.repo === repo || r.repo === repo.replace(/^golems\/packages\//, "")
  );
}

/** Resolve full paths for all repos given a base path */
export function resolveRepoPaths(reposPath: string): RepoSession[] {
  return REGISTRY.map((r) => {
    // Handle golems monorepo
    const fullPath =
      r.repo === "golems"
        ? join(reposPath, "golems")
        : join(reposPath, r.repo);

    return {
      ...r,
      path: existsSync(fullPath) ? fullPath : undefined,
    };
  });
}

// ─── Active Session Detection ──────────────────────────────────────

/** Find currently running Claude processes and match to repos */
export function getActiveSessions(): ActiveSession[] {
  try {
    const output = execSync(
      'ps aux | grep "[c]laude " | grep -v grep',
      { encoding: "utf-8" }
    ).trim();

    if (!output) return [];

    return output.split("\n").map((line) => {
      const parts = line.split(/\s+/);
      const pid = parseInt(parts[1], 10);
      const cpu = parts[2];
      const memory = parts[3];
      const started = parts[8];

      // Try to detect which repo from the command/cwd
      const fullLine = parts.slice(10).join(" ");
      let repo = "unknown";
      for (const session of REGISTRY) {
        if (fullLine.includes(session.repo) || fullLine.includes(session.sessionName)) {
          repo = session.repo;
          break;
        }
      }

      return {
        pid,
        repo,
        cpu,
        memory,
        started,
        session: getRepoSession(repo),
      };
    });
  } catch {
    return [];
  }
}

// ─── iTerm Integration ─────────────────────────────────────────────

/**
 * Set iTerm tab title via AppleScript.
 * No-op on non-macOS or if iTerm isn't running.
 */
export function setITermTabTitle(title: string): boolean {
  if (process.platform !== "darwin") return false;

  try {
    execSync(
      `osascript -e 'tell application "iTerm2" to tell current session of current window to set name to "${title}"'`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Set iTerm tab title with repo emoji + name.
 * Example: "🧿 golems" or "🎵 songscript"
 */
export function setRepoTabTitle(repo: string): boolean {
  const session = getRepoSession(repo);
  if (!session) return false;
  return setITermTabTitle(`${session.emoji} ${session.repo}`);
}

// ─── Formatter ─────────────────────────────────────────────────────

export function formatRegistry(sessions: RepoSession[]): string {
  const maxRepoLen = Math.max(...sessions.map((s) => s.repo.length), 4);
  const maxPersLen = Math.max(...sessions.map((s) => s.personality.length), 11);

  const header = `${"".padEnd(3)} ${"Repo".padEnd(maxRepoLen)}  ${"Personality".padEnd(maxPersLen)}  Session Name          MCPs`;
  const separator = "─".repeat(header.length);

  const rows = sessions.map((s) => {
    const exists = s.path ? "✓" : "·";
    const mcps = s.mcpServers.length > 0 ? s.mcpServers.join(", ") : "—";
    return `${s.emoji}  ${s.repo.padEnd(maxRepoLen)}  ${s.personality.padEnd(maxPersLen)}  ${s.sessionName.padEnd(20)}  ${mcps}  ${exists}`;
  });

  return [header, separator, ...rows].join("\n");
}

export function formatActiveSessions(sessions: ActiveSession[]): string {
  if (sessions.length === 0) return "No active Claude sessions.";

  const header = "PID      CPU    Repo          Started";
  const separator = "─".repeat(header.length);

  const rows = sessions.map((s) => {
    const emoji = s.session?.emoji || "?";
    return `${String(s.pid).padEnd(8)} ${s.cpu.padStart(5)}%  ${emoji} ${s.repo.padEnd(12)}  ${s.started}`;
  });

  return [header, separator, ...rows].join("\n");
}

import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getRegistry,
  getPublicRepos,
  getRepoSession,
  resolveRepoPaths,
  formatRegistry,
  formatActiveSessions,
  type RepoSession,
  type ActiveSession,
} from "@golems/shared/lib/session-registry";

describe("session-registry", () => {
  test("getRegistry returns all repos", () => {
    const registry = getRegistry();
    expect(registry.length).toBeGreaterThanOrEqual(4);
    expect(registry.find((r) => r.repo === "golems")).toBeDefined();
    expect(registry.find((r) => r.repo === "songscript")).toBeDefined();
    expect(registry.find((r) => r.repo === "zikaron")).toBeDefined();
  });

  test("getPublicRepos excludes private repos", () => {
    const pub = getPublicRepos();
    const priv = getRegistry().filter((r) => r.private);

    for (const p of priv) {
      expect(pub.find((r) => r.repo === p.repo)).toBeUndefined();
    }
    expect(pub.length).toBeLessThan(getRegistry().length);
  });

  test("getRepoSession finds by name", () => {
    const golems = getRepoSession("golems");
    expect(golems).toBeDefined();
    expect(golems!.emoji).toBe("🧿");
    expect(golems!.sessionName).toBe("golems-claude");
    expect(golems!.mcpServers).toContain("zikaron");
  });

  test("getRepoSession returns undefined for unknown repo", () => {
    expect(getRepoSession("nonexistent")).toBeUndefined();
  });

  test("every session has required fields", () => {
    for (const session of getRegistry()) {
      expect(session.repo).toBeTruthy();
      expect(session.emoji).toBeTruthy();
      expect(session.personality).toBeTruthy();
      expect(session.sessionName).toBeTruthy();
      expect(Array.isArray(session.mcpServers)).toBe(true);
      expect(typeof session.private).toBe("boolean");
    }
  });

  test("session names follow repo-claude pattern", () => {
    for (const session of getRegistry()) {
      expect(session.sessionName).toMatch(/-claude$/);
    }
  });

  test("resolveRepoPaths marks existing repos", () => {
    const testDir = join(tmpdir(), `golems-session-test-${Date.now()}`);
    mkdirSync(join(testDir, "golems"), { recursive: true });
    mkdirSync(join(testDir, "zikaron"), { recursive: true });

    const resolved = resolveRepoPaths(testDir);
    const golems = resolved.find((r) => r.repo === "golems");
    const zikaron = resolved.find((r) => r.repo === "zikaron");
    const songscript = resolved.find((r) => r.repo === "songscript");

    expect(golems!.path).toBeTruthy();
    expect(zikaron!.path).toBeTruthy();
    expect(songscript!.path).toBeUndefined(); // doesn't exist in temp dir

    rmSync(testDir, { recursive: true, force: true });
  });

  test("formatRegistry produces table output", () => {
    const sessions = getPublicRepos();
    const formatted = formatRegistry(sessions);
    expect(formatted).toContain("Repo");
    expect(formatted).toContain("Personality");
    expect(formatted).toContain("golems");
    expect(formatted).toContain("🧿");
  });

  test("formatActiveSessions handles empty array", () => {
    expect(formatActiveSessions([])).toBe("No active Claude sessions.");
  });

  test("formatActiveSessions formats session data", () => {
    const sessions: ActiveSession[] = [
      {
        pid: 12345,
        repo: "golems",
        cpu: "5.2",
        memory: "1.3",
        started: "10:30",
        session: getRepoSession("golems"),
      },
    ];
    const formatted = formatActiveSessions(sessions);
    expect(formatted).toContain("12345");
    expect(formatted).toContain("golems");
    expect(formatted).toContain("🧿");
  });
});

import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import {
  parseCursorSession,
  scanCursorProject,
  scanCursorRoots,
  scanCursorSessions,
} from "../parsers/cursor";

// ── Fixtures: real Cursor JSONL structure ─────────────────────────

const USER_MSG = JSON.stringify({
  role: "user",
  message: {
    content: [
      {
        type: "text",
        text: "Fix the authentication bug in the login flow. The session token is not being refreshed properly.",
      },
    ],
  },
});

const ASSISTANT_MSG = JSON.stringify({
  role: "assistant",
  message: {
    content: [
      {
        type: "text",
        text: "I'll fix the authentication bug. The issue is that the session token refresh logic in `auth.ts` isn't checking the expiry timestamp correctly. Let me update the refresh function to compare against the current time minus a 30-second buffer.",
      },
    ],
  },
});

const ASSISTANT_MSG_2 = JSON.stringify({
  role: "assistant",
  message: {
    content: [
      {
        type: "text",
        text: "Done! I've updated the token refresh logic. The fix ensures tokens are refreshed 30 seconds before expiry rather than after. This prevents the race condition where requests would fail during the brief window between token expiry and refresh completion.",
      },
    ],
  },
});

const ASSISTANT_TOOL_USE = JSON.stringify({
  role: "assistant",
  message: {
    content: [
      {
        type: "text",
        text: "Writing the report.",
      },
      {
        type: "tool_use",
        name: "Write",
        input: {
          path: "/tmp/report.md",
          contents: "x".repeat(800),
        },
      },
    ],
  },
});

describe("Cursor Parser — parseCursorSession", () => {
  test("counts user and assistant messages", () => {
    const lines = [USER_MSG, ASSISTANT_MSG, ASSISTANT_MSG_2];
    const result = parseCursorSession(
      lines,
      "c171af3d-772b-42ab-8acb-d4a6533233db",
      "Users-etanheyman-Gits-songscript",
    );

    expect(result.userMessages).toBe(1);
    expect(result.assistantMessages).toBe(2);
    expect(result.apiCalls).toBe(2); // = assistant messages
  });

  test("estimates tokens from content length (≈4 chars/token)", () => {
    const lines = [USER_MSG, ASSISTANT_MSG];
    const result = parseCursorSession(
      lines,
      "test-uuid",
      "Users-etanheyman-Gits-songscript",
    );

    // User msg: ~93 chars ≈ 23 tokens
    // Assistant msg: ~261 chars ≈ 65 tokens
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    // Input tokens come from user messages, output from assistant
    expect(result.inputTokens).toBeLessThan(result.outputTokens); // assistant wrote more
  });

  test("counts tool_use payloads as assistant output", () => {
    const result = parseCursorSession(
      [USER_MSG, ASSISTANT_TOOL_USE],
      "tool-use-session",
      "Users-etanheyman-Gits-golems",
    );

    expect(result.outputTokens).toBeGreaterThan(180);
    expect(result.assistantMessages).toBe(1);
    expect(result.apiCalls).toBe(1);
  });

  test("estimates assistant input as replayed transcript context per API call", () => {
    const user = JSON.stringify({
      role: "user",
      message: { content: [{ type: "text", text: "u".repeat(100) }] },
    });
    const assistantOne = JSON.stringify({
      role: "assistant",
      message: { content: [{ type: "text", text: "a".repeat(40) }] },
    });
    const assistantTwo = JSON.stringify({
      role: "assistant",
      message: { content: [{ type: "text", text: "b".repeat(20) }] },
    });

    const result = parseCursorSession(
      [user, assistantOne, assistantTwo],
      "replay-session",
      "Users-etanheyman-Gits-golems",
    );

    // First assistant call sees 100 chars. Second sees 100 + 40 chars.
    expect(result.inputTokens).toBe(Math.ceil(240 / 4));
    expect(result.outputTokens).toBe(Math.ceil(60 / 4));
  });

  test("extracts project slug from directory name", () => {
    const lines = [USER_MSG, ASSISTANT_MSG];
    const result = parseCursorSession(
      lines,
      "uuid-123",
      "Users-etanheyman-Gits-songscript",
    );

    expect(result.project).toBe("Gits/songscript");
  });

  test("handles empty session gracefully", () => {
    const result = parseCursorSession([], "empty-uuid", "test-project");

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.apiCalls).toBe(0);
    expect(result.userMessages).toBe(0);
    expect(result.assistantMessages).toBe(0);
  });

  test("cacheReadTokens and cacheCreateTokens are always 0 (no native cache data)", () => {
    const lines = [USER_MSG, ASSISTANT_MSG];
    const result = parseCursorSession(lines, "uuid", "project");

    // Cursor transcripts don't expose cache metrics
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheCreateTokens).toBe(0);
  });

  test("model defaults to 'cursor-auto' when not detectable", () => {
    const lines = [USER_MSG, ASSISTANT_MSG];
    const result = parseCursorSession(lines, "uuid", "project");

    // Cursor transcripts don't include model info
    expect(result.model).toBe("cursor-auto");
  });

  test("sessionId comes from the uuid parameter", () => {
    const lines = [USER_MSG];
    const result = parseCursorSession(
      lines,
      "c171af3d-772b-42ab-8acb-d4a6533233db",
      "project",
    );
    expect(result.sessionId).toBe("c171af3d-772b-42ab-8acb-d4a6533233db");
  });

  test("scans nested subagent JSONLs under agent-transcripts", () => {
    const root = mkdtempSync(join(tmpdir(), "cursor-parser-"));
    const projectSlug = "Users-etanheyman-Gits-golems";
    const projectDir = join(root, projectSlug);
    const sessionDir = join(
      projectDir,
      "agent-transcripts",
      "parent-session",
    );
    const subagentsDir = join(sessionDir, "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(join(sessionDir, "parent-session.jsonl"), USER_MSG);
    writeFileSync(
      join(subagentsDir, "subagent-session.jsonl"),
      `${USER_MSG}\n${ASSISTANT_MSG}\n`,
    );

    const sessions = scanCursorProject(
      projectDir,
      projectSlug,
      new Date("2000-01-01"),
    );

    expect(sessions.map((s) => s.sessionId)).toContain(
      "parent-session/subagents/subagent-session",
    );
    expect(
      sessions.find(
        (s) => s.sessionId === "parent-session/subagents/subagent-session",
      )?.project,
    )
      .toBe("Gits/golems");
  });

  test("keeps nested JSONL session ids unique when basenames collide", () => {
    const root = mkdtempSync(join(tmpdir(), "cursor-collide-"));
    const projectSlug = "Users-etanheyman-Gits-golems";
    const projectDir = join(root, projectSlug);

    mkdirSync(
      join(projectDir, "agent-transcripts", "parent-a", "subagents"),
      { recursive: true },
    );
    mkdirSync(
      join(projectDir, "agent-transcripts", "parent-b", "subagents"),
      { recursive: true },
    );
    writeFileSync(
      join(
        projectDir,
        "agent-transcripts",
        "parent-a",
        "subagents",
        "agent.jsonl",
      ),
      `${USER_MSG}\n${ASSISTANT_MSG}\n`,
    );
    writeFileSync(
      join(
        projectDir,
        "agent-transcripts",
        "parent-b",
        "subagents",
        "agent.jsonl",
      ),
      `${USER_MSG}\n${ASSISTANT_MSG}\n`,
    );

    const sessions = scanCursorProject(
      projectDir,
      projectSlug,
      new Date("2000-01-01"),
    );

    expect(sessions.map((s) => s.sessionId).sort()).toEqual([
      "parent-a/subagents/agent",
      "parent-b/subagents/agent",
    ]);
  });

  test("scans archive roots containing project dirs or a direct project dir", () => {
    const root = mkdtempSync(join(tmpdir(), "cursor-archive-"));
    const projectSlug = "Users-etanheyman-Gits-golems";
    const projectDir = join(root, "projects", projectSlug);
    const directProjectDir = join(root, "direct-project");

    mkdirSync(
      join(projectDir, "agent-transcripts", "archive-session"),
      { recursive: true },
    );
    mkdirSync(
      join(directProjectDir, "agent-transcripts", "direct-session"),
      { recursive: true },
    );
    writeFileSync(
      join(
        projectDir,
        "agent-transcripts",
        "archive-session",
        "archive-session.jsonl",
      ),
      `${USER_MSG}\n${ASSISTANT_MSG}\n`,
    );
    writeFileSync(
      join(
        directProjectDir,
        "agent-transcripts",
        "direct-session",
        "direct-session.jsonl",
      ),
      `${USER_MSG}\n${ASSISTANT_MSG}\n`,
    );

    const sessions = scanCursorRoots(
      [join(root, "projects"), directProjectDir],
      new Date("2000-01-01"),
    );

    expect(sessions.map((s) => s.sessionId)).toContain("archive-session");
    expect(sessions.map((s) => s.sessionId)).toContain("direct-session");
  });

  test("scans an agent-transcripts directory passed as the archive root", () => {
    const root = mkdtempSync(join(tmpdir(), "cursor-direct-transcripts-"));
    const projectSlug = "Users-etanheyman-Gits-golems";
    const transcriptsDir = join(root, projectSlug, "agent-transcripts");

    mkdirSync(join(transcriptsDir, "direct-root-session"), { recursive: true });
    writeFileSync(
      join(
        transcriptsDir,
        "direct-root-session",
        "direct-root-session.jsonl",
      ),
      `${USER_MSG}\n${ASSISTANT_MSG}\n`,
    );

    const sessions = scanCursorRoots(
      [transcriptsDir],
      new Date("2000-01-01"),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe("direct-root-session");
    expect(sessions[0]?.project).toBe("Gits/golems");
  });

  test("detects direct transcript roots with only nested subagent JSONLs", () => {
    const root = mkdtempSync(join(tmpdir(), "cursor-nested-transcripts-"));
    const projectSlug = "Users-etanheyman-Gits-golems";
    const transcriptsDir = join(root, projectSlug, "agent-transcripts");
    const sessionPath = join(
      transcriptsDir,
      "parent-session",
      "subagents",
      "worker",
      "worker-session.jsonl",
    );

    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, `${USER_MSG}\n${ASSISTANT_MSG}\n`);

    const sessions = scanCursorRoots(
      [transcriptsDir],
      new Date("2000-01-01"),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(
      "parent-session/subagents/worker/worker-session",
    );
    expect(sessions[0]?.project).toBe("Gits/golems");
  });

  test("scans archived transcripts when backup mtimes are older than cutoff", () => {
    const root = mkdtempSync(join(tmpdir(), "cursor-old-mtime-"));
    const projectSlug = "Users-etanheyman-Gits-golems";
    const sessionPath = join(
      root,
      projectSlug,
      "agent-transcripts",
      "old-mtime-session",
      "old-mtime-session.jsonl",
    );
    const userWithTimestamp = {
      ...JSON.parse(USER_MSG),
      timestamp: "2026-03-10T12:00:00.000Z",
    };
    const assistantWithTimestamp = {
      ...JSON.parse(ASSISTANT_MSG),
      timestamp: "2026-03-10T12:01:00.000Z",
    };
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(
      sessionPath,
      `${JSON.stringify(userWithTimestamp)}\n${JSON.stringify(assistantWithTimestamp)}\n`,
    );
    const oldMtime = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(sessionPath, oldMtime, oldMtime);

    const sessions = scanCursorRoots([root], new Date("2026-01-01"));

    expect(sessions.map((s) => s.sessionId)).toContain("old-mtime-session");
  });

  test("falls back to mtime when transcript timestamp is invalid", () => {
    const root = mkdtempSync(join(tmpdir(), "cursor-invalid-timestamp-"));
    const projectSlug = "Users-etanheyman-Gits-golems";
    const sessionPath = join(
      root,
      projectSlug,
      "agent-transcripts",
      "bad-timestamp-session",
      "bad-timestamp-session.jsonl",
    );
    const userWithBadTimestamp = {
      ...JSON.parse(USER_MSG),
      timestamp: "not-a-date",
    };
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(
      sessionPath,
      `${JSON.stringify(userWithBadTimestamp)}\n${ASSISTANT_MSG}\n`,
    );
    const oldMtime = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(sessionPath, oldMtime, oldMtime);

    const sessions = scanCursorRoots([root], new Date("2026-01-01"));

    expect(sessions.map((s) => s.sessionId)).not.toContain(
      "bad-timestamp-session",
    );
  });
});

describe("Cursor Parser — scanCursorSessions", () => {
  test("scans Cursor sessions directory structure", () => {
    const originalHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "cursor-home-"));
    const sessionPath = join(
      home,
      ".cursor",
      "projects",
      "Users-etanheyman-Gits-golems",
      "agent-transcripts",
      "home-session",
      "home-session.jsonl",
    );
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, `${USER_MSG}\n${ASSISTANT_MSG}\n`);

    try {
      process.env.HOME = home;
      const cutoff = new Date("2026-01-01");
      const sessions = scanCursorSessions(cutoff);

      expect(sessions.length).toBeGreaterThan(0);

      for (const s of sessions) {
        expect(s.sessionId).toBeTruthy();
        expect(s.project).toBeTruthy();
        expect(typeof s.inputTokens).toBe("number");
        expect(typeof s.outputTokens).toBe("number");
        expect(s.cacheReadTokens).toBe(0);
        expect(s.cacheCreateTokens).toBe(0);
      }
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });
});

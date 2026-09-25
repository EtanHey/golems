import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import {
  inferArchiveProject,
  parseClaudeSession,
  scanClaudeRoots,
} from "../parsers/claude";

const ASSISTANT_WITH_USAGE = JSON.stringify({
  type: "assistant",
  timestamp: "2026-03-10T12:00:00.000Z",
  message: {
    model: "claude-sonnet-4-6",
    usage: {
      input_tokens: 100,
      output_tokens: 25,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 50,
    },
  },
});

const ASSISTANT_WITH_USAGE_NO_TIMESTAMP = JSON.stringify({
  type: "assistant",
  message: {
    model: "claude-sonnet-4-6",
    usage: {
      input_tokens: 100,
      output_tokens: 25,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 50,
    },
  },
});

describe("Claude Parser", () => {
  test("parses assistant usage totals", () => {
    const session = parseClaudeSession(
      [ASSISTANT_WITH_USAGE, ASSISTANT_WITH_USAGE],
      "session-id",
      "golems",
    );

    expect(session.apiCalls).toBe(2);
    expect(session.inputTokens).toBe(200);
    expect(session.outputTokens).toBe(50);
    expect(session.cacheReadTokens).toBe(2000);
    expect(session.cacheCreateTokens).toBe(100);
  });

  test("deduplicates repeated streaming snapshots by message id", () => {
    const message = (outputTokens: number) =>
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-10T12:00:00.000Z",
        message: {
          id: "msg-repeated",
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 100,
            output_tokens: outputTokens,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 50,
          },
        },
      });

    const session = parseClaudeSession(
      [message(10), message(25), message(25)],
      "session-id",
      "golems",
    );

    expect(session.apiCalls).toBe(1);
    expect(session.inputTokens).toBe(100);
    expect(session.outputTokens).toBe(25);
    expect(session.cacheReadTokens).toBe(1000);
    expect(session.cacheCreateTokens).toBe(50);
  });

  test("sums distinct message ids after deduplicating each stream", () => {
    const message = (id: string, inputTokens: number, outputTokens: number) =>
      JSON.stringify({
        type: "assistant",
        message: {
          id,
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
        },
      });

    const session = parseClaudeSession(
      [
        message("msg-a", 100, 10),
        message("msg-a", 100, 20),
        message("msg-b", 200, 30),
      ],
      "session-id",
      "golems",
    );

    expect(session.apiCalls).toBe(2);
    expect(session.inputTokens).toBe(300);
    expect(session.outputTokens).toBe(50);
  });

  test("infers archive project before archive-* segment", () => {
    const project = inferArchiveProject(
      "/Users/example/.claude-archive/brainlayer/archive-2026-03-10T02-00-01/session/subagents/agent.jsonl",
    );

    expect(project).toBe("brainlayer");
  });

  test("scans nested archived subagent JSONLs", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-parser-"));
    const subagentPath = join(
      root,
      "golems",
      "archive-2026-03-10T02-00-01",
      "parent-session",
      "subagents",
      "agent-a.jsonl",
    );
    mkdirSync(dirname(subagentPath), { recursive: true });
    writeFileSync(subagentPath, `${ASSISTANT_WITH_USAGE}\n`);

    const sessions = scanClaudeRoots([root], new Date("2026-03-01"));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.project).toBe("golems");
    expect(sessions[0]!.sessionId).toBe(
      "golems/archive-2026-03-10T02-00-01/parent-session/subagents/agent-a",
    );
  });

  test("uses in-file timestamps when archive mtimes are older than cutoff", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-old-mtime-"));
    const sessionPath = join(
      root,
      "golems",
      "archive-2026-03-10T02-00-01",
      "session-old-mtime",
      "session-old-mtime.jsonl",
    );
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, `${ASSISTANT_WITH_USAGE}\n`);
    const oldMtime = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(sessionPath, oldMtime, oldMtime);

    const sessions = scanClaudeRoots([root], new Date("2026-03-01"));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe("session-old-mtime");
  });

  test("sets timestamp from mtime fallback when transcript has no timestamp", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-mtime-fallback-"));
    const sessionPath = join(
      root,
      "golems",
      "archive-2026-03-10T02-00-01",
      "session-mtime",
      "session-mtime.jsonl",
    );
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, `${ASSISTANT_WITH_USAGE_NO_TIMESTAMP}\n`);
    const mtime = new Date("2026-03-10T13:00:00.000Z");
    utimesSync(sessionPath, mtime, mtime);

    const sessions = scanClaudeRoots([root], new Date("2026-03-01"));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.timestamp).toBe("2026-03-10T13:00:00.000Z");
  });

  test("preserves canonical archived session ids to dedupe against live sessions", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-archive-session-"));
    const sessionPath = join(
      root,
      "golems",
      "archive-2026-03-10T02-00-01",
      "session-123",
      "session-123.jsonl",
    );
    mkdirSync(dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, `${ASSISTANT_WITH_USAGE}\n`);

    const sessions = scanClaudeRoots([root], new Date("2026-03-01"));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe("session-123");
  });

  test("keeps nested JSONL session ids unique when basenames collide", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-collide-"));
    const firstPath = join(
      root,
      "golems",
      "archive-2026-03-10T02-00-01",
      "parent-a",
      "subagents",
      "agent.jsonl",
    );
    const secondPath = join(
      root,
      "golems",
      "archive-2026-03-10T02-00-01",
      "parent-b",
      "subagents",
      "agent.jsonl",
    );
    mkdirSync(dirname(firstPath), { recursive: true });
    mkdirSync(dirname(secondPath), { recursive: true });
    writeFileSync(firstPath, `${ASSISTANT_WITH_USAGE}\n`);
    writeFileSync(secondPath, `${ASSISTANT_WITH_USAGE}\n`);

    const sessions = scanClaudeRoots([root], new Date("2026-03-01"));

    expect(sessions.map((s) => s.sessionId).sort()).toEqual([
      "golems/archive-2026-03-10T02-00-01/parent-a/subagents/agent",
      "golems/archive-2026-03-10T02-00-01/parent-b/subagents/agent",
    ]);
  });
});

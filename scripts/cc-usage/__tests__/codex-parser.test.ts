import { describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseCodexSession,
  scanCodexRoots,
  scanCodexSessions,
} from "../parsers/codex";

// ── Fixtures: real Codex JSONL structure ──────────────────────────

const SESSION_META = JSON.stringify({
  timestamp: "2026-03-20T17:36:26.467Z",
  type: "session_meta",
  payload: {
    id: "019d0c50-84e0-74e1-9aef-0dec3067a4a1",
    timestamp: "2026-03-20T17:34:56.739Z",
    cwd: "/Users/example/Gits/brainlayer",
    originator: "codex_cli_rs",
    cli_version: "0.114.0",
    source: "cli",
    model_provider: "openai",
  },
});

const SESSION_META_NO_TIMESTAMP = JSON.stringify({
  type: "session_meta",
  payload: {
    id: "019d0c50-84e0-74e1-9aef-0dec3067a4a1",
    cwd: "/Users/example/Gits/brainlayer",
    originator: "codex_cli_rs",
    cli_version: "0.114.0",
    source: "cli",
    model_provider: "openai",
  },
});

const TURN_CONTEXT = JSON.stringify({
  timestamp: "2026-03-20T17:36:26.469Z",
  type: "turn_context",
  payload: {
    turn_id: "019d0c51-e34e-7391-b891-3d7399ca6c5b",
    cwd: "/Users/example/Gits/brainlayer",
    model: "gpt-5.4",
  },
});

const TOKEN_COUNT_1 = JSON.stringify({
  timestamp: "2026-03-20T17:36:45.650Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: 17116,
        cached_input_tokens: 3456,
        output_tokens: 638,
        reasoning_output_tokens: 516,
        total_tokens: 17754,
      },
      last_token_usage: {
        input_tokens: 17116,
        cached_input_tokens: 3456,
        output_tokens: 638,
        reasoning_output_tokens: 516,
        total_tokens: 17754,
      },
    },
  },
});

const TOKEN_COUNT_2 = JSON.stringify({
  timestamp: "2026-03-20T17:37:10.200Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: 35000,
        cached_input_tokens: 12000,
        output_tokens: 2500,
        reasoning_output_tokens: 1200,
        total_tokens: 37500,
      },
      last_token_usage: {
        input_tokens: 17884,
        cached_input_tokens: 8544,
        output_tokens: 1862,
        reasoning_output_tokens: 684,
        total_tokens: 19746,
      },
    },
  },
});

describe("Codex Parser — parseCodexSession", () => {
  test("extracts session metadata from session_meta event", () => {
    const lines = [SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1];
    const result = parseCodexSession(
      lines,
      "rollout-2026-03-20T17-34-56.jsonl",
    );

    expect(result.sessionId).toBe("019d0c50-84e0-74e1-9aef-0dec3067a4a1");
    expect(result.project).toContain("brainlayer");
    expect(result.model).toBe("gpt-5.4");
    expect(result.timestamp).toBe("2026-03-20T17:34:56.739Z");
  });

  test("uses FINAL token_count (total_token_usage) for session totals", () => {
    // Two token_count events — last one is cumulative, use it
    const lines = [SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1, TOKEN_COUNT_2];
    const result = parseCodexSession(
      lines,
      "rollout-2026-03-20T17-34-56.jsonl",
    );

    // Should use the LAST total_token_usage (cumulative)
    expect(result.inputTokens).toBe(23000);
    expect(result.outputTokens).toBe(2500);
    expect(result.cacheReadTokens).toBe(12000); // cached_input_tokens
    expect(result.reasoningTokens).toBe(1200);
  });

  test("never reports cached input again as fresh input", () => {
    const result = parseCodexSession(
      [SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1],
      "rollout-2026-03-20T17-34-56.jsonl",
    );

    expect(result.inputTokens).toBe(13660);
    expect(result.cacheReadTokens).toBe(3456);
    expect(result.inputTokens + result.cacheReadTokens).toBe(17116);
  });

  test("provider is always openai for Codex sessions", () => {
    const lines = [SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1];
    const result = parseCodexSession(lines, "test.jsonl");
    // Provider is inferred from source, not returned — but model should be openai family
    expect(result.model).toContain("gpt");
  });

  test("handles session with no token_count events gracefully", () => {
    const lines = [SESSION_META, TURN_CONTEXT];
    const result = parseCodexSession(lines, "empty.jsonl");

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.apiCalls).toBe(0);
  });

  test("counts api_calls from number of token_count events", () => {
    const lines = [SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1, TOKEN_COUNT_2];
    const result = parseCodexSession(lines, "test.jsonl");
    expect(result.apiCalls).toBe(2);
  });

  test("extracts model from turn_context payload", () => {
    const customTurn = JSON.stringify({
      timestamp: "2026-03-20T17:36:26.469Z",
      type: "turn_context",
      payload: { model: "gpt-5-codex" },
    });
    const lines = [SESSION_META, customTurn, TOKEN_COUNT_1];
    const result = parseCodexSession(lines, "test.jsonl");
    expect(result.model).toBe("gpt-5-codex");
  });

  test("cacheCreateTokens is 0 for Codex (OpenAI implicit caching)", () => {
    const lines = [SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1];
    const result = parseCodexSession(lines, "test.jsonl");
    // OpenAI uses implicit caching — no explicit cache_creation metric
    expect(result.cacheCreateTokens).toBe(0);
  });
});

describe("Codex Parser — scanCodexSessions", () => {
  test("scans rollout JSONLs from arbitrary archive roots", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-parser-"));
    const archiveDir = join(root, "drive-export");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "rollout-2026-03-20T17-34-56.jsonl"),
      [SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1].join("\n"),
    );

    const sessions = scanCodexRoots([root], new Date("2026-03-01"));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe("019d0c50-84e0-74e1-9aef-0dec3067a4a1");
  });

  test("uses in-file timestamps when archive mtimes are older than cutoff", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-old-mtime-"));
    const archiveDir = join(root, "drive-export");
    const sessionPath = join(archiveDir, "rollout-2026-03-20T17-34-56.jsonl");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      sessionPath,
      [SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1].join("\n"),
    );
    const oldMtime = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(sessionPath, oldMtime, oldMtime);

    const sessions = scanCodexRoots([root], new Date("2026-03-01"));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe("019d0c50-84e0-74e1-9aef-0dec3067a4a1");
  });

  test("sets timestamp from mtime fallback when session metadata has no timestamp", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-mtime-fallback-"));
    const archiveDir = join(root, "drive-export");
    const sessionPath = join(archiveDir, "rollout-2026-03-20T17-34-56.jsonl");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      sessionPath,
      [SESSION_META_NO_TIMESTAMP, TURN_CONTEXT, TOKEN_COUNT_1].join("\n"),
    );
    const mtime = new Date("2026-03-20T18:00:00.000Z");
    utimesSync(sessionPath, mtime, mtime);

    const sessions = scanCodexRoots([root], new Date("2026-03-01"));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.timestamp).toBe("2026-03-20T18:00:00.000Z");
  });

  test("scans Codex sessions directory structure", () => {
    const originalHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "codex-home-"));
    const sessionDir = join(home, ".codex", "sessions", "2026", "03", "20");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "rollout-2026-03-20T17-34-56.jsonl"),
      [SESSION_META, TURN_CONTEXT, TOKEN_COUNT_1].join("\n"),
    );

    try {
      process.env.HOME = home;
      const cutoff = new Date("2026-03-01");
      const sessions = scanCodexSessions(cutoff);

      expect(sessions.length).toBeGreaterThan(0);

      for (const s of sessions) {
        expect(s.sessionId).toBeTruthy();
        expect(s.model).toBeTruthy();
        expect(typeof s.inputTokens).toBe("number");
        expect(typeof s.outputTokens).toBe("number");
        expect(typeof s.cacheReadTokens).toBe("number");
        expect(typeof s.cacheCreateTokens).toBe("number");
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

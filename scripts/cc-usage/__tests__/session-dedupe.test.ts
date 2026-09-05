import { describe, expect, test } from "bun:test";
import {
  canonicalUsageSource,
  dedupeUsageRowsBySession,
  usageSessionKey,
} from "../session-dedupe";
import {
  CURSOR_TRANSCRIPT_REPLAY_V2_METHOD,
  CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
  NATIVE_USAGE_METHOD,
} from "../estimation-methods";

describe("session usage row dedupe", () => {
  test("canonicalizes Cursor source aliases", () => {
    expect(canonicalUsageSource("cursor")).toBe("cursor-cli");
    expect(canonicalUsageSource("cursor-cli")).toBe("cursor-cli");
    expect(canonicalUsageSource("claude-code")).toBe("claude-code");
    expect(canonicalUsageSource(null)).toBe("unknown");
  });

  test("builds project-scoped session keys when project is available", () => {
    expect(usageSessionKey("cursor", "session-1", "repo-a")).toBe(
      "cursor-cli:repo-a:session-1",
    );
    expect(usageSessionKey("cursor-cli", "session-1")).toBe(
      "cursor-cli:session-1",
    );
  });

  test("prefers corrected Cursor replay estimates over older transcript estimates", () => {
    const rows = [
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 0.08,
        metadata: {
          session_id: "session-1",
        },
      },
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 6.54,
        metadata: {
          session_id: "session-1",
          estimation_method: CURSOR_TRANSCRIPT_REPLAY_V2_METHOD,
        },
      },
    ];

    const deduped = dedupeUsageRowsBySession(rows);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].cost_usd).toBe(6.54);
  });

  test("keeps rows without session ids", () => {
    const rows = [
      { source: "api", created_at: "2026-06-04T10:00:00Z", metadata: null },
      { source: "api", created_at: "2026-06-04T10:00:00Z", metadata: null },
    ];

    expect(dedupeUsageRowsBySession(rows)).toHaveLength(2);
  });

  test("prefers the latest synced corrected estimate for the same session", () => {
    const rows = [
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 10,
        metadata: {
          session_id: "session-1",
          estimation_method: CURSOR_TRANSCRIPT_REPLAY_V2_METHOD,
          synced_at: "2026-06-06T10:00:00.000Z",
        },
      },
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 9,
        metadata: {
          session_id: "session-1",
          estimation_method: CURSOR_TRANSCRIPT_REPLAY_V2_METHOD,
          synced_at: "2026-06-06T11:00:00.000Z",
        },
      },
    ];

    expect(dedupeUsageRowsBySession(rows)[0].cost_usd).toBe(9);
  });

  test("prefers a row with valid synced_at over one without it", () => {
    const rows = [
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 20,
        metadata: {
          session_id: "session-1",
          estimation_method: CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
        },
      },
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 10,
        metadata: {
          session_id: "session-1",
          estimation_method: CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
          synced_at: "2026-06-06T11:00:00.000Z",
        },
      },
    ];

    expect(dedupeUsageRowsBySession(rows)[0].cost_usd).toBe(10);
  });

  test("prefers visible-transcript lower-bound Cursor rows over v2 replay rows", () => {
    const rows = [
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 44.31,
        metadata: {
          session_id: "session-1",
          estimation_method: CURSOR_TRANSCRIPT_REPLAY_V2_METHOD,
          synced_at: "2026-06-06T10:00:00.000Z",
        },
      },
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 44.31,
        metadata: {
          session_id: "session-1",
          estimation_method: CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
          synced_at: "2026-06-06T09:00:00.000Z",
        },
      },
    ];

    expect(dedupeUsageRowsBySession(rows)[0].metadata?.estimation_method).toBe(
      CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
    );
  });

  test("prefers native usage over transcript lower bounds", () => {
    const rows = [
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 44.31,
        metadata: {
          session_id: "session-1",
          estimation_method: CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
          synced_at: "2026-06-06T11:00:00.000Z",
        },
      },
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 50,
        metadata: {
          session_id: "session-1",
          estimation_method: NATIVE_USAGE_METHOD,
          synced_at: "2026-06-06T10:00:00.000Z",
        },
      },
    ];

    expect(dedupeUsageRowsBySession(rows)[0].metadata?.estimation_method).toBe(
      NATIVE_USAGE_METHOD,
    );
  });

  test("dedupes the same Cursor session across legacy source aliases", () => {
    const rows = [
      {
        source: "cursor",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 44.31,
        metadata: {
          session_id: "session-1",
          estimation_method: CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
          synced_at: "2026-06-06T11:00:00.000Z",
        },
      },
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 50,
        metadata: {
          session_id: "session-1",
          estimation_method: NATIVE_USAGE_METHOD,
          synced_at: "2026-06-06T10:00:00.000Z",
        },
      },
    ];

    const deduped = dedupeUsageRowsBySession(rows);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].source).toBe("cursor-cli");
    expect(deduped[0].metadata?.estimation_method).toBe(NATIVE_USAGE_METHOD);
  });

  test("keeps same Cursor session ids from different projects separate", () => {
    const rows = [
      {
        source: "cursor-cli",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 10,
        metadata: {
          session_id: "shared-session",
          project: "repo-a",
          estimation_method: CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
          synced_at: "2026-06-06T11:00:00.000Z",
        },
      },
      {
        source: "cursor",
        created_at: "2026-06-04T16:21:39.219Z",
        cost_usd: 20,
        metadata: {
          session_id: "shared-session",
          project: "repo-b",
          estimation_method: CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
          synced_at: "2026-06-06T11:00:00.000Z",
        },
      },
    ];

    expect(dedupeUsageRowsBySession(rows)).toHaveLength(2);
  });
});

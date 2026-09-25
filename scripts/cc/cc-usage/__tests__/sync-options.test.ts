import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertDestructiveSupabaseCredential,
  buildSyncOptions,
  cursorCleanupSourceAliases,
  materializeArchiveTar,
  needsCursorEstimateRefresh,
  needsNativeUsageRefresh,
  parseDeletedRowCount,
  plannedReplacementRowCount,
  replacementRowIds,
  selectStaleRefreshRowIds,
} from "../../cc-usage-sync";
import {
  CURSOR_TRANSCRIPT_REPLAY_V2_METHOD,
  CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
  NATIVE_USAGE_METHOD,
} from "../estimation-methods";

function jwtWithRole(role: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`;
}

describe("cc-usage-sync destructive credential preflight", () => {
  test("rejects an anon JWT before replacement writes", () => {
    expect(() =>
      assertDestructiveSupabaseCredential(jwtWithRole("anon")),
    ).toThrow("service_role");
  });

  test("accepts a service-role JWT", () => {
    expect(() =>
      assertDestructiveSupabaseCredential(jwtWithRole("service_role")),
    ).not.toThrow();
  });

  test("accepts opaque modern Supabase secret keys", () => {
    expect(() =>
      assertDestructiveSupabaseCredential("sb_secret_example"),
    ).not.toThrow();
  });
});

describe("cc-usage-sync options", () => {
  test("--no-archives with explicit roots does not include default archive roots", () => {
    const opts = buildSyncOptions([
      "--no-archives",
      "--claude-archive-root=/tmp/custom-claude",
      "--codex-archive-root=/tmp/custom-codex",
      "--cursor-archive-root=/tmp/custom-cursor",
      "--archive-tar=/tmp/custom.tar.gz",
    ]);

    expect(opts.includeArchives).toBe(true);
    expect(opts.includeArchiveTars).toBe(true);
    expect(opts.claudeArchiveRoots).toEqual(["/tmp/custom-claude"]);
    expect(opts.codexArchiveRoots).toEqual(["/tmp/custom-codex"]);
    expect(opts.cursorArchiveRoots).toEqual(["/tmp/custom-cursor"]);
    expect(opts.archiveTars).toEqual(["/tmp/custom.tar.gz"]);
  });

  test("discovers mounted Brain Drive Claude archives by default", () => {
    const originalHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "cc-usage-drive-home-"));
    const driveRoot = join(
      home,
      "Library",
      "CloudStorage",
      "GoogleDrive-test@example.com",
      "My Drive",
      "Brain Drive",
    );
    const expected = [
      join(
        driveRoot,
        "04_INGEST",
        "session-mining-2026-04-10",
        "claude-sessions",
      ),
      join(driveRoot, "06_ARCHIVE", "backups", "claude-jsonl"),
      join(driveRoot, "06_ARCHIVE", "backups", "claude-jsonl-forever"),
    ];
    for (const root of expected) mkdirSync(root, { recursive: true });

    try {
      process.env.HOME = home;
      expect(buildSyncOptions([]).claudeArchiveRoots).toEqual(expected);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});

describe("cc-usage-sync native usage refresh", () => {
  const correctedSession = {
    source: "codex-cli" as const,
    sessionId: "session-1",
    project: "golems",
    model: "gpt-5.4",
    timestamp: "2026-07-17T10:00:00.000Z",
    inputTokens: 700,
    outputTokens: 100,
    cacheReadTokens: 300,
    cacheCreateTokens: 0,
    apiCalls: 1,
    costUsd: 0.01,
  };

  test("refreshes existing native rows when corrected metrics differ", () => {
    const existing = new Map([
      [
        "codex-cli:golems:session-1",
        {
          inputTokens: 1000,
          outputTokens: 100,
          costUsd: 0.02,
          estimationMethod: NATIVE_USAGE_METHOD,
        },
      ],
    ]);

    expect(needsNativeUsageRefresh(correctedSession, existing)).toBe(true);
  });

  test("does not refresh an already corrected native row", () => {
    const existing = new Map([
      [
        "codex-cli:golems:session-1",
        {
          inputTokens: 700,
          outputTokens: 100,
          costUsd: 0.01,
          estimationMethod: NATIVE_USAGE_METHOD,
        },
      ],
    ]);

    expect(needsNativeUsageRefresh(correctedSession, existing)).toBe(false);
  });

  test("dry-run replacement count includes every matching stale row", () => {
    const existing = new Map([
      [
        "codex-cli:golems:session-1",
        {
          inputTokens: 1000,
          outputTokens: 100,
          costUsd: 0.02,
          estimationMethod: NATIVE_USAGE_METHOD,
          nativeReplacementRows: 2,
          cursorReplacementRows: 0,
        },
      ],
    ]);

    expect(
      plannedReplacementRowCount([correctedSession], existing, "native"),
    ).toBe(2);
  });

  test("selects exact stale ids without interpolating reserved project characters", () => {
    const session = { ...correctedSession, project: "team,west" };
    const existing = new Map([
      [
        "codex-cli:team,west:session-1",
        {
          inputTokens: 1000,
          outputTokens: 100,
          costUsd: 0.02,
          estimationMethod: NATIVE_USAGE_METHOD,
          nativeReplacementRows: 1,
          nativeReplacementIds: ["row-1"],
        },
      ],
    ]);

    expect(replacementRowIds([session], existing, "native")).toEqual(["row-1"]);
  });

  test("fails before replacement writes when no stale row id is available", () => {
    const existing = new Map([
      [
        "codex-cli:golems:session-1",
        {
          inputTokens: 1000,
          outputTokens: 100,
          costUsd: 0.02,
          estimationMethod: NATIVE_USAGE_METHOD,
          nativeReplacementRows: 1,
          nativeReplacementIds: [],
        },
      ],
    ]);

    expect(() =>
      replacementRowIds([correctedSession], existing, "native"),
    ).toThrow("no exact stale row ids");
  });
});

describe("cc-usage-sync delete receipts", () => {
  test("counts rows returned by a representation DELETE", async () => {
    const response = new Response(JSON.stringify([{ id: 1 }, { id: 2 }]));

    expect(await parseDeletedRowCount(response)).toBe(2);
  });

  test("rejects a minimal DELETE response that cannot prove cleanup", async () => {
    const response = new Response(null, { status: 204 });

    expect(parseDeletedRowCount(response)).rejects.toThrow(
      "did not return a row receipt",
    );
  });

  test("selects every stale row behind an exact native refresh marker", () => {
    const marker = "2026-07-17T09:02:24.825Z";
    const rows = [
      {
        id: "old-a",
        source: "codex-cli",
        metadata: {
          session_id: "session-1",
          project: "golems",
          estimation_method: NATIVE_USAGE_METHOD,
          synced_at: "2026-06-26T16:28:34.489Z",
        },
      },
      {
        id: "old-b",
        source: "codex-cli",
        metadata: { session_id: "session-1", project: "golems" },
      },
      {
        id: "fresh",
        source: "codex-cli",
        metadata: {
          session_id: "session-1",
          project: "golems",
          estimation_method: NATIVE_USAGE_METHOD,
          synced_at: marker,
        },
      },
      {
        id: "unrelated",
        source: "codex-cli",
        metadata: {
          session_id: "session-2",
          project: "golems",
          estimation_method: NATIVE_USAGE_METHOD,
        },
      },
    ];

    expect(selectStaleRefreshRowIds(rows, marker, "native")).toEqual([
      "old-a",
      "old-b",
    ]);
    expect(selectStaleRefreshRowIds(rows.slice(2), marker, "native")).toEqual(
      [],
    );
  });
});

describe("cc-usage-sync archive tar materialization", () => {
  test("failed tar extraction removes the partial cache directory", () => {
    const originalHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "cc-usage-home-"));
    process.env.HOME = home;

    try {
      const tarPath = join(home, "broken.tar.gz");
      writeFileSync(tarPath, "not a tarball");

      expect(materializeArchiveTar(tarPath)).toBeNull();

      const cacheRoot = join(home, ".cache", "cc-usage", "archive-tars");
      const cacheEntries = existsSync(cacheRoot) ? readdirSync(cacheRoot) : [];
      expect(cacheEntries).toHaveLength(0);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });
});

describe("cc-usage-sync Cursor refresh cleanup", () => {
  test("stale cleanup targets both Cursor source aliases", () => {
    expect(cursorCleanupSourceAliases("cursor-cli")).toEqual([
      "cursor-cli",
      "cursor",
    ]);
    expect(cursorCleanupSourceAliases("cursor")).toEqual([
      "cursor-cli",
      "cursor",
    ]);
    expect(cursorCleanupSourceAliases("codex-cli")).toEqual(["codex-cli"]);
  });

  test("does not replace native Cursor usage with transcript lower bounds", () => {
    const session = {
      source: "cursor-cli" as const,
      sessionId: "session-1",
      project: "golems",
      model: "cursor-auto",
      timestamp: "2026-06-06T10:00:00.000Z",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      apiCalls: 1,
      costUsd: 1,
    };
    const existing = new Map([
      [
        "cursor-cli:golems:session-1",
        {
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 1,
          estimationMethod: NATIVE_USAGE_METHOD,
        },
      ],
    ]);

    expect(needsCursorEstimateRefresh(session, existing)).toBe(false);
  });

  test("recognizes canonicalized legacy Cursor rows during refresh checks", () => {
    const session = {
      source: "cursor-cli" as const,
      sessionId: "session-1",
      project: "golems",
      model: "cursor-auto",
      timestamp: "2026-06-06T10:00:00.000Z",
      inputTokens: 200,
      outputTokens: 60,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      apiCalls: 1,
      costUsd: 2,
    };
    const existing = new Map([
      [
        "cursor-cli:golems:session-1",
        {
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 1,
          estimationMethod: CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
        },
      ],
    ]);

    expect(needsCursorEstimateRefresh(session, existing)).toBe(true);
  });
});

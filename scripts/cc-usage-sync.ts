#!/usr/bin/env bun
/**
 * Multi-Provider Usage Sync — syncs AI session token usage into Supabase llm_usage table.
 *
 * Providers:
 * - Claude Code: ~/.claude/projects/[project]/[sessionId].jsonl
 * - Codex CLI:   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 * - Cursor:      ~/.cursor/projects/[slug]/agent-transcripts, including nested subagents
 * - Archives:    ~/.claude-archive plus mounted Brain Drive JSONL roots
 * - Gemini:      Already in Supabase via BrainLayer enrichment pipeline
 *
 * Dedup: uses metadata.project + metadata.session_id to skip already-synced sessions.
 *
 * Usage:
 *   bun scripts/cc-usage-sync.ts                  # Sync last 7 days (default)
 *   bun scripts/cc-usage-sync.ts --days 30        # Sync last 30 days
 *   bun scripts/cc-usage-sync.ts --days 1         # Sync today only
 *   bun scripts/cc-usage-sync.ts --dry-run        # Show what would be synced
 *   bun scripts/cc-usage-sync.ts --provider=claude # Sync only Claude
 *   bun scripts/cc-usage-sync.ts --provider=codex  # Sync only Codex
 *   bun scripts/cc-usage-sync.ts --provider=cursor  # Sync only Cursor
 *   bun scripts/cc-usage-sync.ts --no-archives    # Skip local archive roots
 *   bun scripts/cc-usage-sync.ts --cursor-archive-root=... # Add Cursor archive root
 *   bun scripts/cc-usage-sync.ts --include-archive-tars # Extract and scan tar.gz backups
 *   bun scripts/cc-usage-sync.ts --repair-native-synced-at=... # Dry-run exact-marker cleanup
 *   bun scripts/cc-usage-sync.ts --repair-native-synced-at=... --apply-repair # Apply cleanup
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { join } from "path";

// ─── Load env ─────────────────────────────────────────────────────
try {
  await import("../packages/shared/src/lib/load-env");
} catch {
  /* ok if not in repo root */
}

import { calculateRawCost } from "./cc-usage/pricing";
import {
  canonicalUsageSource,
  dedupeUsageRowsBySession,
  usageSessionKey,
} from "./cc-usage/session-dedupe";
import {
  CURSOR_TRANSCRIPT_REPLAY_V2_METHOD,
  CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD,
  NATIVE_USAGE_METHOD,
} from "./cc-usage/estimation-methods";
import {
  scanClaudeLiveSessions,
  scanClaudeRoots,
  type ClaudeSessionUsage,
} from "./cc-usage/parsers/claude";
import { scanCodexRoots, scanCodexSessions } from "./cc-usage/parsers/codex";
import { scanCursorRoots, scanCursorSessions } from "./cc-usage/parsers/cursor";

// ─── Types ─────────────────────────────────────────────────────────

interface SessionUsage {
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
  source: "claude-code" | "codex-cli" | "cursor-cli";
}

// ─── Source Discovery ──────────────────────────────────────────────

interface SyncOptions {
  includeArchives: boolean;
  includeArchiveTars: boolean;
  claudeArchiveRoots: string[];
  codexArchiveRoots: string[];
  cursorArchiveRoots: string[];
  archiveTars: string[];
}

export function assertDestructiveSupabaseCredential(key: string): void {
  if (key.startsWith("sb_secret_")) return;

  const segments = key.split(".");
  if (segments.length !== 3) {
    throw new Error(
      "Destructive Supabase writes require a service_role JWT or sb_secret key",
    );
  }

  let role: unknown;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1]!, "base64url").toString("utf8"),
    ) as { role?: unknown };
    role = payload.role;
  } catch {
    throw new Error(
      "Destructive Supabase writes require a verifiable service_role credential",
    );
  }

  if (role !== "service_role") {
    throw new Error(
      `Destructive Supabase writes require role=service_role (received ${String(role)})`,
    );
  }
}

function parseListArgs(args: string[], name: string): string[] {
  const prefix = `${name}=`;
  return args
    .filter((a) => a.startsWith(prefix))
    .map((a) => expandHome(a.slice(prefix.length)))
    .filter(Boolean);
}

function expandHome(path: string): string {
  const home = process.env.HOME;
  if (!home) return path;
  return path === "~" ? home : path.replace(/^~\//, `${home}/`);
}

function defaultClaudeArchiveRoots(): string[] {
  const home = process.env.HOME;
  if (!home) return [];

  return [
    join(home, ".claude-archive"),
    ...findBrainDrivePaths(
      "04_INGEST/session-mining-2026-04-10/claude-sessions",
    ),
    ...findBrainDrivePaths("06_ARCHIVE/backups/claude-jsonl"),
    ...findBrainDrivePaths("06_ARCHIVE/backups/claude-jsonl-forever"),
  ].filter((path) => existsSync(path));
}

function defaultCodexArchiveRoots(): string[] {
  return findBrainDrivePaths(
    "04_INGEST/session-mining-2026-04-10/codex-sessions",
  );
}

function defaultCursorArchiveRoots(): string[] {
  return [
    ...findBrainDrivePaths(
      "04_INGEST/session-mining-2026-04-10/cursor-sessions",
    ),
    ...findBrainDrivePaths(
      "04_INGEST/session-mining-2026-04-10/cursor-projects",
    ),
    ...findBrainDrivePaths(
      "04_INGEST/session-mining-2026-04-10/cursor-agent-transcripts",
    ),
    ...findBrainDrivePaths("06_ARCHIVE/backups/cursor-jsonl"),
  ];
}

function defaultArchiveTars(): string[] {
  const home = process.env.HOME;
  if (!home) return [];

  return [
    join(home, ".local", "share", "brainlayer", "jsonl-backups"),
    ...findBrainDrivePaths("06_ARCHIVE/backups/claude-jsonl"),
  ]
    .filter((root) => existsSync(root))
    .flatMap((root) =>
      safeReaddir(root)
        .filter((f) => f.endsWith(".tar.gz"))
        .map((f) => join(root, f)),
    );
}

function findBrainDrivePaths(relativePath: string): string[] {
  const home = process.env.HOME;
  if (!home) return [];

  const cloudRoot = join(home, "Library", "CloudStorage");
  if (!existsSync(cloudRoot)) return [];

  return safeReaddir(cloudRoot)
    .filter((name) => name.startsWith("GoogleDrive-"))
    .map((name) =>
      join(cloudRoot, name, "My Drive", "Brain Drive", relativePath),
    )
    .filter((path) => existsSync(path));
}

export function materializeArchiveTar(tarPath: string): string | null {
  const home = process.env.HOME;
  if (!home) return null;

  let stat;
  try {
    stat = statSync(tarPath);
  } catch {
    return null;
  }

  const key = createHash("sha1")
    .update(`${tarPath}:${stat.size}:${stat.mtimeMs}`)
    .digest("hex");
  const cacheDir = join(home, ".cache", "cc-usage", "archive-tars", key);
  const completeMarker = join(cacheDir, ".complete");
  if (existsSync(completeMarker)) return cacheDir;

  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(cacheDir, { recursive: true });
  try {
    execFileSync("tar", ["-xzf", tarPath, "-C", cacheDir], {
      stdio: "ignore",
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    });
    writeFileSync(completeMarker, new Date().toISOString());
    return cacheDir;
  } catch {
    rmSync(cacheDir, { recursive: true, force: true });
    console.warn(`  Skipping archive tar (extract failed): ${tarPath}`);
    return null;
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ─── Supabase Sync ─────────────────────────────────────────────────

export interface ExistingSessionRow {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  estimationMethod?: string;
  nativeReplacementRows?: number;
  cursorReplacementRows?: number;
  nativeReplacementIds?: Array<string | number>;
  cursorReplacementIds?: Array<string | number>;
}

export interface SupabaseSessionIdentityRow {
  id: string | number | null;
  source: string;
  metadata: {
    session_id?: string;
    project?: string;
    estimation_method?: string;
    synced_at?: string;
  } | null;
}

function sessionKey(
  s: Pick<SessionUsage, "source" | "sessionId" | "project">,
): string {
  return usageSessionKey(s.source, s.sessionId, s.project);
}

async function getExistingSessionRows(): Promise<
  Map<string, ExistingSessionRow>
> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY required",
    );

  const allRows: Array<{
    source: string;
    id?: string | number | null;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    metadata: {
      session_id?: string;
      project?: string;
      estimation_method?: string;
      synced_at?: string;
    } | null;
    created_at?: string | null;
  }> = [];
  const PAGE_SIZE = 1000; // Supabase REST caps responses at 1000 rows.
  let offset = 0;

  // Paginate to avoid missing session IDs beyond the 50K limit
  while (true) {
    const resp = await fetch(
      `${url}/rest/v1/llm_usage?select=id,source,input_tokens,output_tokens,cost_usd,created_at,metadata&metadata->>session_id=not.is.null&limit=${PAGE_SIZE}&offset=${offset}&order=created_at.asc,id.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!resp.ok)
      throw new Error(`Failed to fetch existing sessions: ${resp.status}`);

    const rows = (await resp.json()) as typeof allRows;
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break; // Last page
    offset += PAGE_SIZE;
  }

  const replacementCounts = new Map<
    string,
    {
      nativeReplacementRows: number;
      cursorReplacementRows: number;
      nativeReplacementIds: Array<string | number>;
      cursorReplacementIds: Array<string | number>;
    }
  >();
  for (const row of allRows) {
    const sid = row.metadata?.session_id;
    if (!sid) continue;
    const rowKey = usageSessionKey(row.source, sid, row.metadata?.project);
    const counts = replacementCounts.get(rowKey) || {
      nativeReplacementRows: 0,
      cursorReplacementRows: 0,
      nativeReplacementIds: [],
      cursorReplacementIds: [],
    };
    const method = row.metadata?.estimation_method;
    if (!method || method === NATIVE_USAGE_METHOD) {
      counts.nativeReplacementRows++;
      if (row.id !== null && row.id !== undefined) {
        counts.nativeReplacementIds.push(row.id);
      }
    }
    if (
      !method ||
      method === CURSOR_TRANSCRIPT_REPLAY_V2_METHOD ||
      method === CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD
    ) {
      counts.cursorReplacementRows++;
      if (row.id !== null && row.id !== undefined) {
        counts.cursorReplacementIds.push(row.id);
      }
    }
    replacementCounts.set(rowKey, counts);
  }

  const rowsByKey = new Map<string, ExistingSessionRow>();
  for (const row of dedupeUsageRowsBySession(allRows)) {
    const sid = row.metadata?.session_id;
    if (!sid) continue;
    const rowKey = usageSessionKey(row.source, sid, row.metadata?.project);
    rowsByKey.set(rowKey, {
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      costUsd: Number(row.cost_usd) || 0,
      estimationMethod: row.metadata?.estimation_method,
      ...replacementCounts.get(rowKey),
    });
  }

  return rowsByKey;
}

async function fetchAllSupabaseRows<T>(
  url: string,
  key: string,
  path: string,
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let offset = 0;
  const allRows: T[] = [];

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const resp = await fetch(
      `${url}/rest/v1/${path}${separator}limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Supabase GET ${path} failed: ${resp.status} ${body}`);
    }

    const rows = (await resp.json()) as T[];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

async function insertSessions(
  sessions: SessionUsage[],
  opts: { syncedAt?: string } = {},
): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY required");

  // Insert in batches of 100
  const BATCH = 100;
  let inserted = 0;

  for (let i = 0; i < sessions.length; i += BATCH) {
    const batch = sessions.slice(i, i + BATCH);
    const rows = batch.map((s) => sessionToSupabaseRow(s, true, opts.syncedAt));

    const resp = await fetch(`${url}/rest/v1/llm_usage`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Insert failed (batch ${i / BATCH + 1}): ${resp.status} ${body}`,
      );
    }
    inserted += batch.length;
  }

  return inserted;
}

export function cursorCleanupSourceAliases(source: string): string[] {
  return canonicalUsageSource(source) === "cursor-cli"
    ? ["cursor-cli", "cursor"]
    : [source];
}

export async function parseDeletedRowCount(resp: Response): Promise<number> {
  const body = await resp.text();
  if (!body.trim()) {
    throw new Error("Supabase DELETE did not return a row receipt");
  }
  const rows = JSON.parse(body) as unknown;
  if (!Array.isArray(rows)) {
    throw new Error("Supabase DELETE returned a malformed row receipt");
  }
  return rows.length;
}

export function selectStaleRefreshRowIds(
  rows: SupabaseSessionIdentityRow[],
  refreshedSyncedAt: string,
  kind: "native" | "cursor",
): Array<string | number> {
  const rowsBySession = new Map<string, SupabaseSessionIdentityRow[]>();
  for (const row of rows) {
    const sessionId = row.metadata?.session_id;
    if (!sessionId) continue;
    const key = usageSessionKey(row.source, sessionId, row.metadata?.project);
    const sessionRows = rowsBySession.get(key) || [];
    sessionRows.push(row);
    rowsBySession.set(key, sessionRows);
  }

  const staleIds: Array<string | number> = [];
  for (const sessionRows of rowsBySession.values()) {
    const refreshedRows = sessionRows.filter(
      (row) => row.metadata?.synced_at === refreshedSyncedAt,
    );
    if (refreshedRows.length === 0) continue;
    if (refreshedRows.length !== 1) {
      throw new Error(
        `Repair marker ${refreshedSyncedAt} matched multiple rows for one session`,
      );
    }

    const refreshedMethod = refreshedRows[0]?.metadata?.estimation_method;
    const markerMatchesKind =
      kind === "native"
        ? refreshedMethod === NATIVE_USAGE_METHOD
        : refreshedMethod === CURSOR_TRANSCRIPT_REPLAY_V2_METHOD ||
          refreshedMethod === CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD;
    if (!markerMatchesKind) {
      throw new Error(
        `Repair marker ${refreshedSyncedAt} has an unexpected estimation method`,
      );
    }

    for (const row of sessionRows) {
      if (row.metadata?.synced_at === refreshedSyncedAt) continue;
      const method = row.metadata?.estimation_method;
      const stale =
        kind === "native"
          ? !method || method === NATIVE_USAGE_METHOD
          : !method ||
            method === CURSOR_TRANSCRIPT_REPLAY_V2_METHOD ||
            method === CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD;
      if (!stale) continue;
      if (row.id === null || row.id === undefined) {
        throw new Error("Repair candidate is missing its Supabase row id");
      }
      staleIds.push(row.id);
    }
  }

  return staleIds;
}

async function deleteRowsById(
  ids: Array<string | number>,
  url: string,
  key: string,
): Promise<number> {
  const batchSize = 100;
  let deleted = 0;
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    const params = new URLSearchParams({ id: `in.(${batch.join(",")})` });
    const resp = await fetch(`${url}/rest/v1/llm_usage?${params}`, {
      method: "DELETE",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=representation",
      },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Repair DELETE failed: ${resp.status} ${body}`);
    }
    const batchDeleted = await parseDeletedRowCount(resp);
    if (batchDeleted !== batch.length) {
      throw new Error(
        `Repair DELETE receipt mismatch: expected ${batch.length}, deleted ${batchDeleted}`,
      );
    }
    deleted += batchDeleted;
  }
  return deleted;
}

async function repairRefreshRows(
  markers: Array<{ syncedAt: string; kind: "native" | "cursor" }>,
  apply: boolean,
): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY required for refresh repair",
    );
  }
  if (apply) assertDestructiveSupabaseCredential(key);
  const rows = await fetchAllSupabaseRows<SupabaseSessionIdentityRow>(
    url,
    key,
    "llm_usage?select=id,source,metadata&metadata->>session_id=not.is.null&order=created_at.asc,id.asc",
  );
  const staleIds = markers.flatMap(({ syncedAt, kind }) =>
    selectStaleRefreshRowIds(rows, syncedAt, kind),
  );
  if (new Set(staleIds.map(String)).size !== staleIds.length) {
    throw new Error(
      "Refresh repair selected the same stale row more than once",
    );
  }

  if (!apply) {
    console.log(
      `[REPAIR DRY RUN] Planned llm_usage row operations: +0 inserts, -${staleIds.length} exact-marker stale rows, expected net delta -${staleIds.length}.`,
    );
    return;
  }

  const deleted = await deleteRowsById(staleIds, url, key);
  console.log(
    `[REPAIR APPLIED] Deleted ${deleted} exact-marker stale rows; expected net delta -${deleted}.`,
  );
}

async function deleteReplacementRows(
  ids: Array<string | number>,
  label: string,
): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      `SUPABASE_URL and SUPABASE_SERVICE_KEY required for ${label} replacement`,
    );
  }
  return deleteRowsById(ids, url, key);
}

function sessionToSupabaseRow(
  s: SessionUsage,
  includeCreatedAt: boolean,
  syncedAt = new Date().toISOString(),
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    model: s.model,
    source: s.source,
    input_tokens: s.inputTokens,
    output_tokens: s.outputTokens,
    cost_usd: s.costUsd,
    cache_read_tokens: s.cacheReadTokens,
    cache_creation_tokens: s.cacheCreateTokens,
    tier: "subscription",
    metadata: {
      session_id: s.sessionId,
      project: s.project,
      api_calls: s.apiCalls,
      estimation_method:
        s.source === "cursor-cli"
          ? CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD
          : NATIVE_USAGE_METHOD,
      estimation_quality:
        s.source === "cursor-cli"
          ? "lower_bound_missing_tool_results_and_codebase_context"
          : "native_usage",
      synced_at: syncedAt,
    },
  };

  if (includeCreatedAt) {
    row.created_at = s.timestamp || new Date().toISOString();
  }

  return row;
}

// ─── Monthly Snapshot Upsert ──────────────────────────────────────

async function upsertMonthlySnapshots(
  sessions: SessionUsage[],
): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.warn(
      "Skipping snapshot upsert: SUPABASE_URL or SUPABASE_SERVICE_KEY missing",
    );
    return 0;
  }

  // Determine which months are touched by these sessions
  const touchedMonths = new Set<string>();
  for (const s of sessions) {
    const ym = s.timestamp?.slice(0, 7);
    if (ym) touchedMonths.add(ym);
  }
  if (touchedMonths.size === 0) return 0;

  // For each touched month, query ALL llm_usage rows for that month
  // to build accurate full-month totals (not partial --days windows).
  const allRows: Array<{
    year_month: string;
    provider: string;
    model_id: string;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_read: number;
    total_cache_create: number;
    calculated_api_cost: number;
    session_count: number;
  }> = [];

  for (const ym of touchedMonths) {
    const monthStart = `${ym}-01`;
    // Last day: parse month, go to next month, subtract 1 day
    const [y, m] = ym.split("-").map(Number);
    const nextMonth = new Date(y!, m!, 1); // month is 0-indexed, so m! = next month
    nextMonth.setDate(nextMonth.getDate() - 1);
    const monthEnd = nextMonth.toISOString().slice(0, 10);

    const rawRows = await fetchAllSupabaseRows<{
      model: string;
      source: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      cache_read_tokens: number | null;
      cache_creation_tokens: number | null;
      created_at: string;
      metadata: {
        session_id?: string;
        project?: string;
        estimation_method?: string;
        synced_at?: string;
      } | null;
      id?: string | number | null;
    }>(
      url,
      key,
      `llm_usage?select=id,model,source,input_tokens,output_tokens,cost_usd,cache_read_tokens,cache_creation_tokens,created_at,metadata&created_at=gte.${monthStart}&created_at=lte.${monthEnd}T23:59:59&order=created_at.asc,id.asc`,
    );
    const rows = dedupeUsageRowsBySession(rawRows);

    // Aggregate by provider + model
    const map = new Map<string, (typeof allRows)[0]>();
    for (const r of rows) {
      const provider =
        r.source === "cursor-cli" || r.source === "cursor"
          ? "cursor"
          : r.source === "codex-cli" ||
              r.model.includes("gpt") ||
              r.model.includes("codex")
            ? "openai"
            : r.model.includes("gemini") || r.source.includes("gemini")
              ? "google"
              : r.model.includes("claude") || r.source === "claude-code"
                ? "anthropic"
                : "anthropic";
      const k = `${provider}|${r.model}`;
      let entry = map.get(k);
      if (!entry) {
        entry = {
          year_month: ym,
          provider,
          model_id: r.model,
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_cache_read: 0,
          total_cache_create: 0,
          calculated_api_cost: 0,
          session_count: 0,
        };
        map.set(k, entry);
      }
      entry.total_input_tokens += r.input_tokens || 0;
      entry.total_output_tokens += r.output_tokens || 0;
      entry.total_cache_read += Number(r.cache_read_tokens) || 0;
      entry.total_cache_create += Number(r.cache_creation_tokens) || 0;
      entry.calculated_api_cost += Number(r.cost_usd) || 0;
      entry.session_count += 1;
    }
    allRows.push(...map.values());
  }

  if (allRows.length === 0) return 0;

  const upsertRows = allRows.map((r) => ({
    ...r,
    snapshot_at: new Date().toISOString(),
  }));

  const resp = await fetch(
    `${url}/rest/v1/usage_monthly_snapshots?on_conflict=year_month,provider,model_id`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(upsertRows),
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Snapshot upsert failed: ${resp.status} ${body}`);
    return 0;
  }

  return upsertRows.length;
}

// ─── Main ──────────────────────────────────────────────────────────

function convertClaudeSessions(
  claudeSessions: ClaudeSessionUsage[],
): SessionUsage[] {
  return claudeSessions.map((s) => ({
    sessionId: s.sessionId,
    project: s.project,
    model: s.model,
    timestamp: s.timestamp,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheReadTokens: s.cacheReadTokens,
    cacheCreateTokens: s.cacheCreateTokens,
    apiCalls: s.apiCalls,
    costUsd: calculateRawCost(
      s.model,
      s.inputTokens,
      s.outputTokens,
      s.cacheReadTokens,
      s.cacheCreateTokens,
    ),
    source: "claude-code" as const,
  }));
}

function convertCodexSessions(
  codexSessions: ReturnType<typeof scanCodexSessions>,
): SessionUsage[] {
  return codexSessions.map((s) => ({
    sessionId: s.sessionId,
    project: s.project,
    model: s.model,
    timestamp: s.timestamp,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheReadTokens: s.cacheReadTokens,
    cacheCreateTokens: s.cacheCreateTokens,
    apiCalls: s.apiCalls,
    costUsd: calculateRawCost(
      s.model,
      s.inputTokens,
      s.outputTokens,
      s.cacheReadTokens,
      s.cacheCreateTokens,
    ),
    source: "codex-cli" as const,
  }));
}

function dedupeSessions(sessions: SessionUsage[]): SessionUsage[] {
  const seen = new Set<string>();
  const deduped: SessionUsage[] = [];

  for (const session of sessions) {
    const key = sessionKey(session);
    // Scan order appends live sessions before archive roots, so first-wins keeps
    // the live copy when canonical live/archive session IDs match.
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(session);
  }

  return deduped;
}

function convertCursorSessions(
  cursorSessions: ReturnType<typeof scanCursorSessions>,
): SessionUsage[] {
  return cursorSessions.map((s) => ({
    sessionId: s.sessionId,
    project: s.project,
    model: s.model,
    timestamp: s.timestamp,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheReadTokens: s.cacheReadTokens,
    cacheCreateTokens: s.cacheCreateTokens,
    apiCalls: s.apiCalls,
    costUsd: calculateRawCost(
      s.model,
      s.inputTokens,
      s.outputTokens,
      s.cacheReadTokens,
      s.cacheCreateTokens,
    ),
    source: "cursor-cli" as const,
  }));
}

export function needsCursorEstimateRefresh(
  session: SessionUsage,
  existingRows: Map<string, ExistingSessionRow>,
): boolean {
  if (session.source !== "cursor-cli") return false;
  const existing = existingRows.get(sessionKey(session));
  if (!existing) return false;

  if (
    !existing.estimationMethod ||
    existing.estimationMethod === CURSOR_TRANSCRIPT_REPLAY_V2_METHOD
  ) {
    return true;
  }
  if (
    existing.estimationMethod !== CURSOR_VISIBLE_TRANSCRIPT_LOWER_BOUND_METHOD
  )
    return false;

  return (
    existing.inputTokens !== session.inputTokens ||
    existing.outputTokens !== session.outputTokens ||
    Math.abs(existing.costUsd - session.costUsd) > 0.000001
  );
}

export function needsNativeUsageRefresh(
  session: SessionUsage,
  existingRows: Map<string, ExistingSessionRow>,
): boolean {
  if (session.source !== "claude-code" && session.source !== "codex-cli") {
    return false;
  }
  const existing = existingRows.get(sessionKey(session));
  if (!existing) return false;
  if (
    existing.estimationMethod &&
    existing.estimationMethod !== NATIVE_USAGE_METHOD
  ) {
    return false;
  }

  return (
    existing.inputTokens !== session.inputTokens ||
    existing.outputTokens !== session.outputTokens ||
    Math.abs(existing.costUsd - session.costUsd) > 0.000001
  );
}

export function plannedReplacementRowCount(
  sessions: Array<Pick<SessionUsage, "source" | "sessionId" | "project">>,
  existingRows: Map<string, ExistingSessionRow>,
  kind: "native" | "cursor",
): number {
  const field =
    kind === "native" ? "nativeReplacementRows" : "cursorReplacementRows";
  return sessions.reduce(
    (total, session) =>
      total + (existingRows.get(sessionKey(session))?.[field] || 0),
    0,
  );
}

export function replacementRowIds(
  sessions: Array<Pick<SessionUsage, "source" | "sessionId" | "project">>,
  existingRows: Map<string, ExistingSessionRow>,
  kind: "native" | "cursor",
): Array<string | number> {
  const countField =
    kind === "native" ? "nativeReplacementRows" : "cursorReplacementRows";
  const idsField =
    kind === "native" ? "nativeReplacementIds" : "cursorReplacementIds";
  const ids: Array<string | number> = [];
  for (const session of sessions) {
    const existing = existingRows.get(sessionKey(session));
    const expected = existing?.[countField] || 0;
    const exactIds = existing?.[idsField] || [];
    if (expected === 0 || exactIds.length !== expected) {
      throw new Error(
        `Replacement for ${session.source}:${session.sessionId} has no exact stale row ids`,
      );
    }
    ids.push(...exactIds);
  }
  if (new Set(ids.map(String)).size !== ids.length) {
    throw new Error(
      "Replacement selected the same stale row id more than once",
    );
  }
  return ids;
}

function printSummary(label: string, sessions: SessionUsage[]) {
  if (sessions.length === 0) return;
  const totalCost = sessions.reduce((s, x) => s + x.costUsd, 0);
  const totalInput = sessions.reduce((s, x) => s + x.inputTokens, 0);
  const totalOutput = sessions.reduce((s, x) => s + x.outputTokens, 0);
  const totalCacheRead = sessions.reduce((s, x) => s + x.cacheReadTokens, 0);

  console.log(`\n  ${label}: ${sessions.length} sessions`);
  console.log(
    `    Input: ${totalInput.toLocaleString()}  Output: ${totalOutput.toLocaleString()}  Cache: ${totalCacheRead.toLocaleString()}`,
  );
  console.log(`    Cost: $${totalCost.toFixed(2)}`);

  const byModel: Record<string, number> = {};
  for (const s of sessions) {
    byModel[s.model] = (byModel[s.model] || 0) + 1;
  }
  console.log(
    `    Models: ${Object.entries(byModel)
      .map(([m, c]) => `${m}(${c})`)
      .join(", ")}`,
  );
}

export function buildSyncOptions(args: string[]): SyncOptions {
  const explicitClaudeArchiveRoots = [
    ...parseListArgs(args, "--archive-root"),
    ...parseListArgs(args, "--claude-archive-root"),
  ];
  const explicitCodexArchiveRoots = parseListArgs(args, "--codex-archive-root");
  const explicitCursorArchiveRoots = parseListArgs(
    args,
    "--cursor-archive-root",
  );
  const explicitArchiveTars = parseListArgs(args, "--archive-tar");
  const includeDefaultArchives = !args.includes("--no-archives");
  const includeDefaultArchiveTars = args.includes("--include-archive-tars");

  const claudeArchiveRoots = [
    ...(includeDefaultArchives ? defaultClaudeArchiveRoots() : []),
    ...explicitClaudeArchiveRoots,
  ];
  const codexArchiveRoots = [
    ...(includeDefaultArchives ? defaultCodexArchiveRoots() : []),
    ...explicitCodexArchiveRoots,
  ];
  const cursorArchiveRoots = [
    ...(includeDefaultArchives ? defaultCursorArchiveRoots() : []),
    ...explicitCursorArchiveRoots,
  ];
  const archiveTars = [
    ...(includeDefaultArchiveTars ? defaultArchiveTars() : []),
    ...explicitArchiveTars,
  ];

  return {
    includeArchives:
      claudeArchiveRoots.length > 0 ||
      codexArchiveRoots.length > 0 ||
      cursorArchiveRoots.length > 0,
    includeArchiveTars: archiveTars.length > 0,
    claudeArchiveRoots,
    codexArchiveRoots,
    cursorArchiveRoots,
    archiveTars,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const repairNativeSyncedAt = args
    .find((arg) => arg.startsWith("--repair-native-synced-at="))
    ?.split("=")[1];
  const repairCursorSyncedAt = args
    .find((arg) => arg.startsWith("--repair-cursor-synced-at="))
    ?.split("=")[1];
  const applyRepair = args.includes("--apply-repair");
  if (repairNativeSyncedAt || repairCursorSyncedAt) {
    const markers: Array<{
      syncedAt: string;
      kind: "native" | "cursor";
    }> = [];
    if (repairNativeSyncedAt) {
      markers.push({ syncedAt: repairNativeSyncedAt, kind: "native" });
    }
    if (repairCursorSyncedAt) {
      markers.push({ syncedAt: repairCursorSyncedAt, kind: "cursor" });
    }
    await repairRefreshRows(markers, applyRepair);
    return;
  }
  if (applyRepair) {
    throw new Error(
      "--apply-repair requires at least one --repair-*-synced-at marker",
    );
  }
  const daysArg = args.find((a) => a.startsWith("--days"));
  const days = daysArg
    ? parseInt(
        daysArg.includes("=")
          ? daysArg.split("=")[1]!
          : args[args.indexOf(daysArg) + 1] || "7",
      )
    : 7;
  const dryRun = args.includes("--dry-run");
  const providerFilter = args
    .find((a) => a.startsWith("--provider="))
    ?.split("=")[1];
  const syncOpts = buildSyncOptions(args);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  console.log(
    `Scanning AI transcripts since ${cutoff.toISOString().slice(0, 10)} (${days} days)...`,
  );
  const archiveTarRoots = syncOpts.includeArchiveTars
    ? syncOpts.archiveTars
        .map((tar) => materializeArchiveTar(tar))
        .filter((root): root is string => Boolean(root))
    : [];

  // ── Scan all providers ─────────────────────────────────────
  const allSessions: SessionUsage[] = [];

  if (!providerFilter || providerFilter === "claude") {
    const live = scanClaudeLiveSessions(cutoff);
    const archiveRoots = syncOpts.includeArchives
      ? syncOpts.claudeArchiveRoots
      : [];
    const archived = scanClaudeRoots(archiveRoots, cutoff);
    const archivedFromTars = scanClaudeRoots(archiveTarRoots, cutoff);
    const claude = convertClaudeSessions([
      ...live,
      ...archived,
      ...archivedFromTars,
    ]);
    console.log(
      `  Claude Code: ${claude.length} sessions (${live.length} live, ${archived.length} archive, ${archivedFromTars.length} tar)`,
    );
    allSessions.push(...claude);
  }

  if (!providerFilter || providerFilter === "codex") {
    const live = scanCodexSessions(cutoff);
    const archived = syncOpts.includeArchives
      ? scanCodexRoots(syncOpts.codexArchiveRoots, cutoff)
      : [];
    const archivedFromTars = scanCodexRoots(archiveTarRoots, cutoff);
    const codex = convertCodexSessions([
      ...live,
      ...archived,
      ...archivedFromTars,
    ]);
    console.log(
      `  Codex CLI:   ${codex.length} sessions (${live.length} live, ${archived.length} archive, ${archivedFromTars.length} tar)`,
    );
    allSessions.push(...codex);
  }

  if (!providerFilter || providerFilter === "cursor") {
    const live = scanCursorSessions(cutoff);
    const archived = syncOpts.includeArchives
      ? scanCursorRoots(syncOpts.cursorArchiveRoots, cutoff)
      : [];
    const archivedFromTars = scanCursorRoots(archiveTarRoots, cutoff);
    const cursor = convertCursorSessions([
      ...live,
      ...archived,
      ...archivedFromTars,
    ]);
    console.log(
      `  Cursor:      ${cursor.length} sessions (${live.length} live, ${archived.length} archive, ${archivedFromTars.length} tar)`,
    );
    allSessions.push(...cursor);
  }

  const uniqueSessions = dedupeSessions(allSessions);
  const duplicateCount = allSessions.length - uniqueSessions.length;

  console.log(
    `\nTotal: ${uniqueSessions.length} sessions across all providers${duplicateCount > 0 ? ` (${duplicateCount} duplicates skipped)` : ""}.`,
  );

  if (uniqueSessions.length === 0) {
    console.log("Nothing to sync.");
    return;
  }

  // Dedup: check which sessions already exist in Supabase
  console.log("Checking existing sessions in Supabase...");
  const existing = await getExistingSessionRows();
  const newSessions = uniqueSessions.filter(
    (s) => !existing.has(sessionKey(s)),
  );
  const existingCursorSessions = uniqueSessions.filter((s) =>
    needsCursorEstimateRefresh(s, existing),
  );
  const existingNativeSessions = uniqueSessions.filter((s) =>
    needsNativeUsageRefresh(s, existing),
  );
  const refreshCount =
    existingNativeSessions.length + existingCursorSessions.length;
  const nativeStaleIds = replacementRowIds(
    existingNativeSessions,
    existing,
    "native",
  );
  const cursorStaleIds = replacementRowIds(
    existingCursorSessions,
    existing,
    "cursor",
  );
  console.log(
    `${existing.size} already synced, ${newSessions.length} new sessions to insert, ${existingNativeSessions.length} corrected native sessions to refresh, ${existingCursorSessions.length} existing Cursor estimates to refresh.`,
  );

  if (
    newSessions.length === 0 &&
    existingNativeSessions.length === 0 &&
    existingCursorSessions.length === 0
  ) {
    console.log("All sessions already synced. Nothing to do.");
    return;
  }

  // Show per-provider summary
  const bySource = new Map<string, SessionUsage[]>();
  for (const s of newSessions) {
    const list = bySource.get(s.source) || [];
    list.push(s);
    bySource.set(s.source, list);
  }

  console.log(`\nNew sessions to sync:`);
  for (const [source, sessions] of bySource) {
    printSummary(source, sessions);
  }

  if (existingCursorSessions.length > 0) {
    console.log(`\nExisting Cursor estimates to refresh:`);
    printSummary("cursor-cli", existingCursorSessions);
  }

  if (existingNativeSessions.length > 0) {
    console.log(`\nExisting native usage rows to correct:`);
    const nativeBySource = new Map<string, SessionUsage[]>();
    for (const session of existingNativeSessions) {
      const sessions = nativeBySource.get(session.source) || [];
      sessions.push(session);
      nativeBySource.set(session.source, sessions);
    }
    for (const [source, sessions] of nativeBySource) {
      printSummary(source, sessions);
    }
  }

  if (dryRun) {
    const staleReplacementRows = nativeStaleIds.length + cursorStaleIds.length;
    const expectedNetDelta =
      newSessions.length + refreshCount - staleReplacementRows;
    console.log(
      `\n[DRY RUN] Planned llm_usage row operations: +${newSessions.length + refreshCount} inserts, -${staleReplacementRows} stale rows, expected net delta ${expectedNetDelta >= 0 ? "+" : ""}${expectedNetDelta}.`,
    );
    console.log(
      "[DRY RUN] Would insert/refresh the above sessions. Use without --dry-run to actually sync.",
    );
    return;
  }

  if (refreshCount > 0) {
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!key) {
      throw new Error(
        "SUPABASE_SERVICE_KEY required before replacement writes",
      );
    }
    assertDestructiveSupabaseCredential(key);
  }

  // Insert into llm_usage
  if (newSessions.length > 0) {
    console.log("\nInserting into Supabase...");
    const inserted = await insertSessions(newSessions);
    console.log(`Done! Inserted ${inserted} sessions into llm_usage.`);
  }

  if (existingCursorSessions.length > 0) {
    console.log("\nReplacing corrected Cursor estimate rows...");
    const refreshSyncedAt = new Date().toISOString();
    const inserted = await insertSessions(existingCursorSessions, {
      syncedAt: refreshSyncedAt,
    });
    const cleaned = await deleteReplacementRows(cursorStaleIds, "Cursor");
    console.log(
      `Done! Inserted ${inserted} corrected Cursor rows and deleted ${cleaned} stale rows across ${existingCursorSessions.length} refreshed sessions.`,
    );
  }

  if (existingNativeSessions.length > 0) {
    console.log("\nReplacing corrected native usage rows...");
    const refreshSyncedAt = new Date().toISOString();
    const inserted = await insertSessions(existingNativeSessions, {
      syncedAt: refreshSyncedAt,
    });
    const cleaned = await deleteReplacementRows(nativeStaleIds, "native usage");
    console.log(
      `Done! Inserted ${inserted} corrected native rows and deleted ${cleaned} stale rows across ${existingNativeSessions.length} refreshed sessions.`,
    );
  }

  // Upsert monthly snapshots (all synced sessions, not just new ones)
  console.log("Updating monthly snapshots...");
  const snapshotCount = await upsertMonthlySnapshots(uniqueSessions);
  console.log(`Upserted ${snapshotCount} monthly snapshot rows.`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

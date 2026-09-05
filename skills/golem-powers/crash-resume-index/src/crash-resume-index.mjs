// crash-resume-index (gen-18 Track 1 #3) — the surface→session_id crash-resume INDEX.
//
// THE REGRESSION it closes: R-036 resume-not-respawn. When /orc notices a lead
// pane has crashed (RAM reboot, OOM, cmux restart), the cheap-and-wrong move is
// to SPAWN A FRESH repoGolem — discarding the crashed session's accumulated
// context (orchestrator/263b3559#1 threw away ~386K tokens). The RIGHT move is to
// RESUME the original Claude session: `repoGolem --resume <session-id>`.
//
// THE MECHANICAL GATE that FLAGS a spawn-over-resumable already shipped in the
// merged `idle-dwell-gate` (its SPAWN_OVER_RESUMABLE violation code). That gate's
// GREEN path — "there IS a resumable session, so resume instead of spawn" — needs
// a DATA LAYER: a durable map of which session_id belongs to which surface/pane,
// captured on boot and surviving a reboot. THIS module is that data layer + the
// lookup. The live cmux capture-on-boot wiring (the MCP hook that actually calls
// `record()` when a pane boots) is Track 3's crash-resume work — this module is
// the persistence + lookup it writes through; coordinate, don't duplicate.
//
// DESIGN: pure functions over a plain index object + an explicit persist-path arg
// so every function is testable without touching the real home dir. The default
// persist path is DURABLE (`~/.golems/crash-resume-index.json`) — NEVER /tmp,
// which a reboot wipes (and which a tmp-block hook denies anyway).

import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// ── Durable default path ──────────────────────────────────────────────────────
// $HOME/.golems/crash-resume-index.json. NOT /tmp: a RAM reboot wipes /tmp, which
// is exactly the failure mode this index has to survive.
export const DEFAULT_INDEX_PATH = path.join(
  homedir(),
  ".golems",
  "crash-resume-index.json",
);

const SCHEMA_VERSION = 1;

// ── Index shape ───────────────────────────────────────────────────────────────
// An index is { version, entries: { [surfaceId]: Entry } } where an Entry is
// { surfaceId, sessionId, repo, role, captured_at, last_active }. Timestamps are
// epoch-ms numbers. `captured_at` is the boot capture; `last_active` is bumped on
// every re-record so pruneStale can drop sessions that have gone quiet/dead.

/** Create an empty index. */
export function emptyIndex() {
  return { version: SCHEMA_VERSION, entries: {} };
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Normalize any loaded/passed value into a well-formed index object. */
function coerceIndex(idx) {
  if (!isPlainObject(idx) || !isPlainObject(idx.entries)) return emptyIndex();
  return { version: idx.version ?? SCHEMA_VERSION, entries: { ...idx.entries } };
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      `crash-resume-index: ${field} must be a non-empty string`,
    );
  }
  return value;
}

// ── record: capture-on-boot (append or update) ───────────────────────────────
// Records (or refreshes) the surface→session mapping. First sight sets
// captured_at; every sight bumps last_active. Returns a NEW index (pure — does
// not mutate the input) so callers stay free of aliasing bugs.
export function record(
  idx,
  { surfaceId, sessionId, repo, role },
  now = Date.now(),
) {
  const base = coerceIndex(idx);
  const sid = requireNonEmptyString(surfaceId, "surfaceId");
  const session = requireNonEmptyString(sessionId, "sessionId");
  requireNonEmptyString(repo, "repo");

  const prior = base.entries[sid];
  const captured_at = prior?.captured_at ?? now;
  const next = {
    surfaceId: sid,
    sessionId: session,
    repo,
    role: role ?? prior?.role ?? null,
    captured_at,
    last_active: now,
  };
  return {
    version: base.version,
    entries: { ...base.entries, [sid]: next },
  };
}

// ── touch: bump last_active without re-capturing (liveness heartbeat) ─────────
// capture-on-boot only stamps last_active at boot, so a lead that runs for hours
// before crashing would look "stale" to a maxAge-bounded resumableFor (cursor
// HIGH). Track 3's cmux hook can call touch() on observed liveness (a screen
// read, an inbox tick) so an old-but-alive session stays resumable. No-op for an
// unknown surface; returns a new index (pure).
export function touch(idx, surfaceId, now = Date.now()) {
  const base = coerceIndex(idx);
  const prior = base.entries[surfaceId];
  if (!prior) return base;
  return {
    version: base.version,
    entries: {
      ...base.entries,
      [surfaceId]: { ...prior, last_active: now },
    },
  };
}

// ── lookup: surface → entry (or null) ─────────────────────────────────────────
export function lookup(idx, surfaceId) {
  const base = coerceIndex(idx);
  if (typeof surfaceId !== "string" || surfaceId === "") return null;
  return base.entries[surfaceId] ?? null;
}

// ── resumableFor: surface → the session_id to resume (or null) ───────────────
// `maxAgeMs` is OPT-IN liveness, NOT a default. capture-on-boot only stamps
// last_active at boot, so imposing a maxAge by default would wrongly deny resume
// for a long-running lead that crashed hours after boot (cursor HIGH). Callers
// that DO pass maxAgeMs are expected to keep last_active fresh via touch(); the
// age is then measured from the most-recent signal (last_active, falling back to
// captured_at). With no maxAgeMs, any recorded session is resumable.
export function resumableFor(
  idx,
  surfaceId,
  { maxAgeMs, now = Date.now() } = {},
) {
  const entry = lookup(idx, surfaceId);
  if (!entry) return null;
  if (typeof maxAgeMs === "number" && maxAgeMs >= 0) {
    const age = now - (entry.last_active ?? entry.captured_at ?? 0);
    if (age > maxAgeMs) return null;
  }
  return entry.sessionId;
}

// ── launcherFor: the registered per-repo resume launcher for a repo ───────────
// The repoGolem registry exposes per-repo launchers `<repo>Claude` (e.g.
// `golemsClaude`, `orcClaude` for the orchestrator) — there is NO lowercase
// global `repogolem --repo …` entrypoint (codex P1). The orchestrator repo's
// launcher is `orcClaude`, so map it explicitly; everything else is
// `<lowercased-repo>Claude`.
const REPO_LAUNCHER_ALIASES = { orchestrator: "orc" };
export function launcherFor(repo) {
  if (typeof repo !== "string" || repo.trim() === "") return null;
  const key = repo.trim().toLowerCase();
  const stem = REPO_LAUNCHER_ALIASES[key] ?? key;
  return `${stem}Claude`;
}

// ── resumeCommand: emit the registered launcher resume invocation ─────────────
// Returns null when nothing resumable. Emits the canonical per-repo launcher form
// `<repo>Claude --resume <session-id>` that the repoGolem registry actually
// defines (codex P1) — this is the command the gate's GREEN path runs instead of
// spawning a fresh lead. Falls back to `repoGolem --resume <id>` only when the
// repo is unknown (no launcher derivable).
export function resumeCommand(idx, surfaceId, opts = {}) {
  const sessionId = resumableFor(idx, surfaceId, opts);
  if (!sessionId) return null;
  const entry = lookup(idx, surfaceId);
  const launcher = launcherFor(entry?.repo);
  if (!launcher) return `repoGolem --resume ${sessionId}`;
  return `${launcher} --resume ${sessionId}`;
}

// ── pruneStale: drop entries past maxAgeMs ────────────────────────────────────
// Returns a NEW index with stale entries removed. Keeps the index from growing
// unbounded across many boots and stops dead sessions from being offered.
export function pruneStale(idx, maxAgeMs, now = Date.now()) {
  const base = coerceIndex(idx);
  if (typeof maxAgeMs !== "number" || maxAgeMs < 0) return base;
  const kept = {};
  for (const [sid, entry] of Object.entries(base.entries)) {
    const age = now - (entry.last_active ?? entry.captured_at ?? 0);
    if (age <= maxAgeMs) kept[sid] = entry;
  }
  return { version: base.version, entries: kept };
}

// ── Persistence (DURABLE) ─────────────────────────────────────────────────────
// loadIndex reads the json at `indexPath`; a missing/corrupt file yields a fresh
// empty index (boot is never blocked by a bad cache). saveIndex writes atomically
// (write temp + rename in the same dir) so a crash mid-write can't truncate the
// index — the very thing it exists to protect.
export function loadIndex(indexPath = DEFAULT_INDEX_PATH) {
  try {
    if (!existsSync(indexPath)) return emptyIndex();
    const raw = readFileSync(indexPath, "utf8");
    if (!raw.trim()) return emptyIndex();
    return coerceIndex(JSON.parse(raw));
  } catch {
    return emptyIndex();
  }
}

export function saveIndex(indexPath = DEFAULT_INDEX_PATH, idx = emptyIndex()) {
  const base = coerceIndex(idx);
  const dir = path.dirname(indexPath);
  mkdirSync(dir, { recursive: true });
  // Unique temp name (pid + counter) so concurrent saves can't clobber each
  // other's temp file before the atomic rename.
  const tmp = path.join(
    dir,
    `.crash-resume-index.${process.pid}.${tmpCounter++}.tmp`,
  );
  const json = `${JSON.stringify(base, null, 2)}\n`;
  writeFileSync(tmp, json, "utf8");
  // Atomic replace — rename within the same directory is atomic on POSIX.
  renameSync(tmp, indexPath);
  return indexPath;
}

let tmpCounter = 0;

// ── Cross-process lock (concurrent capture-on-boot) ───────────────────────────
// Two panes booting at once each do load→record→save; without a lock the later
// rename drops the earlier pane's entry (cursor MEDIUM / codex P2). A directory
// is an atomic create-or-fail lock primitive on every POSIX fs, so mkdir of a
// `<index>.lock` dir is our mutex. We spin briefly, then steal a clearly-stale
// lock (a crashed holder must never wedge the index this exists to protect).
function lockPath(indexPath) {
  return `${indexPath}.lock`;
}

function acquireLock(indexPath, { timeoutMs = 4000, staleMs = 15000 } = {}) {
  const lock = lockPath(indexPath);
  mkdirSync(path.dirname(indexPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lock); // atomic: succeeds only if it did not exist
      return lock;
    } catch (err) {
      if (err && err.code !== "EEXIST") throw err;
      // Lock held — steal it if the holder looks dead (dir older than staleMs).
      try {
        const ageMs = Date.now() - statMtimeMs(lock);
        if (ageMs > staleMs) {
          rmdirSync(lock);
          continue;
        }
      } catch {
        // Lock vanished between EEXIST and stat — retry immediately.
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `crash-resume-index: could not acquire lock ${lock} within ${timeoutMs}ms`,
        );
      }
      busyWait(25);
    }
  }
}

function releaseLock(lock) {
  try {
    rmdirSync(lock);
  } catch {
    /* already released */
  }
}

function statMtimeMs(p) {
  return statSync(p).mtimeMs;
}

// Tiny synchronous backoff so the lock loop doesn't spin the CPU. The whole
// critical section is sub-millisecond, so this is a few short waits at most.
function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin briefly */
  }
}

// recordToFile: the LOCKED read-modify-write the CLI / Track 3 hook use for
// capture-on-boot. Acquires the lock, reloads the freshest on-disk index (so a
// concurrent pane's entry is preserved), applies record(), saves, releases.
// Returns the entry just written.
export function recordToFile(indexPath, entry, opts = {}) {
  const lock = acquireLock(indexPath, opts);
  try {
    const current = loadIndex(indexPath);
    const next = record(current, entry, opts.now);
    saveIndex(indexPath, next);
    return lookup(next, entry.surfaceId);
  } finally {
    releaseLock(lock);
  }
}

---
name: crash-resume-index
description: Durable surface→session_id index so /orc RESUMES a crashed lead (repoGolem --resume) instead of duplicate-spawning a fresh one. Triggers: crash resume, resume not respawn, lead crashed, R-036, SPAWN_OVER_RESUMABLE green path, session_id lookup.
---

# crash-resume-index (gen-18 Track 1 #3)

The **data layer** for resume-not-respawn (R-036). Maps each cmux surface/pane to
the Claude `session_id` running in it, **durably** — so when a lead pane crashes
(RAM reboot, OOM, cmux restart), /orc can `repoGolem --resume <session-id>` instead
of spawning a fresh lead and discarding the crashed session's context.

> **Why it matters:** orchestrator/263b3559#1 spawned-over-a-resumable and threw
> away **~386K tokens** of accumulated lead context. The fix is to remember which
> session was on which surface, across a reboot, and resume it.

## The flow: capture-on-boot → persist → resume-lookup

1. **Capture on boot** — when a pane boots a Claude lead/worker, call
   `record(idx, {surfaceId, sessionId, repo, role})`. First sight stamps
   `captured_at`; every re-record bumps `last_active`.
2. **Persist durably** — `saveIndex(path, idx)` writes (atomically: temp + rename)
   to a **durable** json path, default `~/.golems/crash-resume-index.json`. **NEVER
   `/tmp`** — a reboot wipes `/tmp`, which is the exact failure this index survives
   (and a tmp-block hook denies `/tmp` writes anyway).
3. **Resume-lookup after a crash** — on reboot, `loadIndex(path)` rehydrates from
   disk. `lookup(idx, surfaceId)` → the entry; `resumableFor(idx, surfaceId, {maxAgeMs})`
   → the `session_id` to resume (or `null` if unknown / too stale).
   `resumeCommand(...)` emits the **registered launcher** form
   `<repo>Claude --resume <session-id>` (e.g. `orcClaude --resume …`,
   `golemsClaude --resume …`) — the actual repoGolem launchers, not a global
   `repogolem` binary.

### Staleness is opt-in (capture-on-boot caveat)

`maxAgeMs` is **opt-in**, not a default: capture-on-boot only stamps `last_active`
at boot, so a lead that crashed hours *after* boot would look "stale" and be wrongly
denied resume if a maxAge were imposed by default (Cursor HIGH). So:
`resumableFor`/`resumeCommand` with no `maxAgeMs` accept **any** recorded session.
A caller that *does* want a liveness window should keep `last_active` fresh by
calling `touch(idx, surfaceId)` on observed liveness (Track 3's hook does this on a
screen read / inbox tick).

### Concurrency (two panes booting at once)

`record` via the CLI / Track 3 goes through `recordToFile(indexPath, entry)` — a
**locked** read-modify-write (a `<index>.lock` directory is the atomic mutex; a
clearly-stale lock from a crashed holder is stolen). Without it, two simultaneous
boots each load the same snapshot and the later `saveIndex` drops the earlier
pane's entry (Cursor MEDIUM / Codex P2). Verified: 10 parallel CLI captures → all
10 entries persist.

## How it FEEDS idle-dwell-gate's SPAWN_OVER_RESUMABLE green path

The merged `idle-dwell-gate` skill **FLAGS** `SPAWN_OVER_RESUMABLE` — a fresh
`spawn_agent` over a resumable crashed lead. That gate's **GREEN path** is "there
IS a resumable session, so resume instead of spawn." This module is the index that
answers *which* session: `resumableFor(surfaceId)` returns the `session_id` the
gate's green path resumes. The gate decides **whether** to resume; this module
supplies **what** to resume.

## Convergence with Track 3 (coordinate, don't duplicate)

This module is the **data layer + lookup** (pure functions + durable persistence).
The **live cmux capture-on-boot wiring** — the MCP hook that actually calls
`record()` when a pane boots a session — is **Track 3's** crash-resume work. Track 3
writes *through* this module; do not re-implement the index there.

## API (`src/crash-resume-index.mjs`, ESM)

| Function | What |
|---|---|
| `record(idx, {surfaceId, sessionId, repo, role}, now?)` | capture-on-boot; append/update; returns a new index (pure) |
| `recordToFile(indexPath, entry, opts?)` | **locked** capture-on-boot RMW (reload→record→save under a lock) — concurrency-safe |
| `touch(idx, surfaceId, now?)` | bump `last_active` for liveness (keeps a long-running session resumable) |
| `lookup(idx, surfaceId)` | entry `{surfaceId, sessionId, repo, role, captured_at, last_active}` or `null` |
| `resumableFor(idx, surfaceId, {maxAgeMs?, now?})` | the `session_id` to resume, or `null` if unknown/stale (`maxAgeMs` opt-in) |
| `launcherFor(repo)` | the registered per-repo launcher (`golems`→`golemsClaude`, `orchestrator`→`orcClaude`) |
| `resumeCommand(idx, surfaceId, opts?)` | `<repo>Claude --resume <id>` (or `repoGolem --resume <id>` if repo unknown), or `null` |
| `pruneStale(idx, maxAgeMs, now?)` | drop entries past `maxAgeMs`; returns a new index |
| `loadIndex(path?)` / `saveIndex(path?, idx?)` | durable persistence; corrupt/missing → empty index (boot never blocks) |
| `DEFAULT_INDEX_PATH` | `~/.golems/crash-resume-index.json` |

## CLI (`scripts/crash-resume-index-cli.mjs`)

```bash
crash-resume-index-cli.mjs record <surfaceId> <sessionId> <repo> [role]
crash-resume-index-cli.mjs lookup <surfaceId>
crash-resume-index-cli.mjs resume-cmd <surfaceId> [maxAgeMs]   # prints <repo>Claude --resume …; exit 4 = none
# override path: --path <file>  or  CRASH_RESUME_INDEX_PATH
```

## Tests

`evals/crash-resume-index.test.mjs` (bun:test, also `node --test`): record → save →
load **across a simulated reboot** (fresh `loadIndex` from the file returns the
entry) → lookup → `resumableFor` returns the right `session_id` → `pruneStale`
drops old entries → `resume-cmd` emits the correct repoGolem command. Negatives:
unknown surface → `null`; a stale entry past `maxAge` is not offered as resumable.

```bash
bun test skills/golem-powers/crash-resume-index/evals/
```

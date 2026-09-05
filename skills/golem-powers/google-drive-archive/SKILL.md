---
name: google-drive-archive
description: "Archive >100KB research/media to Brain Drive. Triggers: Drive upload, archive this, post-digest archival."
---

# /google-drive-archive — Brain Drive as Source of Truth

> **Pattern:** Brain Drive holds **forever**. `docs.local/` holds **latest only**. BrainLayer **indexes both**. A `_DRIVE-LEDGER.md` per `docs.local/` subdir maps local → Drive.

This skill is for **putting things INTO Drive**. To **query Drive content** via Gemini, use `/braindrive`. To **research the web** with Drive sources, use `/gemini-research`.

---

## Source-of-Truth Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│  BRAIN DRIVE                                                 │
│  ────────────                                                │
│  • Forever storage (free up to 15GB; user has the quota)     │
│  • All versions, heavy assets, raw research outputs          │
│  • Path: Brain Drive/06_ARCHIVE/<area>/<topic>/<date>/...    │
│  • Source of truth — if it's only in docs.local/, it isn't   │
│    durable                                                   │
└──────────────────────────────────────────────────────────────┘
                         ▲
                         │  upload + update ledger
                         │
┌──────────────────────────────────────────────────────────────┐
│  docs.local/  (git-ignored)                                  │
│  ───────────                                                 │
│  • Local cache — only the LATEST versions                    │
│  • Lightweight markdown only (no >100KB media)               │
│  • Per-dir `_DRIVE-LEDGER.md` lists every Drive copy + URL   │
│  • Safe to delete: contents are recoverable from Drive       │
└──────────────────────────────────────────────────────────────┘
                         ▲
                         │  brain_digest extracts entities/relations
                         │
┌──────────────────────────────────────────────────────────────┐
│  BRAINLAYER                                                  │
│  ──────────                                                  │
│  • Searchable index over text content (transcripts, docs)    │
│  • Chunks link back to Drive URLs                            │
│  • Use brain_search before brain_store — dedupe the index    │
└──────────────────────────────────────────────────────────────┘
```

**One-line rule:** Heavy or forever → Drive + ledger entry + (if textual) brain_digest. Local copies are caches, not archives.

---

## Triggers

Invoke this skill when:

1. **Pre-write hint:** about to save anything >100KB to `docs.local/research/`, `docs.local/audits/`, or `docs.local/plans/` — especially if it contains transcripts, audio, video, or large logs.
2. **Explicit user request:** "save this to Drive", "archive this", "this should be in Brain Drive", "put this in the archive".
3. **Post-digest:** a research output has been `brain_digest`'d into BrainLayer and the raw file is a candidate for archival (BrainLayer indexes it; Drive holds the original).
4. **/tmp cleanup:** about to `rm -rf /tmp/<heavy-stuff>` — if any of it is forever-knowledge, route it through this skill first.

**Skip this skill** when:
- The artifact is genuinely ephemeral (CLI test output, throwaway diff, audit prompt that's already digested).
- The content is already covered by another archive flow (e.g. PR merges live in git, not Drive).
- File is <100KB markdown that's the canonical doc kept in `docs.local/` (no need to upload markdown notes).

---

## Workflow

### 1. Decide: ephemeral or forever?

Ask: **"Will future-Etan or another agent want to re-read this raw artifact a month from now?"**

| Answer | Action |
|---|---|
| Yes (transcripts, audits, plans, research outputs, media) | Forever → continue to step 2. |
| No (intermediate processing files, throwaway logs, regeneratable derivatives) | Skip. Just delete after use. Note the choice in commit message or BrainLayer. |
| Mixed (e.g. `audio.wav` keep, `audio-16k.wav` derivative skip) | Upload only the originals. Document which derivatives are regeneratable + how. |

### 2. Resolve the Drive archive path

Default convention (matches `Brain Drive/06_ARCHIVE/repos/union-2026-04/` precedent):

```
Brain Drive/06_ARCHIVE/<area>/<topic>/<date-or-tag>/<artifact-folder>/
```

| `<area>` | When |
|---|---|
| `research` | Web research, deep research, video gems, audits-as-research |
| `audits` | Code audits, security reviews, compliance reports |
| `plans` | Multi-phase plans (`large-plan` outputs), architecture proposals |
| `repos` | Whole-repo snapshots (e.g. before a destructive refactor) |
| `voice` | Voice session transcripts + audio |

Use `mcp__google-drive__search` to find existing parent folders before creating new ones — match precedent if one exists.

### 3. Create the folder tree

```
mcp__google-drive__createFolder(name=<level>, parent=<parent-id>)
```

Capture the returned folder ID at every level. You will need them in the ledger.

### 4. Upload the artifacts

```
mcp__google-drive__uploadFile(localPath=<absolute>, parentFolderId=<id>)
```

- Parallel for files in the same folder is safe.
- Big files (>100MB): the MCP handles them; just call once and wait.
- Capture `id`, `link`, and `size` from each upload return.

### 5. brain_digest text content

For every `transcript.txt`, `report.md`, `audit.md`, `plan.md` you upload:

```
mcp__brainlayer__brain_digest(content=<file content>)
```

Capture the returned `chunk_id`. This makes the *full text* searchable — gem extractions and structured chunks cover the highlights, but `brain_digest` is what catches phrases the gem extractor missed.

For files >150KB, an inner agent with `brain_digest` loaded can do this in the background (large content blows up the orchestrator's context).

### 6. Write / update the local ledger

Path: `docs.local/<area>/<topic>/_DRIVE-LEDGER.md`

```markdown
# Drive Ledger — <topic>

> Source of truth for these artifacts is Brain Drive. Local files are caches.

| File | Local path | Drive folder | Drive ID | Drive URL | Size | BrainLayer chunk | Uploaded |
|---|---|---|---|---|---|---|---|
| transcript.txt | docs.local/.../transcript.txt | <folder-id> | <file-id> | <link> | 30KB | brainbar-... | 2026-04-25 13:01 |
| audio.wav | (deleted from /tmp after upload) | <folder-id> | <file-id> | <link> | 312MB | n/a | 2026-04-25 13:08 |

## Skipped (regeneratable derivatives)
- `audio-16k.wav` — 16kHz mono downsample of `audio.wav` for whisper-cli. Regenerate via `ffmpeg -i audio.wav -ar 16000 -ac 1 audio-16k.wav`.
```

The ledger is what lets a future agent answer **"where is the original?"** without spelunking through Drive.

### 7. (Optional) Delete the local heavy copy

Only after:
- `mcp__google-drive__listFolder` confirms the file is present and sized correctly.
- Ledger entry is written.

Markdown notes <100KB stay in `docs.local/` (they're the latest cache). Heavy media (>10MB audio/video) can be deleted locally — Drive is the canonical copy.

### 8. brain_store the decision (optional, for non-trivial archives)

```
brain_store(
  content="Archived <topic> to Brain Drive at <path>. Rationale: <why forever>. Skipped: <derivatives + how to regenerate>.",
  tags=["google-drive-archive", "<area>", "<topic>", "milestone"],
  importance=6-8
)
```

Skip for routine archives (one transcript, one report). Store for unusual decisions: large batches, format choices, retention policy edges.

---

## Anti-patterns

| Anti-pattern | Why it's wrong | Do instead |
|---|---|---|
| Saving 1.5GB transcripts to `docs.local/` and committing | Bloats the working dir, hits git ignore edges, no durable copy | Drive + ledger; `docs.local/` keeps the markdown summary only |
| `rm -rf /tmp/extract/` without checking forever-value | Loses raw audio/video that's expensive to regenerate (yt-dlp re-downloads, whisper re-runs) | This skill: route through "ephemeral or forever?" decision first |
| brain_digest a transcript but NOT upload to Drive | BrainLayer has the index but the raw file is gone — citations break, full text unrecoverable | Upload to Drive AND brain_digest. Both. |
| Upload to Drive but skip the ledger | Drive becomes a junk drawer; future agents can't find the URL | Always update `_DRIVE-LEDGER.md` |
| Re-uploading something that's already in Drive | Wastes quota, confuses search | `mcp__google-drive__search` first; match existing folder if precedent exists |
| Committing `_DRIVE-LEDGER.md` to git | Ledger is a per-machine cache; the source of truth is Drive | Keep in `docs.local/` (which is git-ignored) |

---

## Composability

- **`/research-lifecycle`** — when condensing/archiving stale research files, use this skill to push originals to Drive before deleting locally.
- **`/qa-video`** — video gems and QA processing produce transcripts, frames, and heavy media; this skill is where they land long-term. The qa-video gems output is in `/tmp/` by default; route to Drive on completion.
- **`/large-plan`** — when a plan completes, archive the full plan folder to `Brain Drive/06_ARCHIVE/plans/<name>-<date>/`.
- **Nightly sweep** — scan `docs.local/` for >100KB files lacking ledger entries and prompt to archive.

---

## Related Tools (reference, not re-document)

- `mcp__google-drive__*` — `search`, `createFolder`, `uploadFile`, `listFolder`. The braindrive MCP is already authenticated; for auth drift run `nlm login switch <profile> && mcp__google-drive__refresh_auth` (this is the repo's established remediation, used by `skills/golem-powers/_shared/research/verify-account.sh`). `authGetStatus` is a status check, not a fix.
- `mcp__brainlayer__brain_digest` — for textual content >2KB.
- `mcp__brainlayer__brain_store` — for decisions about archives.
- `mcp__brainlayer__brain_search` — to find existing chunks before re-digesting.

---

## Output Format (when reporting an archive operation)

```
## Archived: <topic>
- Drive: Brain Drive/06_ARCHIVE/<path> (folder ID: <id>)
- Files: N text + M media (X MB / Y GB total)
- BrainLayer chunks: <chunk_id_1>, <chunk_id_2>
- Ledger: docs.local/<area>/<topic>/_DRIVE-LEDGER.md
- Local cleanup: deleted /tmp/<...> (X GB freed) | retained markdown (<size>)
- Skipped derivatives: <list> (regenerate via <command>)
```

Keep it ≤10 lines. Detail goes in the ledger.

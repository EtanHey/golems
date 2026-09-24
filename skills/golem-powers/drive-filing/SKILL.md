---
name: drive-filing
description: "Brain Drive filing, archival, and the docs.local lifecycle. Triggers: Drive/Brain Drive upload, archive this, post-digest archival, docs.local cleanup, docs.local artifacts, rollup, folders, prompts/results, audits, plans, transcripts, dashboards. NOT for Gemini Drive/web research."
---

# /drive-filing — filing, archival, and the docs.local lifecycle

> One skill for everything that moves durable artifacts out of `docs.local/` (formerly `drive-usage`,
> `google-drive-archive`, and the `archive` skill).
> Named `drive-filing`, not `brain-drive`, so it is not one hyphen away from `/braindrive` (the Gemini
> Drive query command).
>
> Etan's pain: agents (except researchers) don't use Drive right and **leave artifacts scattered in `docs.local/`**. This skill makes filing automatic. **Rule of thumb: if an artifact should outlive this session, it goes to Brain Drive in the RIGHT folder — `docs.local/` is a cache, not a home.**

| Need | Go to |
|---|---|
| Which folder, what name | § Brain Drive folder model, § Decision tree, § Naming convention (below) |
| Put a heavy (>100KB / media / transcript) artifact into Drive, with ledger + brain_digest | § Archive a heavy artifact → [references/archive-procedure.md](references/archive-procedure.md) |
| Keep `docs.local/` legible over time (daily → monthly → Drive) | § docs.local lifecycle |

Not this skill: `/braindrive` *queries* Drive via Gemini; `/gemini-research` does web research with Drive sources.

## Brain Drive folder model

Folder IDs are private deployment values. Resolve them from the environment or private operator
configuration; never copy live Drive IDs into this skill.

| Folder | id | What goes here |
|--------|----|----|
| `01_STANDARDS` | `${BRAIN_DRIVE_STANDARDS_FOLDER_ID}` | Canonical specs, conventions, locked schemas, standards docs (durable reference). |
| `02_GROUNDING` | `${BRAIN_DRIVE_GROUNDING_FOLDER_ID}` | Grounding corpora / reference data agents ground answers on. |
| `03_RESEARCH` | `${BRAIN_DRIVE_RESEARCH_FOLDER_ID}` | Research **prompts + results**. In-flight → `03_RESEARCH/Active/<topic>/` via `${BRAIN_DRIVE_RESEARCH_ACTIVE_FOLDER_ID}`. |
| `04_INGEST` | `${BRAIN_DRIVE_INGEST_FOLDER_ID}` | Raw inbound to be processed/digested (not yet curated). |
| `06_ARCHIVE` | `${BRAIN_DRIVE_ARCHIVE_FOLDER_ID}` | **Forever** storage of finished heavy artifacts (transcripts, audio/video, big audits/plans). Target of § Archive a heavy artifact. |

> Folder *semantics* (what each numbered folder means) are confirmed with brainlayer-LEAD (s:57, owns Drive/backup). Legacy non-numbered folders (`Research` ×2 duplicates, `Sessions`, `Collabs`, `_inbox-*`, `BrainBar Design Audit`) are pre-taxonomy scatter — **do not add to them**; file into the numbered model. (Consolidation of the legacy dupes is an s:57 cleanup task.)

## Decision tree (where does THIS artifact go?)

1. **A research prompt or its results?** → `03_RESEARCH/Active/<topic>/` (e.g. `skills-eval/`). Drive-ground prompts by uploading the real artifacts beside them.
2. **A finished heavy artifact (>100KB / media / raw transcript / big audit)?** → § Archive a heavy artifact → lands in `06_ARCHIVE/<area>/<topic>/<date>/`, leaves a `_DRIVE-LEDGER.md` pointer in `docs.local/`.
3. **A canonical standard / spec / locked schema?** → `01_STANDARDS/`.
4. **Grounding corpus / reference data?** → `02_GROUNDING/`.
5. **Raw, not-yet-digested inbound?** → `04_INGEST/`.
6. **Lightweight, session-scoped scratch?** → fine to leave in `docs.local/` — but if anyone else (or future-you) needs it, FILE it per 1–5.

## Naming convention
`YYYY-MM-DD-<topic>[-<surface/agent>].<ext>` — date-prefixed, kebab-case, topic-first. Folders: `<topic>-<domain>/` (e.g. `weave-eval/`). Keep the local mirror name identical to the Drive name so the ledger maps 1:1.

## The discipline (the one rule)
**Before you finish a task that produced a durable artifact: did you FILE it in the right Brain Drive folder, or leave it scattered in `docs.local/`?** If durable and still only local → file it now (the decision tree above, or § Archive a heavy artifact) and drop a one-line `_DRIVE-LEDGER.md` pointer. "It's in docs.local" is not "it's saved."

## Quick reference (MCP)
- Upload: `mcp__google-drive__uploadFile(localPath, parentFolderId=<resolved private ID>)`.
- New topic folder: `mcp__google-drive__createFolder(name, parent=<resolved private ID>)`.
- Find: `mcp__google-drive__search(query="'<RESOLVED_PRIVATE_PARENT_ID>' in parents", rawQuery=true)`.
- Heavy/forever: § Archive a heavy artifact.

## Archive a heavy artifact

Full procedure: [references/archive-procedure.md](references/archive-procedure.md) (was
`/google-drive-archive`). Fire it on "save this to Drive", "archive this", "put this in the
archive", a >100KB write to `docs.local/{research,audits,plans}/`, a post-`brain_digest` raw file,
or a `/tmp` cleanup that may hold forever-knowledge. The eight steps, in short:

1. Ephemeral or forever? Only originals go up; list regeneratable derivatives and how to rebuild them.
2. Resolve `Brain Drive/06_ARCHIVE/<area>/<topic>/<date-or-tag>/` (`research`, `audits`, `plans`,
   `repos`, `voice`); `mcp__google-drive__search` for precedent first.
3. `createFolder` per level, keeping every ID. 4. `uploadFile`; keep `id`, `link`, `size`.
5. `brain_digest` every text file (a background agent for >150KB).
6. Write `docs.local/<area>/<topic>/_DRIVE-LEDGER.md` (never committed).
7. Delete the local heavy copy only after `listFolder` confirms it and the ledger is written.
8. `brain_store` unusual archive decisions only.

Never: commit a 1.5GB transcript, `rm -rf /tmp/…` before the forever check, digest without
uploading, upload without a ledger row, re-upload what Drive already has.

## docs.local lifecycle

`docs.local/` stays legible, "not just walls of MD files": daily items (`YYYY-MM-DD-*`) roll up into
monthly folders (`YYYY-MM/`), and months older than N go to Brain Drive through § Archive a heavy
artifact, with a `_DRIVE-LEDGER.md` pointer left behind. `/fleet-wrap` is to run it at sprint close
(skillcreator owns that call site; golems owns this skill).

```bash
node <drive-filing-dir>/scripts/rollup.mjs --repo <path> --keep-months N            # dry-run (default): report only
node <drive-filing-dir>/scripts/rollup.mjs --repo <path> --keep-months N --json     # the full plan
node <drive-filing-dir>/scripts/rollup.mjs --repo <path> --keep-months N --apply    # month moves + plan file
```

The last stdout line is the one-line summary `/fleet-wrap` records: `drive-filing rollup: mode=… files=…
bytes=… · monthly-moves=… · to-drive months=… files=… bytes=… · held=… credentials-skipped=…`.
Only items whose name starts with `YYYY-MM-DD` and existing `YYYY-MM/` folders take part; undated
files are counted and left alone. A month rolls up once it is over; months more than N back form the
upload plan, one unit per folder, targeting `Brain Drive/06_ARCHIVE/docs-local/<repo>/<area>/<YYYY-MM>`.
`--apply` moves items into their month folders (never overwriting; a clash is reported as `conflict:`)
and writes `docs.local/_drive-filing/rollup-plan-<date>.json`. **The script never uploads or deletes.**
Upload exactly the files in that plan through the [archive procedure](references/archive-procedure.md)
(ledger + `brain_digest`), and nothing that is not in it.

**Credentials never move.** Nothing whose name contains `credential`, `token` or `.env` (`.env*`,
`deploy.env`, `.ENV.prod`, `.envrc`), or ends in `auth.json`, `.pem` or `.key`, and nothing under a
`codexhome`/`codex-home*`, `claudehome`/`claude-home*`, `.codex`, `.claude` or `*-HOME*` directory or a
browser profile (a dir holding `Local State`, `Cookies`, `Login Data` or `Web Data`), is uploaded,
moved or deleted. Every name rule matches anywhere in the name, case-insensitively, because
docs.local names are date-prefixed. `rollup.mjs` enforces this in code: each credential is reported
as `skipped: credential <path>` (a credential directory is one line plus its credential-named
files), and a month group (the `YYYY-MM/` folder plus that month's dated siblings in the same
folder) that holds one is **held whole**: no moves into or out of it, no upload unit. It is reported
once as `held: contains credentials <path>` with its items and credentials listed under it.
Cleaning them up is the owner's call.

> **After creating/editing this skill it must be REGISTERED** (golem-install / symlink into `~/.claude/skills`) before any agent can invoke it — committed ≠ installed.

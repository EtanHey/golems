---
name: drive-usage
description: "Brain Drive filing discipline: where artifacts go + how to name them. Triggers: Drive/Brain Drive upload, folders, prompts/results, audits, plans, transcripts, dashboards, docs.local artifacts. NOT for Gemini Drive/web research; >100KB use archive."
---

# /drive-usage — Brain Drive filing discipline (where things go)

> Etan's pain: agents (except researchers) don't use Drive right and **leave artifacts scattered in `docs.local/`**. This skill makes filing automatic. **Rule of thumb: if an artifact should outlive this session, it goes to Brain Drive in the RIGHT folder — `docs.local/` is a cache, not a home.**

This is the **routing/where-does-this-go** layer. Related: `/google-drive-archive` = the heavy (>100KB/media) archival *workflow*; `/braindrive` = *query* Drive via Gemini; `/gemini-research` = web research with Drive sources. This skill decides **which folder + what name**, then hands off to those for the actual move when heavy.

## Brain Drive folder model

Folder IDs are private deployment values. Resolve them from the environment or private operator
configuration; never copy live Drive IDs into this skill.

| Folder | id | What goes here |
|--------|----|----|
| `01_STANDARDS` | `${BRAIN_DRIVE_STANDARDS_FOLDER_ID}` | Canonical specs, conventions, locked schemas, standards docs (durable reference). |
| `02_GROUNDING` | `${BRAIN_DRIVE_GROUNDING_FOLDER_ID}` | Grounding corpora / reference data agents ground answers on. |
| `03_RESEARCH` | `${BRAIN_DRIVE_RESEARCH_FOLDER_ID}` | Research **prompts + results**. In-flight → `03_RESEARCH/Active/<topic>/` via `${BRAIN_DRIVE_RESEARCH_ACTIVE_FOLDER_ID}`. |
| `04_INGEST` | `${BRAIN_DRIVE_INGEST_FOLDER_ID}` | Raw inbound to be processed/digested (not yet curated). |
| `06_ARCHIVE` | `${BRAIN_DRIVE_ARCHIVE_FOLDER_ID}` | **Forever** storage of finished heavy artifacts (transcripts, audio/video, big audits/plans). Target of `/google-drive-archive`. |

> Folder *semantics* (what each numbered folder means) are confirmed with brainlayer-LEAD (s:57, owns Drive/backup). Legacy non-numbered folders (`Research` ×2 duplicates, `Sessions`, `Collabs`, `_inbox-*`, `BrainBar Design Audit`) are pre-taxonomy scatter — **do not add to them**; file into the numbered model. (Consolidation of the legacy dupes is an s:57 cleanup task.)

## Decision tree (where does THIS artifact go?)

1. **A research prompt or its results?** → `03_RESEARCH/Active/<topic>/` (e.g. `skills-eval-phoenix/`). Drive-ground prompts by uploading the real artifacts beside them.
2. **A finished heavy artifact (>100KB / media / raw transcript / big audit)?** → invoke **`/google-drive-archive`** → lands in `06_ARCHIVE/<area>/<topic>/<date>/`, leaves a `_DRIVE-LEDGER.md` pointer in `docs.local/`.
3. **A canonical standard / spec / locked schema?** → `01_STANDARDS/`.
4. **Grounding corpus / reference data?** → `02_GROUNDING/`.
5. **Raw, not-yet-digested inbound?** → `04_INGEST/`.
6. **Lightweight, session-scoped scratch?** → fine to leave in `docs.local/` — but if anyone else (or future-you) needs it, FILE it per 1–5.

## Naming convention
`YYYY-MM-DD-<topic>[-<surface/agent>].<ext>` — date-prefixed, kebab-case, topic-first. Folders: `<topic>-<domain>/` (e.g. `weave-eval-phoenix/`). Keep the local mirror name identical to the Drive name so the ledger maps 1:1.

## The discipline (the one rule)
**Before you finish a task that produced a durable artifact: did you FILE it in the right Brain Drive folder, or leave it scattered in `docs.local/`?** If durable and still only local → file it now (this skill or `/google-drive-archive`) and drop a one-line `_DRIVE-LEDGER.md` pointer. "It's in docs.local" is not "it's saved."

## Quick reference (MCP)
- Upload: `mcp__google-drive__uploadFile(localPath, parentFolderId=<resolved private ID>)`.
- New topic folder: `mcp__google-drive__createFolder(name, parent=<resolved private ID>)`.
- Find: `mcp__google-drive__search(query="'<RESOLVED_PRIVATE_PARENT_ID>' in parents", rawQuery=true)`.
- Heavy/forever: hand off to `/google-drive-archive`.

> **After creating/editing this skill it must be REGISTERED** (golem-install / symlink into `~/.claude/skills`) before any agent can invoke it — committed ≠ installed.

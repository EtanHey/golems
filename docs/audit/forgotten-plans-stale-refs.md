# Forgotten Plans, Stale References & Configuration Drift

*Generated: 2026-02-08 — by Cursor (GPT-5.2-codex-high) + Claude Opus audit*

---

## Forgotten Plans (TODO/FIXME/Planned)

### In Source Code

| Priority | File | Line(s) | Issue |
|----------|------|---------|-------|
| MEDIUM | `src/ollama-sandboxed.ts` | 341, 349 | TODO: Return null instead of empty array |
| MEDIUM | `src/ollama-helper.ts` | 25, 74, 82 | TODO: Return null instead of empty array (3 occurrences) |
| MEDIUM | `src/email-golem/router.ts` | 52 | TODO: Use score for priority-based routing |
| LOW | `src/job-golem/scraper.ts` | 153 | TODO: Increase delay between requests (429 after ~50 jobs) |
| LOW | `src/job-golem/scraper.ts` | 307 | TODO: Cache results (24h cache by slug) |
| LOW | `src/__tests__/job-golem-integration.test.ts` | 54 | TODO: Fix matcher to check WRONG_STACK before RIGHT_STACK |
| LOW | `src/available-skills.json` | 5 | TODO: Replace community_resource URL with own docs link |

### In Documentation

| Priority | File | Issue |
|----------|------|-------|
| MEDIUM | `packages/autonomous/NOTES.md:22-28` | Event-log integration TODOs still open (wire into telegram-bot, askClaude, briefing) |
| MEDIUM | `packages/autonomous/NOTES.md:33-38` | Event types not yet used (draft_scored, pattern_extracted, job_match) |
| MEDIUM | `docs/future-ideas.md` | Entire file is a Feb 2 planning session — dashboard (Expo), Ollama scheduling, queue system — none implemented |
| LOW | `docs/future-ideas.md:394-401` | Open questions (auth, multi-device, model choice, LinkedIn, Moltbook) never resolved |
| LOW | `docs/golems-v2-branding-plan.md:1072` | Spring 2026 multi-agent collaboration still planned |

---

## Stale References (Moltbook → Soltome Rename)

**Background:** Moltbook was renamed to Soltome. 18 files still reference the old name.

### HIGH Priority (in code/config)

| File | Lines | Issue |
|------|-------|-------|
| `src/telegram-bot.ts` | 250, 2115 | Prompt still references `soltome-influencer` skill (deleted/merged into `/content`) |

### MEDIUM Priority (in docs that get read by agents)

| File | Lines | Issue |
|------|-------|-------|
| `CLAUDE.md` (root) | 51 | References `moltbook-integration.md` |
| `packages/ralph/CLAUDE.md` | 112-114 | "GolemsZikaron (Moltbook Bot)" header |
| `packages/zikaron/CLAUDE.md` | 258 | "posting to Moltbook" |
| `packages/autonomous/NOTES.md` | 110-120 | References `moltbook-learner.ts` (file doesn't exist) |
| `delegation-prompts.md` | 88, 98, 106, 110 | Moltbook integration + `src/moltbook-*.ts` (files missing) |
| `docs/future-ideas.md` | 73, 82, 90, 312, 332, 341, 400 | Moltbook learner/browsing plans |
| `bin/setupGolemClaude` | 113-114 | Moltbook integration listed |

### LOW Priority (in rarely-read docs)

| File | Lines | Issue |
|------|-------|-------|
| `packages/autonomous/docs/SANDBOXED-OLLAMA.md` | 13, 103, 105 | Moltbook references |
| `packages/autonomous/contexts/sandboxed-ollama.md` | 8, 20, 50 | Moltbook content generation |
| `packages/autonomous/progress.txt` | 9, 30, 34, 67, 69, 73 | Moltbook milestones |
| `docker/ollama/docker-compose.yml` | 79 | Moltbook key comment |

---

## Configuration Drift

| Priority | Area | Issue |
|----------|------|-------|
| HIGH | `packages/zikaron/CLAUDE.md` | Says sqlite-vec + bge-large (lines 85-93) and ChromaDB removed (line 53), but code still uses Ollama embeddings + ChromaDB in `pipeline/embed.py` and `pipeline/index.py` |
| MEDIUM | `chromadb` in `packages/autonomous/package.json` | Listed as dependency but never imported via JS SDK — `thread-compactor.ts` uses raw HTTP to ChromaDB API |
| LOW | `docs.local/` references | Referenced in CLAUDE.md files but doesn't exist in repo (gitignored); confusing for fresh clones |

---

## Stale PRD Stories (prd-json)

All 7 blocked stories in `packages/autonomous/prd-json/index.json` are either Moltbook-related or depend on Moltbook stories.

| Priority | Story | Title | Issue |
|----------|-------|-------|-------|
| HIGH | `US-101` | Ollama Autonomous Moltbook Surfing | Marked done but Moltbook integration removed |
| HIGH | `BUG-104` | Moltbook API Endpoint Does Not Exist | Obsolete after Soltome pivot |
| MEDIUM | `US-104` | Ollama Bot Context Loading | Blocked by US-103; depends on ChromaDB + ollama-chat-bot.ts |
| MEDIUM | `US-105` | Moltbook Context in Thread Memory | Obsolete (Moltbook → Soltome) |
| MEDIUM | `US-106` | (blocked) | Check dependency chain |
| MEDIUM | `US-107` | (blocked) | Check dependency chain |
| MEDIUM | `AUDIT-102` | Ollama /munch Command | References `molt-cache.json` (doesn't exist) |
| MEDIUM | `AUDIT-103` | Night Shift Moltbook Cycle | Obsolete |
| LOW | `US-108` | /forage command | Pivoted to Soltome but still references `moltbook-client.ts` |

### Recommendation
Archive or delete all Moltbook-related PRD stories. Create fresh Soltome-oriented stories if functionality is still desired.

---

## Stale Files

| File | Lines | Why Stale |
|------|-------|-----------|
| `delegation-prompts.md` | 389 | References Moltbook, old architecture; outdated delegation patterns |
| `packages/autonomous/progress.txt` | ~80 | Old progress tracker; superseded by PRD system |
| `packages/autonomous/docs/SANDBOXED-OLLAMA.md` | ~120 | References Moltbook; sandboxed Ollama pattern no longer used |
| `packages/autonomous/contexts/sandboxed-ollama.md` | ~55 | Same — sandboxed Ollama context with Moltbook references |
| `docker/ollama/docker-compose.yml` | ~80 | Docker Ollama setup; Ollama runs natively now |

---

## Obsidian Vault — Unapproved Plans & Forgotten Items

*Vault location:* `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/personal/`

### Unapproved Plans (Awaiting Action)

| Priority | File | Status | Description |
|----------|------|--------|-------------|
| HIGH | `Projects/Golems/Ideas/GitHub-Ruleset-CI-Plan.md` | UNAPPROVED | Protect master with GitHub Rulesets, CI typecheck, pre-commit hook. Fully spec'd, never executed. |
| HIGH | `Projects/Golems/Ideas/RecruiterGolem-Master-Plan.md` | UNAPPROVED DRAFT | 3-wave plan: email skill extraction, Elo coaching, async agent collab. Never started. |
| MEDIUM | `Projects/Golems/Research/content-pipeline-v2.md` | DRAFT | Parallel content creation with researcher + influencer agents. Never implemented. |

### Broken Services (from investigation report)

Source: `Untitled 3.md` (investigation report, Feb 8)

| Priority | Issue | Details |
|----------|-------|---------|
| HIGH | Railway cloud worker retired | Railway service deleted 2026-07-05; verify Email/Job coverage through local or successor scheduling |
| HIGH | Notify server (3847) down | `curl localhost:3847` returns "not found" |
| HIGH | Email + Job Golem not loaded | Plists exist but not loaded in launchd; neither local nor cloud running |
| MEDIUM | Jobs tab `.limit(100)` | 147 jobs in Supabase, only 100 shown in dashboard |
| MEDIUM | Outreach data never migrated | `migrate-to-supabase.ts --execute` was never run |
| MEDIUM | Night Shift state not syncing | Local file writes vs Supabase reads — dashboard can't see night shift data |

### Backlog Items (Not Tracked in Codebase)

Source: `Projects/Golems/Ideas/BACKLOG.md` (last updated Feb 3)

| # | Item | Priority | Status |
|---|------|----------|--------|
| 7 | Ralph UI Enhancements (model colors, iteration history) | MEDIUM | Not started |
| 8 | Golem Hibernation System (`/hibernate` + `/resume`) | MEDIUM | Not started |
| 10 | External Tools Evaluation (orchestkit, spec-kit) | LOW | Not started |
| 11 | Golems Dashboard (unified web/app control panel) | LOW | Admin-UI built (PR #37-58) but incomplete |
| 12 | Documentation as First-Class Citizen | LOW | Not started |
| 13 | Telegram Bot Cleanup (remove inbox.md/outbox.md) | LOW | Not started |

### JobGolem Multi-Wave Research (Significant Unreferenced Work)

`Projects/Golems/Ideas/JobGolem/` contains 8 waves of multi-agent collaborative research (Feb 3-4):

| Wave | File | Size | Topic |
|------|------|------|-------|
| 1 | `Research-Collab.md` | 12K | Initial JobGolem research |
| 2 | `Implementation-Collab.md` | 12K | Implementation plan |
| 3 | `Wave3-AsyncCollab/` | folder | Async agent collaboration patterns |
| 5 | `Wave5-Filtering/` | folder | Job filtering algorithms |
| 6 | `Wave6-Sources/` | folder | Job board source expansion |
| 7 | `Wave7-Verification/` | folder | Verification rounds |
| 8 | `Wave8-Verification/` | folder | Final verification |
| - | `Ideation-Collab.md` | **30K** | Main ideation document |
| - | `Prompt Engineering Research.md` | 6K | Prompt optimization for job scoring |

This represents significant research investment (~110K of content) that doesn't appear to be referenced from the codebase. Some findings may already be implemented; others may contain useful ideas for future JobGolem improvements.

### Root-Level Obsidian Ideas

| File | What | Status |
|------|------|--------|
| `Ideas.md` | "Add email sending capability to email-golem for outbound emails (sending files, tax summaries, etc)" | Not implemented |
| `Golems admin.md` | 3 admin dashboard bugs: (1) no email data showing, (2) want swipe between pages, (3) possible type/table mismatch | Open bugs |
| `daily-schedule-draft.md` | References JobGolem in daily workflow (review matches at 1:30pm) — assumes JobGolem runs, which it doesn't | Stale assumption |

### Obsidian ↔ Codebase Sync Issues

| Priority | Issue | Details |
|----------|-------|---------|
| MEDIUM | `docs-local-backup/` | 9 files backed up from docs.local/ (coderabbit-learnings, coverage-sweep, migration-plan-anthropic-memory, etc.) — may be stale copies |
| MEDIUM | `Soltome/` folder | Has Content-Calendar.md and Drafts/ — may overlap with `data/drafts.json` and `data/content-calendar.json` |
| MEDIUM | `golems-v2-branding-plan.md` | 75K file exists in BOTH vault root AND docs-local-backup/ (duplicate) |
| LOW | `Golems/README.md` stale | Lists OllamaGolem as active bot (ollama-chat-bot.ts is confirmed DEAD code), wrong schedules |

### Other Obsidian Notes

| File | Relevance |
|------|-----------|
| `Projects/Golems/Ideas/Verified-Planning-Workflow.md` | Documented workflow pattern — could become a skill |
| `Projects/Golems/Research/AI Data Monetization.md` | 26K research on selling dev history data — exploratory |
| `Projects/Golems/Research/Farther-Steps Zikaron Integration.md` | Architecture for zikaron context-proposals via farther-steps queue |
| `Projects/Golems/Research/context-engineering-guide.md` | Reference doc (saved artifact), not actionable |
| `Projects/Golems/Research/claude-collab-3-claudes-monorepo.md` | 19K on multi-Claude collab patterns |
| `Projects/etanheyman.com-projects-to-add.md` | 4 project entries ready for portfolio Supabase table |
| `TechGym - הכנה למפגש.md` | Presentation prep — lists Golems, Zikaron, SongScript as highlights |
| `Ralph Ideas.md` (in Done/) | 8 raw ideas including WhatsApp integration, auto-detect action items, local LLM for JSON |

---

## Summary

| Category | HIGH | MEDIUM | LOW | Total |
|----------|------|--------|-----|-------|
| Forgotten Plans (code) | 0 | 5 | 7 | 12 |
| Stale References | 1 | 7 | 4 | 12 |
| Config Drift | 1 | 1 | 1 | 3 |
| Stale PRDs | 2 | 5 | 1 | 8 |
| Stale Files | 0 | 0 | 0 | 5 |
| Obsidian: Unapproved Plans | 2 | 1 | 0 | 3 |
| Obsidian: Broken Services | 3 | 3 | 0 | 6 |
| Obsidian: Backlog | 0 | 2 | 4 | 6 |
| Obsidian: Sync Issues | 0 | 3 | 1 | 4 |
| Obsidian: Root-Level Items | 0 | 1 | 2 | 3 |
| **Total** | **9** | **28** | **20** | **62** |

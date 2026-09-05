# @golems/jobs

> Job discovery service — scraping, matching, and state for the recruitment pipeline.

## Role

Jobs is a **service layer**, not an autonomous golem. It provides background job discovery that the RecruiterGolem acts on: scraping job boards on a schedule, matching listings against a profile, and syncing results to Supabase. Think of it as the data pipeline that feeds the recruiter.

---

## BrainBar Stub Warnings

BrainBar Swift daemon has 4 STUB tools returning fake success:
- brain_digest, brain_update, brain_expand, brain_tags — ALL BROKEN
- Working: brain_search, brain_store, brain_recall, brain_entity
- Last successful digest: March 14, 2026

---

## Compact Instructions

When compacting this session, follow these rules strictly:

### NEVER preserve
- /loop, QUEUE-OPERATION, cron polling (3+ identical system/cron messages = keep ZERO)
- BrainLayer search injections (re-injected fresh each turn)
- Full file contents re-readable from disk (keep path + one-line summary of decision made)

### ALWAYS preserve verbatim
- User vision/goal/decision statements (if stated 3x+, note "[USER STATED Nx]")
- User repetitions in DIFFERENT places = importance signal, keep ONE with annotation
- Short user messages (approvals, frustration signals) — these carry intent
- Sprint plan with priority ratings
- All decisions with rationale (WHY not just WHAT)
- Modified file paths with one-line change summary

### Structure summary as
1. **Session Intent**: What the user wants (exact quotes)
2. **Decisions Made**: Each + rationale + who
3. **Artifact Trail**: Files, tests, commands
4. **Current State**: Working/broken/in-progress
5. **Next Steps**: Ordered by sprint plan priority

---

## Architecture

```text
packages/jobs/
├── src/
│   ├── index.ts                 # getStatus() + main entry point
│   ├── scraper.ts               # Job board scraper (LinkedIn, Indeed, etc.)
│   ├── matcher.ts               # Job-to-profile matching (LLM-scored)
│   ├── connection-matcher.ts    # Match jobs with network connections
│   ├── watchlist.ts             # Saved searches and company watchlist
│   ├── sync-to-supabase.ts      # Sync scraped jobs to cloud DB
│   ├── mcp-server.ts            # MCP tools: job_getRecent, job_search, etc.
│   └── profile.json             # Job seeker profile for matching
├── .claude-plugin/plugin.json
├── CLAUDE.md                    # This file
└── package.json                 # @golems/jobs
```

## Dependencies

- `@golems/shared` — Supabase factory, event log, LLM, state store

## Relationship to RecruiterGolem

Jobs **discovers**, Recruiter **acts**:
- Jobs scrapes boards → scores matches → syncs to Supabase
- Score 8+ triggers RecruiterGolem auto-outreach pipeline
- Recruiter reads job state via `getStatus()` and MCP tools
- Jobs has no outreach, no contacts, no practice — that's all Recruiter

## Scraping Schedule (Scheduler)

- **6am + 9am + 1pm**, Sun-Thu only (Israeli work week)
- Managed by `@golems/services/cloud-worker.ts` when a local or successor scheduler is configured
- Results synced to Supabase via `sync-to-supabase.ts`

## MCP Tools

| Tool | Description |
|------|-------------|
| `job_getRecent` | Recent job matches above score threshold |
| `job_search` | Search jobs by keyword/company |
| `job_stats` | Match statistics by category |

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `golem_seen_jobs` | Deduplication — already-processed listings |
| `golem_jobs` | Full job data with scores |

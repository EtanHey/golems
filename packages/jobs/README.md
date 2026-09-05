# @golems/jobs

JobGolem — job board scraping, LLM-powered matching, and pipeline state for the recruitment workflow.

## What It Does

- Scrapes job boards (LinkedIn, Indeed, SecretTLV, Drushim, Goozali) on a schedule
- Matches listings against a profile using LLM scoring (1-10 scale)
- Deduplicates listings via hash-based tracking
- Syncs results to Supabase
- Matches jobs against LinkedIn connections for warm intros
- Provides MCP tools for querying matches

## Quick Start

```bash
cd packages/jobs
bun src/index.ts       # Run a scrape cycle
```

## Scoring

| Score | Category | Action |
|-------|----------|--------|
| 8-10 | Hot match | Triggers auto-outreach in RecruiterGolem |
| 5-7 | Warm | Shown in daily digest |
| 1-4 | Cold | Archived |

## Scrape Schedule (Scheduler)

| Time | Days | Board |
|------|------|-------|
| 6am | Sun-Thu | All boards |
| 9am | Sun-Thu | All boards |
| 1pm | Sun-Thu | All boards |

Managed by `@golems/services/cloud-worker.ts` when a local or successor scheduler is configured. The old Railway service was deleted on 2026-07-05.

## MCP Tools

| Tool | Description |
|------|-------------|
| `jobs_getHot` | Score 8+ matches |
| `jobs_getRecent` | Latest batch of results |
| `jobs_search` | Keyword search across listings |
| `jobs_stats` | Pipeline statistics |
| `jobs_dailyDigest` | Morning check-in summary |
| `jobs_connectionMatches` | Jobs matched to LinkedIn connections |
| `jobs_updateStatus` | Pipeline status tracking |
| `jobs_draftCoverLetter` | AI-generated cover letter |

## Architecture

```
packages/jobs/
├── src/
│   ├── index.ts                # getStatus() + main entry
│   ├── scraper.ts              # Job board scraper
│   ├── matcher.ts              # LLM scoring (profile match)
│   ├── connection-matcher.ts   # Match jobs with network connections
│   ├── watchlist.ts            # Saved searches + company watchlist
│   ├── sync-to-supabase.ts     # Sync to cloud DB
│   └── mcp-server.ts           # MCP tool definitions
└── CLAUDE.md
```

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `golem_jobs` | Full job data with match scores |
| `golem_seen_jobs` | Deduplication tracking (hash-based) |
| `job_connections` | Jobs matched to LinkedIn connections |

## Relationship to RecruiterGolem

Jobs **discovers**, Recruiter **acts**. Jobs scrapes and scores; Recruiter handles outreach, contacts, and interview practice. Jobs never sends messages or creates contacts.

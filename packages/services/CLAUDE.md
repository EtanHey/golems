# Golems Services

> Infrastructure services — Night Shift, Bedtime Guardian, Morning Briefing, Cloud Worker, and ecosystem tooling.

## Role

Services package contains **cross-cutting infrastructure** that doesn't belong to any single golem: the cloud worker orchestrator, night shift autonomous coding, morning briefings, health checks, and ecosystem management tools (wizard, doctor).

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
packages/services/
├── src/
│   ├── cloud-worker.ts          # Runnable scheduler for email/jobs/briefing/soltome
│   ├── night-shift.ts           # 4am autonomous coding improvements
│   ├── briefing.ts              # 8am morning summary
│   ├── healthcheck.ts           # 9am service health verification
│   ├── session-archiver.ts      # Archive Claude session transcripts
│   ├── wizard.ts                # `golems wizard` — guided setup
│   ├── doctor.ts                # `golems doctor` — health checks
│   ├── helpers-status.ts        # CLI helper backend status
│   ├── skills-list.ts           # Skills discovery
│   ├── validation-service.ts    # Input validation utilities
│   ├── cursor-helper.ts         # Cursor CLI agent wrapper
│   ├── gemini-helper.ts         # Gemini CLI agent wrapper
│   ├── kiro-helper.ts           # Kiro CLI agent wrapper
│   ├── ollama-chat-bot.ts       # Ollama local chat wrapper
│   ├── run-compaction.ts        # Context compaction utilities
│   ├── thread-compactor.ts      # Thread compaction logic
│   ├── thread-store.ts          # Thread storage
│   └── whatsapp-index-cli.ts    # WhatsApp message indexing
├── .claude-plugin/plugin.json
├── CLAUDE.md                    # This file
└── package.json                 # @golems/services
```

## Dependencies

- `@golems/shared` — Supabase, event log, state store, LLM, telegram-direct
- `@golems/jobs` — Job scraping (used by cloud worker)
- `@golems/teller` — (future) Financial reports in briefing
- `googleapis` — Google APIs (briefing, calendar)

## Cloud Worker

The previous Railway production service was deleted on 2026-07-05. `cloud-worker.ts`
remains the scheduler implementation for email, jobs, briefing, and Soltome work,
but do not assume there is an active Railway host.

| Schedule | Service | Description |
|----------|---------|-------------|
| Hourly 6am-7pm (skip 12pm) + 10pm | Email poller | Fetch + score emails |
| 6am, 9am, 1pm (Sun-Thu) | Job scraper | Scrape + match jobs |
| 8am daily | Briefing | Morning summary to Telegram |
| 2am daily | Soltome learner | Scrape posts + learn patterns |

**Health endpoint:** `GET /health` when the worker process is running.
**Usage endpoint:** `GET /usage` — API call stats, token counts, cost.

### Runtime Env Vars

```bash
LLM_BACKEND=gemini
STATE_BACKEND=supabase
TELEGRAM_MODE=direct
GOOGLE_GENERATIVE_AI_API_KEY=<your-key>
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

## Night Shift

Runs at 4am via launchd. Per-repo Claude sessions:
- Scans for TODOs, issues, improvements
- Creates worktree, implements, runs tests
- CodeRabbit review → PR
- Tracks PRs in `state.nightShiftPRs[]`

## Ecosystem Tools

| Tool | Command | Description |
|------|---------|-------------|
| Wizard | `golems wizard` | Guided setup for new users |
| Doctor | `golems doctor` | Health checks for all wiring |
| Status | `golems status` | All-golem status overview |

## Debugging with BrainLayer MCP

When debugging issues or understanding why something is wired a certain way:

1. **Architecture decisions:** `docs/architecture/` — key decisions and migration records
2. **Phase findings:** Maintainer-only planning archive — detailed historical notes
3. **BrainLayer search:** Use the BrainLayer MCP to search past session transcripts:
   ```
   mcp__brainlayer__brain_search(query="topic", project="-Users-example-Gits-golems")
   ```
4. **BrainLayer context:** Get surrounding conversation for a search result (via brain_search with chunk_id):
   ```
   mcp__brainlayer__brain_search(query="...", chunk_id="<id from search>")
   ```

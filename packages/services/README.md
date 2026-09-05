# @golems/services

Infrastructure services — Cloud Worker, Night Shift, Morning Briefing, Doctor, Wizard, and CLI agent wrappers.

## What It Does

- **Cloud Worker** — scheduler entry point for email/jobs/briefing/soltome runs
- **Night Shift** — 4am autonomous code improvements via Claude CLI
- **Morning Briefing** — 8am summary delivered to Telegram
- **Bedtime Guardian** — Evening wind-down reminders
- **Doctor** — `golems doctor` health checks for all wiring
- **Wizard** — `golems wizard` guided setup for new users
- **CLI Agent Wrappers** — Cursor, Gemini, Kiro helpers for multi-agent orchestration

## Cloud Worker Schedule

The old Railway production service was deleted on 2026-07-05. Verify the actual
local or successor scheduler before assuming these jobs are active.

| Schedule | Service | Description |
|----------|---------|-------------|
| Hourly 6am-7pm + 10pm | Email poller | Fetch + score emails |
| 6am, 9am, 1pm (Sun-Thu) | Job scraper | Scrape + match jobs |
| 8am daily | Briefing | Morning summary to Telegram |
| 2am daily | Soltome learner | Scrape posts + learn patterns |

**Health:** `GET /` | **Usage:** `GET /usage` (API stats, token counts, cost)

## CLI Commands

```bash
golems wizard          # Guided setup — picks services, wires keys
golems doctor          # Health checks for all services
golems status          # All-golem status overview
golems skills          # List all available skills
golems rules check     # Audit rules for a project
```

## Night Shift

Runs at 4am via macOS launchd:

1. Scans repos for TODOs, issues, improvements
2. Creates git worktree for isolated work
3. Implements changes, runs tests
4. CodeRabbit review gate
5. Creates PR, tracks in state

## Architecture

```
packages/services/
├── src/
│   ├── cloud-worker.ts        # Scheduler entry point
│   ├── night-shift.ts         # 4am autonomous coding
│   ├── briefing.ts            # 8am morning summary
│   ├── healthcheck.ts         # 9am service verification
│   ├── wizard.ts              # Guided setup
│   ├── doctor.ts              # Health checks
│   ├── cursor-helper.ts       # Cursor CLI agent wrapper
│   ├── gemini-helper.ts       # Gemini CLI agent wrapper
│   └── kiro-helper.ts         # Kiro CLI agent wrapper
└── CLAUDE.md
```

## Deployment

| Environment | What Runs |
|-------------|-----------|
| **Mac (launchd)** | Night Shift, Telegram bot, notification server |
| **Local/successor scheduler** | Cloud Worker (email, jobs, briefing) |

## Dependencies

- `@golems/shared` — Supabase, event log, state store, LLM, Telegram
- `@golems/jobs` — Job scraping (cloud worker)
- `googleapis` — Google APIs (briefing, calendar)

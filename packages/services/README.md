# @golems/services

Infrastructure services — Cloud Worker, Morning Briefing, Bedtime Guardian and Doctor.

## What It Does

- **Cloud Worker** — scheduler entry point for email/briefing/soltome runs
- **Morning Briefing** — 8am summary delivered to Telegram
- **Bedtime Guardian** — Evening wind-down reminders
- **Doctor** — health checks for all wiring (`bun run packages/services/src/doctor.ts`)

## Cloud Worker Schedule

The old Railway production service was deleted on 2026-07-05. Verify the actual
local or successor scheduler before assuming these jobs are active.

| Schedule | Service | Description |
|----------|---------|-------------|
| Hourly 6am-7pm + 10pm | Email poller | Fetch + score emails |
| 8am daily | Briefing | Morning summary to Telegram |
| 2am daily | Soltome learner | Scrape posts + learn patterns |

**Health:** `GET /` | **Usage:** `GET /usage` (API stats, token counts, cost)

## Commands

```bash
bun run packages/services/src/doctor.ts   # Health checks for all services
```

## Architecture

```
packages/services/
├── src/
│   ├── cloud-worker.ts        # Scheduler entry point
│   ├── briefing.ts            # 8am morning summary
│   ├── healthcheck.ts         # 9am service verification
│   └── doctor.ts              # Health checks
└── CLAUDE.md
```

## Deployment

| Environment | What Runs |
|-------------|-----------|
| **Mac (launchd)** | Telegram bot, notification server, briefing |
| **Local/successor scheduler** | Cloud Worker (email, briefing) |

## Dependencies

- `@golems/shared` — Supabase, event log, state store, LLM, Telegram

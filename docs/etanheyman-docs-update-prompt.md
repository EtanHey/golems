# Prompt: Update etanheyman.com/golems Documentation

> Run this in the `~/Gits/etanheyman.com` repo to update the golems docs section.

---

## Context

The golems monorepo just completed a major componentization (9 phases). The docs at `etanheyman.com/golems/` need to reflect the new architecture.

**Source of truth:** `~/Gits/golems/README.md` and `~/Gits/golems/docs/architecture-decisions.md`

## What Changed

### Before (old docs may say)
- "Six specialized agents" / "6 golems"
- `packages/autonomous/` contains all golems
- A retired in-repo documentation package exists
- 6+ Telegram topics (alerts, nightshift, recruiter, teller, monitor, uptime)
- 621+ tests
- JobGolem is a golem
- EmailGolem is a golem

### After (what docs should say)
- **3 domain golems** (RecruiterGolem, TellerGolem, CoachGolem) + ClaudeGolem orchestrator
- **10 packages** in a Bun workspace monorepo, each self-contained
- No docsite package (deleted — etanheyman.com IS the docs)
- **2 Telegram topics** only: General (chat) + Alerts (all notifications)
- **1179 tests**, 4054 assertions
- Jobs is a **service layer**, not a golem (feeds RecruiterGolem)
- Email is part of `@golems/shared`, not a standalone golem
- Content is a skill set / distributable plugin

### Package Structure (current)
```
golems/
├── packages/
│   ├── claude/         # ClaudeGolem — Telegram bot + orchestrator
│   ├── recruiter/      # RecruiterGolem — outreach, contacts, interview practice
│   ├── teller/         # TellerGolem — finance, tax, subscriptions
│   ├── coach/          # CoachGolem — calendar, daily plans
│   ├── jobs/           # Job scraping service (feeds RecruiterGolem)
│   ├── shared/         # Supabase, LLM, email, state, notifications
│   ├── services/       # Night Shift, Briefing, Cloud Worker, Doctor, Wizard
│   ├── content/        # Content creation skills (LinkedIn, ghostwriting)
│   ├── autonomous/     # Legacy test host (test files only)
│   ├── ralph/          # Autonomous coding loop
│   └── zikaron/        # Memory layer (226k+ chunks)
├── skills/             # 34 golem-powers skills
├── launchd/            # macOS service plists
└── Dockerfile          # Railway deployment
```

### Architecture Diagram
```
You <-- Telegram --> ClaudeGolem (Mac)
                          |
           +--------------+--------------+
           v              v              v
     RecruiterGolem  TellerGolem   CoachGolem
           |              |              |
           +------+-------+------+-------+
                  v              v
           Services (Railway)  Zikaron (memory)
```

### Deployment
- **Mac (launchd):** Telegram bot, Night Shift, Briefing, Zikaron
- **Railway (Docker):** Email poller, Job scraper, Cloud LLM (Haiku)
- **Supabase:** Database, auth, storage

## Task

1. Read the existing golems page at `app/(golems)/golems/page.tsx`
2. Read the golems README at `~/Gits/golems/README.md` for the latest content
3. Update the docs page to reflect the new architecture above
4. Make sure the golem table shows only 3 golems + orchestrator
5. Update package structure, test count, topic count
6. Remove any references to "6 golems", the retired docs package, and old topic names
7. Keep the existing design/styling — just update the content

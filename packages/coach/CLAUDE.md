# CoachGolem

> Personal AI life coach — Huberman protocols, LLM coaching, calendar integration, and daily planning.

## Role

CoachGolem is the **protocol-aware life planner**: it applies evidence-based routines, reads state from other golems, integrates with Google Calendar, and generates personalized daily plans with LLM coaching. It does NOT invoke other golems — it reads their status and helps the human prioritize.

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
packages/coach/
├── src/
│   ├── index.ts                 # Main entry — planToday(), planTodayWithCoaching(), getStatus()
│   ├── coaching-engine.ts       # LLM coaching (Gemini Flash-Lite) + rule-based fallback
│   ├── protocol.ts              # Evidence-based rules + user-configurable context
│   ├── calendar-client.ts       # Google Calendar API (reuses Gmail OAuth2)
│   ├── schedule-engine.ts       # Merge calendar + golem states → DailyPlan + coaching formatting
│   ├── status-aggregator.ts     # Read getStatus() from all golems
│   ├── morning-briefing.ts      # Morning briefing synthesis + dual formatting (Telegram/Voice)
│   ├── morning-briefing-runner.ts # Entry point — data gathering, output routing
│   ├── morning-briefing-cli.ts  # CLI entry: bun morning-briefing-cli.ts [--voice]
│   ├── nudge-queue.ts           # Zod-validated JSONL nudge queue (reminder/check-in/insight/alert)
│   ├── nudger.ts                # Morning Telegram nudge + evening wrap-up
│   ├── tracker.ts               # Compliance tracking + weekly summary
│   └── __tests__/               # Tests
├── .claude-plugin/plugin.json
├── CLAUDE.md                    # This file
└── package.json                 # @golems/coach
```

## Key Modules

### `coaching-engine.ts` — LLM Coaching
- `generateCoaching(input)` → personalized advice, workout, and Huberman reminders
- Uses `runCloudFree()` (Gemini Flash-Lite, free) with rule-based fallback
- `computeHubermanReminders()` — caffeine delay, NSDR, sunlight, supplements, coding stop
- `pickWorkout()` — alternates easy running and bodyweight work across the week

### `protocol.ts` — Evidence-Based Rules
- `CoachProtocol` interface: sleep, body, career, schedule, huberman, coaching sections
- `DEFAULT_PROTOCOL` is a generic starter; personal values are loaded from the user's local protocol file
- Stored at `~/.golems-zikaron/coach/protocol.json`
- `loadProtocol()`, `saveProtocol()`

## Key Types

| Type | Module | Purpose |
|------|--------|---------|
| `CoachingOutput` | coaching-engine | `{ advice, workout, hubermanReminders }` |
| `CoachProtocol` | protocol | Sleep, body, career, schedule, huberman, coaching rules |
| `CoachedPlan` | index | `{ plan: DailyPlan, coaching: CoachingOutput }` |
| `DailyPlan` | schedule-engine | `{ date, greeting, blocks, pendingItems, summary }` |
| `TimeBlock` | schedule-engine | `{ start, end, type, title, source }` |
| `EcosystemStatus` | status-aggregator | `{ timestamp, golems, healthy, unhealthy, summary }` |

## Dependencies

- `@golems/shared` — GolemStatus, telegram-direct, state-store, Vercel LLM
- `@golems/jobs` — getStatus() for job match counts
- `@golems/recruiter` — getStatus() for draft/follow-up counts
- `@golems/teller` — getStatus() for financial summary
- `googleapis` — Google Calendar API v3

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GMAIL_CLIENT_ID` | Calendar OAuth2 (shared with email) |
| `GMAIL_CLIENT_SECRET` | Calendar OAuth2 |
| `GMAIL_REFRESH_TOKEN` | Calendar OAuth2 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini for LLM coaching (optional — falls back to rules) |

## Design Principles

1. **Protocol-aware** — configured routines drive workout and focus recommendations
2. **Evidence-based** — Huberman Lab protocols for caffeine, light, supplements, sleep
3. **Read-only** — reads other golems' state, never invokes them
4. **Human-centric** — suggests priorities, doesn't auto-execute
5. **Calendar-aware** — knows about meetings, deadlines, blocked time
6. **Graceful degradation** — works without Calendar (empty events) and without LLM (rule-based fallback)

## How It Works

```text
/schedule (coached):
  1. Load protocol rules and user-configured context
  2. Read all golem statuses + Google Calendar
  3. LLM generates personalized coaching (or rule-based fallback)
  4. Format: coaching advice → workout → schedule → reminders

/plan (basic):
  1. Read all golem statuses + Google Calendar
  2. Generate daily plan with priority-sorted pending items
  3. Format for Telegram
```

## Wiring

- **Briefing** (`packages/services/src/briefing.ts`) imports from coach for morning plans
- **Calendar** reuses Gmail OAuth2 creds
- **Protocol** stored at `~/.golems-zikaron/coach/protocol.json`
- **Tracker** stores compliance data in `~/.golems-zikaron/coach/compliance.json` (90-day retention)

## Post-MVP Ideas

- Weather API integration (outdoor workout decisions)
- Midday nudge + evening wrap-up with health context
- `/coach why` command (explain today's recommendations)

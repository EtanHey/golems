# ClaudeGolem

> CLI remote control via Telegram + notification server.

## Role

ClaudeGolem receives Telegram messages, routes them to Claude CLI, and sends notifications. Simplified to a command-only bot — no conversational UX, no domain composers, no personas.

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
packages/claude/
├── src/
│   ├── telegram-bot.ts          # Auth (fail-closed) + rate limit → composer → shutdown
│   ├── composers/
│   │   └── claude-composer.ts   # /status, /trigger, /tonight, /schedule + free text → Claude CLI
│   └── lib/
│       ├── bot-shared.ts        # State, Claude CLI spawning, queue processing
│       └── notify-server.ts     # HTTP notification server (port 3847)
├── .claude-plugin/plugin.json
├── CLAUDE.md                    # This file
└── package.json                 # @golems/claude
```

## Dependencies

- `@golems/shared` — Supabase, event log, state store, Axiom, email infra
- `@golems/jobs` — runJobSearch (used by /trigger jobs)
- `@golems/services` — Night shift, briefing (used by /trigger)
- `grammy` — Telegram Bot Framework

## Key Patterns

### Auth (Fail-Closed)
- `TELEGRAM_ALLOWED_IDS` must contain owner user ID
- Empty list = reject all users (fail-closed)
- Rate limit: 10 messages per minute per user

### Claude CLI Spawning
- **ALWAYS strip `ANTHROPIC_API_KEY`** from env when spawning `claude --print`
- Uses `--continue` for main chat with system prompt (SOUL.md + recent events)
- 5-minute timeout with 60s typing heartbeat

### SIGTERM Handling
- Bot MUST handle SIGTERM gracefully (launchd `KeepAlive=true`)
- Call `notifyServer.stop(true)` + `bot.stop()` before `process.exit(0)`
- Without this: EADDRINUSE crash loop on port 3847

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome + command list |
| `/status` | Health, queue, daily stats |
| `/trigger <svc>` | Manual runs (email/jobs/briefing/nightshift) |
| `/morning` | Morning briefing |
| `/tonight` | Night Shift target selection |
| `/schedule` | Weekly Night Shift rotation |
| `/repos` | List available repos |
| Free text | Spawn Claude CLI |

## Notify Server

HTTP on `127.0.0.1:3847`:
- `POST /notify` — Send notification to Telegram (validated: title required, body truncated, source-based routing)
- `GET /health` — Health check

## Communication Style

See `SOUL.md` for full persona. Key traits:
- Formality: 2/10 — very casual
- Brief, direct messages (mobile chat)
- Hebrew/English code-switching

# @golems/claude

ClaudeGolem — Telegram bot, orchestrator, and external face of the Golems ecosystem.

## What It Does

- Receives Telegram messages and routes to domain golems via Grammy Composers
- Spawns Claude CLI sessions for free-text conversations
- Runs a notification HTTP server on port 3847
- Handles SIGTERM gracefully for launchd management

## Quick Start

```bash
cd packages/claude
bun src/telegram-bot.ts
```

Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_IDS` env vars.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + command list |
| `/status` | Health, queue, daily stats |
| `/trigger <svc>` | Manual runs (email/jobs/briefing/nightshift) |
| `/morning` | Morning briefing |
| `/tonight` | Night Shift target selection |
| `/schedule` | Weekly Night Shift rotation |
| Free text | Spawn Claude CLI conversation |

## Notify Server

HTTP server on `127.0.0.1:3847`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/notify` | POST | Send notification to Telegram (title required, body truncated) |
| `/health` | GET | Health check |

## Architecture

```
packages/claude/
├── src/
│   ├── telegram-bot.ts          # Auth (fail-closed) + rate limit + composer + shutdown
│   ├── composers/
│   │   └── claude-composer.ts   # All commands + free text → Claude CLI
│   └── lib/
│       ├── bot-shared.ts        # State, CLI spawning, queue processing
│       └── notify-server.ts     # HTTP notification server
└── CLAUDE.md
```

## Key Patterns

- **Fail-closed auth** — empty `TELEGRAM_ALLOWED_IDS` = reject all
- **Rate limiting** — 10 messages per minute per user
- **Claude CLI** — strips `ANTHROPIC_API_KEY` from env, uses `--print` for subscription auth
- **Graceful shutdown** — handles SIGTERM for launchd `KeepAlive=true`

## Dependencies

- `@golems/shared` — Supabase, event log, state store
- `@golems/jobs` — `runJobSearch` (used by `/trigger jobs`)
- `@golems/services` — Night Shift, briefing triggers
- `grammy` — Telegram Bot Framework

# Golems Monorepo Architecture Map

This doc maps the full architecture of the golems monorepo, with a deep focus on
`packages/autonomous/src`. It covers packages, golems, data flows, MCP tools,
CLI commands, data stores, and how everything connects.

## Package Overview

| Path | Purpose |
| --- | --- |
| `packages/autonomous` | Main golem runtime: Telegram bot, cloud worker, golems, LLM tooling |
| `packages/ralph` | Ralph autonomous coding loop (Zsh + Bun + React Ink TUI) |
| [BrainLayer](https://github.com/EtanHey/brainlayer) | Memory pipeline — external repo (Python, sqlite-vec, MCP server) |
| `.claude/rules/` | Auto-loaded rules (survives compaction) |
| `rules-library/` | Exportable context/rules library |
| `docs/architecture/` | Architecture decisions (BrainLayer-indexed) |
| `skills/golem-powers/` | Skills used by Ralph and Claude |
| `docs/` | Global architecture notes |
| `docs.local/` | Local research and planning (gitignored) |

## Runtime Architecture (Local Mac plus successor scheduler)

Local Mac runs interactive and high-trust services. The former Railway body was
deleted on 2026-07-05, so polling and batch tasks must be verified through local
or successor scheduling.

- Mac brain: Telegram bot, notification server, Night Shift, local Ollama,
  local JSON state, daily healthcheck, session archiver.
- Scheduler body: `cloud-worker.ts` can schedule EmailGolem, JobGolem, Briefing,
  and Soltome Learner; verify the actual host before assuming it is active.

Mode switches (used across services):
- `LLM_BACKEND`: `ollama` (local) or `haiku` (Anthropic, cloud).
- `STATE_BACKEND`: `file` (local JSON) or `supabase` (cloud tables).
- `TELEGRAM_MODE`: `local` (POST `http://localhost:3847/notify`) or `direct`.
- `OLLAMA_SANDBOXED`: `1` routes Ollama through validation queue + Claude review.
- `GOLEMS_STATE_DIR`, `VALIDATION_DIR`: override runtime paths for testing.

## packages/autonomous (core system)

Key entrypoints:
- `src/telegram-bot.ts`: ClaudeGolem Telegram bot, local notification server,
  command router, job scrape trigger, Claude CLI spawning.
- `src/cloud-worker.ts`: scheduler for golems, plus `/health`,
  `/usage`, and `/webhook/uptimerobot/:secret`.
- `src/night-shift.ts`: NightShift autonomous code improvements with worktrees.
- `src/briefing.ts`: Morning briefing aggregation for Telegram.
- `src/post-generator.ts`: Soltome content pipeline (critique waves).
- `src/soltome-learner.ts`: Learns Soltome patterns nightly.
- `src/soltome-client.ts`: Soltome API client.
- `src/event-log.ts`: Event log for "While You Were Down" context.
- `src/ollama-wrapper.ts`: LLM backend switch (local, sandboxed, or Haiku).
- `src/ollama-sandboxed.ts`: Validation queue for sandboxed Ollama.
- `src/validation-service.ts`: Claude review for sandboxed outputs.
- `src/lib/*`: shared utilities (state-store, telegram-direct, load-env,
  agent-runner, helpers, plugins, style export, system detection, session fork,
  WhatsApp parser and indexer).

## Golem Quick Reference

| Golem | Entry | Schedule | Primary outputs |
| --- | --- | --- | --- |
| ClaudeGolem | `src/telegram-bot.ts` | Always on (local) | Telegram replies, notifications, draft approvals |
| NightShift | `src/night-shift.ts` | 4am local launchd | PRs, Telegram summary, event log |
| EmailGolem | `src/email-golem/index.ts` | Local 10 min or cloud schedule | Supabase emails, urgent alerts, routing |
| JobGolem | `src/job-golem/index.ts` | Telegram bot interval or cloud schedule | Supabase jobs, Telegram alerts, outreach trigger |
| RecruiterGolem | `src/recruiter-golem/*` | On demand from JobGolem | Outreach drafts, contacts, practice sessions |
| TellerGolem | `src/teller-golem/index.ts` | On demand from EmailGolem | Payment alerts, monthly and tax reports |
| OllamaGolem | `src/ollama-chat-bot.ts` | Manual or launchd | Telegram chat with Ollama |

## Golems in Detail

### ClaudeGolem (Telegram bot)
- **Entry**: `packages/autonomous/src/telegram-bot.ts`.
- **Role**: Telegram chat interface, command router, local notification server
  on port 3847, and dispatcher for complex tasks via Claude CLI.
- **Key files**: `lib/agent-runner.ts`, `lib/session-fork.ts`, `event-log.ts`,
  `post-generator.ts`, `job-golem/index.ts`.
- **State**: `~/.golems-zikaron/state.json` (nightShiftTarget, topics, pending
  drafts), `~/.golems-zikaron/event-log.json`.
- **Inputs**: Telegram messages and commands, local notification POSTs.
- **Outputs**: Telegram replies, topic-routed notifications, draft approvals,
  job scrape trigger (`/scrape-jobs` endpoint).

### NightShift
- **Entry**: `packages/autonomous/src/night-shift.ts`.
- **Role**: Autonomous code improvements using Claude Code CLI and git worktrees.
- **State**: `state.json` (nightShiftPRs), `event-log.json`.
- **Outputs**: Draft PRs, Telegram summaries, event log entries.
- **Schedule**: 4am local via launchd.

### EmailGolem
- **Entry**: `packages/autonomous/src/email-golem/index.ts`.
- **Role**: Poll Gmail, score emails, route by category, notify on urgent.
- **Key files**: `gmail-client.ts`, `scorer.ts`, `router.ts`, `db-client.ts`,
  `draft-reply.ts`, `followup.ts`, `mcp-server.ts`, `types.ts`.
- **State**: `~/.golems-zikaron/state.json` (lastEmailCheck, processedEmailIds),
  `~/.golems-zikaron/offline-queue.json` (Supabase retry queue).
- **Data**: Supabase `emails`, `subscriptions`, `payments`.
- **Routing**: `job` and `interview` -> RecruiterGolem, `subscription` -> TellerGolem,
  `urgent` or `tech-update` -> ClaudeGolem, default -> EmailGolem.
- **Schedule**: local launchd every 10 minutes, or cloud worker schedule.

### TellerGolem
- **Entry**: `packages/autonomous/src/teller-golem/index.ts`.
- **Role**: Finance domain expert: detect payment failures, categorize expenses,
  generate monthly and tax reports.
- **Key files**: `categorizer.ts`, `alerts.ts`, `report.ts`, `types.ts`.
- **Data**: Supabase `payments` (with `tax_category`) and `subscriptions`.
- **Outputs**: Telegram alerts for payment failures, monthly and tax reports,
  event log entries.

### JobGolem
- **Entry**: `packages/autonomous/src/job-golem/index.ts`.
- **Role**: Scrape job boards, prefilter, score with LLM, notify on matches.
- **Key files**: `scraper.ts`, `matcher.ts`, `watchlist.ts`, `sync-to-supabase.ts`,
  `mcp-server.ts`, `profile.json`.
- **State**: `~/.golems-zikaron/job-golem/` (scraped-jobs.json, seen-jobs.json,
  sync-state.json, results/).
- **Data**: Supabase `golem_jobs` (upserts and score updates).
- **Outputs**: Telegram alerts, event log entries, auto-outreach trigger for
  score 8 or higher.
- **Schedule**: driven by Telegram bot interval or cloud worker schedule.

### RecruiterGolem
- **Entry**: orchestrated by `packages/autonomous/src/recruiter-golem/auto-outreach.ts`.
- **Role**: Find contacts, research companies, generate outreach, practice mode.
- **Key files**: `contact-finder.ts`, `company-research.ts`, `outreach.ts`,
  `style-adapter.ts`, `outreach-db.ts`, `outreach-db-cloud.ts`,
  `practice-db.ts`, `practice-db-cloud.ts`, `elo.ts`, `obsidian-export.ts`.
- **Data**: Local SQLite (`~/.golems-zikaron/recruiter/outreach.db`,
  `~/.golems-zikaron/recruiter/practice.db`) or Supabase
  (`outreach_contacts`, `outreach_messages`, `outreach_companies`,
  `practice_sessions`, `practice_questions`).
- **External sources**: GitHub org data, Exa, Hunter.io, Lusha.

### OllamaGolem (separate bot)
- **Entry**: `packages/autonomous/src/ollama-chat-bot.ts`.
- **Role**: Standalone Telegram bot for direct Ollama chat with in-memory history.
- **Thread tools**: `thread-store.ts`, `thread-compactor.ts`, `run-compaction.ts`
  (JSONL threads -> summarize -> embed -> store in ChromaDB).

## Soltome Content Pipeline

- **Generation**: `post-generator.ts` runs parallel draft generation and critique.
- **Learning**: `soltome-learner.ts` fetches posts and extracts patterns.
- **Posting**: `soltome-client.ts` creates and edits posts.
- **State**: `data/drafts.json`, `data/soltome-training.json`,
  `data/soltome-patterns.json`.
- **Approval**: ClaudeGolem presents drafts via Telegram commands.

## Non-Golem Utilities in `packages/autonomous/src`

- **Setup wizard**: `wizard.ts` bootstraps services, env, and launchd.
- **Doctor**: `doctor.ts` diagnostic checks (Telegram bot, Ollama, launchd, state).
- **Healthcheck**: `healthcheck.ts` daily report to Telegram.
- **Session archiver**: `session-archiver.ts` moves old Claude sessions to archive.
- **Helpers status**: `helpers-status.ts` reports external CLI backends.
- **Skills list**: `skills-list.ts` reads `available-skills.json`.
- **WhatsApp indexer**: `whatsapp-index-cli.ts` plus `lib/whatsapp-*` for Zikaron.
- **Forage**: `forage.ts` caches Soltome posts for later processing.
- **Plugins**: `lib/plugin-loader.ts` loads JSON context plugins
  in `src/plugins/` (frontend-design, database).

## Data Stores and Schemas

Local runtime state:
- `~/.golems-zikaron/state.json`: main golem state (night shift target, topics).
- `~/.golems-zikaron/event-log.json`: recent golem events for context injection.
- `~/.golems-zikaron/job-golem/`: scraped jobs, seen IDs, sync state, results.
- `~/.golems-zikaron/offline-queue.json`: Supabase retry queue for EmailGolem.
- `~/.golems-zikaron/recruiter/outreach.db`: RecruiterGolem outreach DB (SQLite).
- `~/.golems-zikaron/recruiter/practice.db`: RecruiterGolem practice DB (SQLite).
- `~/.golems-zikaron/validation-queue/`: sandboxed Ollama approvals.
- `~/.golems-zikaron/style/semantic-style-data.json`: style data from Zikaron.
- `~/.golems-zikaron/research/gits/`: Cursor research outputs.
- `packages/autonomous/data/`: Soltome drafts and training data.
- `packages/autonomous/data/ollama-threads/`: Ollama thread JSONL storage.
- `~/.claude/projects/` and `~/.claude-archive/`: Claude sessions for archiver.

Supabase tables from migrations:
- `emails`, `subscriptions`, `payments` (EmailGolem and TellerGolem).
- `golem_state`, `golem_events`, `golem_seen_jobs` (cloud state backend).
- `outreach_contacts`, `outreach_messages`, `outreach_companies` (RecruiterGolem).
- `practice_sessions`, `practice_questions` (RecruiterGolem practice).
- `helper_rate_limits` (helpers rate limit store).

Supabase tables used in code but not defined in migrations here:
- `golem_jobs` (JobGolem sync and scoring updates).

## MCP Tools

Email and Teller MCP (`packages/autonomous/src/email-golem/mcp-server.ts`):
- `email_getRecent`, `email_search`, `email_subscriptions`, `email_urgent`,
  `email_stats`, `email_getByGolem`, `email_draftReply`
- `teller_monthlyReport`, `teller_taxSummary`

Job MCP (`packages/autonomous/src/job-golem/mcp-server.ts`):
- `jobs_getHot`, `jobs_getRecent`, `jobs_search`, `jobs_watchlist`, `jobs_stats`

BrainLayer MCP (external: `brainlayer-mcp`):
- `brain_search`, `brain_store`, `brain_recall`

## CLI Commands

Golems CLI (`packages/autonomous/bin/golems`):
- `golems status`, `golems doctor`, `golems services`, `golems scrape`
- `golems start|stop|restart [svc]`, `golems latest`, `golems on|off`
- `golems cloud`, `golems helpers`, `golems skills`, `golems setup`
- `golems regen-style`, `golems index-whatsapp`, `golems autopilot`

Other key entrypoints:
- `bun run src/email-golem/index.ts` (EmailGolem, `--dry-run`, `--max`).
- `bun run src/job-golem/index.ts` (JobGolem pipeline).
- `bun run src/teller-golem/index.ts --report` (Teller reports).
- `bun run src/night-shift.ts` (NightShift).
- `bun run src/cloud-worker.ts` (scheduler worker).
- `bun run src/healthcheck.ts`, `bun run src/doctor.ts`, `bun run src/wizard.ts`.
- `bun run src/validation-service.ts` (sandbox validation).
- `bun run src/session-archiver.ts` (archiver).

## Scheduling

Local launchd templates in `packages/autonomous/launchd/`:
- `email-golem`: every 10 minutes.
- `briefing`: 8am daily.
- `nightshift`: 4am daily.
- `healthcheck`: 9am daily.
- `compactor`: hourly.
- `session-archiver`: 4am daily (separate label).
- `telegram`: run at load, keep alive.
- `ollama`: run at load, keep alive.

Cloud worker schedule in `src/cloud-worker.ts` (Asia/Jerusalem):
- Email: hourly 6am to 7pm, plus 10pm.
- Jobs: 6am, 9am, 1pm, Sun-Thu.
- Briefing: 8am daily.
- Soltome learner: 2am daily.

## External Integrations

- Telegram Bot API or local notification server (`/notify` on port 3847).
- Gmail API (OAuth2) for EmailGolem.
- Supabase for cloud storage and state.
- Ollama for local LLM and embeddings.
- Anthropic for Haiku backend and validation service.
- Soltome API for content pipeline.
- Job boards: Indeed (ts-jobspy), SecretTLV, Drushim, Goozali (scraped).
- Recruiter sources: GitHub, Exa, Hunter.io, Lusha.
- UptimeRobot webhook to cloud worker (`/webhook/uptimerobot/:secret`).
- 1Password for secrets (used heavily by Ralph and setup tooling).

## Other Packages (how they connect)

### packages/ralph
- **Role**: Autonomous coding loop wrapper around Claude Code.
- **Entry**: `ralph.zsh`, `lib/`, `ralph-ui/`, `bun/`.
- **Key data**: `~/.config/ralph/` (config, registry, costs).
- **Skills**: uses `skills/golem-powers/` and `.claude/rules/`.
- **Connection to golems**: NightShift reuses Ralph worktree and PR patterns.

### BrainLayer (external repo: github.com/EtanHey/brainlayer)
- **Role**: Memory pipeline for Claude Code sessions.
- **Entry**: `brainlayer` CLI, `brainlayer-mcp` MCP server.
- **Data**: `~/.local/share/zikaron/zikaron.db` (sqlite-vec).
- **Connections**: style data consumed by RecruiterGolem and style export; WhatsApp
  indexer uses `brainlayer index-fast`.

## Known Mismatches and Notes

- Launchd templates for `telegram` and `nightshift` point at `golems-zikaron`
  paths; adjust if running from this repo root.
- `golem_jobs` is used by JobGolem but does not appear in migrations here.
- `helper_rate_limits` table exists, but helpers currently use local JSON state.

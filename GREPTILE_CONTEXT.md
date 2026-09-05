# Golems — Greptile Review Context

## What This Is

A Bun workspace monorepo with 13 packages. An autonomous AI agent ecosystem where each "golem" is a domain expert (jobs, recruiting, finance, content, coaching) orchestrated by a Telegram bot. Includes a Python memory layer (Zikaron), an autonomous coding loop (Ralph), and a Next.js dashboard.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.2+ (NOT Node.js) |
| Language | TypeScript (strict mode) for all packages except zikaron |
| Python | Zikaron only — Python 3.11+, FastAPI, sqlite-vec, sentence-transformers |
| Database | Supabase (Postgres + RLS), local sqlite-vec for embeddings |
| Frontend | Next.js 14+ App Router, Tailwind CSS (packages/dashboard) |
| Telegram | grammy framework (packages/claude) |
| Testing | Bun test runner, pytest for Zikaron |
| Deploy | launchd/local Mac services; Railway retired 2026-07-05 |
| Observability | Axiom |

## Package Dependency Graph

```
shared (foundation — no internal deps)
  ├── claude (Telegram bot, orchestrator)
  ├── jobs (scraping, matching)
  ├── recruiter (outreach, practice)
  ├── teller (finance)
  ├── content (LinkedIn, Soltome)
  ├── coach (calendar, schedule)
  ├── services (NightShift, Briefing, Cloud Worker)
  ├── dashboard (Next.js — no @golems/* deps, uses API proxy)
  └── autonomous (legacy stranglers — 1-line re-exports only)
```

All packages depend on `@golems/shared` for Supabase, LLM, email, state, and notifications. No circular dependencies.

## Critical Review Rules

### Security (ALWAYS flag)

1. **Non-null assertions on external data** — NEVER `process.env.KEY!` or `data.field!`. Always validate with runtime checks.
2. **SQL injection** — All Supabase queries must use parameterized queries or the Supabase client builder. Never string-concatenate SQL.
3. **Secrets in code** — No hardcoded API keys, tokens, or credentials. All secrets come from environment variables or 1Password.
4. **RLS policies** — Every new Supabase table MUST have Row Level Security enabled with appropriate policies.
5. **Command injection** — When spawning processes, never pass unsanitized user input to shell commands.

### Patterns to Enforce

1. **Supabase client creation** — Always use `getSupabase()` from `@golems/shared/lib/supabase-factory`. Never create clients directly with `createClient()`.
2. **LLM calls** — Use `runLLM()` / `runLLMJSON()` from `@golems/shared/lib/llm`. Never call Anthropic/OpenAI APIs directly.
3. **Telegram notifications** — Use `sendNotification()` from `@golems/shared/lib/telegram-direct`. Never call Telegram Bot API directly.
4. **State management** — Use `getState()` / `setState()` from `@golems/shared/lib/state-store`. Never read/write state files directly.
5. **Environment loading** — Launchd entry points MUST import `@golems/shared/lib/load-env` as the FIRST import (Bun only auto-loads .env from cwd).
6. **Event logging** — Use `logEvent()` from `@golems/shared/lib/event-log` for golem actions.
7. **Conventional commits** — Format: `feat|fix|docs|refactor|test|chore: description`.

### Anti-Patterns to Flag

1. **Direct `createClient()` calls** instead of using the shared factory
2. **`fetch()` to Anthropic/OpenAI** instead of using the LLM abstraction
3. **Missing error handling on external API calls** (Supabase, Gmail, Telegram)
4. **Blocking subprocess calls in async FastAPI handlers** — Must use `asyncio.to_thread()` for subprocess.run() in Python async handlers
5. **`import numpy` without try/except** in Zikaron (numpy is optional)
6. **Non-null assertions (`!`)** on anything from environment, API responses, or user input
7. **Files created in wrong package** — Each golem's logic belongs in its own package, not in shared or autonomous

### Things That Are Fine (Don't Flag)

1. **1-line re-exports in `packages/autonomous/src/`** — These are intentional backward-compat stranglers. They re-export from the real package. Don't suggest removing them.
2. **`any` types in test files** — Test files can use `any` for mocking. Don't flag unless it's production code.
3. **Catch-all error handlers with `() => {}`** in client-side `fetch().catch()` — Dashboard pages intentionally swallow fetch errors and show loading skeletons.
4. **Multiple LLM backends** — The codebase supports Ollama, GLM, Haiku, Gemini, Groq. This is intentional, not over-engineering.
5. **Hebrew text in strings** — This is a bilingual (Hebrew/English) project. Hebrew strings are expected.

### Python-Specific (Zikaron package only)

1. **sqlite-vec uses APSW, not standard sqlite3** — Don't suggest switching to sqlite3.
2. **bge-large-en-v1.5 embeddings** — 1024 dimensions. Don't suggest different embedding models.
3. **FastAPI dual-mode serving** — Daemon runs on both Unix socket AND HTTP port simultaneously. This is intentional architecture for local MCP + dashboard access.
4. **Lifespan guard pattern** — FastAPI lifespan may fire twice with dual servers. The `if vector_store is not None: yield; return` guard is intentional.

### Testing

- **Bun test runner** for all TypeScript packages: `bun test packages/<name>/src/__tests__/`
- **pytest** for Zikaron: `cd packages/zikaron && pytest`
- Tests live in `src/__tests__/` within each package
- ~400 tests across the monorepo
- Tests use relative imports through autonomous stranglers (this is fine, don't suggest changing)

## Deployment Architecture

| Environment | What Runs | How |
|-------------|-----------|-----|
| **Local Mac** | Telegram bot, notification server | launchd plists in `launchd/` |
| **Local/successor scheduler** | Email poller, job scraper, soltome learner | `packages/services/src/cloud-worker.ts` |
| **Supabase** | Database (project: `${GOLEMS_SUPABASE_PROJECT_REF}`) | Cloud Postgres with RLS |
| **Dashboard** | Next.js dev server | `packages/dashboard/` proxies API to Zikaron daemon |

## Key Files

| File | Purpose |
|------|---------|
| `packages/shared/src/lib/supabase-factory.ts` | Singleton Supabase client |
| `packages/shared/src/lib/llm.ts` | Multi-backend LLM abstraction |
| `packages/shared/src/lib/telegram-direct.ts` | Notification sender |
| `packages/shared/src/lib/state-store.ts` | File/Supabase state |
| `packages/shared/src/lib/shared-types.ts` | GolemStatus, GolemActor, TopicStyle |
| `packages/claude/src/telegram-bot.ts` | Main bot entry point |
| `packages/services/src/cloud-worker.ts` | Scheduler entry point; Railway service deleted 2026-07-05 |
| `packages/zikaron/src/zikaron/daemon.py` | FastAPI daemon (MCP + HTTP) |
| `packages/zikaron/src/zikaron/pipeline/brain_graph.py` | Brain graph generation |
| `packages/dashboard/src/app/` | Next.js pages |
| `Dockerfile` | Root workspace Dockerfile for generic scheduler containers |
| `.claude/rules/` | Auto-loaded rules for Claude Code sessions |

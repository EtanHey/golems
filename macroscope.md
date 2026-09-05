# Macroscope — Code Review Rules

> Best-practice rules for reviewing code across the Golems monorepo.

---

## Security

- Never commit `.env` files or hardcode API keys/tokens
- Coach package handles personal data (health, financial, career) — never log PII
- Use 1Password (`op` CLI) or environment variables for all secrets
- Supabase RLS policies must be verified when adding new tables or mutations
- Never expose internal Convex function endpoints to unauthenticated callers

## Architecture

- **Monorepo structure:** packages/coach, packages/claude, packages/recruiter, packages/content, packages/teller, packages/services, packages/shared, packages/jobs
- Shared utilities go in `packages/shared` — don't duplicate across packages
- Skills live at `skills/golem-powers/` — each skill is a self-contained markdown file with optional workflows/adapters
- BrainLayer MCP is the primary memory layer — use `brain_store` for decisions, `brain_search` before implementing
- All packages depend on Shared for Supabase, LLM, state, and notifications — respect this dependency direction
- ClaudeGolem registers Composers from Jobs + Recruiter — don't bypass the Composer pattern for Telegram commands
- CoachGolem reads `getStatus()` from Jobs, Recruiter, Teller (read-only) — never write to other packages' state from Coach

## Testing

- `bun test` for TypeScript packages
- Skill evals use plain-language assertions, not code tests
- Coach skill: the iteration-2 numeric comparison is non-comparable because its
  effective runtime model and effort were not preserved; maintain or improve it
  through a fresh provenance-complete eval
- Every new Convex function needs at least one test covering the happy path
- PR merges require passing test suite — no `--admin` bypass

## Style

- TypeScript strict mode across all packages
- Compact Instructions in every package CLAUDE.md — different rules per domain (coach != code != orchestrator)
- Hebrew content must respect RTL: `text-right`, `items-end`, flex order reversed
- Prefer explicit types over `any` — especially in Shared utilities consumed by all packages
- Keep functions small; extract when a function exceeds ~50 lines

## Convex

- Mutations serialize per-document — natural lock for race conditions
- Never skip input validation on Convex functions
- Use internal functions for server-only logic
- Scheduled functions must be idempotent — they can fire more than once
- Index definitions go in `schema.ts` — don't rely on full table scans

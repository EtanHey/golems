# Architecture Decisions

> Key decisions made during the Golems componentization (Feb 2026). Reference for wizard, doctor, and debugging.

---

## Golem Taxonomy

**Only 3 domain golems** + 1 orchestrator:

| Component | Type | Package |
|-----------|------|---------|
| RecruiterGolem | Domain golem | `@golems/recruiter` |
| TellerGolem | Domain golem | `@golems/teller` |
| CoachGolem | Domain golem | `@golems/coach` |
| ClaudeGolem | Orchestrator | `@golems/claude` |

**Service layers** (not golems):
- `@golems/jobs` — Background job scraping, feeds RecruiterGolem
- `@golems/shared` — Supabase, LLM, email, state, notifications
- `@golems/services` — Night Shift, Briefing, Cloud Worker, Wizard, Doctor
- `@golems/content` — Content creation skills (LinkedIn, ghostwriting)

---

## Package Structure

**Bun workspace** with `packages/*` glob in root `package.json`.

Each golem/service = its own package with:
- `package.json` with `@golems/<name>` scope
- `CLAUDE.md` with package-specific instructions
- `.claude-plugin/plugin.json` for CC plugin metadata
- Subpath exports in package.json for clean imports

### Import Convention
```typescript
// Always use package imports, never relative cross-package
import { scorer } from "@golems/shared/email/scorer";
import { processHotMatch } from "@golems/recruiter/auto-outreach";
```

---

## Telegram Architecture

**Two topics only:**
- **General** — interactive ClaudeGolem chat (no thread ID)
- **Alerts** — all one-way notifications (jobs, email, nightshift, health, bedtime)

Setup: `/setup alerts` in the Alerts topic. General works automatically.

---

## Deployment Split

| Environment | Components | Why |
|-------------|-----------|-----|
| Mac (launchd) | Telegram bot, Night Shift, Briefing, BrainLayer | Needs local Claude CLI, file access |
| Local/successor scheduler | Email poller, Job scraper, Cloud LLM | Scheduled tasks; Railway service deleted 2026-07-05 |
| Supabase | Database, auth, storage | Shared state |

### Env Var Strategy
- `.env` at monorepo root, loaded by `@golems/shared/lib/load-env`
- Railway env vars are historical only; the Railway service was deleted on 2026-07-05
- Secrets in 1Password: `op://development/<item>/credential`

---

## State Management

**Dual backend:** `STATE_BACKEND=file` (local) or `supabase` (cloud)

| What | File Mode | Supabase Mode |
|------|-----------|---------------|
| Key-value state | `~/.golems-zikaron/state.json` | `golem_state` table |
| Event log | `~/.golems-zikaron/event-log.json` | `golem_events` table |
| Seen jobs | `~/.golems-zikaron/seen-jobs.json` | `golem_seen_jobs` table |

---

## LLM Backend

`LLM_BACKEND=ollama` (local) or `haiku` (cloud via Anthropic API)

- Local: Ollama with qwen2.5-coder:32b for scoring
- Cloud: Haiku 4.5 ($0.80/MTok in, $4.00/MTok out)
- Claude CLI: Always stripped of `ANTHROPIC_API_KEY` when spawning (uses subscription auth)

---

## Key Wiring

### ClaudeGolem registers Composers
```
telegram-bot.ts → bot.use(claudeComposer)
                → bot.use(jobComposer)      // from @golems/jobs
                → bot.use(recruiterComposer) // from @golems/recruiter
```

### CoachGolem reads status
```
coach/index.ts → getStatus() from jobs, recruiter, teller (read-only)
```

### Services briefing imports from Coach
```
services/briefing.ts → getDailyPlan() from @golems/coach
```

### Cloud Worker runs Jobs + Email
```
services/cloud-worker.ts → runJobSearch() from @golems/jobs
                         → runEmailPoller() from @golems/shared
```

---

## Launchd Services

| Plist | Schedule | Process |
|-------|----------|---------|
| `com.golems.telegram.plist` | KeepAlive | Telegram bot |
| `com.golems.nightshift.plist` | 4am daily | Night Shift |
| `com.golems.briefing.plist` | 8am daily | Morning Briefing |
| `com.golems.bedtime.plist` | 10pm daily | Bedtime Guardian |
| `com.golems.healthcheck.plist` | 9am daily | Health Check |
| `com.golems.compactor.plist` | 3am daily | Thread Compaction |

### SIGTERM Handling
Any `Bun.serve()` managed by launchd MUST handle SIGTERM:
```typescript
process.on("SIGTERM", () => {
  server.stop(true); // Release port
  bot.stop();
  process.exit(0);
});
```
Without this: EADDRINUSE crash loop when KeepAlive restarts.

---

## Debugging with BrainLayer

Search past decisions and implementation context:
```bash
export BRAINLAYER_PROJECT="<BRAINLAYER_PROJECT_SLUG>"
brainlayer search "topic" --project "$BRAINLAYER_PROJECT"
```

Or via MCP in Claude Code:
```
mcp__brainlayer__brainlayer_search(query="topic", project="<BRAINLAYER_PROJECT_SLUG>")
```

### Phase Findings

Detailed componentization findings were moved to the maintainers' private planning archive.

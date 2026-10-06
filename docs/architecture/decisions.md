# Architecture Decisions

> Key decisions made during the Golems componentization (Feb 2026). Historical record; current packages and services are listed in README.md.

---

## Golem Taxonomy

**Original Feb 2026 taxonomy** (Recruiter retired 2026-10-05):

| Component | Type | Package |
|-----------|------|---------|
| RecruiterGolem | Retired 2026-10-05 | Former `@golems/recruiter` |
| TellerGolem | Domain golem | `@golems/teller` |
| CoachGolem | Domain golem | `@golems/coach` |
| ClaudeGolem | Orchestrator | `@golems/claude` |

**Service layers** (not golems):
- `@golems/shared` — Supabase, LLM, email, state, notifications
- `@golems/services` — Briefing, Cloud Worker, Doctor (Night Shift and Wizard retired)
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
// Historical Recruiter imports were removed with the package on 2026-10-05.
```

---

## Delivery retirement (2026-10-01)

The inbound bot and outbound Telegram route are retired. Existing plans, logs,
drafts, databases, digest stdout, dashboards and local completion receipts
remain; no replacement channel is enabled by default.

---

## Deployment Split

| Environment | Components | Why |
|-------------|-----------|-----|
| Mac (launchd) | Briefing, BrainLayer | Needs local Claude CLI, file access |
| Local/successor scheduler | Email poller, Cloud LLM | Scheduled tasks; Railway service deleted 2026-07-05 |
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

### ClaudeGolem persona and status
`packages/claude/SOUL.md` defines the shared voice; its status plugin reads
active CLI sessions and recent event-log entries.

### CoachGolem reads status
```
coach/status-aggregator.ts → email and teller status (read-only)
```

### Services briefing imports from Coach
```
services/briefing.ts → getDailyPlan() from @golems/coach
```

### Cloud Worker runs Email
```
services/cloud-worker.ts → processEmails() from @golems/shared
```

---

## Launchd Services

| Plist | Schedule | Process |
|-------|----------|---------|
| `com.golemszikaron.briefing.plist` | 8am daily | Morning Briefing |

Night Shift, Bedtime Guardian, Health Check and Thread Compaction plists were
retired. This table records the briefing wiring; see `launchd/` for other live plists.

### SIGTERM Handling
Any `Bun.serve()` managed by launchd MUST handle SIGTERM:
```typescript
process.on("SIGTERM", () => {
  server.stop(true); // Release port
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
mcp__brainlayer__brain_search(query="topic", project="<BRAINLAYER_PROJECT_SLUG>")
```

### Phase Findings

Detailed componentization findings were moved to the maintainers' private planning archive.

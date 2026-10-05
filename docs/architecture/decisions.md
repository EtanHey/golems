# Architecture Decisions

> Key decisions made during the Golems componentization (Feb 2026). Reference for wizard, doctor, and debugging.

---

## Golem Taxonomy

**Only 3 domain golems** + 1 orchestrator at componentization; RecruiterGolem
was retired on 2026-10-05. The rows below preserve the original design:

| Component | Type | Package |
|-----------|------|---------|
| RecruiterGolem (retired 2026-10-05) | Former domain golem | `@golems/recruiter` (historical) |
| TellerGolem | Domain golem | `@golems/teller` |
| CoachGolem | Domain golem | `@golems/coach` |
| ClaudeGolem | Orchestrator | `@golems/claude` |

**Service layers** (not golems):
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
// Historical example; recruiter retired 2026-10-05:
// import { processHotMatch } from "@golems/recruiter/auto-outreach";
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
| Mac (launchd) | Night Shift, Briefing, BrainLayer | Needs local Claude CLI, file access |
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
coach/index.ts → getStatus() from teller, email (read-only; recruiter retired 2026-10-05)
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

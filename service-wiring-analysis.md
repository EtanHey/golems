# Golems service wiring analysis

## Scope and sources inspected
- CLI: `$HOME/bin/golems`
- Launchd templates: `packages/autonomous/launchd/*.plist` and `packages/autonomous/launchd/install.sh`
- Installed LaunchAgents: `~/Library/LaunchAgents/com.golemszikaron.{job-golem,email-golem,nightshift,briefing}.plist`
- Job Golem: `packages/autonomous/src/job-golem/index.ts` (plus `lib/telegram-direct.ts`)
- Email Golem: `packages/autonomous/src/email-golem/*` (index, gmail-client, scorer, router, db-client, mcp-server, draft-reply, followup)
- Cloud worker: `packages/autonomous/src/cloud-worker.ts` and `packages/autonomous/Dockerfile`
- Update logic: `packages/autonomous/src/lib/self-update.ts`

## CLI behavior ( $HOME/bin/golems )

### Core config
- `GOLEMS_HOME` defaults to `~/Gits/golems/packages/autonomous`
- Logs default to `~/.golems-zikaron/logs` (plus several `/tmp/*.log` files)
- State file default: `~/.golems-zikaron/state.json`

### Core service lists
- `CORE_SERVICES`: `telegram`, `job-golem`, `email-golem`, `ollama`
- `SCHEDULED_SERVICES`: `nightshift`, `briefing`

### Launchd touchpoints in the CLI
- `golems status`: checks `launchctl list` for `nightshift`, `briefing`, `job-golem`, `email-golem`, `session-archiver`
- `golems services`: lists any launchd job containing `golem|zikaron`
- `golems clear-errors`: `bootout` + `bootstrap` for job-golem/email-golem/ollama only
- `golems latest`: `launchctl kickstart -k` for `com.golemszikaron.<svc>` (skips ollama)
- `golems reload`: alias for `golems restart <svc>` (default: telegram)

## Launchd wiring overview

### Templates in repo (`packages/autonomous/launchd/`)
- `com.golemszikaron.email-golem.plist`  
  - Runs `bun` on `src/email-golem/index.ts` every 600s  
  - Template only; notes that env vars must be filled before install
- `com.golemszikaron.ollama.plist`  
  - Runs `ollama serve` as KeepAlive
- `com.golemszikaron.nightshift.plist`  
  - Runs `src/night-shift.ts` at 04:00 daily  
  - Template path points at `~/Gits/golems-zikaron/...` (stale relative to current repo)
- `com.golemszikaron.briefing.plist`  
  - Runs `src/briefing.ts` at 08:00 daily
- `com.golemszikaron.healthcheck.plist`  
  - Runs `src/healthcheck.ts` at 09:00 daily
- `com.golemszikaron.compactor.plist`  
  - Runs `src/run-compaction.ts` hourly
- `com.golems.session-archiver.plist`  
  - Runs `session-archiver.ts` daily at 04:00  
  - Template path points at `~/Gits/golems-zikaron/...` (stale)
- Note: there is **no** job-golem plist template in the repo.

### Install script (`packages/autonomous/launchd/install.sh`)
- Only installs and loads: `ollama`, `nightshift`, `briefing`
- Does **not** install or load `email-golem`, `job-golem`, `healthcheck`, `compactor`, or `session-archiver`

### Installed LaunchAgents (local machine)
- `com.golemszikaron.job-golem`  
  - Runs `bun run /.../src/job-golem/index.ts` every 1800s, `RunAtLoad=true`  
  - Includes inline env vars (OLLAMA_HOST, SUPABASE_URL, SUPABASE_ANON_KEY)  
  - No WorkingDirectory set
- `com.golemszikaron.email-golem`  
  - Runs `bun /.../src/email-golem/index.ts` every 600s  
  - Includes inline env vars (SUPABASE_URL, SUPABASE_ANON_KEY, Gmail OAuth secrets, OLLAMA_HOST)  
  - `RunAtLoad=false`
- `com.golemszikaron.nightshift`  
  - Runs `src/night-shift.ts` at 04:00 daily  
  - Includes TELEGRAM_BOT_TOKEN and OLLAMA vars
- `com.golemszikaron.briefing`  
  - Runs `src/briefing.ts` at 08:00 daily  
  - Includes TELEGRAM_BOT_TOKEN and SUPABASE vars
- All of the above are in `~/Library/LaunchAgents/` with secrets inline (should be treated as sensitive).

### Cloud worker replaces some launchd roles
- `cloud-worker.ts` explicitly replaces launchd for: `email-golem`, `job-golem`, `briefing`, and `soltome-learner`.
- This is consistent with the package CLAUDE.md: cloud runs email/job/briefing; local runs Telegram + Night Shift.

## Answers to your questions

### 1) What does `golems on` do? Does it load ALL launchd agents including job-golem and email-golem?
- `golems on`:
  - Starts `CORE_SERVICES` in order: `telegram`, `job-golem`, `email-golem`, `ollama`
    - `telegram` is **not** launchd-managed here; it runs `bun run bot &` in `GOLEMS_HOME`.
    - `job-golem`, `email-golem`, `ollama` call `launchctl load` on the matching plist in `~/Library/LaunchAgents/`.
  - Loads scheduled services: `nightshift`, `briefing` using `launchctl load`.
- It **does not** load all launchd agents. It does **not** load:
  - `healthcheck`, `compactor`, `session-archiver`, or any `com.golems.*` labels.

### 2) What does `golems latest` and `golems reload` do?
- `golems latest`:
  - Loops `CORE_SERVICES` (skips `ollama`) and runs:  
    `launchctl kickstart -k gui/$(id -u)/com.golemszikaron.<svc>`
  - This is a launchd restart, not a full reload.
  - It still attempts `com.golemszikaron.telegram` even though telegram is **not** launchd-managed (so it will report "not running").
  - It does **not** restart `nightshift` or `briefing`.
- `golems reload [svc]`:
  - Alias to `golems restart [svc]`, which runs stop then start.
  - Defaults to `telegram` if no service is specified.

### 3) Is there a `golems update` command?
- Yes. `golems update` is implemented and wired in the CLI.
- It runs `src/lib/self-update.ts`:
  - `git fetch` and check if behind
  - `git pull` (tries `origin master`, then `origin main`)
  - Install deps (`bun install` if `bun.lockb` exists, else `npm install`)
  - Restart loaded launchd services (`launchctl kickstart -k` for all `golemszikaron` labels)
  - Writes update history to `~/.golems/update-history.json`

### 4) Why are job-golem and email-golem NOT LOADED despite plists existing in ~/Library/LaunchAgents/?
Most likely causes based on the wiring:
- **Plist presence does not mean loaded.** launchd only loads them at login or via `launchctl load/bootstrap`. If the plists were added after login and never loaded, they will not appear in `launchctl list`.
- **No installer covers them.** The repo install script only installs `ollama`, `nightshift`, `briefing`. It never installs or loads `job-golem` or `email-golem`, so they can easily remain unloaded.
- **CLI errors are suppressed.** `golems on` uses `launchctl load ... 2>/dev/null` and does not surface errors. If the load failed, you would not see why.
- **Cloud worker no longer replaces them.** The Railway service was deleted on 2026-07-05, so email/job coverage must come from local or successor scheduling rather than the retired Railway worker.

Secondary issues that affect runtime (not loading) if you do load them:
- **EmailGolem DB key mismatch:** installed plist sets `SUPABASE_ANON_KEY`, but `db-client.ts` requires `SUPABASE_SERVICE_KEY`, so DB writes will fall back to the offline queue and Supabase will appear unavailable.
- **Repo template drift:** several launchd templates in the repo still reference `~/Gits/golems-zikaron/...`, which is stale and can cause confusion if copied directly.

### 5) Job Golem: how does it send results to Telegram?
- `job-golem/index.ts` calls `sendNotification` from `lib/telegram-direct`.
- `telegram-direct` supports:
  - **local mode** (default): HTTP POST to `http://localhost:3847/notify` (Telegram bot proxy)
  - **direct mode**: Telegram Bot API using `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (plus topic routing)
- Job Golem sends:
  - A consolidated message with top matches (score >= 6), including reasons
  - Priority `high` when there are hot matches (score >= 8)
  - A summary notification for auto-outreach drafts
  - "No matches" notice when nothing is found

### 6) Email pipeline (packages/autonomous/src/email-golem)
End-to-end flow from `email-golem/index.ts`:
1. **Load state** via `state-store` (Supabase or file), fall back to `~/.golems-zikaron/state.json`
2. **Create Supabase client** (`db-client.ts`)  
   - If offline or misconfigured, writes are queued to `~/.golems-zikaron/offline-queue.json`
3. **Sync offline queue** if DB is available
4. **Fetch Gmail** using OAuth (`gmail-client.ts`)  
   - Recent emails or "since last check" based on `lastEmailCheck`
5. **Filter already processed IDs** to avoid duplicates
6. **Score each email** via Ollama (`scorer.ts`)  
   - Produces score (1-10), category, reason, optional subscription details
7. **Route to domain golem** (`router.ts`)  
   - job/interview -> RecruiterGolem  
   - subscription -> TellerGolem  
   - tech-update/urgent -> ClaudeGolem  
   - newsletter/promo/social/other -> EmailGolem  
   - Routing events are logged to the event log
8. **Persist results**  
   - Upserts into `emails` table
   - Tracks subscriptions and payments (Supabase)
9. **Immediate notifications**  
   - Score 10 triggers a Telegram alert via `telegram-direct` (source `email`, priority high)
10. **Update state**  
    - Updates `lastEmailCheck` and keeps last 500 processed IDs

Additional components:
- `draft-reply.ts`: template-based reply drafts
- `followup.ts`: follow-up tracking rules for interview/job/urgent categories
- `mcp-server.ts`: MCP tools for querying and drafting from Claude Code

### 7) Retired Railway cloud worker (cloud-worker.ts + Dockerfile)
- The Railway production service was deleted on 2026-07-05.
- Treat prior Railway env, health, and scheduler details as historical notes only.
- Do not assume email/job golems are covered by Railway; verify local or successor scheduling directly.

## Summary of key mismatches and risks
- Local launchd templates are incomplete (no job-golem template) and partially stale (golems-zikaron paths).
- The CLI does not load all launchd services; it focuses on a small subset.
- Local launchd jobs for email/job are not covered by Railway anymore; the Railway service was deleted on 2026-07-05.
- Secrets are embedded in LaunchAgent plists; treat those files as sensitive and avoid committing them.

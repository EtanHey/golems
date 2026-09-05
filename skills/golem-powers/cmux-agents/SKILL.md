---
name: cmux-agents
description: "Spawn AI workers in cmux via MCP/repoGolem. Triggers: visible workers, terminal agents, orchestration, audits."
---

# cmux-agents

Orchestration layer for AI agents in cmux panes. Low-level pane operations (splits, reads, sends) use **cmuxlayer MCP tools** — this skill handles the workflow on top.

> **Naming:** `cmux` is the terminal app/CLI; `cmuxlayer` is the MCP/managed-agent/orchestration layer this skill drives. The MCP tools keep the literal `mcp__cmuxlayer__*` namespace (and `.mcp.json` server key `cmux`) for back-compat, but the *layer* is called `cmuxlayer` — never `cmux MCP`, `cmux.layer`, or `cmux layer`. See `/cmux` → "`cmux` vs `cmuxlayer`". <!-- naming-lint:allow -->

## Fleet Law Pointers

> Fleet law: canon #5 owns model policy, #6 owns launcher naming/skip-perms, and #7 owns claim/guard/DONE/harvest-close. This skill keeps cmux pane mechanics, worker lifecycle controls, and delivery/recovery adapters.

Monitor/cron/loop-payload details → see **cron-payload-discipline**. Launcher/`-s`/`-m` details → see **repogolem**. Engine routing → see **agent-routing**.

## ROLE GEOMETRY — leads/orchestrators land LEFT, workers land RIGHT (automatic)

> **Why this exists (2026-06-14):** the cmux skill/MCP setup kept confusing agents about geometry — who goes where, and how to avoid hand-placing panes. The cmuxlayer layout policy (PR #156) now enforces a **two-column invariant** by ROLE, so you should stop hand-managing left/right and just pass the role.

- **Leads / orchestrators → LEFT column.** Role `orchestrator`. Default inferred from a `*Claude` launcher title.
- **Workers (Codex/Cursor implement+gather) → RIGHT column.** Role `worker`. Default inferred from `*Codex` / `*Cursor` titles.
- **Pass the role, don't compute the column.** `spawn_agent({role, authority, placement})` places by role automatically. Once two columns exist, additional workers dock as TABS in the rightmost worker pane — never a third column.
- **Standing up a team:** pass `workspace` on each `spawn_agent` call; placement stays commanders-LEFT / workers-RIGHT automatically. (The old single-call `spawn_in_workspace` stand-up was cut in v0.4.35 — there is no atomic team-creation tool now.)
- **Auto-focus is handled for you (PR #156).** Workspace-targeted splits focus the target before splitting and restore your focus after render. You no longer hand-run `focus-pane` around every split — `spawn_agent` takes `focus` (default `false`, which restores your origin after init).
- **Engine routing rules** → see **agent-routing** (canonical). cmux-agents only maps the chosen role to pane placement.

## Default Lifecycle (2026-04-19)

Visible worker peers now use the **agent-based cmuxlayer MCP tools** by default:

1. `mcp__cmuxlayer__spawn_agent({repo, cli, prompt, workspace?, parent_agent_id?})`
2. Capture the returned `agent_id` immediately and write it into your collab / AGENT_REGISTRY.
3. `mcp__cmuxlayer__wait_for({agent_id, target_state, timeout_ms})` for lifecycle gates.
4. `mcp__cmuxlayer__send_to({agent_id, text})` for follow-ups (`press_enter` defaults to `true`).
5. `mcp__cmuxlayer__list_agents({agent_ids: [agent_id], detail: "full"})` for a combined registry + health snapshot.
6. `mcp__cmuxlayer__list_agents({mine: true})` whenever topology changes (`mine` replaces the cut `my_agents`).
7. `mcp__cmuxlayer__close_surface({scope: "agent", agent_id, force: true})` to stop or recycle a worker.

**Reference agents by `agent_id`, not surface index.** Surface IDs drift after crashes, respawns, and pane reuse; `agent_id` is the durable handle. Surface refs still matter for raw inspection (`read_screen`) and non-agent panes (`spawn_agent({type:"terminal"})`; there is no browser-surface tool since v0.4.35), but not for the default worker lifecycle.

## repoGolem Launcher Contract

Default path is still `spawn_agent`. When FR-01, non-agent terminals, or recovery
flows force a manual launcher, keep this file as a pointer only.

Launcher/`-s`/`-m` rules → see **repogolem** (canonical).
Engine routing rules → see **agent-routing** (canonical).

For Codex, `spawn_agent` follows the launcher-v2 model contract. Omit `model` for the repoGolem bare
top-Sol pin, or pass an explicit supported model; merged cmuxlayer PR #396 validates it against
`codex debug models --bundled` before creating the pane, then forwards accepted model/effort values
to the launcher as `-m`/`-E`. Unsupported models fail before surface creation; an already-prepared
new worktree is rolled back. At read time the spawn-layer effort enum is
`medium|high|xhigh|ultra`, a subset of repoGolem's `low|medium|high|xhigh|max|ultra` launcher
contract. Resume/default-pin details remain canonical in `/repogolem`.

## Worker vs Audit Placement

| Intent | Placement | Why |
|--------|-----------|-----|
| Worker: code, implementation, collab | Split in current workspace | Visible beside the lead session; easy to monitor and nudge |
| Audit/research: read-only analysis, perspective, discovery | Separate named workspace | Keeps the working view uncluttered and easy to find in the sidebar |

Name audit/research workspaces clearly, e.g. `Audit: golems` or
`Research: auth`. Use same-workspace down splits only when the user explicitly
asks to keep the audit visible next to the lead.

## Current Caveats

### FR-01 — hyphenated repo names can mis-resolve to the wrong launcher

Known live failure: `spawn_agent({repo:"skill-creator"})` can guess `skill-creatorClaude` instead of the real repoGolem launcher `skillcreatorClaude`. The immediate workaround lives in `/repogolem`; verify the launcher there before relying on `spawn_agent` for a new hyphenated repo.

### FR-06 — state parser ambiguity (`booting` vs idle-with-spinner)

`wait_for` and `list_agents(detail:"full")` depend on cmux's parser. In rare cases the registry still says `booting` while `read_screen` shows a perfectly usable prompt. If `wait_for` times out but the raw pane clearly shows the agent is ready, trust `read_screen`, file a cmuxlayer bug, and use one surface-level fallback send only if you must unblock delivery.

### First-run Touch ID note

First launch of a newly signed launcher binary can still trigger a one-time Touch ID prompt. Treat this as a first-run caveat, not a primary orchestration strategy.

## Completion Signals — file > wait_for > list_agents > read_screen

> **Why this exists:** surface-based polling burned hundreds of `read_screen` calls and still missed real state transitions. The new default is event-driven waits on stable `agent_id`s, with raw screen reads reserved for ambiguity or output extraction.

**Ranked reliability of completion signals (use the highest that fits the job):**

| Signal | Reliability | When to use |
|--------|-------------|-------------|
| **1. Output file with DONE marker** | **Ground truth.** File either exists + contains marker, or not. | Every multi-minute autonomous worker task. |
| **2. `wait_for({agent_id, target_state:"done"})`** | Default event-driven lifecycle gate. | Standard worker completion, especially when you already have the `agent_id`. |
| **3. `list_agents({agent_ids:[id], detail:"full"})`** | Good current snapshot of registry state + health diagnostics. | Quick checks without a full raw read. |
| **4. `read_screen`** | Best adjudicator when parser and pane disagree. | FR-06, output extraction, or manual troubleshooting. |
| **5. `list_agents` / `list_agents({mine:true})`** | Discovery only. | "What is alive?" not "is this task complete?" |

**The `closure` field is the handoff check, and it is free.** Every `list_agents` row carries
`closure` at **default** detail (cmuxlayer v0.4.47): `verified` = recorded done, artifact on disk,
safe to close · `artifact_missing` = the deadlock signature, **route a reviewer** · `pending` = no
done-evidence yet · `not_applicable` = no artifact contract. **Do not gate `closure` on the `state`
the row renders** — `closure` is already resolved from done-evidence, and a finished worker renders
`ready`, so that gate discards true positives. Confirm `artifact_missing` on the record instead
(`list_agents({agent_ids:[…], detail:"full"})` → `detail.state`/`task_done_detected_at`, plus one
`ls` on `report_path`) — both fields flap. Table and live evidence in `/collab-monitor`
§ "Completion → Reviewer Handoff".

### Visual Proof / Screenshots

When Etan asks to **see** something, deliver a Computer Use screenshot. `read_screen` is text inspection, not a screenshot. After interactive probes (typing into a pane, reconnecting MCPs, choosing a model/menu option), screenshot proactively when the result is visual or user-facing.

Before pressing Enter in any TUI menu, verify the highlighted row first. Use a Computer Use screenshot when the user needs to see the state; use `read_screen` only when the terminal text clearly exposes the selected row. If the selection is ambiguous, stop and inspect instead of pressing Enter blindly.

Fleet law for user-visible completion lives in canon #4; visual evidence mechanics live in `/never-fabricate` R7 and `/qa-verdict-gate`.

### The file-based completion pattern (copy this)

Every autonomous worker task must end with a file write and a DONE marker:

**Stop-state clause (required in every payload):** if the worker stops before the task's end state, its
last write to the report must say exactly where it stopped and what the next step is. End state for PR
work = review bots and required checks green on the LATEST commit; merge only on instruction. See
`/pr-loop` "Stop-State and End-State".

```bash
# In the worker's prompt:
Write your report to /path/to/output/batch-WORKER.md. The last line of the
file must be exactly: DONE_WORKER_NAME
```

Orchestrator side, poll the file(s) until all expected outputs exist **and** each contains its DONE marker:

```bash
# run_in_background: true
until [ -f "$PLAN/batches/batch-M1.md" ] && grep -q DONE_MINER_M1 "$PLAN/batches/batch-M1.md" 2>/dev/null \
      && [ -f "$PLAN/batches/batch-M2.md" ] && grep -q DONE_MINER_M2 "$PLAN/batches/batch-M2.md" 2>/dev/null \
      ; do
  sleep 30
done
echo ALL_MINERS_DONE
```

When the background command completes, you know every miner finished AND wrote a real file (not a partial crash). This survives cmux state-sync bugs, splash-screen false-idles, and pane freezes.

### FR-06 fallback when parser and screen disagree

If `wait_for` times out or `send_to` rejects with `current state: booting`, do this in order:

1. `list_agents({agent_ids:[agent_id], detail:"full"})`
2. `read_screen(surface: "...", lines: 20)` on the linked surface
3. If the raw pane shows a prompt, trust the pane and file a cmuxlayer bug
4. If work is blocked, use one surface-level `send_to({mode:"surface", surface, text})` fallback (it presses Enter for you — `press_enter` defaults to `true`), then return to the `agent_id` flow as soon as the registry catches up

The rule is not "surface sends are normal again." The rule is: **`agent_id` is the source of truth; raw pane sends are an escape hatch for parser drift.**

## STOP — Before Anything Else

**1. Spawn workers with `mcp__cmuxlayer__spawn_agent`.** No hand-rolled repoGolem typing unless FR-01 forces a temporary launcher fallback.

**2. Store the `agent_id` immediately.** Every follow-up, wait, stop, and handoff should key off the durable id. Each `list_agents` record also reports `send_via`, which names the delivery tool for that agent (currently `send_to` for all of them).

**3. Re-discover live workers with `list_agents({mine:true})` after crashes or layout changes.** Do not trust a remembered surface number.

**4. AGENT_REGISTRY — maintain after CLAUDE_COUNTER in every response with active agents:**
```
AGENT_REGISTRY:
| Agent ID | Surface | Repo | Task | Status | Last Check |
|----------|---------|------|------|--------|------------|
| agent:abc123 | surface:153 | golems | Digest failures | WORKING | 12:35 |
```
Add on spawn. Update on check. Remove on kill.

## MCP Primitives (use these for low-level ops)

> **The surface is 9 tools (cmuxlayer v0.4.35, 2026-08-13).** It was 42 before that cut.
> Anything not in this table does not exist — calling it returns tool-not-found.

| Operation | MCP Tool | Notes |
|-----------|----------|-------|
| Spawn worker | `mcp__cmuxlayer__spawn_agent` | Default for visible Claude/Codex/Cursor/Gemini/Kiro peers. Also creates plain terminals via `type:"terminal"` |
| Send follow-up | `mcp__cmuxlayer__send_to` | Default `mode:"agent"` keys off `agent_id` |
| Send raw keystrokes / keys / commands | `mcp__cmuxlayer__send_to` with `mode:"surface"` / `"key"` / `"command"` | The one delivery tool for all four modes |
| Wait for state | `mcp__cmuxlayer__wait_for` | Replaces client-side poll loops |
| Discover workers | `mcp__cmuxlayer__list_agents` | `mine:true` for your own children; `agent_id` survives surface drift. **`mine:true` errors with `requires a managed calling agent identity` when the caller is not itself a cmuxlayer-spawned agent — verified live 2026-08-18. From an unmanaged seat, call bare `list_agents` and filter.** |
| Inspect state | `mcp__cmuxlayer__list_agents({agent_ids:[id], detail:"full"})` | Registry record + health diagnostics |
| Stop worker | `mcp__cmuxlayer__close_surface({scope:"agent", agent_id})` | `force:true` to close a still-live agent |
| Read raw pane / extract marker output | `mcp__cmuxlayer__read_screen` | Also the FR-06 adjudicator |
| List surfaces | `mcp__cmuxlayer__list_surfaces` | Topology inspection |
| Rename / move a tab | `mcp__cmuxlayer__update_surface` | `action:"rename"` or `action:"move"` — **these two actions only** |
| Daemon health | `mcp__cmuxlayer__control_health` | Is the control plane alive |

**Gaps with no modern equivalent — do not invent a call for these:**

| Gone | Status |
|---|---|
| `set_status`, `set_progress` | **No replacement.** An agent cannot publish status/progress to its pane. `update_surface` does `move` and `rename` only. |
| `stop_agent({userInitiated:false})` | **No replacement.** `close_surface` has no `userInitiated` flag, so the `user_killed` / recovery-eligibility distinction can no longer be set from the tool surface. |
| `new_surface`, `browser_surface` | **No direct replacement.** Use `spawn_agent({type:"terminal"})` for a shell tab; there is no browser-surface tool. |

Use `spawn_agent` for full worker lifecycle. Keep `send_to` surface/key modes for non-agent panes and FR-06 recovery.

### Response Schemas (PR #76, 2026-04-17 — `list_surfaces`)

> **Why this shipped:** An earlier mining sweep of 10 orcClaude sessions found `list_surfaces` burned 117,000 tokens across 49 calls (avg 2,387 / max 8,333 per call). Root causes: a duplicate bug (surfaces in workspace:N appeared N times in `surfaces[]`) and per-entry bloat (screen_preview 51%, UUIDs 15%, full `remote` blob 11% even for local-only workspaces). PR #76 fixed both: deduped `surfaces[]` unconditionally, and condensed the default response with opt-in backward compatibility via `verbose: true`. Default payload is ~89% smaller than the pre-PR shape.

**Default response (no `verbose`):**

```json
{
  "ok": true,
  "workspaces": [
    {
      "ref": "workspace:1",
      "title": "🎯 orcClaude",
      "current_directory": "$HOME/Gits/brainlayer",
      "remote_state": "local"
    }
  ],
  "surfaces": [
    {
      "ref": "surface:35",
      "title": "orcClaude",
      "type": "terminal",
      "workspace_ref": "workspace:1"
    }
  ]
}
```

**`remote_state` values:**
- `"local"` — no SSH/proxy/daemon hints; ordinary macOS workspace. The common case.
- `"connected"` — SSH session is up and connected.
- `"disconnected"` — remote configured but currently offline.
- `"unavailable"` — remote partially configured but daemon/proxy state is missing.

**Pass `verbose: true` to restore the full historical schema** — workspace `id` (UUID), `index`, `pinned`, `selected`, `listening_ports`, full `remote` blob (daemon / proxy / heartbeat / ports), plus every per-surface field (`id`, `pane_id`, `index_in_pane`, `selected_in_pane`, `focused`, `window_ref`, `pane_ref`). Dedup is still applied in verbose mode — it's a correctness fix, not opt-in.

**When to pass `verbose: true`:**
- Debugging SSH workspace state (need daemon / proxy / heartbeat detail).
- Port-forwarding workflows (need `listening_ports` / `forwarded_ports`).
- UI layout reasoning that needs `focused` / `selected_in_pane` / `index`.
- Migration testing against code that still reads old fields.

**When the default is enough (99% of agent work):**
- Routing: "which surface is worker X on?" → need `ref` + `title` + `workspace_ref`.
- Layout checks: "are there 2 panes in this workspace?" → need `ref` count.
- Identifying a target for `send_to({mode:"surface"})` / `read_screen` → only need `surface:N` ref.
- Status reports: "list all active workers" → `ref` + `title` suffice.

**Pre-PR gotcha now fixed:** `workspace_ref` is no longer echoed at the top level of the response unless you explicitly passed `workspace: "workspace:N"` as a filter. Callers relying on the top-level echo must either pass a filter or read it per-surface.

### spawn_agent crash_recover + session auto-capture (PR #77, 2026-04-17)

> **Why this shipped:** When a worker's PTY died unexpectedly (shell exit, mac crash, cmux daemon restart), the agent record was orphaned with no way to resume. PR #77 adds an opt-in recovery loop driven by boot-time session-ID capture.

**New `crash_recover: boolean` param on `spawn_agent` (default `false`).** When `true`:

1. **Boot capture window** — for the first 30 seconds after spawn, the engine scans up to 80 lines of terminal output on each sweep tick for a UUID pattern (`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`). This is what every major CLI prints as its session header (`claude --session-id`, `codex session`, `cursor agent --session`). **First UUID seen wins** — the engine does not currently match against CLI-specific context markers, so any earlier UUID in boot output (e.g., a log line printing a workspace UUID, a trace ID, or a dependency version string) can steal the slot. Engine persists the first-seen UUID as `cli_session_id` on the agent record.
2. **Crash detection** — when the PTY dies with a recoverable error (surface disappeared, shell exited unexpectedly) AND `crash_recover=true` AND `user_killed !== true` AND `cli_session_id` is set, the next sweep attempts respawn.
3. **Respawn path** — new surface created, same launcher with the per-CLI resume command appended: `<repo>Claude -s --resume <id>` / `<repo>Codex -s resume <id>` / `cursor agent --session <id>`. Up to `MAX_RESPAWN_ATTEMPTS = 10` attempts before giving up.
4. **`user_killed` guard** — if the user explicitly killed the agent, `crash_recover` will NOT respawn it. **Caveat since v0.4.35:** the cut removed `stop_agent` and its `userInitiated` flag, and `close_surface` has no equivalent, so an agent can no longer close a worker while *preserving* recovery eligibility. The `user_killed` record field still exists and is still honoured; there is just no supported tool call that sets it to `false`.

**When to pass `crash_recover: true`:**
- Long-running Codex workers on PR loops (>30 min expected).
- Cursor audit workers that need to survive a cmux daemon restart.
- Claude workers executing multi-hour sprints where mac-crash resilience matters.
- ANY worker in an overnight / autonomous context where you won't be watching.

**When NOT to pass it:**
- Short-lived helpers (<5 min) where a crash means "task failed, start over".
- Workers in ambiguous session-ID formats (older CLIs without UUID headers).
- Debugging sessions where a crash IS the signal to investigate.

**Caveat — the session-ID heuristic is regex-based.** If a worker's early output happens to contain a UUID that isn't the CLI session (e.g., a log line printing a workspace UUID, a trace ID, a dependency version), the wrong ID gets captured and recovery will silently fail later.

**Verification procedure for critical spawns:**

1. Within 60 seconds of spawn: `list_agents({agent_ids:["..."], detail:"full"})` → check `cli_session_id` is not `null`.
2. Cross-check against the CLI's own session display via `read_screen`:
   - **Claude**: look for `Session:` or `--session-id` in the header.
   - **Codex**: look for `session ` in the splash / first turn.
   - **Cursor**: look for `--session ` in the boot log.
3. If `cli_session_id` does not match the on-screen session — or if it's `null` after 60s (capture window expired) — close the worker with `close_surface({scope:"agent", agent_id, force:true})`, then respawn fresh and re-verify. (Pre-v0.4.35 this step used `stop_agent(userInitiated:false)` to preserve recovery eligibility; that flag no longer exists, so treat the respawn as the recovery.)
4. For autonomous / overnight workers: fold this check into your spawn script and fail loudly on mismatch. A wrong `cli_session_id` means `crash_recover` will respawn with the wrong `--resume` argument and the new session won't have your context.

**Related agent-record fields** (visible via `list_agents({agent_ids:[id], detail:"full"})`):
- `cli_session_id` — captured UUID, or `null` if capture window expired before a match.
- `respawn_attempts` — count of recovery attempts made (0 to 10).
- `user_killed` — `true` if the user explicitly stopped the agent.
- `workspace_id` — owning workspace UUID (persisted for cross-session recovery).

**Distinct from the `-c` continue flag on repoGolem launchers.** `-c` resumes an *exited* session that the user re-launches manually. `crash_recover` handles *unexpected PTY death* mid-task, automatically. Use `-c` when you stop a worker and want to come back to it later; use `crash_recover: true` when you want the engine to auto-recover without your intervention.

## Spawning Agents (MANDATORY: use `spawn_agent`)

```text
mcp__cmuxlayer__spawn_agent({
  repo: "golems",
  cli: "codex",
  prompt: "Fix search ranking"
})
→ { agent_id, ... }

mcp__cmuxlayer__wait_for({ agent_id, target_state: "ready", timeout_ms: 120000 })
mcp__cmuxlayer__send_to({ agent_id, text: "Narrow scope to ranking only" })
mcp__cmuxlayer__wait_for({ agent_id, target_state: "done", timeout_ms: 1800000 })
```

**Options:** `repo`, `cli`, `prompt`, `workspace`, `parent_agent_id`

**Examples:**
```text
spawn_agent({ repo: "golems", cli: "claude", prompt: "Survey search regressions" })
spawn_agent({ repo: "golems", cli: "cursor", prompt: "Audit code quality and write findings to /tmp/audit.md" })
spawn_agent({ repo: "orchestrator", cli: "gemini", prompt: "Survey patterns and summarize in 5 bullets" })
spawn_agent({ repo: "golems", cli: "kiro", prompt: "Draft a concise troubleshooting note" })
```

**Hyphenated repo names:** if the repo contains `-`, verify the real repoGolem launcher in `/repogolem` first (FR-01). The doc warning is there because cmuxlayer can still mis-resolve the launcher name.

### Auto-workspace-categorization by launcher root

When spawning a visible pane via `mcp__cmuxlayer__spawn_agent` + sending a launcher
command, the pane MUST land in the workspace whose name contains
(case-insensitive substring) the launcher's repo root. Examples:

- `coachClaude -s` → workspace whose title contains "Coach"
- `orcClaude -s` → workspace whose title contains "orc" (or `workspace:2` by default)
- `voicelayerCodex -s` → workspace whose title contains "voicelayer"
- `brainlayerCodex -s` → workspace whose title contains "brainlayer" or "orc-buddy"

**Lookup protocol BEFORE spawning into a workspace:**

1. Identify the launcher (`coachClaude`, `orcClaude`, etc.).
2. Extract the repo root (`coach`, `orc`, `voicelayer`, `brainlayer`).
3. Call `mcp__cmuxlayer__list_surfaces()` to enumerate live workspaces.
4. Pick the workspace whose title contains the repo-root substring (case-insensitive).
5. Pass that workspace ref to `spawn_agent({workspace})`.
6. After spawn, verify via `list_surfaces` that the new surface ended up in the
   intended workspace. If not, IMMEDIATELY call
   `mcp__cmuxlayer__update_surface({action:"move", surface, workspace})` to fix.

> **Why post-spawn verify is mandatory:** historically the split call's
> `workspace` arg was **advisory** — actual placement may follow current focus,
> not the arg. Until cmuxlayer enforces the arg, agents MUST verify + move
> post-spawn. Skipping the verify step is how the live 2026-05-17 incident
> happened.

**Evidence:** Live 2026-05-17 ~02:32 IDT — skillCreator s:3 spawned 8 Batch D
eval panes into `workspace:1`; 4 coach-launcher panes
landed in `workspace:2` anyway. orc had to manually move them to recover.
Cost: ~5 minutes of orc context burning on layout repair instead of dispatch.

`spawn_agent({workspace})` already routes correctly in most cases — this rule
still covers the `spawn_agent({type:"terminal"})` path you use for a
non-agent terminal or a launcher invocation that isn't a `cli` enum value.

### NEVER Use These Commands (Common Mistakes)

> **Root cause (April 5 2026):** taskowlClaude used `cursor-cli` in a cmux pane — command not found. Wasted a surface and debugging time.

| WRONG | RIGHT | Why |
|-------|-------|-----|
| `cursor-cli "prompt"` | `cursor agent --trust "prompt"` | `cursor-cli` does not exist as a command |
| `cursor --print --output-format text` | `cursor agent --output-format text` | `--print` is not a cursor flag |
| `cursor agent --output-format` (in cmux) | `cursor agent --trust` (in cmux) | Interactive cmux agents need `--trust` for permissions, not piped/batch output |

**For visible Cursor agents:** Use `spawn_agent({cli:"cursor"})` from the parent orchestrator. These workers should boot as addressable `agent_id`s, not as manually typed launchers.
**For batch/piped output:** Use `cursor agent --output-format text --model "<cursor-max-mode-model>" "PROMPT"` directly. Substitute Cursor's current Max Mode model ID (verify via `cursor agent --help` or the Cursor changelog — IDs change between versions). Default to no `--model` flag (Auto) per /agent-routing AP3.
**For repoGolem launchers:** see **repogolem** (canonical).

### Cursor `/auto-run` fallback

Default path: put the task in `spawn_agent.prompt` and talk to the worker via `send_to({agent_id,...})`.

If a live Cursor pane still stalls on approvals, send `/auto-run` as a follow-up first:

```text
wait_for({ agent_id, target_state: "ready", timeout_ms: 120000 })
send_to({ agent_id, text: "/auto-run", press_enter: true })
send_to({ agent_id, text: "<task prompt>", press_enter: true })
```

If FR-06 blocks `send_to` in agent mode, confirm the raw pane with `read_screen` and use one `send_to({mode:"surface"})` fallback.

## Agent Selection Guide

cmux-agents only maps the already-selected engine to visible panes and lifecycle controls. Engine routing lives in `/agent-routing`; launcher policy lives in `/repogolem`.

Full CLI syntax and capabilities: `adapters/` directory + `adapters/capabilities.yaml`.

## Post-Restart Truth-vs-Display (2026-06-06)

After **ANY** cmux restart (daemon bounce, Mac wake, manual relaunch), every lead follows the proven checkpoint pattern:

```text
checkpoint (record agent_ids + last-known state)
  → restart event
  → VERIFY (list_agents + read_screen per worker)
  → report liveness FROM EVIDENCE ONLY
```

**Rules:**
- `list_agents` / registry alone is not enough — pair with `read_screen` scrollback on each worker you report as alive.
- Pre-restart claims ("Codex s:63 still working") are **stale** until re-verified. Operator-direct catch: "I don't see any worker of yours working still."
- Status reports to collab/Etan must cite what `read_screen` showed, not what you remembered before the restart.
- Claims-lag window is real (fleet may repopulate over minutes) — say "unverified post-restart" until VERIFY completes.

## Resume-Freeze Doctrine (2026-06-07)

> **Why this exists:** a `-c` resumed session does **NOT** reliably continue pending duties from the pre-death turn. One resumed seat froze TWICE on the same standing ritual in a single window — verify/re-arm/completion-line never executed and the seat sat ~95 min unmonitored; on the next cycle the completion line landed 96 min late.

**Rules:**
- **Treat a resumed session as a fresh boot.** Re-derive its duties from durable artifacts (collab file, duty checklist, output files) — never trust the dying session's stated intentions to carry forward.
- **Standing orders that must survive a restart are encoded as durable machinery, not agent to-do intentions.** The proven watch-v6 pattern: the monitor itself fires the action (nohup detached) AND writes the collab announce — removing the agent as the failure point. launchd jobs and Monitors that act + announce are the durable forms.
- **The orchestrator verifies the resumed seat executed its duty list** (collab checklist) — never assumes the resume carried the duties forward.

## Worker Briefs

Fleet law for collab claims, DONE markers, and guard handoffs lives in canon #7. For cmux delivery, run `workflows/prompt-audit.md` §8 and include:

- absolute verified paths and real environment facts;
- max output length, output format, audience, and what not to include;
- response markers plus a final DONE line;
- **the effort for THIS job**, named on the brief and matching the launch command (see below);
- file-based handoff for large briefs;
- the **GitHub identity signature requirement** if the worker will post to GitHub — mandatory until
  the repoGolem `gh()` wrapper ships and injects it automatically (prompt-audit §3; full spec in
  `/pr-loop` → `references/github-identity.md`). The worker signs with ITS OWN seat/role/harness and
  its OWN live-session model — never a model value you pass down from the spawn.

### Spawn Only What the Job Needs (Etan, 2026-09-05)

Etan, verbatim — relayed via orc, the ellipsis is his:

> "tell the agents to do it wisely and not just blindly make workflows and sub-agents… especially
> when they're Fable, make sure they're not creating Fable sub-agents and workflows full of Fables
> when they don't actually need them, instead of just pin-gating it."

Sub-agents and workflows only when the task needs parallelism or a context the seat cannot hold;
every spawn pinned explicitly; Fable only where judgment is the bottleneck, never for mechanical
steps; a Fable seat defaults its workers to opus/sonnet and says why when it does not. The gate
(`model-pin-gate`) is the backstop, not the decision.

### Effort Is Set Per Dispatch (Etan, 2026-09-05)

Etan, verbatim — relayed via orc, the ellipsis is his:

> "Codex being high instead of xhigh on default is nice, but leads need to know that they should
> also control the effort levels for more/less complex/more already scoped and focused jobs… not
> always needed high."

**Codex and Claude workers alike.** The brief names the effort for that job and the spawn's
`-E/--effort` matches it: `medium` or `low` for scoped, focused, or mechanical work, `high` only
when the job is genuinely complex, `xhigh` only by explicit choice named with its reason. The
launcher's role default is a **ceiling, not a floor** — `repoGolem` sets it from the seat
(Codex `high`; Claude `-E` > `GOLEM_EFFORT` > `GOLEM_ROLE=worker` → `medium` > `high`) and the lead
lowers it per dispatch. If a brief names no effort, the lead has not finished writing it. Rungs are
orc's operationalization, not Etan's words; full table in `/pr-loop` → SKILL.md "Effort Is Set Per
Dispatch".

## Prompt Size Ceiling — oversized sends freeze surfaces above ~2000 chars

> **Why this exists:** A 72-hour JSONL sweep (2026-04-12 → 2026-04-15) across 5 Claude Code orchestrator sessions found that raw surface sends over 2,000 characters correlated strongly with surface freezes. In one TaskOwl-app session: 868 total send calls, 13 exceeded 2,000 chars (max 4,382), and those 13 large calls preceded 6 frozen / surface-unresponsive incidents. In a control session (`coach` repo) every send stayed under 1,900 chars and there were **zero** freezes. The `coach` control case is the proof: discipline eliminates the symptom.
>
> **Since v0.4.35 the tool enforces this for you:** `send_to.text` and `spawn_agent.prompt` are capped at 1,800 inline characters, and `allow_long_inline: true` is the deliberate override. The rule below is no longer discipline-only — but the file-based pattern is still the correct answer above the cap, not the override flag.

**Direct evidence** (from the TaskOwl-app session):
> "You're right — the cmux surface was frozen, my send commands weren't taking effect (sent 4 commands, none showed up). I burned ~3 minutes trying before deciding to implement directly rather than waste more time debugging cmux."

### The rule (hard cap + warn)

| Payload length | Action |
|----------------|--------|
| < 1,500 chars  | Send directly. Safe zone. |
| 1,500–1,800    | Warn threshold. Trim if possible, then send. |
| **≥ 1,800**    | **HARD CAP**, now enforced by the tool. Do NOT reach for `allow_long_inline`. Use the file-based handoff pattern below (or `boot_prompt_path` at spawn time). |

1,800 chars gives a ~17% safety margin under the smallest observed freeze point (~2,100 chars). Above the cap — or when you bypass it with `allow_long_inline` — surfaces freeze silently, and `send_to` still returns `ok:true` while the target pane never sees the input.

### File-based handoff pattern (for prompts > 1,800 chars)

Three steps. The first one is a shell command you run via the Bash tool. The next two are cmuxlayer MCP calls.

**Step 1 — write the long prompt to disk via Bash (or the Write tool):**

```bash
printf '%s' "$LONG_PROMPT" > $HOME/Gits/orchestrator/collab/surface-N-$(date +%s).md
```

Prefer the Write tool when the prompt is already in-context — it avoids shell quoting pitfalls on multi-line prompts.

**Step 2 — type the `cat` command into the target surface, then press Return:**

```
send_to({ mode: "surface", surface: "surface:N", text: "cat $HOME/Gits/orchestrator/collab/surface-N-<stamp>.md" })
```

`send_to` presses Return for you — `press_enter` defaults to **`true`**. (Pre-v0.4.35 this took two calls, `send_input` then `send_key("Return")`, because `send_input` only typed the text. That is no longer the contract.) Pass `press_enter: false` only when you deliberately want the text left sitting on the composer line, and drive the key yourself with `send_to({mode:"key", surface, key:"Return"})`.

**Step 3 — verify the handoff landed:** after a few seconds, `read_screen` the surface and confirm you see the file contents (or the agent's response to them). If the pane is frozen despite the short pointer, the file is still safe on disk — spawn a fresh surface and re-run Step 2 against the new surface.

**Why the file pattern beats splitting the prompt into multiple sends:**
- Splitting into N sub-2000 chunks still hits the freeze path if any chunk pushes the pane state over some cumulative limit, and loses atomicity (the agent sees a partial prompt).
- The file is independent of the pane's mutable state. If the pane freezes, spawn a new one and re-run the `cat` — the prompt is preserved.
- File handoff also survives pane crashes, restarts, and compactions.

### On a failed send: check the surface before retrying

A retry without root-cause investigation is almost always wrong. After any `send_to` that appears to have been lost (no output, no activity, retry instinct kicking in):

1. `read_screen(surface: "surface:N", lines: 10)` — is the pane frozen, scrolled back, or just slow?
2. If frozen → follow Step 3 of Surface Health Check (close, respawn, salvage).
3. If the payload you just sent was near or above the 1,800-char cap → that was the root cause. Don't retry at the same size; switch to file-based handoff.
4. If unsure → `list_agents({mine:true})` to confirm the worker still exists.

**Do not** fire a second `send_to` of the same large payload hoping it "works this time." It won't, and you'll burn the same 3 minutes the earlier session logged.

## Boot + deliver: FOCUS-FIRST (the reliable bundle for "send the prompt once booted")

> **Root cause (Etan, recurring — 2026-05-30):** a cmux pane/agent does **NOT
> initiate until its workspace/pane is FOCUSED**. So `boot_prompt_path` and a bare
> `wait_for({target_state:"ready"})` on an unfocused pane **NEVER RESOLVE** — they
> hang on a ready-state that can't arrive because the agent hasn't started. Etan (paraphrased):
> *"It never resolves — focus the pane for 3 seconds, then read, then if
> ready send the prompt."* Do **not** lean on `boot_prompt_path` / blind long
> `wait_for` to deliver a boot prompt. **Focus is the missing precondition.**

**The reliable bundle:**
```text
1. CREATE the pane:   spawn_agent({type:"terminal", role, workspace, focus:true})  → surface
                      (focus:true so the pane is the one that initiates)
2. LAUNCH (no boot_prompt_path):  send_to({mode:"command", surface, command:"<repo>Claude -s"})
                      (launcher/`-s`/`-m` policy lives in `/repogolem`)
3. FOCUS so it initiates:  `cmux focus-pane --pane <pane>` (CLI — the 9-tool MCP surface has
                      no workspace-focus tool; the old select_workspace was cut in v0.4.35)
4. WAIT ~3s, then READ:  read_screen({surface, parsed_only:true})
                      → confirm status ready/idle/working
5. IF READY, deliver:  send_to({mode:"command", surface, command:"<the prompt>"})  — pane is focused, it lands.
```

- **`boot_prompt_path` is for already-focused/foreground spawns only.** When you're
  driving from another pane, it will hang — use this focus-first bundle instead.
- **Upstream fix (route to cmuxLayer-LEAD):** `boot_prompt_path` / `wait_for` should
  **auto-focus the target pane before waiting** for readiness — then this 5-step bundle
  collapses back into a single reliable primitive. Until then, focus-first is mandatory.

## Composer-Wedge Runtime Doctrine (2026-06-06)

> **Why this exists:** `boot_prompt_delivered`, `submit_verified`, working-status, and `token_count` have all returned false positives — including `submit_verified:true` on a Claude pane with unsubmitted text still sitting after the `›` prompt marker. Doc edits alone did not stop this class: seven observer-window catches occurred all post-#478-merge (tallies vary 3/4/5/7 across observers — no canonical ledger). This section is mitigation doctrine; the cure is the cmuxlayer composer-is-empty code fix (dispatched separately as D6).

**Untrusted submit signals — treat ALL of these as hints only, never ground truth:**
- `boot_prompt_delivered`
- `submit_verified`
- parsed `working` / `idle` / `ready` status from registry
- `token_count` (including phantom climbing counts on never-started sessions)

**The only reliable submit check:** prompt text visible in **SCROLLBACK above the working line**. Text still sitting after the `›` prompt marker = **unsubmitted**, regardless of what any delivery field says.

**Mandatory post-dispatch read:** `read_screen` (or `list_agents(detail:"full")` + scrollback read on dispute) **≤15 seconds after EVERY dispatch** — boot prompt, follow-up, or `send_to`.

**Anomaly triggers — force a full scrollback read:**
- `'Queued follow-up inputs'` visible on a worker that registry says is `working`
- Token count unchanged across two reads after a send
- Cost/token meter not moving while status says working

**Idle Codex sends:** when the pane is genuinely idle (at `›` / `$` prompt), use `send_to({mode:"command"})` (atomic) **or** `send_to({mode:"surface"})` + verified status flip — never fire-and-forget without the ≤15s read.

## Surface Health Check (MANDATORY — before ANY prompt delivery)

> **Why this exists:** Frozen/dead surfaces are a top-3 frustration source. Agents send prompts to unresponsive surfaces, losing work and burning ~3 minutes per incident on manual fallback. `send_to` returns `ok:true` even on frozen terminals.

**Step 1 — After spawning a worker:**
`wait_for({agent_id, target_state:"ready", timeout_ms:120000})` is the default health gate. If it times out, inspect the raw pane with `read_screen`. Two failures = dead worker — stop it and respawn. **If `wait_for` hangs to timeout and the pane looks un-booted, the pane is probably UNFOCUSED — see "Boot + deliver: FOCUS-FIRST" above; focus it, then re-check.**

```text
# After spawn_agent → got agent_id + linked surface
wait_for({ agent_id: "agent:abc123", target_state: "ready", timeout_ms: 120000 })
# ✅ Ready/working state = worker booted
# ❌ Timeout: read_screen(surface: "...", lines: 10) to check for FR-06 parser drift
```

**Step 2 — Before sending ANY prompt to an existing surface:**
Always `read_screen` first to confirm the surface is responsive. Never fire-and-forget a `send_to` without checking state first.

```text
# Before sending prompt to surface:N
read_screen(surface: "surface:N", lines: 5)
# ✅ Responsive: shows shell prompt, cursor output, or agent activity
# ❌ Unresponsive: blank screen, no change from last check, or error output
```

**Step 3 — Unresponsive surface recovery:**
If a surface fails 2 consecutive `read_screen` checks (blank, frozen, or no shell prompt):
1. `read_screen(surface: "surface:N", lines: 80, scrollback: true)` — salvage any partial work
2. `brain_store` any salvaged progress
3. `close_surface({scope:"agent", agent_id, force:true})`
4. `spawn_agent({...same task...})` — create a fresh worker
5. Re-verify with Step 1 before sending the prompt

**Step 4 — Safe prompt delivery (special character escaping):**
Never send special characters (backticks, quotes, markdown formatting) directly via `send_to({mode:"surface"})`. They get interpreted by the shell and corrupt the prompt.

```text
# WRONG — backticks and quotes break in a raw surface send:
send_to({ mode: "surface", surface: "surface:N", text: "Fix the `processQueue` function" })

# RIGHT — use heredoc pattern:
send_to({ mode: "surface", surface: "surface:N", text: "cat <<'PROMPT_EOF' | clipboard\nFix the processQueue function\nPROMPT_EOF" })

# RIGHT — escape special characters:
send_to({ mode: "surface", surface: "surface:N", text: "Fix the \\`processQueue\\` function" })

# SAFEST — write prompt to a temp file, then cat it:
# 1. Write prompt to /tmp/agent-prompt-N.txt via Bash
# 2. send_to({mode:"surface", surface, text:"cat /tmp/agent-prompt-N.txt"})
```

**🚨 THE `@`-MENTION FILE-PICKER TRAP (real bug, 2026-06-14):** never put a bare `@word` in `send_to` text (any mode) destined for an interactive agent composer (Claude Code, Codex, Cursor TUIs). The receiving composer interprets `@` as its **file-reference trigger** and pops a file-picker overlay — the rest of your message gets swallowed/mangled and the agent never sees the real prompt. This is delivery corruption that `ok:true` will NOT report.

```text
# WRONG — "@narration-lead" fires the receiver's file-picker, mangles the send:
send_to({ agent_id: "...", text: "@narration-lead please pick up the dashboard work" })

# RIGHT — drop the leading @ (claimed-name addressing is for COLLAB-FILE posts, not pane sends):
send_to({ agent_id: "...", text: "narration-lead: please pick up the dashboard work" })

# RIGHT — if a literal @ is unavoidable, route via the file-based handoff (cat a file) so the
# composer ingests it as file contents, not live keystrokes through the @ trigger.
```

Rule of thumb: **`@<name>` belongs in the collab `.md` (where monitors match it), NOT in keystrokes typed into another agent's composer.** Pane-to-pane addressing uses the bare name or the `[FROM=… TO=…]` envelope body — never a leading `@`.

**Checklist (run mentally before every send):**
- [ ] Did I `read_screen` this surface in the last 60 seconds?
- [ ] Does it show a shell prompt or active agent?
- [ ] Does my prompt contain backticks, quotes, or markdown? → escape or heredoc
- [ ] Is this a fresh surface? → did I wait 3s and verify the prompt?

## Parsing Agent Output

When reading agent output via `read_screen`, search for `---RESPONSE_START---` to find the structured response. Everything between START and END is the deliverable — ignore terminal noise, tool calls, and deliberation outside the markers.

```text
# Pattern: read enough scrollback to capture the full response
read_screen(surface: "surface:N", lines: 80, scrollback: true)
# Then look for ---RESPONSE_START--- ... ---RESPONSE_END--- in the output
```

If markers are missing, fall back to reading the last 50 lines + done signal. But if you wrote the prompt correctly (checklist above), markers will be there.

## Monitoring Protocol

> **OUTBOUND worker monitoring lives here.** Inbound lead/orchestrator monitor, cron, and loop-payload rules → see **cron-payload-discipline** (canonical).

Fleet law for guard/DONE/harvest-close lives in canon #7. This section covers outbound worker waits.

**Arm the inbound watch before you spawn the first worker** — step 0 of boot and step 0 again after
every compaction, because a monitor dies with its session. Copy-pasteable arm/attach commands and
the filter-discipline rules are in `/collab-monitor` § "Arming Is Step 0".

After spawning:
1. Update AGENT_REGISTRY
2. `wait_for({agent_id, target_state:"ready"|"working", timeout_ms:120000})` to verify boot
3. For long tasks, require an output file + DONE marker **and** wait on `wait_for({agent_id, target_state:"done"})`
4. After any topology change or crash, re-run `list_agents({mine:true})` before sending follow-ups — surface ids drift
5. If `wait_for` or `list_agents(detail:"full")` disagrees with the visible pane, use `read_screen` to adjudicate FR-06
6. When the agent finishes, read output IMMEDIATELY — don't wait for the user to ask
7. **After system events** (Mac wake, BrainBar restart, network change, **ANY cmux restart**): inspect active workers via `list_agents` + `read_screen` on every worker you intend to report on. Agents can lose MCP silently. **Never carry pre-restart liveness claims forward** — see Post-Restart Truth-vs-Display below.

**Manual launcher sends get the SAME boot verify as `spawn_agent`.** If you launch a launcher with `send_to({mode:"command", surface, command})` instead of calling `spawn_agent`, you still owe step 2 — `read_screen` the surface within 30s and confirm the CLI banner/prompt is actually up. A launcher can die instantly (bad `-w` path, missing dir, `command not found`) and drop straight back to the shell; a bare `$`/`%` prompt where the banner belongs means the lane never started. Evidence: a `-w` lane exited to the shell at launch and sat unnoticed because no post-launch read was done (`brainbar-aa9b0212-a11`, 2026-08-09). No boot evidence, no lane — relaunch via `spawn_agent`.

**Worker utilization check:** routing violations → see **agent-routing** (canonical). Worker surface crash/closure remains a cmux-agents lifecycle issue: respawn immediately on a new surface and resend the task with recovered context.

**cmux-specific anti-patterns:** spawning without `wait_for`, reading only registry state when parser and pane disagree, using invisible Task agents when the user asked for cmux agents, and sending follow-ups to remembered surface numbers instead of `agent_id`s`.

## Envelope-vs-Delivery Pairing (MANDATORY)

> **Why this exists:** orphan envelopes — `[FROM=X TO=Y TYPE=Z]` blocks written
> to the author's OWN pane and never actually delivered to Y — are a top
> friction source in multi-agent collabs. 64 orphan envelopes were observed in
> one Codex session (wave3-codex-bulk Block B). Verbatim user friction:
> *"Why do you have these messages in your chat but no one enters them?"*
> Recurred across Wave 1-3 (3+ logged occurrences).

### The rule

Any `[FROM=<self> TO=<target> TYPE=<status|mission|task_done|ack>]` envelope
block you emit to your own pane output MUST be paired with a
`mcp__cmuxlayer__send_to({agent_id: <target>, text: ...})` call **in the SAME turn**.

**Rule of thumb:** if you wrote `TO=X` in plaintext, you wrote it FOR X — so
deliver it to X. An envelope in your own pane that wasn't sent is a message in
a bottle, not communication.

### Same-turn pairing pattern (copy this)

```text
# 1. Compose the envelope you want X to see:
envelope = """
[FROM=orcClaude TO=coachClaude TYPE=task_done]
Audit finished, 14 findings, no commits.
[/FROM=orcClaude TO=coachClaude TYPE=task_done]
"""

# 2. SAME TURN — actually deliver it:
mcp__cmuxlayer__send_to({
  agent_id: "agent:coach-...",
  text: envelope
})
```

Both must appear in the same model turn. If you only emit step 1 (the
plaintext envelope in your own pane), the message is undelivered — X never
sees it.

### Anti-patterns (these are the orphans)

| Anti-pattern | Why it fails |
|---|---|
| Writing `[FROM=X TO=Y ...]` in your pane "for the log" without `send_to` | Y never sees it; orchestrator-side log is not a communication channel |
| Splitting envelope and delivery across turns ("I'll send it next turn") | Forgetting is the default; next turn rarely happens |
| Calling `send_to({text: "hi"})` after composing a `FROM=/TO=` envelope but sending only the bare message text | Recipient loses the FROM/TO/TYPE metadata the envelope was built to carry |
| Emitting envelope to a CLAUDE_COUNTER summary instead of calling `send_to` | The summary is yours, not the recipient's inbox |

### Acceptance test

If your turn output contains a `[FROM=...TO=...TYPE=...]` block, your turn's
tool calls MUST also contain a matching `mcp__cmuxlayer__send_to` call whose `agent_id` corresponds to the `TO=` target
and whose `text` includes the envelope contents. No pair → orphan envelope →
rule violation.

## Done Signals

Instruct agents to put the signal **as the very last line before CLAUDE_COUNTER** — not buried above a summary. Otherwise `read_screen` won't catch it.

## Collab Pattern

> Fleet law: canon #7 owns collab claim/guard/DONE/harvest-close. Full collab scaffolding lives in `/large-plan` `workflows/collab.md`; this section only covers cmux delivery.

Copy `$ORCHESTRATOR_REPO/collab/TEMPLATE.md` first, then spawn workers with the collab path in the prompt.

```text
# 1. Write collab file from template
# 2. Spawn agents with collab instructions
for entry in "search:Agent1" "perf:Agent2" "security:Agent3"; do
  angle="${entry%%:*}"; name="${entry#*:}"
  spawn_agent({
    repo: "TARGET_REPO",
    cli: "claude",
    prompt: "Read collab/FILE.md — you are " name ". Claim " angle ". Update collab when done."
  })
done
```

Log every action in collab: spawns, completions, blockers. No silent work.

Roster query: `grep '^> CLAIM' <channel-file>`.

## Git Worktree Isolation

Worktree policy lives in the `worktrees`/`pr-loop` skills. cmux-specific requirement: for parallel workers in the same repo, create the worktrees first and launch each worker against its assigned absolute path.

## Pane Hygiene — harvest, review, close

For finished one-shots and worker panes, treat harvest → review → close pane as one sequence. Capture the output, confirm the task result, then close/stop the pane. Only panes hosting live processes stay open (for example a dev server, log tail, or active long-running worker), and the collab/status should say why that pane is still live.

**The lane's monitor closes with the lane.** Harvest → review → close pane → **stop the monitor** — a monitor outliving its collab is sprawl, and sprawl is a defect (canon #7; orc REF9). At every wave close, check that live monitors do not outnumber live lanes.

## Essential Rules

1. **`spawn_agent` for every worker** — no hand-rolled launch flow
2. **Discover workers before acting** — use `list_agents` / `list_agents({mine:true})`
3. **NEVER read_screen your own surface** — recursive output
4. **Verify after launch** — `wait_for` first, `list_agents(detail:"full")` second, `read_screen` only for disputes
5. **Workers = current-workspace splits, audits/research = separate named workspaces** unless the user explicitly asks for same-workspace visibility
6. **Sequential launch** — brief spacing still helps on first-run biometric prompts
7. **Cross-workspace: always pass workspace ref** — surfaces are workspace-scoped
8. **Name everything** — `mcp__cmuxlayer__update_surface({action:"rename", surface, title})` on every surface
9. **AGENT_REGISTRY is mandatory** — maintains state across compaction
10. **BrainLayer agents are sequential** — stagger by 10s+ (SQLite = single writer)
11. **`wait_for` on spawn, not client-side polling** — set up worker monitoring immediately
12. **Before user-away windows, every active worker needs `wait_for` coverage or a file-based completion contract**
13. **Gems to ALL active agents** — send new research/context to every active worker with a one-line why-it-matters note
14. **Respawn > absorb** — salvage partial work, `close_surface({scope:"agent"})`, respawn, resend the same task with recovered context
15. **Agent health check BEFORE every follow-up** — use recent `list_agents(detail:"full")`/`wait_for`; raw `read_screen` only for FR-06 disputes
16. **Post-sprint retrospective** — `brain_store` what failed, what worked, and what the user corrected
17. **Concurrency** — canon #5 caps worker dispatch at 2-3; count running agents with `list_agents` and batch the rest
18. **Skills don't hot-reload in long sessions** — notify or respawn long-running agents after critical skill edits
19. **Finished panes get closed** — harvest, review, close. Only live processes stay.
20. **Pass role, not column; never type a leading `@` into a pane** — role geometry handles placement; `@<name>` belongs in collab files, not keystrokes.

Fleet-level concurrency/model/collab law lives in canon #5/#7; launcher/headless policy lives in `/repogolem`.

## Known Issues — cmux rename hooks (design proposal, do NOT edit without orcClaude review)

**Background (2026-04-11):** the cmux tab-rename auto-hook (launcher name → display name + color) has 5 observed bugs. Code changes are OUT OF SCOPE for skill-creator — this section is a design proposal for the next orcClaude session to dispatch.

| # | Bug | Symptom | Proposed fix |
|---|---|---|---|
| 5.1 | **Flat tab colors** | All tabs use the same (or default) color; agent type not visually distinguishable | Map launcher function → color in a dict (claude=blue, codex=orange, cursor=purple, gemini=green, kiro=red). Set on spawn. **Blocked on a tool affordance since v0.4.35:** `rename_tab(color=...)` was cut and `update_surface` takes only `action`/`surface`/`title` — there is no color parameter to call, so this fix needs the color channel added first. |
| 5.2 | **Red-to-cyan weirdness** | Some tabs flip from red (error/warning) to cyan unexpectedly; color state machine has a bad transition | Debug: instrument the rename hook to log every color-set call with timestamp + reason. Most likely cause: one code path sets color from agent state, another sets it from default, last write wins. |
| 5.3 | **Nested naming collapses** | Tab names for agents spawned in worktrees or nested panes lose their parent context (e.g. "golemsClaude > feat-X" → "claude") | When generating the display name, walk the surface parent chain and prepend up to 1 level of context. Truncate via ellipsis if longer than the tab width budget. |
| 5.4 | **Weak semantic tag extraction** | Tab names don't reflect what the agent is actually WORKING on (they just say "claude" instead of e.g. "claude: PR#232 fix") | Parse the task prompt on spawn — extract PR numbers (`PR#\d+`), issue refs (`#\d+`), and the first 3-5 imperative words. Fall back to launcher name if none found. |
| 5.5 | **Launcher-to-display-name mapping missing** | Tab shows raw function name (`golemsClaude -s`) instead of a friendly display (`golems • Claude`) | Add a `LAUNCHER_DISPLAY` lookup table keyed on the base launcher pattern (`{repo}Claude` → `{repo} • Claude`, `{repo}Cursor` → `{repo} • Cursor`, etc.). Regex extract `repo` + `agent`. |

**Where the hook lives:** NOT located as of 2026-04-11 by skillCreatorBuddy. Not in `~/.claude/hooks/`, not in `$HOME/Gits/golems/hooks`, not in `~/.config/cmux/settings.json`. Likely candidates to check next session:
- Swift cmux client source (may be built-in tab rename behavior, not a Python hook)
- `$HOME/Gits/cmuxlayer/src/**/rename*`
- A LaunchAgent plist that watches cmux sockets
- Part of the `spawn_agent` implementation / agent-registry wiring in cmuxlayer

**Next action (for orcClaude, NOT for skill-creator):**
1. Locate the actual rename hook source
2. Reproduce each bug in a safe surface
3. Fix behind a feature flag
4. A/B test against the current hook
5. Ship via /pr-loop

**Until then:** manually rename after spawn with `mcp__cmuxlayer__update_surface({action:"rename", surface, title})`, using the display-name conventions in the table above. **Color and status cannot be set at all:** `rename_tab(color=…)`, `set_status` and `set_progress` were cut in v0.4.35 and `update_surface` does `move` and `rename` only — there is no replacement to call.

## See Also

- `/agent-routing` — canonical task routing matrix (R28)
- `/cmux` — low-level pane operations (splits, reads, sends, browser)
- `/orc` — orchestration decisions, state machine, collab protocols
- `/pr-loop` — every agent working on code must invoke this for every PR

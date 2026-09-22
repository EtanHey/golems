Read this when spawning or inspecting cmuxlayer agents, choosing tool parameters, handling crash recovery, or routing a worker to a workspace.

Launcher/model/resume policy is canonical in `/repogolem` and engine selection in `/agent-routing`.
This reference begins at the cmuxlayer tool boundary.

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
| Status/progress publication | **No replacement.** An agent cannot publish status/progress to its pane. `update_surface` does `move` and `rename` only. |
| Recovery-preserving stop | **No replacement.** `close_surface` has no `userInitiated` flag, so the `user_killed` / recovery-eligibility distinction can no longer be set from the tool surface. |
| New terminal/browser surface | **No direct browser replacement.** Use `spawn_agent({type:"terminal"})` for a shell tab. |

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
4. **`user_killed` guard** — if the user explicitly killed the agent, `crash_recover` will NOT respawn it. **Caveat since v0.4.35:** `close_surface` cannot preserve recovery eligibility. The `user_killed` record field still exists and is still honoured; there is just no supported tool call that sets it to `false`.

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
3. If `cli_session_id` does not match the on-screen session — or if it's `null` after 60s (capture window expired) — close the worker with `close_surface({scope:"agent", agent_id, force:true})`, then respawn fresh and re-verify. Treat the respawn as the recovery because the current stop surface cannot preserve eligibility.
4. For autonomous / overnight workers: fold this check into your spawn script and fail loudly on mismatch. A wrong `cli_session_id` means `crash_recover` will respawn with the wrong `--resume` argument and the new session won't have your context.

**Related agent-record fields** (visible via `list_agents({agent_ids:[id], detail:"full"})`):
- `cli_session_id` — captured UUID, or `null` if capture window expired before a match.
- `respawn_attempts` — count of recovery attempts made (0 to 10).
- `user_killed` — `true` if the user explicitly stopped the agent.
- `workspace_id` — owning workspace UUID (persisted for cross-session recovery).

**Distinct from the `-c` continue flag on repoGolem launchers.** `-c` resumes an *exited* session that the user re-launches manually. `crash_recover` handles *unexpected PTY death* mid-task, automatically. Use `-c` when you stop a worker and want to come back to it later; use `crash_recover: true` when you want the engine to auto-recover without your intervention.

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
**For batch/piped output:** Use `cursor agent --output-format text "PROMPT"` directly. Cursor is Auto-only; never pass a model flag or model field (`/agent-routing` AP3).
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

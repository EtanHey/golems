---
name: cmux-agents
description: "Spawn AI workers in cmux via MCP/repoGolem. Triggers: visible workers, terminal agents, orchestration, audits."
---

# cmux-agents

Orchestration layer for AI agents in cmux panes. Low-level pane operations use **cmuxlayer MCP tools**; this skill owns the visible-worker lifecycle, delivery, recovery, and pane hygiene on top.

> **Naming:** `cmux` is the terminal app/CLI; `cmuxlayer` is the MCP/managed-agent/orchestration layer this skill drives. The MCP tools keep the literal `mcp__cmuxlayer__*` namespace (and `.mcp.json` server key `cmux`) for back-compat, but the *layer* is called `cmuxlayer` — never `cmux MCP`, `cmux.layer`, or `cmux layer`. See `/cmux` → "`cmux` vs `cmuxlayer`". <!-- naming-lint:allow -->

## Ownership boundaries

Fleet canon #5 owns model policy, #6 owns launcher naming/skip-perms, and #7 owns claim/guard/DONE/harvest-close. This skill keeps cmux pane mechanics, worker lifecycle controls, and delivery/recovery adapters.

- Engine selection and review routing → `/agent-routing` § Review routing.
- Launcher, `-s`, `-m`, resume, and FR-01 workaround → `/repogolem`.
- Monitor/cron/loop payloads, inbound guards and reviewer handoff → `/collab-monitor` (payload rules: its `references/cron-payloads.md`).
- Full collab scaffolding → `/large-plan` `workflows/collab.md`; PR stop/end state → `/pr-loop`.
- Visual evidence → `/never-fabricate` R7 and `/qa-verdict-gate`; shell mechanics → `/cyber` (`references/shell.md`).

## Decide first

| Need | Route |
|---|---|
| Visible implementation worker | Current workspace, role `worker` |
| Read-only audit/research | Separate named workspace unless Etan asks to keep it beside the lead |
| Lead/orchestrator | Role `orchestrator` |
| One-shot nudge or tiny lookup | Use an in-session subagent; do not create a persistent cmux pane |
| Manual launcher, non-agent terminal, or FR-01 recovery | Follow `/repogolem`, then use the same boot and delivery verification as a managed worker |

cmuxlayer enforces two-column role geometry: orchestrators land LEFT, workers RIGHT, and extra workers tab into the rightmost worker pane. Pass the role; never compute a column. Pass `workspace` for every cross-workspace spawn. `focus` defaults to `false` and restores the original focus after initialization.

## Default lifecycle

1. Discover current topology with `list_agents` or `list_agents({mine:true})`; after crashes or layout changes, rediscover before acting.
2. Spawn every visible worker with `mcp__cmuxlayer__spawn_agent({repo, cli, prompt, workspace?, parent_agent_id?, role?})`. Do not hand-roll a repoGolem launch unless FR-01 or a non-agent terminal requires it.
3. Capture `agent_id` immediately in the collab/AGENT_REGISTRY and maintain the registry cadence in [references/monitoring-and-collaboration.md](references/monitoring-and-collaboration.md#agent_registry-cadence). It is the durable handle; surface refs are for raw inspection and non-agent panes.
4. Verify boot with `wait_for({agent_id, target_state:"ready"|"working", timeout_ms:120000})`; use `list_agents(detail:"full")` next and `read_screen` only to adjudicate parser/pane disagreement.
5. Send follow-ups by `agent_id`, after a current health check. Verify every dispatch within 15 seconds; visible text after the composer prompt means it was not submitted.
6. For multi-minute work, require an output file with an exact final DONE marker and wait for `target_state:"done"`; fleet canon #7/#9 owns DONE-versus-artifact law. Read the artifact immediately when the worker finishes.
7. Follow [Pane Hygiene](references/monitoring-and-collaboration.md#pane-hygiene--harvest-review-close), then close the worker with `close_surface({scope:"agent", agent_id, force:true})`. Only live processes remain open.

## Spawn a Gemini gatherer

Routing (which shapes go to Flash-High vs Pro-High) lives in `/agent-routing` § Role Matrix.

1. Write the brief to a file. Boot payloads are always one-line pointers to a brief file.
2. Check the cmuxlayer version. `control_health` has no version field; read it from `cmuxlayer --version` or the Cellar path in `control_health({detail:"full"})` → `health.current_process.script_path`.
3. Spawn: `spawn_agent({cli:"gemini", role:"gatherer", authority:"worker", placement:"right", repo, model:"flash-high" | "pro", boot_prompt_path:<brief>})`.
   - **< 0.4.88:** the spawn times out on boot readiness although the pane is ready. Deliver the brief with `send_to({mode:"surface", surface, text:"Read and follow <brief> ; your agent id is <id> (contract <path>)"})`. The Antigravity readiness/submit fixes (cmuxlayer #803, #809) are merged but ship in 0.4.88.
   - **≥ 0.4.88:** use `spawn_agent` directly (proven only after cmuxlayer's CX-4 soak).
4. `mcp_profile:"sterile"` skips the contract pointer, so the lead must relay the report path and DONE marker itself.

Gatherer brief rules: prompts only (answer keys stay with the lead); READ-ONLY; one answer/result file plus the contract's DONE report. The lead scores with mechanical keys and takes wall-clock from file mtimes, because Antigravity's self-reported times can be wrong. If `close_surface` says the agent is not found, close by `surface`.

## Hard laws

- Never `read_screen` your own surface; recursive output results.
- File artifact > `wait_for(done)` > `list_agents(detail:"full")` > `read_screen` > discovery-only `list_agents` for completion evidence. `closure` is already resolved; do not gate it on the displayed state.
- DONE-versus-artifact law lives in fleet canon #9; a stopped worker's last report write says exactly where it stopped and the next step.
- `read_screen` is text inspection, not a screenshot. When Etan asks to see something, use Computer Use evidence.
- `send_to.text` and `spawn_agent.prompt` stay below 1,800 inline characters. Use a durable repo/collab file, or `boot_prompt_path` only when the target pane is already focused — unfocused panes never resolve; see [references/delivery-and-recovery.md](references/delivery-and-recovery.md#boot--deliver-focus-first-the-reliable-bundle-for-send-the-prompt-once-booted) § Boot + deliver: FOCUS-FIRST. Never use `/tmp` for durable handoffs. Append collab/report/brief posts with a quoted heredoc, `cat >> <file> <<'EOF'` — an unquoted `<<EOF` executes the body's backticks and `$()` (`/cyber` `references/shell.md` §1b).
- Never send a bare `@word` into an interactive composer; it opens the file picker. Address agents by bare name or deliver a file.
- Any `[FROM=… TO=… TYPE=…]` envelope emitted locally must be delivered with matching `send_to` in the same turn.
- A questioning or briefly idle worker is re-prompted/backgrounded/salvaged, not killed. Kill only after evidence of an unresponsive surface and salvage its output first; then respawn with recovered context.
- Sequentially launch workers; BrainLayer writers are staggered by at least 10 seconds. Fleet canon #5 caps concurrent dispatch at 2–3.
- Before user-away windows, every active worker has `wait_for` coverage or a file completion contract.
- New research/context goes to every active worker with a one-line why-it-matters note.
- Skills do not hot-reload in long sessions; notify or respawn affected workers after critical edits.
- After any cmux restart, Mac wake, BrainBar restart, or network change, prior liveness claims are stale until `list_agents` plus `read_screen` verify each reported worker.
- Name every surface with `update_surface({action:"rename", ...})`; `update_surface` only supports `rename` and `move`.
- Do not invent removed tools: there is no atomic team-creation/stand-up call, status/progress publisher, browser-surface tool, or supported recovery-preserving stop replacement.

## Read the right reference

- Spawning, MCP parameters, response schemas, crash recovery, workspace placement, or CLI-specific commands? Read [references/tool-contracts.md](references/tool-contracts.md).
- Completion artifacts, visual proof, prompt delivery, focus/submit failures, frozen panes, restart/resume, or worker briefs? Read [references/delivery-and-recovery.md](references/delivery-and-recovery.md).
- Monitoring, envelopes, collab delivery, DONE handling, AGENT_REGISTRY, or pane cleanup? Read [references/monitoring-and-collaboration.md](references/monitoring-and-collaboration.md).
- macOS/launchd mechanics or the deferred rename-hook design? Read [references/platform-notes.md](references/platform-notes.md).
- Selecting a CLI or driving its TUI? Read the matching `adapters/*.md` and `adapters/capabilities.yaml`.
- Writing a worker prompt? Run `workflows/prompt-audit.md` §8 and include verified paths, output/audience limits, response markers, final DONE line, per-job effort, and the worker's own GitHub identity instructions.

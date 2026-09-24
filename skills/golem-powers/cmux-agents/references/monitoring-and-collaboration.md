Read this when monitoring outbound workers, delivering envelopes, coordinating through a collab, handling DONE signals, or closing finished panes.

## Monitoring Protocol

> **OUTBOUND worker monitoring lives here.** Inbound lead/orchestrator monitor, cron, and loop-payload rules → see **collab-monitor** (canonical; payload rules in its `references/cron-payloads.md`).

Fleet law for guard/DONE/harvest-close lives in canon #7. This section covers outbound worker waits.
Create monitoring that covers every live surface, and every status report must account for all active agents.

**Arm the inbound watch before you spawn the first worker** — step 0 of boot and step 0 again after
every compaction, because a monitor dies with its session. Copy-pasteable arm/attach commands and
the filter-discipline rules are in `/collab-monitor` § "Arming Is Step 0".

### AGENT_REGISTRY cadence

Maintain this registry after CLAUDE_COUNTER in every response with active agents. It preserves worker state across compaction.

```text
AGENT_REGISTRY:
| Agent ID | Surface | Repo | Task | Status | Last Check |
|----------|---------|------|------|--------|------------|
| agent:abc123 | surface:153 | golems | Digest failures | WORKING | 12:35 |
```

Add on spawn. Update on check. Remove on kill.

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

Worktree policy lives in `/pr-loop`. cmux-specific requirement: for parallel workers in the same repo, create the worktrees first and launch each worker against its assigned absolute path.

## Pane Hygiene — harvest, review, close

For finished one-shots and worker panes, treat harvest → review → close pane as one sequence. Capture the output, confirm the task result, then close/stop the pane. Only panes hosting live processes stay open (for example a dev server, log tail, or active long-running worker), and the collab/status should say why that pane is still live.

Fleet canon #7 owns harvest/close law. Cmux mechanic: the lane's monitor closes with the lane;
after harvest/review, close the pane and stop its monitor in the same turn.
At every wave close, audit the count: live monitors must never outnumber live lanes.

After a multi-agent sprint, `brain_store` what failed, what worked, and what the user corrected.

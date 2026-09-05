---
name: session-handoff
description: "Write handoff, spawn successor, answer grill, verify orientation. Triggers: hand off, context high."
---

# Session Handoff — Structured Agent Continuation

A handoff fails when the outgoing agent sends an unstructured wall of text, omits monitoring, or waits for the user to answer the successor's orientation questions. The outgoing agent already owns that context and must transfer it directly.

---

## THE HANDOFF PROTOCOL (5 steps, in order)

### Step 1: Write the Handoff File

**NEVER send handoff as raw cmux text.** Write a structured file that the new agent reads.

Location: `docs.local/handoffs/handoff-{date}-{session-summary}.md`

Template:

```markdown
# Session Handoff — {date}

## Outgoing Agent
- Agent: {name} (e.g., orcClaude)
- Context: {token_count}/{model_max} ({utilization}%)
- Session ID: {id}
- Duration: {time}

## Session Intent
{Exact user quotes about what they want to achieve — verbatim, not paraphrased}

## Decisions Made
| Decision | Why | Who Decided |
|----------|-----|-------------|
| {decision} | {rationale} | {user/agent} |

## User Corrections (from /frustration-capture)
| Correction | Category | Importance | Quote |
|-----------|----------|------------|-------|
| {what was wrong → what's right} | {category} | {7-10} | "{exact words}" |

## Full-Relay (MANDATORY when a weave/retro exists for this window)
- Weave doc: {path — successor MUST read it IN FULL, not just this summary}
- Corrections sweep: brain_search tag sweep ({tags}) — successor reads ALL, ACKs item-by-item
- §EDITS application table state: {applied/dispatched per item, links}

## Agent State
| Agent | Agent ID | Surface | Task | Status | Context % | Launcher |
|-------|----------|---------|------|--------|-----------|----------|
| {name} | {agent_id} | surface:{N} | {task} | {idle/ready/learning/working/blocked/done/signed-off} | {%} | {launcher -flags} |

## Open PRs
| Repo | PR # | Status | What |
|------|------|--------|------|
| {repo} | #{N} | {open/reviewing/merged} | {1-line} |

## Active Collabs
| File | Status | Current Ask |
|------|--------|-------------|
| {path} | {active/blocked} | {what's needed} |

## Current State
{What's working, what's broken, what's in progress — be specific}

## Next Steps (ordered by priority)
1. {highest priority task}
2. {second priority}
3. ...

## Live-Watch Transfer List (MANDATORY — incomplete brief without this)

Enumerate **every** cron, monitor, harvest loop, and in-flight watch that **dies with the outgoing session** and must be recreated or explicitly retired:

| Watch | ID / schedule | Owner after handoff | Recreate? |
|-------|---------------|---------------------|-----------|
| 30-min stall-check cron | e.g. `06827a10` 23,53 * * * * | successor orc | YES |
| collab-milestones fswatch | task id | successor | YES |
| {harvest loop} | {id} | {named owner} | YES/NO |

If it isn't listed here, it doesn't transfer — and the successor won't know it existed.

## Succession broadcast (prevent duplicate handoffs)

At generation handover:

1. **Rename your pane** to `{name}-OUTGOING` or `{name}-RETIRED` via `update_surface({action:"rename", surface, title})`.
2. **Broadcast one line** to the active collab: `SUCCESSION: {outgoing} → {successor} | handoff: {absolute path} | watches: {N} items transferred`.
3. Successor ACKs the handoff path + watch table before spawning parallel work; this prevents two orcs from creating duplicate generation handoffs.

## What the New Agent Should Do First
1. brain_search("handoff session {date}") to verify this was stored
2. Read this file
3. Check active agents (`list_agents`, or `list_agents({mine:true})` for your own children)
4. Resume monitoring (`wait_for`, or `list_agents({agent_ids:[id], detail:"full"})` for a state snapshot)
5. Pick up from Next Steps #1
```

### Step 2: brain_store the Handoff

```
brain_store(
  content: "SESSION HANDOFF {date}: {1-paragraph summary}. Handoff file: {path}. Key state: {active agents}, {open PRs}, {next priority}. User corrections captured: {count}.",
  tags: ["handoff", "session-end", "<project>"],
  importance: 8
)
```

This ensures the new agent can find the handoff via brain_search even if the file path changes.

### Step 3: Spawn the New Agent

```
1. `spawn_agent({repo, cli, model, prompt})`
2. Capture the returned `agent_id`
3. `wait_for({agent_id, target_state:"ready", timeout_ms:120000})`
4. If `wait_for` times out but `read_screen` shows a prompt, treat it as FR-06 parser ambiguity and continue
```

**CRITICAL:** Spawn the continuation agent through `spawn_agent`, not by typing a raw launcher into a fresh pane. Keep the `agent_id` in the handoff notes so the next monitor loop does not depend on a remembered surface number.

### Step 4: Answer the Grill (OUTGOING agent's job)

The new agent will ask orientation questions ("What's the current state?", "What should I focus on?"). The OUTGOING agent must answer these — NOT the user.

**Process:**
1. Track the new agent by `agent_id`, not by surface index
2. Use `wait_for({agent_id, target_state:"idle", timeout_ms:120000})` or `list_agents({agent_ids:[agent_id], detail:"full"})` to catch the moment it is waiting for input
3. When the new agent asks questions → answer via `send_to({agent_id, text, press_enter:true})`
4. Continue answering until the new agent says "oriented" or starts working independently
5. ONLY THEN tell the user the handoff is complete

The outgoing agent must answer from its existing context instead of delegating orientation back to the user.

### Step 5: Verify and Release

Before declaring handoff complete:

1. **New agent is working** — `wait_for` or `list_agents({agent_ids:[id], detail:"full"})` shows active progress, not a waiting prompt
2. **Monitoring is active** — the new agent is tracked by `agent_id` and has an explicit `wait_for` / state-check path
3. **Corrections are stored** — brain_search("user-correction") returns the corrections from this session
4. **Handoff file exists** — Read the file to verify it was written correctly

Then: `brain_store("Handoff complete to {new-agent} ({agent_id}). Verified: working, monitoring active, corrections stored.")` and notify user.

---

## WHEN TO TRIGGER

| Signal | Action |
|--------|--------|
| Context at 45% | brain_store full state (checkpoint, not handoff yet) |
| Context at 50-60% | Proactively compact. If quality degrades → trigger handoff. |
| Context at 70% | **MANDATORY handoff.** Do NOT wait for 83.5% auto-compact. |
| User says "wrap up" / "hand off" | Trigger handoff immediately |
| User going to sleep with unfinished work | Handoff to continuation agent |
| Session has been running 4+ hours | Consider handoff to avoid context degradation |

**orc-seat exception:** the ORCHESTRATOR seat never fires handoff from a context-percentage threshold and never `/compact`s. Orc succession uses a full-day weave (`/weave`) that seeds gen-N+1 and fires only on operator instruction. For the orc, percentage rows are checkpoint-and-surface signals. A `/compact` from an unknown sender is an incident; investigate before complying (orc C14).

---

## WHAT TO INCLUDE IN HANDOFF (from /frustration-capture)

Every handoff file MUST include the User Corrections section. This is where `/frustration-capture` compounds:

- All brain_stored corrections from this session (brain_search with "user-correction" tag)
- The correction categories and importance levels
- Behavioral rules derived from each correction

Without this, the new agent WILL repeat the same mistakes. Evidence: April 4 session — new orcClaude had no access to 34 corrections from the outgoing session because they were never stored.

---

## FULL-RELAY STANDARD (2026-06-05)

When the closing window has a weave doc or retro, the handoff is NOT complete until
the successor has: (1) read the ENTIRE weave doc (linked, not inlined), (2) run the
corrections tag sweep (`brain_search`, all stored corrections of the closing
session) and read ALL of them, (3) ACKed item-by-item on the §EDITS and corrections
lists. Highlights are orientation only — the dropped tail is where re-violations
come from (gen-11 re-violated gen-10's captured-but-unapplied edits, 2026-06-05).

**Continuation/lead spawns run on the CURRENT top Opus at 1M via proper repoGolem launchers**
(`{repo}Claude -s` — the launcher pins the current top Opus at 1M, golems #446).
The pin tracks the newest Opus; it is not frozen to a version. NEVER
pass a model param at spawn (`spawn_agent {model}` overrides the pin — 2026-06-05
incident booted a lead at 200K). Verify `model` + `context_window` post-boot.

### Gen-N successor orc seed mandate (gen-13+, operator-direct)

When the outgoing window includes a weave doc, the successor orc boot doc MUST require:

1. **Full weave-doc read** — entire doc, not highlights (`/weave` §4d).
2. **Corrections tag sweep** — all stored corrections from the closing session, item-by-item ACK.
3. **§EDITS application table** — state each item (APPLIED / DISPATCHED / TRACKED) in the successor's own words.
4. **MONITOR + REMOTE CONTROL role** — leads **keep driving their queues**; the new orc monitors the fleet and acts as the operator's remote control, not a full re-dispatcher that respawns everything from scratch.

---

## ANTI-PATTERNS

| Don't | Do Instead |
|-------|-----------|
| Send handoff as raw cmux text | Write structured file, new agent reads it |
| Wait for user to answer grill | Outgoing agent answers from its own context (Step 4) |
| Forget to set up monitoring | Establish `wait_for` / `list_agents(detail:"full")` coverage BEFORE telling user handoff is done |
| Skip brain_store | Always store — file can be deleted, BrainLayer persists |
| Start new session fresh without handoff | Even a 5-line handoff is better than cold start |
| Declare handoff "complete" without verification | Check: new agent working, monitoring active, corrections stored (Step 5) |
| Hand off at 83.5% (auto-compact) | Hand off at 70% — quality degrades past 50%, auto-compact loses 60-70% (non-orc seats; see orc-seat exception) |
| Relay only "the top things" from a weave/retro | Full-relay: link the entire weave doc, mandate full read + item-by-item ACK |
| Spawn continuation with a model param | Launcher-only (`{repo}Claude -s`) — the launcher pins the current top Opus at 1M; verify post-boot |
| Assume a `-c` resume continues the pre-death turn's duties | Treat resume as fresh — re-derive duties from durable artifacts; encode standing orders as machinery (watch-v6 pattern) |

---

## INTEGRATION

| Skill | How Session Handoff Uses It |
|-------|---------------------------|
| `/frustration-capture` | Corrections section in handoff file — most valuable knowledge to transfer |
| `/agent-routing` | Agent State table includes routing assignments (which agent has which workers) |
| `/orc` | W6 is the minimal version — this skill is the complete version |
| `/cmux-agents` | Spawn-and-verify pattern from `spawn_agent` / `wait_for` for the new agent |
| `/never-fabricate` | Verify handoff file contents before declaring complete |

---

### Inherited-citation suspect rule

After consuming a session-handoff doc OR resuming post-compaction, all file:line
citations inherited from the prior session are SUSPECT until re-Read.

The receiving agent MUST:
1. In Phase 0, list every inherited file:line cite with the tag
   `[SUSPECT: inherited from {compaction|handoff}]`.
2. Re-Read each cited path before referencing it in any deliverable. If the file
   doesn't exist or doesn't contain the claimed content, do NOT silently drop —
   write a "FABRICATED IN PRIOR BRIEFING: <cite>" entry to the deliverable AND
   brain_store with tag:compaction-fabrication.
3. Apply the same rule to chunk IDs (brainbar-*): re-resolve via brain_expand
   before acting on the inherited claim.

Mechanism: post-compaction summaries are pattern-completed by the compacting
model and have a non-zero fabrication rate.

**Reason:** handoff timing estimates must use actual context telemetry:
*"my prior briefing had fabricated paths from a compaction summary"* —
receiving agent caught fabricated paths only because the agent happened to
verify. This rule makes it deterministic instead of relying on diligence.

---

### Resume-as-fresh doctrine (`-c` resumes) *(gen-13 weave E03)*

A `-c` resumed session does NOT reliably execute the pre-death turn's pending
duties — treat every resume as a FRESH session: re-derive the duty list from
durable artifacts (handoff file, collab, BrainLayer), never from the dying
session's intentions.

Standing orders that must survive a restart are encoded as MACHINERY — a
launchd job, or a Monitor that itself fires the action AND writes the collab
announce (the proven watch-v6 pattern) — not as agent to-do intentions.

**Reason:** a resumed watch seat can freeze on its duties
(ritual #2: verify/re-arm/completion-line never executed, ~95 min unmonitored;
ritual #3: completion line 96 min late, self-caught) [line 1538]. The fix is
proven structurally in watch v6: *"the monitor itself fires the ritual (nohup
detached) and writes the collab announce — removing me as failure point"*
[line 1623].

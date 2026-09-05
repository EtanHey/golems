# Red Team Attack Surface — orcClaude Skill v1

> **Attacker:** skillRedTeamClaude
> **Target:** `golems/skills/golem-powers/orc/SKILL.md`
> **Golden reference:** `golems/skills/golem-powers/coach/SKILL.md`
> **Date:** 2026-03-18
> **Methodology:** 5 catastrophic scenario analyses + comparative gap analysis vs coachClaude

---

## Executive Summary

The orcClaude skill is an 87-line orchestration guide. It covers the happy path well: BrainLayer-first, architect-critic-synthesize, verify claims. But it is **dangerously underspecified for degraded states.** The skill assumes BrainLayer is up, agents respond, context is ample, and the user gives coherent instructions. When ANY of these assumptions break — and in a 4-agent sprint, they ALL eventually break — the skill provides no fallback, leaving orcClaude to improvise. Improvisation in coordination is how data gets lost.

**Verdict: 5 critical gaps, 3 structural gaps vs coach. Not ready for formalization without addressing at least the critical gaps.**

---

## Attack 1: BrainLayer Is Down

### Scenario
BrainLayer MCP process crashes mid-sprint. All `brain_search` calls return errors. orcClaude's cardinal rule ("Search BrainLayer before reading any file") is now a brick wall.

### What the skill says
Nothing. Literally nothing. The word "fallback" does not appear. The word "error" does not appear. The word "fail" does not appear.

### What happens in practice
The collab-v5-FINAL.md mentions this offhand: "If BrainLayer MCP is down → agents work without it (grep/git-log fallback)." But this is in the COLLAB FILE, not the SKILL. The skill is what gets loaded into context. The collab file is session-specific.

### The failure cascade
1. orcClaude tries `brain_search` → MCP error
2. Skill says "BrainLayer-First" with no escape hatch
3. orcClaude either (a) retries infinitely, (b) reads files directly (violating the skill's cardinal rule and burning context), or (c) freezes waiting for guidance
4. Meanwhile, agents are running and posting to collab. Nobody is reading their updates.
5. Sprint degrades silently.

### What coach does better
Coach has explicit fallback ordering: "Check in this order: 1. BrainLayer (primary), 2. Obsidian (secondary), 3. Google Calendar (MCP), 4. Gmail (MCP), 5. Supabase." And a **calendar fallback** ("write schedule to local markdown") when the calendar API fails. Coach even cites a real incident: "This fallback saved a real session when .env broke at 4 AM."

### Fix
Add a degraded-mode section:
```
## When BrainLayer Is Down
1. Echo "BRAINLAYER UNAVAILABLE" to collab + Telegram
2. Fall back to: git log --oneline -20, grep, brain_store queue (local file)
3. Resume BrainLayer when MCP reconnects
4. Never read entire files — use grep with targeted patterns
```

---

## Attack 2: All Agents Freeze Simultaneously

### Scenario
It's 2 AM. The user said "I'm going to bed, keep an eye on things." Four agents are running. macOS updates an Xcode component. All Claude processes hang simultaneously because the terminal subsystem restarts.

### What the skill says
- "Absorb agent work when it freezes → Respawn in new pane with SAME task" (anti-pattern table)
- "Heartbeat check every 5 min" (from collab, not skill)
- "Circuit breaker: 2+ agents dead/blocked simultaneously → stop spawning" (from collab, not skill)

### The critical gap: The skill's anti-pattern table only covers ONE frozen agent
The instruction "Respawn in new pane with SAME task" assumes orcClaude has capacity to respawn. If all 4 agents die:
1. orcClaude tries to respawn agent 1 — creates split, sends prompt
2. The new agent also freezes (same root cause: terminal subsystem is down)
3. orcClaude respawns agent 2 — also freezes
4. orcClaude has now burned 4 splits, 4 prompts, and significant context
5. No circuit breaker in the skill catches this

### The deeper problem: No root-cause detection
The skill says "respawn" but never says "diagnose WHY it froze before respawning." If the cause is systemic (OOM, terminal crash, network down), respawning is worse than useless — it creates orphan processes.

### What coach does better
Coach has credential failure handling with explicit timeout: "Never spend more than 30 seconds debugging credentials." This is a bounded failure response. Orc has no time bounds on any failure recovery.

### Fix
Add:
```
## Mass Agent Failure Protocol
1. First freeze → respawn normally
2. Second freeze in <5 min → STOP. Run diagnostics:
   - `ps aux | grep claude` (are processes alive?)
   - `cmux list-surfaces` (is cmux responsive?)
   - Check disk space, memory
3. If systemic → Telegram user, brain_store state, WAIT. Don't burn context.
4. If user is AFK and all agents are dead → commit any WIP, brain_store full state, exit gracefully
```

---

## Attack 3: User Gives Contradictory Instructions

### Scenario
User says: "Ship the BrainBar PR NOW, we're already behind." 5 minutes later: "Wait, actually revert that — the LaunchAgent isn't ready and it'll break the install script." Meanwhile, brainlayerClaude already merged the PR and is working on Task 3.

### What the skill says
Nothing about handling contradictions, mid-sprint scope changes, or conflicting priorities. The skill assumes a stable collab document that doesn't change.

### The failure cascade
1. orcClaude receives "ship NOW" → relays urgency to agent
2. Agent merges PR
3. User says "revert" → orcClaude now needs to:
   - Stop the agent from building on the merged PR
   - Coordinate a revert
   - Assess blast radius
4. But the skill has no "interrupt agent" protocol
5. And the anti-pattern "Make verbal commitments → Write it as task/file/brain_store" doesn't help because the commitment was already EXECUTED, not just stated

### The deeper problem: No rollback protocol
There is no mention of `git revert`, rollback scripts, or "undo last action" anywhere in the skill. The entire skill is forward-only: design → launch → verify → done. Real sprints go backward sometimes.

### What coach does better
Coach has "Make life decisions for the user → Present options with tradeoffs, let the user choose." This is a decision-gating pattern. Orc has the architect-critic-synthesize pattern for DESIGNS but no equivalent for EXECUTION decisions. Once the design is launched, every merge is fire-and-forget.

### Fix
Add:
```
## Mid-Sprint Scope Changes
1. If user contradicts a previous instruction:
   - brain_store the contradiction with both timestamps
   - STOP affected agents before acting on new instruction
   - Present: "You said X at HH:MM, now Y. Agent already did Z. Options: revert Z, continue X, or pivot to Y."
2. NEVER execute a destructive action (merge, revert, force-push) without confirmation UNLESS explicitly pre-authorized
3. For reversible actions: do them. For irreversible actions: confirm first.
```

---

## Attack 4: Context Hits 90% During a Sprint

### Scenario
orcClaude is coordinating a 4-agent sprint. It's read 3 collab updates, 2 PR diffs, verified 2 agent screens, stored 5 brain entries, and read error logs from a failing agent. Context is at 88%.

### What the skill says
```
Context Budget:
- At 70% → brain_store full state + checkpoint
- At 80% → compact
- At 85% → spawn continuation agent with full handoff
- Heavy file work → spawn haiku subagent
```

### Why this fails in practice
1. **No mechanism to CHECK context usage.** The skill says "at 70%, do X" but orcClaude has no `context_usage()` API. It can estimate from token count but the skill doesn't specify how. Does orcClaude just... guess?
2. **"Spawn continuation agent with full handoff" is underspecified.** What goes in the handoff? The skill says "brain_store full state" but what IS full state? Agent surface IDs, collab file path, repo locks, cron job IDs, stretch pool status, which agents are alive, what PRs are open, what the user's last instruction was? None of this is enumerated.
3. **The continuation agent doesn't have the skill.** Unless the handoff prompt includes the ENTIRE skill content (which would burn ~30% of the new agent's context on the skill alone), the continuation agent starts from scratch.
4. **Compaction at 80% can destroy orchestration state.** When Claude compacts, it summarizes prior messages. But orchestration state isn't in messages — it's in the PATTERN of messages (which agent sent what, in what order, referencing what surface IDs). Summarization destroys temporal ordering.

### What coach does better
Coach doesn't have explicit context management either, but coach's tasks are single-session, single-domain. A coachClaude session that hits context limits just starts a new session and brain_searches for continuity. orcClaude can't do that because it's coordinating LIVE agents that will continue producing output during the handoff gap.

### Fix
Add:
```
## Context Handoff Protocol
Handoff state (write to collab + brain_store before spawning continuation):
1. Active agents: surface IDs, repo locks, current task, last heartbeat
2. Cron jobs: IDs, intervals, what they monitor
3. Open PRs: repo, number, status, blocking issues
4. User's last instruction (verbatim)
5. Stretch pool: what's claimed, what's available
6. Collab file path

Continuation agent's first action: read collab tail, brain_search("sprint status"), verify agent liveness.
```

---

## Attack 5: Edge Cases the Anti-Patterns Table Misses

### 5a: Agent produces wrong output confidently
The anti-pattern table covers "frozen agent" and "agent self-reports." It does NOT cover an agent that runs to completion, produces plausible-looking output, and self-reports success — but the output is WRONG.

Example: brainlayerClaude says "all 130 tests pass, PR merged." But it ran tests from the wrong branch. The PR was merged with a failing test suite.

The verify-claims pattern ("Read the actual output, never trust self-reports") catches fabrication but not honest mistakes. The skill should specify: **verify the CORRECT thing was tested/merged**, not just that something was tested/merged.

### 5b: Two agents claim the same repo lock
The skill says "Use `/cmux-agents` skill" for spawning and mentions repo locks in the collab. But the skill itself has NO locking protocol. What if:
- Agent A posts "releasing brainlayer lock"
- Agent B reads the collab, sees lock released, claims it
- Agent A's `echo >>` was delayed by 2 seconds
- Agent B starts working while Agent A hasn't actually stopped

The skill treats collab file as a synchronization primitive but `echo >>` to a file is NOT atomic when multiple processes write.

### 5c: Stretch pool race condition
The skill says "Agents grab from it if they finish early." But what if two agents finish simultaneously and both grab the same stretch task? No claim protocol exists.

### 5d: Agent outlives orcClaude
If orcClaude's context hits the limit and it needs to spawn a continuation, but an agent finishes work during the handoff gap, the agent's collab message goes unread. The continuation agent may not know to check for it.

### 5e: CronCreate + monitoring gap
The skill anti-pattern says "CronCreate BEFORE telling user 'go'." But cron jobs have minimum intervals. If the cron fires every 5 minutes and an agent dies at minute 0:30, the failure isn't detected for 4.5 minutes. During this time, the user thinks orcClaude is monitoring.

### Fix: Missing anti-patterns to add

| Don't | Do Instead |
|-------|-----------|
| Verify an agent "passed tests" | Verify it passed tests ON THE RIGHT BRANCH (`gh pr checks`) |
| Rely on collab file for locking | Use collab + verify: read collab after writing to confirm your write landed |
| Let two agents grab same stretch task | orcClaude assigns stretch tasks explicitly, agents don't self-serve |
| Assume agent collab writes are instant | After agent posts completion, wait 3s, re-read collab, THEN proceed |
| Trust CronCreate as real-time monitoring | CronCreate is periodic, not real-time. For critical phases, use active polling |

---

## Structural Gaps: What Coach Has That Orc Doesn't

### Gap 1: Explicit Failure Modes with Real Incidents
Coach cites real failures: "coachClaude once wasted 7 minutes grepping for credentials," "This fallback saved a real session when .env broke at 4 AM." These are memorable, specific, and motivate the rules.

Orc's anti-patterns are abstract: "Don't trust send_input ok:true." Why? What happened? The collab file has the war stories (AV1-AV11 from "15 attack vectors") but the skill doesn't. The skill should embed at least the top 3 real incidents.

### Gap 2: Role Clarity / Scope Boundaries
Coach has an explicit "What Coach DOES" and "What Coach Does NOT Do" section with a redirect pattern. Orc has nothing equivalent. When should orcClaude stop orchestrating and start coding? When should it refuse to do something? What's out of scope?

Example: if the user says "just fix it yourself instead of spawning an agent," should orcClaude comply (violating the "never absorb" rule) or push back? The skill doesn't say.

### Gap 3: Learning from Corrections
Coach has a dedicated "Learning from Corrections" section: store corrections with `importance: 8`, search for past corrections before re-drafting. Orc has "AFTER learning anything → brain_store" but no specific protocol for when orcClaude's OWN orchestration is corrected.

If the user says "stop spawning so many agents, just use 2," that's a preference correction that should persist across sessions. The skill doesn't distinguish between one-time instructions and durable preferences.

### Gap 4: Domain Routing
Coach routes to specific workflows based on trigger words. Orc has no equivalent. What triggers "architect-critic-synthesize" vs "just launch it"? What triggers "spawn haiku subagent" vs "read it yourself"? The thresholds are implicit.

### Gap 5: Credential/Auth Failure Handling
Coach has a dedicated credential section with 1Password integration and a 30-second timeout. Orc assumes all tools work. If `cmux send` fails because the socket died, there's no fallback.

---

## Severity Matrix

| # | Attack | Severity | Likelihood | Impact |
|---|--------|----------|------------|--------|
| 1 | BrainLayer down | CRITICAL | Medium (crashes happen) | Full orchestration halt |
| 2 | Mass agent freeze | CRITICAL | Low-Medium (OS updates, OOM) | Sprint dead, no recovery path |
| 3 | Contradictory user instructions | HIGH | High (humans change minds) | Irreversible actions executed |
| 4 | Context overflow during sprint | HIGH | Medium (every long sprint) | State loss during handoff |
| 5a | Agent wrong output, confident report | HIGH | Medium | Merged broken code |
| 5b | Repo lock race condition | MEDIUM | Low | Git conflicts, wasted work |
| 5c | Stretch pool race | LOW | Low | Duplicate work |
| 5d | Agent outlives orcClaude | MEDIUM | Medium | Unread completion messages |
| 5e | Cron monitoring gap | MEDIUM | High (by design) | 5-minute detection blind spot |

---

## Recommendation

**Do not formalize this skill until:**
1. A degraded-mode section is added (Attacks 1, 2)
2. A rollback/contradiction protocol exists (Attack 3)
3. The context handoff is fully specified (Attack 4)
4. The anti-patterns table is expanded with the 5 missing entries (Attack 5)
5. At least 3 real incident citations are added (Gap 1 from coach comparison)

The skill is a good v1 for a happy-path orchestrator. It is not a v1 for a production orchestrator that runs while the user sleeps.

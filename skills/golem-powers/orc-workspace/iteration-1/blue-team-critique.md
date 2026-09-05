# Blue Team Critique: orcClaude SKILL.md

**Reviewer:** skillCriticClaude
**Date:** 2026-03-18
**Verdict:** 5/10 — skeleton of a good skill, but would NOT reliably produce better orchestration decisions than a Claude without it. Too abstract to enforce behavior change. Too thin to cover the failure modes the mining synthesis documented.

---

## 1. What's Missing

### 1.1 No daemon/MCP verification gate

Mining synthesis finding #1 (P0 — blocked ALL agents for an entire session): when you fix a daemon or socket, you must test with a real Claude session in a new pane. The skill says nothing about this. A Claude using this skill would still claim "fixed" after unit tests pass, without ever launching a fresh MCP client.

**Needed:** A "Daemon Fix Verification" section: *"For any daemon/socket/MCP change: open a NEW cmux pane, launch a fresh Claude session, run the tool. If the tool isn't available in the fresh session, you're not done."*

### 1.2 No collab file protocol

The skill mentions "collab GOAL section" in pattern 3, but doesn't explain:
- How to create a collab file (use TEMPLATE.md, never from scratch)
- The append-only rule (echo >>, never Edit/Write)
- The collab-guard.py hook that WILL block violations
- When to update (every gate: before starting, before every commit, after PR merge, if blocked)
- The merge policy table (autonomous / review-required / ask-on-each)

This is one of the most failure-prone areas in orchestration. The v5 sprint plan spent 12 lines defining collab write rules because they'd been violated before. The skill says zero.

### 1.3 No agent recovery protocol

Mining finding #8: orcClaude absorbed frozen agent work instead of respawning. The anti-patterns table says "Respawn in new pane with SAME task" but doesn't explain HOW:
- How to detect frozen (token count delta = 0 across 2 checks)
- How to salvage partial work (git stash the worktree, brain_store what was accomplished)
- How to construct the respawn prompt (include what's already done so the new agent doesn't redo work)
- When it's OK to absorb (never, unless user explicitly requests it)

### 1.4 No monitoring setup protocol

Mining finding #6: orcClaude said "I'll monitor" without setting up CronCreate — TWICE. The skill mentions CronCreate in the anti-patterns table but doesn't give the actual workflow:
- What frequency (3-5 min for active agents, 7 min for AFK)
- What to check (read_screen each surface, token count delta, look for DONE signal)
- When to CronDelete (agent done, user returns, purpose fulfilled)
- The inclusion of loop ID in user-facing response

### 1.5 No cross-agent information flow

Mining finding #10: gems/research hoarded instead of broadcast. The skill says nothing about forwarding context to active agents. When orcClaude receives new information (research results, user decisions, environmental changes), it must push to ALL active agents immediately.

### 1.6 No environmental event handling

The mining synthesis documents Mac restarts killing BrainBar, agents losing MCP access silently. The skill has no protocol for:
- Post-sleep/restart: verify all daemon sockets, check agent MCP status
- BrainLayer outage: agents must report it immediately, fallback to git log + grep
- Network outage: inform all agents so they don't make network-dependent decisions

### 1.7 The session start section is too generic

```
brain_recall(mode="context")     # What's happening now?
brain_search("recent decisions") # What was decided?
TaskList()                       # Any open tasks?
```

This is correct but insufficient. It should also:
- Check for deferred blockers: `brain_search("todo", tag="blocker")`
- Verify daemon health: check sockets exist at expected paths
- Check for stale crons from previous sessions
- Read the last 20 lines of any active collab files
- Check `git status` across repo locks

### 1.8 No naming/identification metadata

The "Spawning Agents" section says "use `/cmux-agents` skill" and lists some rules, but the KEY naming rule isn't explained: agents MUST have `-n agentName` in the claude launch command (CC 2.1.76+). Without this, `ps aux` can't distinguish agents. The skill mentions it but doesn't explain WHY (process identification for kill/debug).

---

## 2. What's Unclear

### 2.1 The description says "orchestrator-status" but the skill is "orcClaude"

The frontmatter `name: orchestrator-status` and the description focus on status collection ("what's the status", "catch me up"). But the body is a full orchestration skill — agent spawning, design patterns, anti-patterns, context budget. These are fundamentally different triggers:
- "What's the status?" → status collection (quick, read-only)
- "Let's plan tonight's sprint" → full orchestration (long, write-heavy)

**Decision needed:** Is this a status-collection skill that ALSO covers orchestration? Or an orchestration skill that triggers on status queries? The current answer is "both," which means it fires on every "what's the status" query and dumps 87 lines of orchestration protocol on a user who just wants a quick update.

### 2.2 The Architect-Critic-Synthesize pattern lacks operational detail

"Draft design (architect agent)" — how? A cmux agent? A haiku subagent? An Agent tool call? The skill doesn't say. "Critique (critic agent cross-reviews)" — cross-reviews what? Where is the design document? How does the critic access it?

The collab template exists. The spawn-agent function exists. The skill doesn't connect them.

### 2.3 "Verify Against Living Spec" — what IS the living spec?

Pattern 3 says "Read the collab GOAL section." But is the collab file the living spec? The sprint plan? The roadmap? A GitHub issue? The skill assumes the reader knows what a "living spec" is in this ecosystem. They don't. The collab GOAL section is the spec, and it's the ONLY thing agents are measured against — say that explicitly.

### 2.4 Score gate thresholds are inconsistent

The skill says: "Score gate: ≥9 → LAUNCH. 7-8 → one more round. <7 → max 3 rounds." But the circuit breaker says "iteration 4+." If a score is <7 and you iterate 3 rounds and it's still <7... what then? Launch anyway? Escalate to user? The skill doesn't say. The mining synthesis says LAUNCH — the planning paralysis anti-pattern is the worst-case outcome.

### 2.5 Context budget percentages are unanchored

"At 70% → brain_store full state + checkpoint" — 70% of what? The context window? How does orcClaude know it's at 70%? There's no tool that reports context usage percentage. In practice, Claude gets a system-reminder about compaction approaching. The skill should reference the actual signal, not an invented percentage.

---

## 3. What Would Make This GOLDEN

### 3.1 Decision trees, not just rules

The difference between a good and great orchestration skill is WHEN to apply each rule. Currently the skill lists rules flatly. A golden skill would have decision trees:

```
Agent reports "done"
  → Did you Read() the actual output? (NO → read it now, /never-fabricate)
  → Does the PR exist? (gh pr view)
  → Does it advance the collab GOAL? (re-read GOAL section)
  → Are tests passing? (gh pr checks)
  → THEN mark complete.

Agent appears frozen
  → read_screen 50+ lines — what's actually on screen?
  → "Press up to edit queued messages" → send Enter key
  → Token count same across 2 checks, 5 min apart → kill → new_split → respawn with SAME task
  → Agent is in long tool call (>5 min) → wait, this is normal for builds/tests
```

### 3.2 The SURVIVAL BLOCK pattern should be IN the skill

The skill says agents need a SURVIVAL BLOCK but doesn't define it. The sprint collab has excellent examples. The skill should include the template:

```markdown
## SURVIVAL BLOCK (re-read after ANY compaction)
I am {agentName}. Repo: {repo}. Mission: {one-sentence}.
Collab: {path/to/collab.md}
Merge policy: {autonomous|review-required|ask-on-each}.
First action: Run brain_search('test'). If fails, echo 'BRAINLAYER UNAVAILABLE' >> collab.
```

This is the single most important pattern for agent reliability — it survives context compaction. Not including it is a critical omission.

### 3.3 A "one-page playbook" for the 3 most common orcClaude sessions

The skill should have concrete playbooks for:

1. **Sprint execution** (spawn agents, monitor, merge, report): The full loop from collab template to Obsidian summary.
2. **Status check / catch-up** (brain_search → read collab → report): The quick path for "where were we?"
3. **Incident response** (daemon down, agent frozen, MCP broken): The triage sequence.

Currently the skill is a reference document. A golden skill is a runbook.

### 3.4 Negative examples ("what bad looks like")

The anti-patterns table is good but abstract. Each anti-pattern should have a CONCRETE bad example from the mining synthesis with the actual quote:

| Anti-pattern | What happened | What should have happened |
|---|---|---|
| Trust send_input ok:true | orcClaude moved on after ok:true on surface:42. 7 min later: agent never received task. | sleep 8 → read_screen → verify token count jumped |
| Absorb frozen agent | surface:42 froze. orcClaude: "I'll write v3 myself." Context bloated, lost orchestration role. | kill → new_split → resend SAME task |
| Read 15 lines | orcClaude: "Both cooking!" based on status bar. Agent was actually stuck at "Press up to edit." | read_screen lines:50 scrollback:true → see actual state |

The before/after format from real incidents is 10x more memorable than abstract rules.

### 3.5 Integration with other skills should be explicit triggers, not references

The skill says "Use `/cmux-agents` skill" but doesn't say WHEN. It should be:

```
Spawning agents → invoke /cmux-agents
Creating a PR → invoke /pr-loop
Claiming done → invoke /superpowers:verification-before-completion
Reporting on output → invoke /never-fabricate
Planning work → invoke /superpowers:writing-plans (then architect-critic if multi-agent)
```

This is the skill composition map. Without it, orcClaude has to remember which skill to invoke for which trigger — exactly the thing skills are supposed to automate.

---

## 4. Are the Anti-Patterns Specific Enough to Be Actionable?

**Partially.** Grading each:

| Anti-pattern | Specificity | Actionable? | Fix |
|---|---|---|---|
| "Absorb agent work when it freezes" | Good — clear what not to do | Yes | Already says "Respawn in new pane with SAME task" |
| "Trust send_input ok:true" | Good — the specific failure mode | Mostly — but "Verify delivery" needs the exact steps | Add: sleep 8 → read_screen lines:5 → check token count |
| "Read bottom 15 lines of screen" | Good — specific number | Yes — says "read_screen 50+ lines" | OK as-is |
| "Hoard gems/research" | Vague — what counts as "hoarding"? | Partially | Add: "Forward to ALL active agents immediately via send_input" |
| "Say 'I'll monitor' without CronCreate" | Good — names the exact tool | Yes | But needs the full workflow (frequency, what to check) |
| "Claim 'fixed' without real client test" | Good | Partially — "new pane, launch Claude, verify tool works" is concrete but needs the actual command sequence |
| "Design past score ≥9" | Good — numeric gate | Yes | |
| "Suggest ending a session" | Unclear — why is this bad? | No — needs context | Add: "orcClaude's context is cheap to continue; spawning a fresh agent preserves state. Delegate continuation." |
| "Report on files without Read()" | Good — names the violation | Yes — links to /never-fabricate | |
| "Make verbal commitments" | Vague — what's "verbal"? | Partially | Add: "If you said it in chat but didn't Write() or brain_store() it, it doesn't persist across compaction" |

**Overall: 6 of 10 are specific enough. The other 4 need concrete examples or the exact command sequence.**

---

## 5. Should cmux and cmux-agents Be Merged Into This?

**No. Absolutely not.** Here's why:

### Different audiences

- **cmux** teaches ANY Claude to drive terminal panes. A brainlayerClaude working on its own needs cmux to split panes for builds.
- **cmux-agents** teaches ANY Claude to spawn and monitor other Claudes. A lead dev Claude might use this without being an "orchestrator."
- **orc** teaches orcClaude specifically how to be an ORCHESTRATOR — BrainLayer-first decisions, design iteration gates, context budget, living spec verification.

Merging them would create a 400+ line skill that fires on every terminal command and every agent mention. Token waste. Context pollution.

### The right relationship is composition, not merger

```
orcClaude skill
  ├── invokes /cmux for pane operations
  ├── invokes /cmux-agents for agent lifecycle
  ├── invokes /pr-loop for PR workflow
  ├── invokes /never-fabricate for verification
  └── adds orchestrator-specific logic ON TOP:
       - Design iteration gates
       - Collab file protocol
       - Cross-agent information flow
       - Context budget management
       - Living spec verification
```

The orc skill should be the CONDUCTOR that calls other skills at the right time. It should NOT contain the sheet music for every instrument.

### What SHOULD happen

The orc skill should have a clear **skill composition map** (see 3.5 above) that tells orcClaude which skills to invoke and when. If orcClaude sees a frozen terminal, it invokes /cmux (which has the recovery protocol). If it needs to spawn agents, it invokes /cmux-agents (which has spawn-agent). The orc skill's job is the DECISION of what to do, not the HOW of doing it.

### One exception

The verify-delivery and read_screen depth rules are duplicated across cmux and cmux-agents. The orc skill adds them a THIRD time in its anti-patterns. This duplication is fine — critical rules should be reinforced — but the orc skill should explicitly say "these are also in /cmux and /cmux-agents; they're repeated here because orcClaude violates them most."

---

## 6. Summary of Required Changes (Priority Order)

### P0 — Without these, the skill is worse than useless (gives false confidence)

1. **Fix the identity crisis**: Rename to `orc` and split the description. Status collection is one trigger; full orchestration is another. Or create two skills.
2. **Add SURVIVAL BLOCK template**: This is the #1 pattern for agent reliability.
3. **Add daemon verification gate**: Mining finding #1. Without it, orcClaude will keep claiming daemon fixes are "done" without real testing.
4. **Add collab file protocol**: Create from template, append-only, update at every gate, merge policy table.

### P1 — Without these, the skill prevents 60% of past failures instead of 90%

5. **Add agent recovery decision tree**: Frozen detection → kill → respawn (not absorb). Include partial work salvage.
6. **Add monitoring setup protocol**: CronCreate before AFK, specific frequencies, what to check, CronDelete when done.
7. **Add cross-agent information flow rule**: Gems/research → send_input to ALL active surfaces.
8. **Add skill composition map**: Which skill to invoke for which trigger.

### P2 — These make the difference between "good" and "golden"

9. **Concrete decision trees** for the 5 most common orchestration scenarios.
10. **Negative examples from mining** — real quotes, real costs, real fixes.
11. **Environmental event handling** — post-sleep, BrainLayer outage, network down.
12. **Playbooks** for sprint execution, status check, incident response.

---

## Final Assessment

The current skill captures the RIGHT principles (BrainLayer-first, launch over iterate, verify against spec) but is too thin to change behavior. A Claude reading this skill gets the vibes right but doesn't know what to DO when an agent freezes, when a daemon breaks, when the user leaves, or when information arrives mid-sprint.

The mining synthesis documented 10 specific failure modes with specific fixes. The skill addresses maybe 4 of them, and those 4 only at the "don't do X" level, not the "here's exactly what to do instead" level.

**The gap:** The skill tells you the PHILOSOPHY of orchestration. It doesn't teach you the PRACTICE.

A golden orc skill would make a Claude who's never orchestrated before produce the same behavior as one who's been through 10 sessions of Etan correcting their mistakes. That requires specificity, decision trees, command sequences, and negative examples — not just principles.

---

*Critique by skillCriticClaude | March 18, 2026 | Input: SKILL.md (87 lines), mining-synthesis.md (213 lines), cmux SKILL.md (184 lines), cmux-agents SKILL.md (157 lines), evals.json (5 evals), collab TEMPLATE.md*

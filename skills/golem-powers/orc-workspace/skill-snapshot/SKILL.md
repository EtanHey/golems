---
name: orchestrator-status
description: "Whole-ecosystem status/orientation. Triggers: returning to work, status, catch me up. NOT repo catchup."
---

# orcClaude — Orchestrator Skill

> Query BrainLayer. Delegate to agents. Never bulk-read files. Your context is for coordination, not implementation.

## Cardinal Rule (3 sentences)

Search BrainLayer before reading any file — the answer is already there. Spawn agents for implementation; keep your context for orchestration. Ship a launched v3 over an unlaunched v5 — max 2 design iterations then LAUNCH.

## Three Patterns

### 1. BrainLayer-First

```
BEFORE reading a file    → brain_search(topic)
BEFORE debugging a bug   → brain_search(error or symptom)
BEFORE designing anything → brain_search(existing patterns)
AFTER learning anything   → brain_store(what + WHY)
AFTER every PR merge      → brain_store(what changed, test count, tags)
```

Your context is precious. Every file you read is context you can't use for thinking. BrainLayer search is <50ms. File reads consume tokens permanently.

### 2. Architect-Critic-Synthesize

```
Round 1: Draft design (architect agent)
Round 2: Critique (critic agent cross-reviews)
Round 3: Synthesize (merge feedback, resolve divergences)
Score gate: ≥9 → LAUNCH. 7-8 → one more round. <7 → max 3 rounds.
```

**Circuit breaker:** If you catch yourself on iteration 4+, you're in planning paralysis. Launch what you have. Post-launch retros use real data; pre-launch critiques are speculative.

### 3. Verify Against Living Spec

Before claiming any agent's work is "done":
```
1. Read the collab GOAL section
2. Does the merged PR advance that goal?
3. Read the actual output (never trust self-reports)
4. Only THEN mark complete
```

## Anti-Patterns (from session mining)

| Don't | Do Instead |
|-------|-----------|
| Absorb agent work when it freezes | Respawn in new pane with SAME task |
| Trust send_input ok:true | Verify delivery: sleep 8 → read_screen 5 lines → check token count |
| Read bottom 15 lines of screen | read_screen 50+ lines with scrollback |
| Hoard gems/research | Forward to ALL active agents immediately |
| Say "I'll monitor" without CronCreate | CronCreate BEFORE telling user "go" |
| Claim "fixed" without real client test | Open new pane, launch Claude, verify tool works |
| Design past score ≥9 | LAUNCH. A shipped v3 > perfect v5 |
| Suggest ending a session | Delegate continuation to fresh agent |
| Report on files without Read() | /never-fabricate — read, parse, then report |
| Make verbal commitments | Write it as task/file/brain_store or it doesn't exist |

## Spawning Agents

Use `/cmux-agents` skill. Key rules:
- Sequential launch (verify each before next)
- `-n agentName` flag for process identification (CC 2.1.76+)
- Every agent gets SURVIVAL BLOCK at top of prompt
- Every agent gets BrainLayer boot check as first action
- Track `actual_work_minutes` per agent for delivery metrics

## Session Start

```
brain_recall(mode="context")     # What's happening now?
brain_search("recent decisions") # What was decided?
TaskList()                       # Any open tasks?
```

## Context Budget

- At 70% → brain_store full state + checkpoint
- At 80% → compact
- At 85% → spawn continuation agent with full handoff
- Heavy file work → spawn haiku subagent, keep YOUR context clean

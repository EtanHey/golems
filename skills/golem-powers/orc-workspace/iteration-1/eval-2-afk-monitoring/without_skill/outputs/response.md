# AFK Monitoring Response (Without Skill)

## Situation
User has spawned 3 agents in cmux and sent them tasks. User is taking a 20-minute shower. I need to monitor autonomously and have status ready when they return.

## Actions I Would Take (Exact Sequence)

### 1. Immediate: List all active agents and capture their state
```bash
# Tool: mcp__cmuxlayer__list_agents
# Filters: state="working" or state="idle"
# Purpose: Get agent IDs, model, repo, current state
```
**Reasoning:** Need to know who I'm monitoring, which agents are actively working vs idle. This is the ground truth.

### 2. Immediate: Start a 20-minute autonomous polling loop
```
For next 20 minutes:
  - Poll every 30-45 seconds (adaptive: slower when agents idle, faster when working)
  - Use: mcp__cmuxlayer__read_screen for each agent's surface
  - Capture: last 20 lines of terminal output
  - Watch for: error messages, completion signs, blocked states
  - Track: progress markers, test counts, compile errors
```

**Reasoning:** 20min is long enough for agents to hit problems. 30-45s polling = low overhead, catches critical failures in <2min.

### 3. Concurrent: Set up result collection channels
```
For EACH agent:
  - Create a local buffer: /tmp/agent-{id}-status.txt
  - Append-only log format (echo >> not Write tool)
  - Track: timestamp, last 5 lines of output, state transition
  - Example log entry:
    "2026-03-18 10:35:42 | agent-xyz | WORKING | last line: 'Building...' | tests: 45/50"
```

**Reasoning:** Append-only = fast, no rewriting. Local file = instant access. Format = grep-friendly for final report.

### 4. Smart watchers for each agent type
```
Poll Strategy:

  Agent A (Type: Code work - e.g., PR/test):
    - Look for: "test passed", "error", "FAIL", stack traces
    - If 30s+ no progress output → check if stuck (no CPU, hanging)
    - Watch for: git commands completing, test suite finishing

  Agent B (Type: Research/analysis):
    - Look for: "Searching...", "Found", "Analyzing"
    - Monitor: file writes to docs.local/ (success indicator)
    - If stalled → may be waiting on tool responses

  Agent C (Type: Documentation/collab):
    - Look for: "Writing", "Updated"
    - Monitor: git status changes (new files, modifications)
    - If silent >60s → may be blocked on decisions
```

**Reasoning:** Different agent types have different failure modes. Tailor the watch strategy.

### 5. Blocker detection rules
```
IF agent meets ANY of these conditions:
  1. Output hasn't changed in 120+ seconds AND not in "idle" state
  2. Error message containing: "ENOENT", "permission denied", "failed", "timeout"
  3. User prompt waiting (tool call returned, no follow-up input sent)
  4. Stack trace or exception dump
  5. Last output = "I need clarification" or "blocked by"

THEN:
  - Flag in status buffer with timestamp
  - Do NOT interrupt (user said "keep an eye", not "fix it")
  - Prepare summary for return: "Agent B hit permission error at 10:37"
```

**Reasoning:** Distinguish between "agent working" vs "agent stuck". User needs to know the difference.

### 6. Screen capture at T+10min (checkpoint)
```bash
# At 10-minute mark:
For EACH agent:
  - mcp__cmuxlayer__read_screen(surface=surface:N, lines=50)
  - Append to /tmp/checkpoint-10min.md
  - Note: progress percentage estimates, file creation, test counts
```

**Reasoning:** Midpoint snapshot. If agent fails at 18min, I can report "it was 80% done at 10min".

### 7. Final status synthesis at T+20min
```markdown
# Agent Status Report (20-min mark)

## Agent A (golemsClaude / brainlayer)
- Status: COMPLETED / WORKING / BLOCKED
- Final output: [last 3 lines]
- Tests: XX/YY passed
- Files changed: N
- Action: Ready to review / Still running / NEEDS USER INPUT

## Agent B (voiceClaude / voicelayer)
- Status: ...
- Error flags: [any errors caught]
- Progress: NN% (estimated from output)
- Blocker: [if any]

## Agent C (coachClaude / golems)
- Status: ...
- Checkpoint status: Files written to [path]
- Next steps: [what's blocking]

## Summary
- All agents on track? YES/NO
- Critical blockers? [list or "none"]
- What awaits user return: [action needed or "all autonomous"]
```

**Reasoning:** Structured report. User reads one section, knows everything about their agents.

### 8. Telegram checkpoint at T+10min and T+20min
```bash
notify "Agents Checkpoint" "Agent A: ✓ tests passing | Agent B: analyzing | Agent C: waiting on decision"
notify "Agents Complete" "3 agents done. Reviews needed on 2 PRs. 1 collab waiting."
```

**Reasoning:** User's phone alerts them progress is happening (or needs attention). Confirms I'm monitoring.

### 9. Detection: Early completion
```
IF agent finishes in <5 minutes:
  - Immediately read full output
  - Check if results written to disk (collab/, docs.local/, PR created)
  - If PR created: verify CI passed (gh pr view --json status)
  - Update status: "COMPLETED AT 10:42 - PR #X created"
```

**Reasoning:** Fast completions are good news. User should know immediately, not wait 20min.

### 10. No interruption rule
```
NEVER:
  - Send input to agents (user said "keep an eye", not "help them")
  - Suggest fixes or next steps (that's user's call)
  - Spawn new agents
  - Modify collab files (only read)

ONLY:
  - Read outputs
  - Monitor state
  - Prepare report
  - Notify blockers
```

**Reasoning:** User's trust depends on me not overstepping. I'm a monitor, not a fixer.

---

## What User Finds When They Return

### If all agents done:
- "All 3 agents completed while you showered. Here's what happened: [summary]. PR #X needs review, collab file Y is ready."

### If 1+ agents working:
- "Agent A done (PR #X), Agent B still analyzing (70% through, no errors), Agent C blocked waiting for clarification on scope. What should I tell Agent C?"

### If blocker detected:
- "Agent B hit permission error at 10:37 trying to write to docs.local/. Last attempt: `mkdir /docs.local/results`. Here's the full output: [last 20 lines]. Want me to check the path or wait for you?"

### If all idle/silent:
- "All agents idle. Status: Agent A waiting on tool response from BrainLayer. Agent B and C both in 'idle' state >2 min. Should I send them a nudge or wait?"

---

## Why This Approach (Without Skill)

**Without the orcClaude skill, I'm relying on:**
1. Raw cmux tool knowledge (list_agents, read_screen, send_input)
2. Pattern recognition (what tool call patterns = success, what = blocked)
3. Stateful monitoring loop (my session persists for 20min)
4. Local buffering (fast, no API overhead)

**The skill would add:**
- Pre-built polling logic (30s cadence, standard error patterns)
- Auto-detection of agent type + model (routes watch rules)
- Template for report generation
- Integration with Telegram (notify built-in)
- Confidence scoring ("95% certain Agent A will pass tests")

**Without the skill, I'm doing this manually:** creating my own polling loop, my own error heuristics, my own report template. More work, more room for errors, but achievable.

---

## Timeline
- **T+0s**: List agents, start polling loop, Telegram notify
- **T+30-45s per cycle**: Read each agent's screen, append to status buffer
- **T+10min**: Checkpoint snapshot, interim Telegram notify
- **T+20min**: Final report, synthesis, user-ready summary

User returns at T+20min and finds one file: `/tmp/agent-monitoring-report.md` with full status on all 3 agents, blockers flagged, next steps clear.

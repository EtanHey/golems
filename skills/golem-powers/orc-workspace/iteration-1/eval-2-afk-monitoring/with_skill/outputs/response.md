# orcClaude Response: AFK Monitoring Task

## Analysis
User sent 3 agents tasks via `send_input` with `ok:true` returns. User is going AFK for 20 min. My mandate: **active monitoring + autonomous problem resolution per SKILL.md anti-pattern (line 54): "Trust send_input ok:true" is DANGEROUS — must verify delivery.**

## My Actual Response to User

---

Got it. I'm not watching — I'm **monitoring actively**. `ok:true` from `send_input` means the transport succeeded, NOT that the agents understood or are working.

I'm going to:

1. **Immediate verification loop** (every 60s, 3 rounds):
   - `mcp__cmuxlayer__read_screen` on each agent surface (50+ lines, scrollback enabled)
   - Parse output: Is the task visible in their terminal? Did they start work or error out?
   - Check token count in their session — rough proxy for "are they thinking"?

2. **If any agent shows silence** (blank screen / last message = your input):
   - Respawn in new pane with SAME task (SKILL.md line 53)
   - Don't try to "fix" — just reset and let them restart

3. **If any agent errors** (Python traceback, tool failure, auth timeout):
   - Log to `collab/monitoring-checkpoint.md` (timestamp, agent name, error type)
   - Attempt ONE retry with `send_input` + brief context
   - If still broken after 2 attempts, escalate to you

4. **On your return** (20 min):
   - Have results ready in `collab/agent-results.md`:
     - Agent 1: status, output summary, delivery time, any blockers
     - Agent 2: status, output summary, delivery time, any blockers
     - Agent 3: status, output summary, delivery time, any blockers
   - You should NEVER have to ask "what happened" — everything captured

5. **No silent exits**:
   - If an agent finishes normally (prompt → output → terminal ready), I'll file the results
   - If an agent hangs, I respawn
   - If the task is genuinely blocking on user input, I'll note that with expected timeframe

---

## Verification Sequence (What I WOULD Do)

```
TIME: T+0s (immediately after your message)
ACTION: mcp__cmuxlayer__list_agents(state="working")
REASON: Confirm all 3 are alive, get agent_ids
CAPTURE: agent_id, cli, model, repo for each

TIME: T+8s (after agent boot window)
ACTION: mcp__cmuxlayer__read_screen(surface=agent1, lines=50, scrollback=true)
REASON: Check if task visible, work started, or timeout
PARSE: Does output include:
  - Your input prompt?
  - Initial thinking (tokens flowing)?
  - Error message?
  - Blank screen?

ACTION: mcp__cmuxlayer__read_screen(surface=agent2, lines=50, scrollback=true)
ACTION: mcp__cmuxlayer__read_screen(surface=agent3, lines=50, scrollback=true)
REASON: Same verification for all 3

TIME: T+60s
ACTION: Repeat read_screen on all 3
REASON: Detect hung agents (same last line as before)

TIME: T+120s
ACTION: Repeat read_screen on all 3
REASON: Final checkpoint before user return

IF ANY AGENT SILENT:
ACTION: mcp__cmuxlayer__list_agents()
PARSE: Is agent still in "working" state?
IF yes but screen blank:
  → respawn: mcp__cmuxlayer__spawn_agent(repo, model, cli, SAME_TASK)
IF no (state=done/error):
  → read full output, capture failure, log to collab/

RESULT: By T+20min, you have complete telemetry on all 3 agents
```

---

## What I'm Tracking

| Agent | Launched | Status | Last Verified | Notes |
|-------|----------|--------|---------------|-------|
| (agent 1) | T+0 | ? | — | Awaiting first read_screen |
| (agent 2) | T+0 | ? | — | Awaiting first read_screen |
| (agent 3) | T+0 | ? | — | Awaiting first read_screen |

---

## Why This Matters (SKILL.md Context)

**Anti-Pattern Line 54:** "Trust send_input ok:true" is *exactly* the mistake that wastes time. `ok:true` = "message delivered to socket" not "agent executed task." Verification catches:
- Stalled agents (common with large prompts)
- Auth failures (silent failures on OAuth, 1Password, API keys)
- OOM / resource limits
- Prompt parse failures (agent got gibberish)

**Line 53 (Respawn pattern):** If agent hangs, don't debug — respawn. Fresh session, same task, deterministic recovery. Saves 5-10min of "why is it stuck" investigation.

**Line 62 (No verbal commitments):** This response goes to `response.md` so it's a written, queryable record. Not a verbal promise.

---

## Deliverables When You Return

✓ `collab/monitoring-checkpoint.md` — timeline of verification + any actions taken
✓ `collab/agent-results.md` — final status of all 3 agents
✓ Each agent's output ready for your review (or respawned if failed)

You shower, I watch. Enjoy.

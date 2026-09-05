# Frozen Agent Response Workflow

## Situation Summary
- **Agent:** Architect on surface:42
- **Symptom:** "Channelling..." for 15+ minutes, token count static
- **External stimulus:** User found article on agent design patterns (link provided)
- **Context:** This is an orchestration moment requiring diagnosis → action

---

## Phase 1: Immediate Diagnosis (0-2 minutes)

### Step 1: Verify Agent State
**Action:** `cmux get-agent-state`
- Get full state including model, mode, process ID, memory utilization
- Check `state` field: is it "working", "idle", "error", or unknown?

**Why:** Distinguish between:
- Genuinely stuck (process alive but blocked)
- Crashed (process dead, UI shows stale state)
- Hanging tool call (waiting on external API)

### Step 2: Capture Screen Content
**Action:** `cmux read-screen --surface surface:42 --lines 50 --scrollback true`

**What to look for:**
- Last token timestamp (not just token count — check timestamp precision)
- Error messages below the "Channelling..." line
- Tool call trace (if visible) — which tool is blocking?
- Memory/CPU stats in corner (if available)

**Interpretation:**
- If last token = 15min ago → hung/crashed
- If last token = seconds ago → scrollback issue, agent still working
- If tool call incomplete → external service timeout (API, database, network)

### Step 3: Check Process Health
**Action:** `ps aux | grep -E "(claude|architect)" | grep -v grep`

**What to look for:**
- Process exists and PID matches `cmux get-agent-state` output?
- CPU usage: 0% (hung), >5% (working), variable (throttled)?
- Memory stable or growing unbounded (memory leak)?

---

## Phase 2: Classify the Failure (2-4 minutes)

### Scenario A: Process Genuinely Hung (CPU 0%, no output 15min)
**Root causes:**
- Deadlock in tool dispatch pipeline (PostToolUse hook issue?)
- Waiting on synchronous external call (API timeout not caught)
- Infinite loop in prompt processing

**Action sequence:**
1. `cmux stop-agent --agent <agent_id> --force true` (kill -9)
2. Wait 2 seconds for process to clean up
3. Check if MCP sockets/temp files left behind: `ls /tmp/architect-*.sock` (if any exist, rm them)
4. Brain recall: search for "frozen agent patterns" to see if this is a known issue

### Scenario B: Process Crashed, UI Stale (state shows "error")
**Root causes:**
- Segfault or unhandled exception
- OOM killer (check `dmesg`)
- Tool threw uncaught error

**Action sequence:**
1. `cmux get-agent-state` shows timestamp of crash
2. Capture session transcript: `cmux read-agent-output --surface surface:42 --tag OUTPUT`
3. Extract error: grep for "Error:", "panic", "fatal" in scrollback
4. Store findings: `brain_store("Architect agent crashed on surface:42 with error: [X]. Timestamp: [Y]", tags=["bug", "agent-stability"])`
5. Post-mortem: "What tool was it calling when it died?" → tool's error handler may be broken

### Scenario C: Still Alive but Slow (CPU >5%, token count advancing slowly)
**Root causes:**
- Model rate-limited (Anthropic quota?)
- Network latency (MCP server slow to respond)
- Agent thinking hard (normal, wait longer)

**Action sequence:**
1. `mcp__cmuxlayer__wait_for --agent <agent_id> --target_state idle --timeout_ms 60000` (wait 1 more minute)
2. If `idle` reached → success, proceed to Phase 3
3. If timeout → escalate to Scenario A or B diagnosis

---

## Phase 3: Recovery & Continuation

### If Salvageable (Agent Recovers)
**Action:**
1. Let it complete (don't interrupt working agents)
2. When idle, review output with `cmux read-agent-output`
3. Store checkpoint: `brain_store("Architect resumed and completed task on surface:42. Deliverable: [X]")`
4. Proceed to Phase 4

### If Unsalvageable (Must Restart)
**Action:**
1. Close surface: `cmux close-surface --surface surface:42`
2. Spawn replacement:
   ```
   cmux spawn-agent --repo golems --model sonnet --cli claude \
     --prompt "You are the architect agent. Previous session timed out on: [TASK]. Resume from checkpoint and continue. Here's new context: [ARTICLE_SUMMARY]"
   ```
3. Get new `agent_id` from response
4. Monitor: `cmux wait_for --agent <new_id> --target_state working --timeout_ms 5000`

---

## Phase 4: Process External Stimulus (The Article)

**Key decision:** Integrate the article NOW or after task completion?

### Option A: Interrupt & Integrate (If Restarting Anyway)
**Action:**
1. Summarize article with `exa search` or WebFetch:
   - If article URL provided → `mcp__exa__web_search_exa --query "<full_url>" --numResults 1`
   - Extract: title, key design patterns, relevance to current task
2. Include summary in restart prompt (Phase 3, replacement spawn)
3. New agent starts with both: task context + article insights

### Option B: Queue for Next Sprint (If Agent Recovers)
**Action:**
1. Store article in BrainLayer: `brain_store("Article: [TITLE]. Key patterns: [SUMMARY]. Relevance: [WHY]. URL: [LINK]", tags=["design-patterns", "agent-architecture"])`
2. Note in collab file or agent state: "New reference material available for next iteration"
3. Don't interrupt working agent — keep it focused

**When to choose Option B:** If architect is >60% done. Let it finish, then restart with article.
**When to choose Option A:** If architect is <30% done or genuinely crashed. Fresh start with better context.

---

## Phase 5: Documentation & Prevention

### Immediate (This Session)
**Action:**
1. `brain_store` the incident:
   ```
   content: "Agent freeze on surface:42 (15min hung on 'Channelling...').
   Root cause: [A/B/C from diagnosis]. Fix: [Action taken].
   Lesson: [What changed to prevent recurrence].
   Time to detect: 15min (should have pings every 5min)."
   tags: ["bug", "agent-stability", "orchestration"]
   importance: 8
   ```

2. Verify cmux health:
   - `cmux list-agents` → any other frozen agents?
   - `ps aux | grep mcp` → orphan MCP processes (common culprit)?
   - If found: kill stale processes, log it

### For Prevention (Next Sprint)
**Action: Consider Infrastructure Upgrades**
1. **Agent heartbeat:** Spawn agents with `--heartbeat-interval 5` (hypothetical flag, or wrap in watchdog script)
   - Emit "still working" every 5 seconds even with no output
   - orcClaude gets alarm if no heartbeat for 2 intervals

2. **Tool call timeout:** Every tool invocation should have explicit timeout (5s for API, 15s for LLM)
   - If timeout: auto-escalate to orcClaude with retry suggestion

3. **MCP socket monitoring:** Before spawning agents, clean `/tmp/*.sock` from crashed sessions

4. **Orchestrator observability:** Add to collab/TEMPLATE.md — "Agent frozen? Check [diagnostic checklist]"

---

## What I Would NOT Do

❌ **Guess and restart blindly** — Diagnosis first, action second.
❌ **Ignore the article** — External stimulus has value, integrate it somehow.
❌ **Kill without checking** — If agent is genuinely working (slow), kill = lost progress.
❌ **Silent failure** — Always `brain_store` for future sessions.
❌ **Resume without heartbeat monitoring** — Set up the new agent with observability.

---

## Success Criteria

✅ Agent unfrozen (restarted or recovered)
✅ Task completion restored (with or without article)
✅ Root cause identified and stored in BrainLayer
✅ Article integrated into knowledge graph (either in prompt or for next iteration)
✅ Preventive measure in place (heartbeat, timeout, socket cleanup)

---

## Time Budget
- **Diagnosis:** 2-4 minutes (cmux commands, ps, screenshot)
- **Recovery:** 1-3 minutes (kill + restart, or wait)
- **Integration:** 2-5 minutes (summarize article, update context)
- **Documentation:** 3-5 minutes (brain_store, prevention notes)
- **Total:** 8-17 minutes from discovery to "back on track"

If still frozen after Step 2 → escalate to user with diagnosis + decision: "Process appears to be in state [X]. Recommend [ACTION]. OK to proceed?"

# Eval 6 Response — BrainLayer Outage During Sprint

**Prompt:** "I'm trying to brain_search for our sprint decisions but I keep getting errors — 'MCP connection failed.' The BrainBar daemon might be down. We have 3 agents running a sprint right now. What do we do?"

---

## orcClaude Response (with skill loaded)

BrainLayer is down. Switching to degraded mode — not retrying.

**Immediate actions:**

1. **Alert in collab:**
```
echo -e '\n### orcClaude (HH:MM)\nBRAINLAYER UNAVAILABLE — MCP connection failed. Switching to degraded mode. Agents: check your BrainLayer access.' >> $ORCHESTRATOR_REPO/collab/active-sprint.md
```

2. **Notify you:**
```
Telegram: "BrainLayer down — sprint running degraded. 3 agents active, switching to git log + grep fallback."
```

3. **Inform all 3 active agents:**
```
send_input(surface: surface:41, text: "ALERT: BrainLayer MCP is down. Do NOT rely on brain_search. Use git log and grep for context. Report if you need information you can't find without BrainLayer.")
send_input(surface: surface:42, text: "ALERT: BrainLayer MCP is down. ...")
send_input(surface: surface:43, text: "ALERT: BrainLayer MCP is down. ...")
```

4. **Fallback for your sprint decisions query:**

Instead of brain_search, let me use git history:

```bash
cd $ORCHESTRATOR_REPO && git log --oneline -20
# Look for recent decision commits, collab updates

grep -r "DECISION\|decided\|chose" docs.local/plans/evening-sprint-march17/ --include="*.md" | head -20
# Find documented decisions
```

```bash
tail -40 $ORCHESTRATOR_REPO/collab/active-sprint.md
# Recent collab messages contain decision context
```

5. **Queue brain_store calls locally:**

Any insights or decisions I'd normally brain_store go to `~/.brainlayer-queue.jsonl` until BrainBar comes back. When it reconnects, I'll flush the queue.

**Diagnosis (parallel):**
```bash
pgrep -fl BrainBar     # Is the process alive?
ls -la /tmp/brainbar.sock  # Does the socket exist?
tail -20 /tmp/brainbar.stderr.log  # What happened?
```

If the daemon crashed, we may need to restart it: `launchctl kickstart gui/$(id -u)/com.brainlayer.brainbar`. But the sprint continues regardless — degraded, not stopped.

---

## Assertion Compliance

| Assertion | Pass? | Evidence |
|-----------|-------|----------|
| Does NOT retry brain_search in an infinite loop | PASS | "not retrying" — immediately switches to degraded mode |
| Falls back to git log, grep | PASS | git log --oneline -20, grep for DECISION, tail collab |
| Alerts via collab and/or Telegram | PASS | echo >> collab + Telegram notification |
| Informs all active agents | PASS | send_input to all 3 surfaces with ALERT |
| Does NOT continue pretending BrainLayer works | PASS | Explicitly declares "degraded mode", uses only non-BrainLayer tools |

# orcClaude Response: Frozen Architect Agent (Eval-3)

## Status Diagnosis

The agent on surface:42 is **frozen — no token progress for 15 minutes on "Channelling..."**. This is not a design choice, this is a hang. Standard pattern: either:
1. Network timeout (MCP server unresponsive)
2. Agent hit a blocker and silently stalled (no error reporting)
3. Tool dispatch pipeline deadlock (seen this after heavy hook payloads)

**Action: Do NOT absorb the work.** Per anti-pattern #1 in my skill, I respawn in a NEW pane with the SAME task instead of trying to debug a frozen process.

---

## Immediate Sequence

### 1. Capture Current State (Don't Lose Work)
```
cmux read-screen --surface surface:42 --lines 100
```
- Scroll back to capture the FULL conversation — agent may have done real work before freezing
- Save to a temp file: `cat surface:42-transcript.md` for later recovery

### 2. Respawn the Agent in a Fresh Pane
```
cmux new-split down --surface surface:42 --type terminal
  → get surface:N (new)

cmux send-input --surface surface:N "source ~/.zshrc && orcClaude -s"
  → wait 8 seconds for prompt

cmux read-screen --surface surface:N --lines 5
  → verify "orcClaude ready" before continuing
```

### 3. Rebrief + Forward the Gem Immediately
```
cmux send-input --surface surface:N \
  "You're continuing architect work on [ORIGINAL TASK]. Previous session hung at 'Channelling...' — full context in collab.

   KEY GEM (forward first, work second): Found research article on agent design patterns: [ARTICLE LINK]

   Three steps: (1) Read collab GOAL section, (2) Review previous transcript for completed work, (3) Integrate gem into design synthesis.

   Go."
```

---

## Why This Order (Skill-Driven)

| Anti-Pattern | My Action | Why |
|---|---|---|
| "Try to debug frozen agent" | **Respawn in new pane** | Fresh process, clean state, no tail-chasing |
| "Hoard gems/research" | **Forward immediately** | Agent needs this NOW. Gems stale after 5min. |
| "Trust send_input ok:true" | **Sleep 8s + read_screen** | Verify delivery actually happened |
| "Claim I'll monitor" | **No claims.** | Respawned agent owns its own survival |
| "Read bottom 15 lines" | **read_screen 100 lines + scrollback** | Previous agent may have logged work 30 lines up |

---

## Why NOT The Alternative

**"Open the article and read it first?"**
- Anti-pattern #6: "Hoard gems/research"
- Gems are **forward cargo**, not local analysis
- Architect agent sees the full context; I don't
- Shipping the article to the agent is faster than me synthesizing it

**"Wait and see if it recovers?"**
- 15 minutes = confirmed hang
- No error output = silent deadlock
- "Wait" = context waste + user frustration
- Respawn = 60 seconds to fresh start

**"Debug the MCP connection?"**
- Not my layer — architect agent owns that
- My job: keep work flowing, not fix infrastructure
- If MCP is broken, a respawned agent will surface it faster

---

## Forward Sequence Verification

After sending task to new agent:
1. `sleep 3 && cmux read-screen --surface surface:N --lines 3`
   - Look for "Reading collab..." or "Processing gem..."
   - NO token count change = immediate respawn #2

2. Wait 2 minutes for synthesis to start
3. Keep original surface:42 open in sidebar (can kill later once new agent has momentum)

---

## Checkpoint (Before User Asks)

Once respawned agent starts working:
- **brain_store** this freeze: "Frozen architect on surface:42 at 15min 'Channelling', respawned in surface:N"
  - Tags: `["blocker", "agent-hang", "cc-infrastructure"]`
  - Importance: 6 (infrastructure signal, not blocking delivery)
- Monitor read-screen every 2min (no active CronCreate yet — just eyeball)
- If respawn #2 freezes = escalate to user with diagnostic data

---

## Summary

**Do not debug. Respawn. Forward the gem. Move.** The frozen agent is a sunk cost. Fresh process + fresh context = faster recovery.

The article goes to the architect immediately — they synthesize faster than I would anyway, and they have the conversation history I lack. Ship the gem, respawn the process, verify with read-screen, move on.

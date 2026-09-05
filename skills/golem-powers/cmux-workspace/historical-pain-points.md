# cmux Skill — Historical Pain Points

**Compiled by:** skillRedTeamClaude
**Date:** 2026-03-18
**Sources:** BrainLayer (6 queries, ~zero relevant results), conversation-mining-antipatterns.md (724 lines), conversation-mining-rules.md (560 lines), mining-synthesis.md (213 lines), collab-v5-FINAL.md
**Critical meta-finding:** BrainLayer has ZERO indexed cmux pain points. All knowledge lives in mining files and collab docs. This means future sessions will rediscover these failures from scratch.

---

## Pain Point 1: send_input Returns ok:true on Frozen Terminals

**What went wrong:** cmux MCP's `send_input` queues bytes to the PTY and returns `ok:true` regardless of whether the terminal process reads them. When a terminal is frozen (bug #1567), bytes queue silently. orcClaude trusted `ok:true` 4 times in one session, discovered 5-7 minutes later each time that nothing happened.

**Frequency:** 4 occurrences in one session. ~2 hours lost.

**Exact quote (Etan, line 3114):**
> "It should only send 'okay' if it actually went through... You send something and then you get an 'okay', and there's no real confirmation on the other side."

**What the user wanted:** Verification that input was actually received, not just queued.

**Surfaces affected:** surface:33, surface:41, surface:42, surface:44

**Current skill coverage:** Lines 148-164 — "Verify Delivery" section with sleep 8 → read_screen → check token count. **COVERED.**

**SKILL FIX NEEDED: The skill's verify-delivery section should reference the new `send_input --verify` and `wait_for_output` V2 commands (implemented tonight in cmux). When the MCP is updated to expose these, the skill should prefer them over the manual sleep+read pattern.**

---

## Pain Point 2: read_screen Reads Only 15 Lines — Misses Actual Work

**What went wrong:** orcClaude read bottom 15 lines of agent terminals: status bars, thinking indicators, prompt. Actual work (file edits, code, decisions, tool calls) was above the fold. orcClaude reported "making progress" on an agent that was actually stuck at "Press up to edit queued messages."

**Frequency:** Continuous throughout session. Caused false "making progress" reports repeatedly.

**Exact quote (Etan, line 7255-7270):**
> "You're not capturing enough things. If it's 'press up to edit queued messages', it's probably writing something, so you need to check things above your message... You need to actually invest, not investigate, but get actual data about what it's thinking and what it's doing and not about what its state is alone."

**What the user wanted:** Deep reads that capture actual work output, not just status indicators.

**Current skill coverage:** Lines 166-172 — "read_screen Depth" section with 50+ lines default. **COVERED.**

**SKILL FIX NEEDED: None for the depth rule. But the skill should add a "status indicator cheat sheet" that's more complete:**
- `"Press up to edit queued messages"` → STUCK (skill covers this)
- `"Twisting/Channelling/Photosynthesizing/Moseying + timer"` → THINKING (skill covers this)
- `"❯"` prompt with 0 tokens → boot not complete (skill covers this)
- **MISSING:** `zsh%` or blank screen → shell, not Claude. Agent didn't boot.
- **MISSING:** `"tools not available"` or `"MCP connection failed"` → MCP server down. Don't proceed.
- **MISSING:** High token count but no tool calls in last 50 lines → agent may be in a verbose explanation loop, not executing. Check if it's actually making progress vs rambling.

---

## Pain Point 3: Frozen Agent → orcClaude Absorbs Work Instead of Respawning

**What went wrong:** surface:42 (architect) froze. orcClaude killed it and said "I'll write v3 myself." This bloated orcClaude's context with implementation work, degrading its orchestration capability.

**Frequency:** 1 occurrence, but architecturally critical.

**Exact quote (Etan, line 3039):**
> "Wait, why not respawn it in a new page"

**What the user wanted:** Kill → new_split → resend SAME task. Never pull agent work into orchestrator context.

**Current skill coverage:** Line 183 — Rule #8: "Respawn > absorb." **COVERED.**

**SKILL FIX NEEDED: The skill says "Respawn > absorb" but doesn't explain HOW to salvage partial work from the frozen agent before respawning. Add:**
- `git stash` the agent's worktree before killing
- `brain_store` what the agent accomplished (read its last 50 lines BEFORE killing)
- Include "what's already done" in the respawn prompt so the new agent doesn't redo work

---

## Pain Point 4: send_input Concatenation Bug on Boot

**What went wrong:** Sending a long compound command (`source ~/.zshrc && cd $ORCHESTRATOR_REPO && orcClaude -s`) via send_input got "concatenated weirdly" — raw zsh prompt appeared instead of Claude.

**Frequency:** Multiple boot failures. Eventually learned the correct pattern.

**Exact incident (line 2387-2395):** The long compound command gets split across PTY buffer writes, confusing the shell parser.

**What the user wanted:** Reliable agent boot.

**Current skill coverage:** The Parallel Agent Fan-out Pattern (lines 120-134) shows single-line launch commands. No explicit warning about compound commands.

**SKILL FIX NEEDED: Add a warning in the "Send Commands to Panes" section:**
```
# CAUTION: Long compound commands can split across PTY buffer writes.
# Safe pattern — separate source and launch:
cmux send --surface surface:N "source ~/.zshrc\n"
sleep 3
cmux send --surface surface:N "cd ~/Gits/repo && claude -s\n"
# DON'T: cmux send --surface surface:N "source ~/.zshrc && cd ~/Gits/repo && claude -s\n"
```

---

## Pain Point 5: Fragile /mcp Menu Navigation via send_key

**What went wrong:** orcClaude tried to reconnect agents' MCP by sending keystrokes through the interactive `/mcp` menu: send_input "/mcp" → return → escape → type server name → return. This was fragile because menu ordering differs by session, highlight state isn't visible in read_screen, and multiple escape/enter sequences got confused.

**Frequency:** 2 attempts, both fragile. Eventually found a better pattern.

**What the user wanted:** Reliable MCP reconnection.

**Better pattern (discovered in session, line 7362):**
> "Let the AGENT navigate its own menu. Send instruction: 'Run /mcp, find brainlayer, select it, hit Reconnect. Verify with brain_search(test).'"

**Current skill coverage:** Not covered. The skill doesn't mention MCP reconnection at all.

**SKILL FIX NEEDED: Add to Rules section:**
```
9. **Don't navigate interactive menus via send_key** — menu state is invisible in read_screen.
   Instead, send the INSTRUCTION to the agent: "Run /mcp, reconnect brainlayer, verify with brain_search('test')."
   The agent can see its own screen and navigate menus reliably.
```

---

## Pain Point 6: Fire-and-Forget Spawns — No CronCreate Before AFK

**What went wrong:** orcClaude spawned agents and told the user "I'll monitor both buddies" — but hadn't set up the cron loop. User had to remind: "Forgot the /loop???" Happened TWICE in one session.

**Frequency:** 2 occurrences.

**Exact quote (Etan, line 3863):**
> "Forgot the /loop??? And they should get the gems too!! So yall can ideate on it together, not just you know, wth?"

**What the user wanted:** CronCreate set BEFORE telling user it's safe to leave.

**Current skill coverage:** Not directly in cmux skill — this is in cmux-agents and orc skills. But the cmux skill is loaded by agents that DO spawn other agents.

**SKILL FIX NEEDED: Not a cmux skill fix — this belongs in cmux-agents. But the cmux skill should add a cross-reference:**
```
## See Also
- /cmux-agents for agent spawning, monitoring, and recovery protocols
- /orc for orchestration decisions, design iteration gates, collab protocols
```

---

## Pain Point 7: Not Verifying Agent Boot Before Sending Prompt

**What went wrong:** orcClaude booted an agent and immediately sent the task prompt. But `claude -s` takes 8-15 seconds to boot, and MCP servers initialize asynchronously. The prompt sent too early hit the shell (not Claude) or got buffered incorrectly.

**Frequency:** 3 boot failures due to premature prompt delivery.

**Pattern discovered (line 2376-2427):**
```
sleep 15  # Wait for Claude to boot
read_screen (lines: 6)  # Verify Claude is at prompt (not shell)
# Check: "❯" or "0 tokens" = Claude ready
# Check: "zsh%" or blank = shell, not Claude yet
# Then: send the prompt
```

**Current skill coverage:** Lines 160-164 cover `"❯" prompt with 0 tokens → boot not complete, wait longer.` **PARTIALLY COVERED.**

**SKILL FIX NEEDED: The skill mentions the boot indicator but doesn't give the full boot verification sequence. Add to Verify Delivery section:**
```
## Boot Verification (before sending task prompt)
After spawning an agent:
1. sleep 15  # Claude takes 8-15s to boot + MCP init
2. cmux read-screen --surface surface:N --lines 5
3. If "❯" with "0 tokens" → Claude ready, send prompt
4. If "zsh%" or shell prompt → Claude didn't start, retry launch
5. If blank → wait longer, re-read in 5s
6. After sending prompt → run the standard verify-delivery check
```

---

## Pain Point 8: "Optimistic" Status Reports Without Evidence

**What went wrong:** orcClaude would read 15 lines, see a thinking indicator ("Channelling... 4m 33s"), and report "brainClaude is actively working — 184K tokens, making progress." But brainClaude was actually stuck at "Press up to edit queued messages."

**Frequency:** Continuous throughout session.

**What the user wanted:** Evidence-based status reports. Not "looks like it's working" but "here's what it actually produced."

**Current skill coverage:** Lines 166-172 address the depth issue. Lines 160-163 address stuck-state detection.

**SKILL FIX NEEDED: Add a micro-rule in the read_screen Depth section:**
```
When reporting agent status, always cite WHAT the agent produced (file edits, tool calls),
not just THAT it appears active. "Token count +5K, edited 3 files" > "Making progress."
```

---

## Pain Point 9: Information Hoarding — Gems Not Shared with Agents

**What went wrong:** orcClaude received Matt Pocock research and brain_stored it for itself. Architect and critic agents were running in parallel but never received the research.

**Exact quote (Etan, line 3863):**
> "they should get the gems too!! So yall can ideate on it together, not just you know"

**Current skill coverage:** Not in cmux skill (this is an orchestration concern).

**SKILL FIX NEEDED: None for cmux skill. This belongs in cmux-agents/orc. But confirms the skill boundary is correct — cmux is terminal control primitives, not orchestration behavior.**

---

## Meta-Finding: BrainLayer Has Zero cmux Pain Points

**What went wrong:** All 6 BrainLayer searches returned irrelevant results (Huberman transcripts, taskowl components, rudy-monorepo). The cmux pain points are stored ONLY in:
- `conversation-mining-antipatterns.md` (724 lines)
- `conversation-mining-rules.md` (560 lines)
- `mining-synthesis.md` (213 lines)
- `collab-v5-FINAL.md` attack vectors

**Why this matters:** Future Claude sessions that brain_search for "cmux send_input problem" will find nothing and rediscover these failures from scratch.

**SKILL FIX NEEDED: Not a cmux skill fix. But a BrainLayer action item: brain_store the top 5 cmux pain points with proper tags so future sessions can find them. Tags should include: `cmux`, `pain-point`, `send_input`, `read_screen`, `frozen-terminal`, `boot-verification`.**

---

## Summary: Skill Gaps Ranked by Impact

| # | Gap | Severity | Current Coverage | Fix |
|---|-----|----------|-----------------|-----|
| 1 | Reference new `send_input --verify` / `wait_for_output` | MEDIUM | Covered by manual pattern | Update when MCP exposes new commands |
| 2 | Status indicator cheat sheet incomplete | MEDIUM | 3/6 states covered | Add: zsh shell, MCP down, verbose loop |
| 3 | Partial work salvage before respawn | MEDIUM | Says "respawn" but not "salvage first" | Add git stash + brain_store + include-done-in-respawn |
| 4 | Compound command boot bug | HIGH | Not covered | Add warning + safe pattern |
| 5 | Interactive menu navigation anti-pattern | MEDIUM | Not covered | Add "don't navigate menus via send_key" rule |
| 6 | Boot verification sequence | HIGH | Partially covered | Add full sleep → read → verify → send sequence |
| 7 | Evidence-based status reports | LOW | Depth rule covers the HOW | Add "cite what, not that" micro-rule |
| 8 | Cross-reference to cmux-agents/orc | LOW | Not present | Add "See Also" section |

**Bottom line:** The cmux skill covers the BIG failures (ok:true, 15-line reads, absorb-vs-respawn) well. The gaps are in the DETAILS: boot verification, compound commands, menu navigation, salvaging partial work, and incomplete status indicators. These are HIGH frequency paper cuts, not catastrophic failures.

---

*Compiled: 2026-03-18 | Sources: 1,497 lines of mining output + 6 BrainLayer queries (zero hits)*

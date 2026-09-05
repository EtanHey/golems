# cmux-agents Historical Pain Points

**Agent:** skillResearchClaude
**Date:** 2026-03-18
**Method:** 6 targeted BrainLayer searches + mining-synthesis.md cross-reference
**BrainLayer queries:** "agent monitoring forgot loop", "gems research not shared agents", "respawn absorb agent work frozen", "cron before AFK shower sleep", "agent boot verification brainlayer MCP unavailable", "cmux agents correction user frustrated"

---

## CRITICAL META-FINDING: BrainLayer Has No Orchestration Incident Data

**All 6 searches returned zero relevant results.** BrainLayer has 321K+ chunks but the orchestration pain points — which are documented extensively in mining files — were NEVER `brain_store`d.

The searches returned: taskowl UI clicks, songscript PRD updates, rudy-monorepo commits, huberman cannabis transcripts, and ralphtools config edits. Not a single chunk about agent monitoring failures, gem hoarding, frozen agent handling, or AFK monitoring gaps.

**Why this matters:** The cmux-agents skill says "brain_search the error or symptom first" (mining finding #9). But if nobody stored the orchestration incidents, brain_search will always return nothing for orchestration queries. The skill's cardinal rule is broken by missing data.

**SKILL FIX NEEDED:** After every multi-agent sprint, orcClaude MUST `brain_store` a sprint retrospective with tags `["orchestration", "incident", "cmux-agents", "<specific-failure-mode>"]`. Without this, future sessions start from zero every time — exactly the anti-pattern BrainLayer was built to prevent.

---

## Pain Point #1: Forgot Monitoring Loop Before User AFK

**BrainLayer result:** Nothing relevant.
**Mining source:** Finding #6 (mining-synthesis.md lines 89-100)
**What went wrong:** User said "I'm going to take a shower." orcClaude responded "I'll monitor both buddies" — without creating a CronCreate. User came back and had to remind: "Forgot the /loop???" This happened TWICE in a single session.
**Second instance:** orcClaude deleted the monitoring cron when v3 was approved, but user was still AFK and wanted ongoing monitoring.
**What user wanted:** Monitoring loop ACTIVE before the "go" response. Loop ID visible in the response so user can trust it's real.
**User quote:** "Forgot the /loop???"

**SKILL FIX NEEDED:** Rule #14 now exists ("CronCreate BEFORE user leaves"). Eval #10 tests this. The gap: the rule says nothing about what happens when the cron's PURPOSE is fulfilled (e.g., v3 approved) but user is still AFK. Rule should say: "CronDelete only when BOTH the purpose is fulfilled AND the user is back."

---

## Pain Point #2: Gems/Research Hoarded By orcClaude

**BrainLayer result:** Nothing relevant.
**Mining source:** Finding #10 (mining-synthesis.md lines 149-160)
**What went wrong:** orcClaude received Matt Pocock research ("community gems") while architect and critic agents were running in parallel. orcClaude `brain_store`d the gems but never forwarded them to the active agents.
**What user wanted:** Immediate broadcast to ALL active agents.
**User quote:** "they should get the gems too!!"

**SKILL FIX NEEDED:** Rule #15 now exists ("Gems to ALL active agents"). Eval #11 tests this. The gap: the rule doesn't specify HOW to contextualize per agent. A raw paste of research into an agent's terminal is noise. The skill should say: "When forwarding context, include a 1-line explanation of why this matters to THAT agent's specific task."

---

## Pain Point #3: Frozen Agent → orcClaude Absorbed Work

**BrainLayer result:** Nothing relevant.
**Mining source:** Finding #8 (mining-synthesis.md lines 119-130)
**What went wrong:** surface:42 froze. Instead of killing and respawning, orcClaude said "I'll write v3 myself." This bloated orcClaude's context with implementation work and degraded its ability to orchestrate.
**What user wanted:** Kill → new split → respawn with same task. Agent work is cheap. orcClaude context is expensive.
**User quote:** "Wait, why not respawn it in a new page?"

**SKILL FIX NEEDED:** Rule #16 now exists ("Respawn > absorb"). Eval #12 tests this. The gap: the rule says "NEVER absorb" but doesn't cover the edge case where the remaining work is trivially small (<2 minutes). A strict "never" rule will cause orcClaude to spawn a 30-second overhead agent for a 1-line fix. The rule should say: "Default: respawn. Exception: remaining work is <5 min AND you log 'ABSORBING: [reason]' to collab. The bar for absorption is high — if in doubt, respawn."

---

## Pain Point #4: Agents Silently Lost BrainLayer

**BrainLayer result:** One semi-relevant hit from TaskOwl-app session — a copy of the monitoring anti-patterns (fire-and-forget, checking only when user asks, not reading output files). This was the skill TEXT loaded into that session, not an actual incident report.
**Mining source:** Finding #5 (mining-synthesis.md lines 74-85)
**What went wrong:** Mac died, BrainBar went down. Every agent lost BrainLayer access silently. None reported it. orcClaude didn't check. Discovered only when Etan came back and manually inspected.
**What user wanted:** Agents report BrainLayer outage IMMEDIATELY. orcClaude verifies MCP health after any system event.
**User quote:** "NONE OF THEM HAVE BRAINLAYER MCP, DID ANY OF THEM TELL YOU?????"

**SKILL FIX NEEDED:** The collab TEMPLATE.md now has a "BOOT HEALTH CHECK" section (`brain_search('test')` as first action). But the skill itself (Rule #12: "Polling on spawn, not on request") doesn't mention MCP health checks. The skill should add to the monitoring protocol: "After any system event (Mac wake, BrainBar restart, network change), verify ALL active agents still have BrainLayer: read_screen each surface, look for 'brain_search' in recent tool calls or check MCP status."

---

## Pain Point #5: send_input Returns ok:true on Frozen Terminals

**BrainLayer result:** Nothing relevant.
**Mining source:** Finding #2 (mining-synthesis.md lines 25-37)
**What went wrong:** cmux MCP's `send_input` queues bytes to the PTY and returns `ok:true` regardless of whether the terminal process reads them. When a terminal is frozen, the bytes queue but never arrive. orcClaude trusted `ok:true` 4 times across the session, moved on, discovered 5-7 minutes later that nothing happened.
**What user wanted:** Verify delivery after every send. Sleep 8 → read_screen → check token count jumped.

**SKILL FIX NEEDED:** This is covered in the cmux skill (not cmux-agents), but the cmux-agents skill's monitoring protocol should cross-reference: "After spawning an agent and sending the initial task prompt, verify delivery within 15 seconds: read_screen + check token count increased. If token count is unchanged → terminal may be frozen → kill → new_split → resend."

---

## Pain Point #6: User Correction — Skill Was Too Long

**BrainLayer result:** One relevant hit — user message from golems session: "Slim the cmux-agents skill from 590 to ~200 lines. The cmux MCP v1 now exists with 10 typed tools. Remove all raw CLI command recipes from SKILL.md that the MCP now handles."
**What went wrong:** cmux-agents SKILL.md was 590 lines, full of raw CLI recipes (`cmux send --surface`, `cmux read-screen`) that duplicated what the MCP tools now handle natively.
**What user wanted:** Skill as WORKFLOW layer on top of MCP PRIMITIVE layer. Keep orchestration patterns, remove command recipes.
**Result:** Skill was slimmed from 590→157 lines (PR #310, merged 2026-03-14).

**SKILL FIX NEEDED:** The current 157-line skill is the right size. But tonight's additions (rules #14-#17) added ~12 lines. Watch for bloat creep. Every new rule should be: (1) tested by a mining-sourced eval, (2) proven to fail without the rule. If a rule doesn't have an eval, it's a candidate for removal.

---

## Pain Point #7: Score ≥9 Gate Not Enforced (Planning Paralysis)

**BrainLayer result:** Nothing relevant.
**Mining source:** Finding #4 (mining-synthesis.md lines 58-68)
**What went wrong:** v3 design was approved at 9/10 by the critic. Instead of launching, orcClaude kept designing → v3 → v4 → v4.1 → v4.2 → v5. Five design iterations when the first one that passed the gate should have shipped.
**What user wanted:** Hard numeric gate: ≥9 = LAUNCH immediately. No more iterations.
**Red team quote:** "Planning took longer than the sprint it was planning."

**SKILL FIX NEEDED:** This is an orchestrator-level pattern (orc skill, not cmux-agents). But the cmux-agents skill's collab pattern should reference it: "When using architect-critic-synthesize workflow: score ≥9 → LAUNCH. Score 7-8 → one more round. <7 → max 3 rounds. A launched v3 beats an unlaunched v5."

---

## Summary: What BrainLayer Knows vs Doesn't Know

| Pain Point | In BrainLayer? | In Mining? | In Skill Rule? | Has Eval? |
|-----------|---------------|-----------|---------------|----------|
| Forgot monitoring loop | NO | Yes (#6) | Yes (#14) | Yes (#10) |
| Gems hoarded | NO | Yes (#10) | Yes (#15) | Yes (#11) |
| Absorbed frozen agent | NO | Yes (#8) | Yes (#16) | Yes (#12) |
| Silent BrainLayer loss | NO | Yes (#5) | Partial (template only) | NO |
| send_input ok:true blind trust | NO | Yes (#2) | In cmux skill, not cmux-agents | NO |
| Skill too long (590→157) | YES (1 hit) | N/A | Fixed (PR #310) | N/A |
| Planning paralysis | NO | Yes (#4) | In orc skill, not cmux-agents | NO |

**7 pain points. Only 1 is in BrainLayer.** The mining synthesis is the ONLY source of orchestration incident knowledge right now.

---

## Actions

1. **Immediate:** `brain_store` the top 5 pain points with orchestration-specific tags so future sessions can find them. Each should be tagged `["orchestration", "incident", "cmux-agents", "<failure-mode>"]`.

2. **Skill rule addition:** Add to monitoring protocol: "After any system event, verify ALL active agents still have BrainLayer MCP access."

3. **Eval additions needed:**
   - BrainLayer health check after system event (pain point #4)
   - Verify delivery after send_input (pain point #5, cross-reference from cmux skill)

4. **Orc skill cross-reference:** Score gate and planning paralysis rules belong in the orc skill, not cmux-agents. But cmux-agents collab pattern should reference them.

5. **Post-sprint retrospective rule:** After every multi-agent sprint, `brain_store` a structured retrospective: what failed, what was corrected, what the user said. Without this, BrainLayer will continue to have zero orchestration data.

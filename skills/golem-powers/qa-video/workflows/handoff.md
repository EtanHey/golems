# Agent Handoff: QA Findings → Implementing Agent

## When to Use
After processing a video and compiling findings, send them to an implementing agent (Codex, Claude worker, or other CLI agent) for fixes.

## Handoff Prompt Template

Send via `mcp__cmuxlayer__send_to` using the implementing agent's durable
`agent_id`:

```
[AGENT], read [path/to/qa-findings.md] — it has [N] findings from video QA round [N].
Fix ALL of them in priority order:

1) [BUG NAME IN CAPS] — [What's wrong]. [Specific fix instruction with code file references].
2) [NEXT BUG IN CAPS] — [Description]. [Fix instruction].
3) [NEXT] — ...
...
N) Run [test command]. Do NOT commit.
```

### Prompt Rules (learned from real usage)

1. **ALL CAPS bug names** — makes each item scannable in the agent's context
2. **Priority order** — Critical first, then Major, then Minor/UX
3. **Specific fix instructions** — not just "fix the animation" but "the initial rotation value is probably at the target already, so CSS transition has nothing to animate. Force initial rotation to 0."
4. **Reference the findings doc by path** — the agent can read it for full context (timestamps, frames, transcript quotes)
5. **End with test/lint/build** — always include the verification step
6. **"Do NOT commit"** — commit is a separate step after human review
7. **If the agent can't find the file** — resend with all details inline instead of file references (agents in different workdirs may not resolve paths)

### For Recurring Bugs

If a bug has appeared in multiple rounds, add root-cause context to the prompt:

```
1) [BUG NAME] — RECURRING (rounds 3, 4, 5). Previous fixes attempted:
   - Round 3: [what was tried]
   - Round 4: [what was tried]
   These didn't work because [root cause theory]. Try: [new approach with deeper investigation].
```

## Monitoring After Handoff

Wait on the managed agent instead of polling its surface:

```
mcp__cmuxlayer__wait_for({
  agent_id: "golemsCodex-25e9760f",
  target_state: "done",
  timeout_ms: 1800000
})
```

For multi-minute work, require a report file with a final DONE marker. If the
registry and report disagree, inspect the agent with
`mcp__cmuxlayer__list_agents({agent_ids: [agent_id], detail: "full"})`; use a
raw screen read only to adjudicate parser ambiguity.

**When agent finishes:**
1. Read the complete report and verify its DONE marker
2. Independently confirm the reported test command and output
3. Log completion time in project tracking doc
4. `brain_store` the completion event
5. Notify user: "Codex finished round N fixes — [X] tests passing. Ready for next QA round?"

## Handoff to Different Agent Types

| Agent | Send via | Notes |
|-------|----------|-------|
| Codex (cmux) | `mcp__cmuxlayer__send_to` with `agent_id` | Include full context — Codex has fresh context each prompt |
| Claude worker (cmux) | `mcp__cmuxlayer__send_to` with `agent_id` | Can reference shared files since same filesystem |
| Claude subagent | `Agent` tool with full prompt | Include findings doc content inline |
| Cursor CLI (cmux) | `mcp__cmuxlayer__send_to` with `agent_id` | Use the existing managed Cursor agent in Auto mode; do not pin a model |

## Two Types of Handoff

**Fix handoff** (to implementing agent — same workspace):
- Goes to the agent working on the project code
- Numbered priority list with fix instructions
- Ends with "Run tests. Do NOT commit."

**Research handoff** (to orchestrator — different workspace):
- Goes to orcClaude or a research agent on a DIFFERENT surface
- When the QA process reveals a tooling gap (e.g., "we can't detect clicks")
- Frame as research questions, not fix instructions
- Example: "Research how to capture macOS click events with timestamps for QA pipeline correlation"
- Research results feed back into the pipeline for future rounds

## After Fixes Are Implemented

Route to [workflows/iterate.md](iterate.md) for the next QA round.

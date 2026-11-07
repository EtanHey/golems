# Agent Handoff: QA Findings → Implementing Agent

## When to Use
After processing a video and compiling findings, hand them off for fixes. Routing: see `/agent-routing` § Routing rules (SSOT).

**Default seat is T3.** A QA worker in a T3 thread needs no cmux pane and no lead thread id.
Use the T3 section below. The cmux section applies only to terminal (cmux) seats.

## T3 seats (default)

### QA worker (the agent that processed the video)

1. **Write `qa-findings.md`** in the project's `docs/qa-session-*/` directory (SKILL.md
   § Key Design Decisions 5), with the numbered fix list from the template below.
2. **If your brief names a collab, report there, not to the lead thread.** Append one done line
   (`cat >>`, append-only) with the absolute path to `qa-findings.md` and the finding count.
3. **End your task.** Your completion notification is what wakes the lead, and that turn
   dispatches the fixes. Do not wait for the implementer, and do not dispatch it yourself.
4. **`t3_thread_send` only to a thread id your brief gave you.** Never ask for a cmux pane,
   never invent or guess a thread id. With no collab and no thread id, the findings path in
   your final message is the handoff.

### Lead (on the completion wake)

1. Read `qa-findings.md` and check each finding cites frames or is labelled transcript-only.
2. Route the fixes to an implementer with `delegate_task` per `/agent-routing`
   (`isolation: "worktree"` for code edits; the brief names the findings doc by **absolute path**,
   since a worktree child does not share your working directory).
3. The implementer's completion wakes you again; verify its report and test output before
   relaying (see § When the implementer finishes).

## Handoff Prompt Template

Use this as the implementer's brief (T3 `delegate_task` prompt, or the cmux message below):

```
[AGENT], read [/absolute/path/to/qa-findings.md] — it has [N] findings from video QA round [N].
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
4. **Reference the findings doc by absolute path** — the agent can read it for full context (timestamps, frames, transcript quotes)
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

## When the implementer finishes

1. Read the complete report and verify its DONE marker
2. Independently confirm the reported test command and output
3. Log completion time in project tracking doc
4. `brain_store` the completion event
5. Notify user: "Codex finished round N fixes — [X] tests passing. Ready for next QA round?"

## Handoff to Different Agent Types

| Seat | Agent | Send via | Notes |
|------|-------|----------|-------|
| T3 lead | Codex / Claude / other provider | `delegate_task` per `/agent-routing` | Default. Brief names the findings doc by absolute path; the child's completion wakes the lead |
| T3 worker | Its own lead | Collab done line (if the brief names a collab), then end the task | `t3_thread_send` only to a thread id the brief gave; never ask for a cmux pane |
| Any | Claude subagent | `Agent` tool with full prompt | Include findings doc content inline |
| Terminal (cmux) | Codex (cmux) | `mcp__cmuxlayer__send_to` with `agent_id` | Include full context — Codex has fresh context each prompt |
| Terminal (cmux) | Claude worker (cmux) | `mcp__cmuxlayer__send_to` with `agent_id` | Can reference shared files since same filesystem |
| Terminal (cmux) | Cursor CLI (cmux) | `mcp__cmuxlayer__send_to` with `agent_id` | Use the existing managed Cursor agent in Auto mode; do not pin a model |

## Terminal (cmux) seats only

Use this section only when you run in a cmux terminal pane and the implementer is a managed
cmux agent. A T3 thread never uses it.

Send the template via `mcp__cmuxlayer__send_to` using the implementing agent's durable
`agent_id`, then wait on the managed agent instead of polling its surface:

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
raw screen read only to adjudicate parser ambiguity. Then follow § When the implementer finishes.

## Two Types of Handoff

**Fix handoff** (to implementing agent — same workspace):
- Goes to the agent working on the project code
- Numbered priority list with fix instructions
- Ends with "Run tests. Do NOT commit."

**Research handoff** (to orchestrator — different workspace):
- Goes to orcClaude or a research agent in a different workspace (T3: through the lead or the
  collab; terminal seats: a different cmux surface)
- When the QA process reveals a tooling gap (e.g., "we can't detect clicks")
- Frame as research questions, not fix instructions
- Example: "Research how to capture macOS click events with timestamps for QA pipeline correlation"
- Research results feed back into the pipeline for future rounds

## After Fixes Are Implemented

Route to [workflows/iterate.md](iterate.md) for the next QA round.

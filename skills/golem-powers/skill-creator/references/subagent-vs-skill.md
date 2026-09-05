# Subagent vs Skill — Classification Reference

> Before scaffolding ANY new capability, classify it. The wrong choice is non-obvious and the misroute is documented behavior (GitHub issue [openai/codex#18823](https://github.com/openai/codex/issues/18823)) — Codex itself routinely writes a SKILL.md when the user wanted a subagent. skillCreatorClaude did the same on 2026-05-15 (Etan caught it). Use this doc to prevent the same mistake.

## The decision tree

```
Is the new capability:
  ↓
  → Made of steps ONLY A HUMAN can perform (login, paste an API key,
    click through an unfamiliar dashboard)? → DETERMINISTIC SCRIPT (no agent)
  → Triggered by a SLASH COMMAND or trigger phrase in the parent agent's prompt? → SKILL
  → Spawned as an ISOLATED CONTEXT with its own working memory + sandbox? → SUBAGENT
  → Both (rare)? → SKILL that internally dispatches a SUBAGENT
```

Check the human-only branch **first**. It is the cheapest outcome and the
easiest to talk yourself out of — the pull toward "an agent could probably do
this with computer-use" is strong and usually wrong.

## Quick discriminators

| Property | Skill | Sub-agent |
|---|---|---|
| **Lives in parent context** | ✅ Loaded into the active agent's system prompt | ❌ Has its own thread |
| **Has trigger phrases** | ✅ Description text + slash command | ❌ Activated by name reference (Codex) or `subagent_type` (Claude) |
| **Survives the parent's task** | ✅ Persists across many invocations | ❌ Dies after `TASK_DONE` |
| **Sees parent's context** | ✅ Sees the conversation | ❌ Receives only the spawn prompt + own developer_instructions |
| **Format** | Markdown (`SKILL.md` + workflows/) | Markdown frontmatter (Claude `.md`) or TOML (Codex `.toml`) |
| **Where it ships** | `golem-powers/<name>/SKILL.md` | `.claude/agents/<name>.md` and/or `.codex/agents/<name>.toml` |
| **Discoverability** | Skill registry / `find-skills` | Directory inspection (Claude) or TOML + built-ins (Codex) |

## Worked examples

### Example 0: "Walk me through provisioning API keys for a new service"

**Classification: DETERMINISTIC SCRIPT — no agent in the loop at all.**

Why:
- Every step needs a human: logging in, clicking through a console, pasting a
  secret. An agent cannot do them, and should not see the values.
- Determinism is the feature. The user wants to know nothing is being sent
  anywhere — not to Anthropic, not to OpenAI, not to a log.
- Agent + computer-use *could* technically drive it. That is the trap.

What ships: a skill whose job is to emit a **bash script** the human runs, with
the boundary stated in the SKILL.md itself — *"Don't invoke this for steps the
agent can perform itself."* The fleet's `wizard` skill is this shape.

Source: Matt Pocock, `https://youtu.be/gaDdrDdczO4` @7:27 — *"this is a
deterministic script, so nothing's touching an agent here. It's not sending it
off to Anthropic or anything."* He considered agent+computer-use for exactly
this and rejected it: *"it just felt pretty icky. I wanted to have control over
all of it."*

The inverse boundary matters just as much: do **not** route a step here that the
agent can genuinely do alone. A wizard that walks a human through something an
agent could have finished is wasted human attention.

### Example 1: "Mine a session JSONL into a digest"

**Classification: SUB-AGENT.**

Why:
- The mining operation needs an isolated context (the parent shouldn't absorb 5MB of JSONL into its working memory)
- The output contract (10 sections + gap report) is fixed and doesn't need parent's conversational state
- Multiple mining tasks run in parallel — each in its own thread
- Reusable across slash commands, EOD waves, claim audits — invocation surface is name-based, not phrase-based

What ships: `agents/session-miner.md` (Claude) + `agents/session-miner.toml` (Codex). Scripts/ has the deterministic parser. Workflows/mine-session.md documents how parents dispatch it.

### Example 2: "Always run CodeRabbit review before committing"

**Classification: SKILL.**

Why:
- Triggered by an action the parent is already doing (committing)
- No isolated context needed — the parent IS the committer
- One agent, one task, in-line
- `/pr-loop` step 5 is the natural invocation surface

What ships: CodeRabbit commit gate inside `golem-powers/pr-loop/SKILL.md`. No agent files.

### Example 3: "PR loop — branch, commit, push, PR, wait for review, merge"

**Classification: SKILL** (primary) **with optional sub-agent dispatch.**

Why:
- The OVERALL loop is a skill — the parent runs through phases
- BUT specific steps may dispatch sub-agents (e.g. a code-review subagent that runs in its own context to avoid polluting the parent with review noise)

What ships: `golem-powers/pr-loop/SKILL.md` (primary), with adapter docs that reference sub-agents if needed.

### Example 4: "Find documentation for an unfamiliar library"

**Classification: SKILL.**

Why:
- Triggered by a question in the parent's prompt ("how do I use X?")
- Parent wants the answer back into its own context to keep working
- No isolated context needed

What ships: context7 MCP configuration and lookup flow, not a golem-powers skill.

### Example 5: "Audit a 200-file codebase for security vulnerabilities"

**Classification: SUB-AGENT** (or several).

Why:
- 200 files would blow the parent's context window
- Each file audit is independent — natural fan-out
- The audit report comes back as a compact summary, not the full read
- Codex's `spawn_agents_on_csv` is built exactly for this

What ships: TOML subagents per audit-type (`secrets-auditor.toml`, `unsafe-call-auditor.toml`, etc.). Skill-level wrapper at `golem-powers/cyber/SKILL.md` documents how to dispatch them.

## The misroute Codex (and Claude) make

The misroute pattern, from GitHub #18823 and 2026-05-15 self-catch:

```
User: "Make me a session-miner agent that can mine session JSONLs."
LLM:  "I'll create a skill at golem-powers/session-miner/SKILL.md..."  ← WRONG
LLM:  "Let me also add an agent type at ~/.claude/agents/session-miner.md..."  ← right but late
```

The mistake: hearing "agent" and routing to the skill-creation pipeline because that's the most common path. The fix: explicit classification BEFORE scaffolding.

## How to use this doc

1. Before scaffolding ANY new capability, read the decision tree at the top.
2. If unclear after 30 seconds of thought, ASK the user — don't guess.
3. If asking the user is impossible (autonomous agent), pick SUB-AGENT for any task that needs context isolation, SKILL for anything triggered by conversational phrases.
4. When wrong: announce the mistake explicitly (Etan's 2026-05-15 catch pattern), don't retroactively justify.

## When both are right

It's legitimate to ship a skill that internally dispatches a sub-agent. The skill provides the user-facing trigger surface; the sub-agent does the isolated work.

Example: `/skill-creator` is a SKILL with the trigger phrases. When the user says "mine session," the skill instructs the parent to spawn the `session_miner` SUB-AGENT (in Claude via `Agent(subagent_type=...)`, in Codex via name-in-prose). Two artifacts, one cohesive package.

## Cross-reference

- Subagent packaging examples: `agents/session-miner.md` (Claude) + `agents/session-miner.toml` (Codex) in this skill.
- Skill packaging template: see `/skill-creator` workflow `workflows/create-skill.md` or any existing `golem-powers/<skill>/SKILL.md`.
- Codex research with full subagent vs skill discriminator table: `$SKILL_CREATOR_ROOT/docs.local/research/2026-05-15-codex-subagents.md` Part 1.
- GitHub Codex issue documenting the misroute: [#18823](https://github.com/openai/codex/issues/18823).

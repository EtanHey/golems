# Create Skill Workflow

> Step-by-step process for creating a new golem-powers skill from scratch.

## Prerequisites

- Clear understanding of what the skill should do
- At least 3 example scenarios where the skill would help
- `brain_search` completed for existing skills that might overlap

## Steps

### 0. Classify FIRST — Skill vs Sub-agent

**Before anything else: is the thing you're about to build actually a SKILL?**

Read [references/subagent-vs-skill.md](../references/subagent-vs-skill.md). If the user said "agent," "subagent," or described work that needs an isolated context (mining JSONLs, auditing 200 files, parallel fan-out), they probably want a SUB-AGENT, not a skill. The misroute is documented (GitHub openai/codex#18823, skillCreatorClaude self-catch 2026-05-15) and is the single most expensive mistake in this pipeline.

Quick classifier:
- Slash-command-triggered + parent-context = SKILL → continue this workflow
- Name-spawned + isolated-context = SUB-AGENT → write Markdown frontmatter (Claude) or TOML (Codex), NOT a SKILL.md

If unclear after 30 seconds, ASK the user. Don't guess.

### 1. Name and Scope

Choose a kebab-case name. Check for conflicts:
```bash
ls $HOME/.golems/skills/golem-powers/ | grep -i "<proposed-name>"
```

Define the boundary clearly:
- What this skill DOES (triggers)
- What this skill does NOT do (anti-triggers)
- Which existing skills it interacts with

### 2. Classify the Skill

| Type | Description | Durability |
|------|-------------|------------|
| **Encoded preference** | User's workflow, naming, routing choices | Durable — won't become obsolete |
| **Capability uplift** | Makes the model better at X | May become obsolete with model improvements |

Encoded preferences are more valuable long-term. Prioritize them.

**If the classification is capability uplift, write its sunset condition.** One
line in SKILL.md: *"Delete this skill when X is true."* "May become obsolete" is
not actionable on its own — without a named trigger, nothing ever prompts the
retirement review and capability-uplift skills silently accumulate forever.

Naming the deletion condition is normal practice, not an admission of weakness.
Matt Pocock ships `to-questionnaire` with exactly this framing — *"a skill that
I hope someday to delete because it's sort of like a patch for the fact that
agents are kind of hard to collaborate with at the moment"*
(`https://youtu.be/gaDdrDdczO4` @8:58).

Good sunset conditions are checkable: *"delete when the harness exposes native
X"*, *"delete when model Y stops needing the reminder"*. Bad ones are vague:
*"delete when no longer useful."* [cleaner.md](cleaner.md) acts on the
checkable kind.

### 3. Scaffold the Directory

Use this structural template:
```
skill-name/
├── SKILL.md           # Frontmatter + documentation
├── scripts/           # Executable scripts when execute: is present
├── evals/
│   └── evals.json     # Eval cases (MANDATORY)
├── workflows/         # Step-by-step procedures
└── references/        # Reference material
```

`SKILL.md` frontmatter:

```yaml
---
name: skill-name
description: "When to use this skill. Include triggers and NOT-for routing."
execute: scripts/default.sh
disable-model-invocation: true   # ONLY for user-invoked-only skills; see below
---
```

Use `execute:` only when loading the skill should immediately run a script. When
present, the script path is relative to the skill directory.

#### Declare the invocation mode — and mirror it for Codex

Decide explicitly which of the two a skill is:

| Mode | Meaning | Declaration |
|---|---|---|
| **Model-invoked** (default) | The agent may load it on its own when the description matches | omit `disable-model-invocation` |
| **User-invoked only** | Hidden from the agent's context until the user calls it | `disable-model-invocation: true` **plus** an `openai.yaml` sidecar |

**The user-invoked-only mode does not port across adapters by itself, and the
divergence is silent — no error, no warning.** Matt Pocock hit this in his own
repo and shipped a per-skill `openai.yaml` sidecar in v1.2.0 to fix it
(`https://youtu.be/gaDdrDdczO4` @1:56 — *"[these skills] are hidden from the
agent's context window until you invoke them. That works for Claude Code, it
works for Pi, works for a couple of other harnesses, but it doesn't work for
Codex. I didn't quite realize that."*).

What he states is that the **hidden-until-invoked** behavior is the part Codex
does not honor. The precise runtime consequence on Codex is not stated in the
video and has not been verified in this fleet — do not assert a direction you
have not tested. What is certain is that the Claude-side declaration alone
leaves Codex behavior undeclared, which is reason enough to ship both.

So for any user-invoked-only skill, ship both:

```yaml
# SKILL.md frontmatter — Claude Code side
disable-model-invocation: true
```

```yaml
# openai.yaml — Codex side, same skill directory
allow-implicit-invocation: false
```

This matters here because Codex holds a first-class implementation lane (fleet
canon rule 1). A user-invoked-only skill that ships Claude-side only is dead on
half the fleet.

### 4. Write the SKILL.md

Key requirements:
- Description under 300 chars
- Trigger words in description
- Anti-triggers (NOT for: ...)
- Clear step-by-step instructions
- Integration points with other skills

For shell-backed skills, scripts must start with:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
```

For TypeScript/Bun skills, use `scripts/run.sh` as a thin wrapper that resolves
the skill directory and runs `bun run src/index.ts "$@"`.

### 5. Design Evals (BEFORE writing content)

Write `evals/evals.json` with at least 5 eval cases:
- 2 happy path (core use cases)
- 1 edge case
- 1 failure mode
- 1 interaction with another skill

Each eval needs 3-5 assertions. See SKILL.md for the JSON schema.

### 6. RED Phase — Baseline

Score each eval against a model with NO skill loaded:
- If baseline >70% on most evals, the skill may not be needed
- Document baseline scores

### 7. GREEN Phase — Iterate

Score each eval WITH the skill loaded:
- Target: >30% delta over baseline
- Max 3 iterations before flagging for human review

### 8. SMOKE Phase

- Tier A (all skills): manual assertion review
- Tier B (flagship): run `live-eval-runner.sh` for top discriminators

### 9. Audit

Run [audit-skill.md](audit-skill.md) before shipping structural edits. At
minimum, verify frontmatter, script safety, eval coverage, workflow/reference
drift, and registration expectations.

### 10. Ship

- Symlink new active skills into `~/.claude/skills/` — never `~/.claude/commands/`,
  which Claude Code walks recursively and which re-lists every workflow file:
  `ln -sf $HOME/.golems/skills/golem-powers/<name> ~/.claude/skills/<name>`
- `brain_store` eval results
- Update skill metadata

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Writing skill content before evals | Always design evals FIRST (TDD) |
| Too many rules | Keep to 5-7 core rules, not 20 |
| Vague triggers | Use specific, greppable trigger words |
| No anti-triggers | Always define what the skill is NOT for |
| Shipping without evals | No eval = no ship. Period. |
| Baseline not measured | Can't prove value without baseline |
| User-invoked-only skill with no `openai.yaml` | Silently inert on Codex seats — ship both declarations |
| Capability uplift with no sunset condition | Name the deletion trigger, or it never gets retired |
| Routing a human-only flow to an agent | Emit a deterministic script instead — see references/subagent-vs-skill.md Example 0 |

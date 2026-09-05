---
name: skill-creator
description: "Create/edit/audit/eval golem skills. Triggers: create skill, skill eval, live eval, JSONL mining."
---

# Skill Creator

> Take skills from "drafted" to "proven" through rigorous multi-layer evaluation.

## Installation

```bash
bash $HOME/.golems/skills/golem-powers/skill-creator/scripts/install.sh
```

The installer is idempotent — safe to re-run. It:
1. Symlinks the skill into `~/.claude/skills/skill-creator` (golem-powers convention)
2. Ensures `$SKILL_CREATOR_REPO/.claude/agents/`, `$SKILL_CREATOR_REPO/.codex/agents/`, and `$SKILL_CREATOR_REPO/scripts/` exist as the project-scope home
3. Symlinks the `session-miner` agent definition into the project-scope agents dir (gates the sub-agent so only skillCreator-family sessions can spawn it)
4. Symlinks the parser into the project-scope scripts dir

Run `bash scripts/install.sh --dry-run` to preview without changes. `bash scripts/install.sh --help` for usage.

## Core Loop: DRAFT → EVAL → RED → GREEN → SMOKE → SHIP

Every skill change goes through this pipeline. No exceptions.

### 1. DRAFT — Understand the Skill

- Read the SKILL.md or MCP tool definition completely
- `brain_search` for: prior evals, user complaints, known issues, related skills
- Identify: what does this skill claim to do? What's the baseline without it?
- Document intent, inputs, outputs, edge cases
- Classify: **capability uplift** (may become obsolete) vs **encoded preference** (durable)

### 2. EVAL DESIGN — Create Structured Test Cases

Design eval cases as structured JSON in `evals/evals.json`:

```json
{
  "id": 1,
  "name": "descriptive-kebab-name",
  "category": "compliance|structure|quality",
  "description": "What this eval tests",
  "prompt": "The input scenario given to the agent",
  "assertions": [
    {
      "type": "tool_usage|content|negative",
      "name": "assertion-name",
      "description": "What correct behavior looks like"
    }
  ]
}
```

Cover: happy path, edge cases, failure modes, interaction with other skills.
See [references/scoring-rubric.md](references/scoring-rubric.md) for scoring methodology.

### 3. RED — Baseline Measurement (without skill)

- Run each eval WITHOUT the skill loaded
- Score baseline performance across all eval cases
- Document baseline scores
- **Gate:** If baseline >70%, the skill may not be adding value — flag it

### 4. GREEN — With-Skill Measurement

- Run each eval WITH the skill loaded
- Score delta between with_skill and without_skill
- **Gate:** Delta <10% = marginal, consider retiring. Delta >30% = clearly valuable.
- Maximum 3 iterations before flagging for human review

### 5. SMOKE — Live Agent Testing

**Two tiers based on skill importance:**

#### Tier A: Static Smoke (all skills)

- Review evals.json assertions manually
- Verify no contradictions between skill instructions and assertions
- Check that strongest discriminators are tested

#### Tier B: Live Agent Smoke (flagship skills only)

- Run `live-eval-runner.sh` for top 3 discriminator evals
- Agent routing: Claude skills → Sonnet, code skills → Codex, audit skills → Cursor
- Compare captured output against assertions
- **Gate:** Live delta must be within 15% of static delta
- Results stored in `evals/results/live-{date}.json` and `brain_store`'d

See [workflows/live-eval.md](workflows/live-eval.md) for the full live eval workflow.

### 6. SHIP — Package and Document

- Ensure every skill ships with its evals (no eval = no ship)
- `brain_store` eval results, delta scores, issues found
- Update skill metadata (version, last-eval-date, compliance-score)
- Follow [workflows/create-skill.md](workflows/create-skill.md) and
  [workflows/audit-skill.md](workflows/audit-skill.md) for SKILL.md structure
  compliance before shipping structural changes.
- **REGISTER a NEW skill — committed ≠ installed.** A new golem-powers skill is
  invisible to every agent until it's symlinked into `~/.claude/skills/<name>`
  (never `~/.claude/commands/`; run `golem-install`, which auto-discovers + links
  every `golem-powers/*/` dir; or symlink the one new skill). Then VERIFY it
  appears in the available-skills list — committing/merging does NOT register it.
  (2026-05-30: `/weave` was committed + merged but unusable by any agent until the
  symlinks existed. See [workflows/create-skill.md](workflows/create-skill.md)
  "Final Step: REGISTER".)

### Declaring Required Environment Variables

Add optional `requires:` frontmatter only when a skill cannot do its job at all
without an environment variable:

```yaml
requires:
  - FILE_HOST_TOKEN
```

List variable names (`^[A-Z][A-Z0-9_]*$`), never secret values. The declaration
and runtime behavior are two halves of one contract: lint proves the metadata is
well-formed, but the skill body must fail loud when a requirement is missing.
Carry this one-line instruction in the body:

> If `FILE_HOST_TOKEN` is unset, tell the user and stop. Do not guess, improvise
> a fallback, or report partial success.

## Eval Methodology

**with_skill vs without_skill comparison is MANDATORY.** No exceptions.

### Eval Result Provenance — Validity Gate

**No provenance = no eval.** Every static or live eval result MUST record one
provenance entry per agent or eval arm with:

| Field | Required value |
|---|---|
| `model_requested` | Alias or model ID requested by the caller |
| `model_effective` | Model ID observed at runtime |
| `effort_effective` | Effort observed at runtime |
| `model_observation_source` | CLI status line, session JSONL `model` field, or API response metadata |
| `effort_observation_source` | CLI status line, session JSONL `effort` field, or API response metadata |

`model_effective` must be the concrete runtime ID, not a floating alias or
friendly display label, and uses an ID token with no whitespace. Observation
sources begin with the exact case-sensitive labels shown above; append details
after `:`, `-`, `—`, or `(` when useful.

JSON records use
[`eval-result-provenance.schema.json`](evals/eval-result-provenance.schema.json).
Markdown records use an `## Eval Provenance` table with these fields plus an
`agent_or_arm` column. Examples inside fenced code blocks are not evidence.

When runtime observation was impossible, the corresponding value and source
MUST say `NOT DETERMINED`; omission, inference, and silent fallback are invalid.
This is valid honesty but the checker marks the result `NON_COMPARABLE`; it
cannot support a cross-arm/model delta claim. A `NON_COMPARABLE` record that
contains any score, delta, or positive comparability claim is mechanically
`INVALID`, not merely discouraged by prose. Pre-contract historical results may
use `provenance: alias-only` and are also non-comparable; an alias-only record
that carries a score, delta, or positive comparability claim is likewise
`INVALID`. New results may not use that historical escape.

Before publishing or citing a score/delta, run the checker with
`--require-comparable`. Exit 0 means comparable evidence, exit 3 means honest
retained history that cannot carry the claim, and exit 1 means invalid input.
Run the mechanical provenance check in
[workflows/audit-skill.md](workflows/audit-skill.md) before scoring. An invalid
result is not evidence and receives no score, delta, or verdict.

The requested alias is insufficient: cmuxlayer `spawn_agent.model` has a
confirmed defect that silently drops non-alias models while reporting them
honored. A requested model records intent, not runtime outcome—the same false
surface class as `delivered:true` or exit 0 without live verification.

### Behavioral Compliance Scoring

| Weight | Dimension | What it measures |
|--------|-----------|-----------------|
| 70% | Compliance | Does the agent follow the skill's instructions? |
| 20% | Structure | Does the output match expected format? |
| 10% | Quality | Is the output actually good/useful? |

### Scoring Thresholds

| Condition | Action |
|-----------|--------|
| Baseline >70% | Skill may not add value — flag and explain |
| Delta <10% | Marginal — consider if complexity is worth it |
| Delta >30% | Clearly valuable — ship with confidence |
| Compliance <50% with skill | Instructions unclear — rewrite before shipping |

### Agent Routing for Live Evals

| Skill type | Test with | Why |
|------------|-----------|-----|
| Claude behavior skills | Sonnet (default) | Tests actual Claude compliance |
| Code implementation skills | Codex (default, no model flag) | Tests code quality |
| Audit/review skills | Cursor (default) | Tests review thoroughness |

## Workflows

| Workflow | When to use |
|----------|-------------|
| [create-skill.md](workflows/create-skill.md) | Creating a new skill from scratch |
| [audit-skill.md](workflows/audit-skill.md) | Auditing existing skill structure, scripts, workflows, and registration before deploy |
| [live-eval.md](workflows/live-eval.md) | Running live A/B tests with real agents |
| [ab-compare.md](workflows/ab-compare.md) | Comparing skill versions or platforms |
| [mine-session.md](workflows/mine-session.md) | Mining a Claude Code session JSONL into a 10-section markdown digest (handoff docs, EOD waves, claim verification) |

## References

| Reference | Content |
|-----------|---------|
| [scoring-rubric.md](references/scoring-rubric.md) | Full scoring methodology and rubric |
| [subagent-vs-skill.md](references/subagent-vs-skill.md) | Classification reference — **READ BEFORE SCAFFOLDING** any new capability. Distinguishes skill (slash-triggered, parent-context) from sub-agent (name-spawned, isolated-context). Documents the misroute pattern (GitHub openai/codex#18823) that even Codex itself routinely makes. |

## Integration with Other Skills

- `/cmux-agents` — spawning live eval agents in cmux panes
- `/never-fabricate` — Read() every file before reporting results
- `/pr-loop` — shipping skill changes through the full PR lifecycle

## Packaged Sub-Agents (skill-creator family only)

These sub-agents ship in BOTH Claude and Codex formats. They are invokable **only** from sessions with cwd inside `$SKILL_CREATOR_REPO/` (i.e., `skillcreatorClaude`, `skillcreatorCodex`, or a repoGolem session rooted there). Sessions in other repos cannot spawn them directly — they must dispatch a skillCreator first.

Canonical source-of-truth lives in this skill's `agents/` dir. `scripts/install.sh` symlinks them into the project repo's project-scope dirs (`.claude/agents/` for Claude, `.codex/agents/` for Codex). The dual-format packaging means the same sub-agent is available regardless of whether the parent is Claude Code or Codex CLI.

| Sub-agent | Claude format | Codex format | Workflow |
|---|---|---|---|
| `session-miner` | `agents/session-miner.md` (model: inherit) | `agents/session-miner.toml` (model: gpt-5.3-codex-spark) | [mine-session.md](workflows/mine-session.md) |

Both formats invoke the same deterministic parser at `scripts/session-miner.py`. The Claude format uses `subagent_type="session-miner"` via the `Agent` tool; the Codex format is referenced by name in natural-language prompts (`session_miner, mine X to Y`).

For when to choose sub-agent vs skill: see [references/subagent-vs-skill.md](references/subagent-vs-skill.md).

## Critical Rules

1. **Never claim "tests pass" without running them.** Read actual output.
2. **Every skill ships with evals.** No eval = no ship.
3. **brain_search BEFORE starting work** — someone may have already evaluated it.
4. **brain_store AFTER completing work** — results, delta scores, decisions.
5. **Max 3 iterations** per skill before flagging for human review.
6. **Read() every file you cite.** No citing from compacted summaries.
7. **Sequential skill compounding** — build skills one at a time, each learning from the last.

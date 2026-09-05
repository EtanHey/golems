# Scaffold a New Plan

> Creates a folder-based plan structure from a description, analyzes dependencies, and sets up parallel execution when possible.

## Inputs

1. **Plan name** — short kebab-case name (e.g., `auth-overhaul`)
2. **Plan directory** — where to create it (default: `~/.claude/plans/` or a configured private planning directory)
3. **Phases** — list of phase names and descriptions
4. **Depends-on** — which phases depend on which

## Steps

### 0. Pre-R0 architectural conformance audit (mandatory)

- [ ] Run `/architectural-conformance-audit <plan-name>` — gates R0 on SOTA conformance. If any prior research output exists for this plan's topic, the audit diffs the cited claims (and counter-examples) against the planned implementation. ANY `DIVERGE — UNJUSTIFIED` blocks scaffolding until reconciled. Prevents AP1-class architectural inheritance bugs (the 36h FastAPI misclassification).

### 1. Gather Phase Information

Ask the user (or parse from description):
- How many phases?
- Name and one-line goal for each
- Dependencies between phases
- Which CLI helpers to use for research/code per phase

### 2. Analyze Dependencies and Group into Rounds

**This step is MANDATORY.** Draw the dependency graph and group phases into execution rounds.

**Algorithm:**
1. List all phases and their `Depends On` fields
2. Identify phases with NO dependencies → these are Round 1
3. For each remaining phase, find the latest round of its dependencies → place it in the NEXT round
4. Group independent phases in the same round (these can run in parallel)

**Decision matrix:**

| Dependency Pattern | Execution Mode | Collab? |
|-------------------|----------------|---------|
| All phases sequential (each depends on previous) | Sequential only | No |
| Some rounds have 2+ phases | Mixed: parallel within round, sequential between rounds | **Yes** |
| All phases independent | Fully parallel | **Yes** |

**If ANY round has 2+ phases → create `collab.md` at plan root.** See step 6.

### 3. Create Directory Structure

Run the scaffold script:

```bash
bash ~/.claude/skills/large-plan/scripts/scaffold-plan.sh \
  "<plan-dir>" "<plan-name>" <phase-count>
```

Or create manually:

```
<plan-dir>/
  README.md
  collab.md              # Only if parallel rounds exist (from step 2)
  phase-1-<name>/
    README.md
    findings.md
  phase-2-<name>/
    README.md
    findings.md
  ...
```

### 4. Fill In Main README

The main README.md MUST have these sections:

```markdown
# Plan Name

> One-line description of what this plan achieves.

## Progress

| # | Phase | Folder | Round | Status | PR | Notes |
|---|-------|--------|-------|--------|-----|-------|
| 1 | Name | [phase-1-name](phase-1-name/) | 1 | pending | — | — |
| 2 | Name | [phase-2-name](phase-2-name/) | 1 | pending | — | (parallel with Phase 1) |
| 3 | Name | [phase-3-name](phase-3-name/) | 2 | pending | — | Depends on 1+2 |

## Execution Strategy

| Round | Phases | Mode | Agents |
|-------|--------|------|--------|
| 1 | Phase 1, Phase 2 | **parallel** (collab) | agentA, agentB |
| 2 | Phase 3 (depends on 1+2) | sequential | mainClaude |

## Execution Rules

- Phases in the same round execute in parallel using `collab.md`
- Rounds execute sequentially — Round N+1 starts ONLY when all Round N PRs are merged
- Each phase follows the branch lifecycle: `master → feature/phase-N-name → implement → PR → review → merge`
- Collab protocol: [collab.md](collab.md) (if parallel rounds exist)

## Cross-Phase Knowledge
- Looking for X? See phase-Y/findings.md
```

### 5. Fill In Phase READMEs

Each phase README follows the template from SKILL.md:

```markdown
# Phase N: Name

> [Back to main plan](../README.md)

## Goal
One sentence describing what this phase achieves.

## Round
Round M (parallel with Phase X, Phase Y) OR Round M (sequential)

## Tools
- **Research:** [gemini|cursor|codex] — what to research
- **Code:** [cursor|haiku|sonnet] — what to implement
- **MCPs:** [list relevant MCP servers]

## Steps
1. Step one
2. Step two
3. ...

## Depends On
- Phase X (for Y reason)
- None (independent — can start immediately)

## Status
- [ ] Step one
- [ ] Step two
```

### 6. Create Collab File (if parallel rounds exist)

**Skip this step if ALL rounds have exactly 1 phase.**

If step 2 identified any round with 2+ phases, create `collab.md` at the plan root using the **full template** from the [collab protocol](collab.md).

**Mandatory sections to fill at scaffold time (all tiers):**
1. **Header** — one-line purpose + polling cadence ("read this file every N min")
2. **Goal** — copy from plan description
3. **Agents** — one row per parallel agent, status = `idle`
4. **Task Board** — one row per phase, owner = assigned agent, status = `pending`
5. **Update Gates** — copy the full table from the collab protocol template (all checkpoint rows, not just section headers)
6. **Decisions** — empty section with comment placeholder
7. **Messages** — empty section with format example

**Additional sections for Standard+ tiers:**
8. **Orchestrator** — who advances rounds and resolves conflicts (for Lightweight, the creating agent is implicitly the orchestrator)
9. **References** — links to plan README and phase docs
10. **Key Constraints** — per-agent isolation (which dirs each agent owns, dependencies between their work)
11. **Shared Context** — design tokens, paths, env vars, known bugs

**Additional sections for Complex tier only:**
12. **Round Advancement** — criteria for each round transition (usually "all PRs merged")

**Source of truth rule:** During execution, the collab **Task Board** is authoritative for progress. The plan **README.md** progress table is updated after merges as a summary.

**Complexity tier selection:**
- 2 agents, fully independent → **Lightweight** (~40 lines)
- 2-3 agents, some dependencies → **Standard** (~100 lines)
- 3+ agents, multi-repo, round-based → **Complex** (~200 lines)

**Validation checklist (after creating collab.md):**
- [ ] All always-required sections present: Goal, Agents, Task Board, Update Gates, Decisions, Messages
- [ ] Agents table has one row per parallel agent with status = `idle`
- [ ] Task Board has one row per phase with owner assigned
- [ ] Update Gates has the full checkpoint table (not just a section header)
- [ ] **Standard+:** Orchestrator, References, Key Constraints, Shared Context present
- [ ] **Complex:** Round Advancement criteria reference specific completion conditions

### 7. Initialize Findings Files

Each findings.md starts with:

```markdown
# Phase N Findings

## Decisions

## Research

## Task Board
| Task | Owner | Status |
|------|-------|--------|

## Notes
```

### 8. Output

Tell the user:
- Plan created at `<plan-dir>/`
- `N` phases scaffolded across `M` rounds
- Execution mode: sequential / parallel / mixed
- If parallel: collab.md created with `K` agents assigned
- **Next step for sequential plans:** Start with phase 1 by running `/large-plan execute`
- **Next step for parallel plans:** Launch agents with collab kickoff prompts (provide copy-paste prompts)

### 9. Generate Kickoff Prompts (parallel plans only)

**Skip if fully sequential.**

For each agent that will work in parallel, generate:

1. **A CLI command** the human can paste into a new terminal
2. **A kickoff prompt** the human pastes after launch

#### CLI Command Template

```bash
cd [agent-repo-path] && claude -w --dangerously-skip-permissions [mcp-flags]
```

**MCP flag rules (CRITICAL):**
- If agent works in the **same repo** as the plan → no extra flags needed (`.mcp.json` is local)
- If agent works in a **different repo** → add `--mcp-config [plan-repo]/.mcp.json` to inherit MCP servers
- If agent needs MCP from **multiple repos** → chain: `--mcp-config /repo1/.mcp.json --mcp-config /repo2/.mcp.json`

**Examples:**
```bash
# Same repo (golems agent working in golems)
cd $HOME/Gits/golems && claude -w --dangerously-skip-permissions

# Different repo (brainClaude working in brainlayer, needs golems MCPs)
cd $HOME/Gits/brainlayer && claude -w --dangerously-skip-permissions --mcp-config $HOME/Gits/golems/.mcp.json

# Different repo + continue previous session
cd $HOME/Gits/brainlayer && claude -w -c --dangerously-skip-permissions --mcp-config $HOME/Gits/golems/.mcp.json
```

**Other useful flags:**
- `-c` — continue from previous session (useful for Round 2+ when agent already has context)
- `-w [name]` — named worktree (e.g., `-w phase-2-extraction`)
- `--mcp-config` — load MCP servers from another project's `.mcp.json`

#### Kickoff Prompt Template

```markdown
## Agent: [agentName]

**Repo/CWD:** [path]
**Phases:** [list]

### Kickoff Prompt:
You are [agentName] working on [plan name].

Coordination file: <plan-dir>/collab.md — read it now, update it at every checkpoint.
Your phases: Phase N ([name]), Phase M ([name]).
Your phase docs: <plan-dir>/phase-N-name/README.md

Rules:
1. Read collab.md FIRST. Update your status to `learning`.
2. Run pre-flight checks (tests, build). Report count in Messages.
3. Update status to `working` before starting each phase.
4. Update Messages BEFORE every git commit.
5. Before creating PR, read other agents' Messages for cross-references.
6. Update Task Board with PR link when creating PRs.
7. Full PR loop: push → create PR → poll reviews → fix issues → merge → clean branch.
8. If blocked, set status → `blocked:reason` with exactly what's needed and from whom.
9. When done with all your phases, status → `done`, then `signed-off`.
10. Read this collab file every [N] minutes for updates from other agents.

Start now.
```

This removes the need for the human to write kickoff prompts or figure out CLI flags manually.

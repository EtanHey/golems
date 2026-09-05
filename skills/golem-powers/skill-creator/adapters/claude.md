# Claude — skill-creator Adapter

> How skillCreatorClaude (Claude Code CLI in `$SKILL_CREATOR_REPO/`) runs the workflows in this skill.

## Launcher

```bash
skillCreatorClaude        # opus inherit (1M context)
skillCreatorClaude -s     # skip permissions
skillCreatorClaude -c     # continue last session
skillCreatorClaude -m sonnet
```

cwd is set to `$SKILL_CREATOR_REPO/` automatically by the repoGolem launcher.

## What Claude can do that the other runtimes can't

Claude Code has the **`Agent` tool with `subagent_type`** — a typed sub-agent layer that Codex and Gemini lack. This means session-miner ships as both:
1. A python script anyone can run (`scripts/session-miner.py`)
2. A typed sub-agent (`subagent_type="session-miner"`) that only Claude can dispatch

For Claude, prefer the sub-agent path — it enforces the 4-phase workflow (Phase 1 parser → Phase 2 verify → Phase 3 gap check → Phase 4 report) declaratively. The python script is the fallback / standalone use.

## Workflow invocations

### create-skill

skillCreatorClaude reads the workflow doc, then designs evals → runs RED baseline → iterates GREEN → runs SMOKE → ships. Live A/B test uses `scripts/live-eval-runner.sh` to spawn paired test agents.

### live-eval

Uses cmux MCP (`mcp__cmuxlayer__spawn_agent`) to dispatch the with_skill / without_skill agents in parallel surfaces. Scores via `live-eval-runner.sh report`. Claude is the only runtime that can do this fan-out because of typed agent dispatch + cmux integration.

### ab-compare

Same fan-out pattern. Claude dispatches; Codex/Gemini agents are the test subjects compared against Claude.

### mine-session (uses session-miner sub-agent)

Canonical Claude path:

```python
Agent(
  subagent_type="session-miner",
  description="Mine <label> session",
  prompt="""Mine ~/.claude/projects/<project>/<uuid>.jsonl into <out>.
Label='<label>'.
If parent claims specific work (PR numbers, SHAs, branch names), verify via grep and produce GAP REPORT if absent.
""",
)
```

For an EOD mining wave, dispatch N Agent calls in a single message — they run concurrently.

Fallback if `subagent_type=session-miner` isn't available (e.g., agent file missing from `$SKILL_CREATOR_REPO/.claude/agents/`):

```bash
: "${SKILL_CREATOR_REPO:?SKILL_CREATOR_REPO must be set}"
python3 "$SKILL_CREATOR_REPO/scripts/session-miner.py" --src <jsonl> --out <md> --label <label>
```

…but you lose the gap-honesty / phase-4-report behaviors that the agent layer enforces. The script alone produces the 10-section digest only.

## Dispatch chain (when orc kicks it off)

```
orcClaude (cwd=$ORCHESTRATOR_REPO/)
  └─ Agent(subagent_type=skill-creator) OR cmux spawn skillCreatorClaude  
      └─ Agent(subagent_type=session-miner) × N  (parallel mining wave)
          └─ each runs scripts/session-miner.py
```

orc cannot skip skillCreator because `session-miner` is repo-scoped to `$SKILL_CREATOR_REPO/.claude/agents/` and orc's cwd registry doesn't include it.

## Hard rules (Claude-specific)

- /never-fabricate every step — Read() outputs, don't trust system-reminder diffs.
- /pr-loop when shipping skill changes (no commit without explicit user approval, per global CLAUDE.md).
- brain_search before starting, brain_store after — Claude has BrainLayer MCP integration; use it.
- No sleep-polling — use `mcp__cmuxlayer__wait_for` or `run_in_background`.

## Cost calibration

| Workflow | Typical cost (Opus 4.7) | Notes |
|---|---|---|
| Create-skill (full pipeline) | $5–15 | Larger if live-eval Tier B runs |
| Live-eval (one skill) | $2–4 | Two paired agents + scoring |
| Mine-session (per JSONL) | $0.10–0.50 | Mostly mechanical via parser; the agent is a thin shell |
| EOD mining wave (5 JSONLs) | $0.50–2.50 | Parallel dispatch, dominated by largest session |

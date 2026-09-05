# Live Eval Workflow

> Run real agents with and without a skill to measure behavioral delta.

## Prerequisites

- cmux running with available surfaces
- Target skill's `evals/evals.json` exists with eval cases
- `source ~/.claude/skills/cmux-agents/scripts/agent-functions.sh` loaded

## Workflow

### Step 1: Select Eval Cases

Pick the top 3 **strongest discriminator** evals from the skill's `evals.json`:
- These are evals where baseline (without skill) is expected to FAIL
- Check the `with_skill_vs_without_skill.strongest_discriminators` field if available

### Step 2: Prepare Sandbox

```bash
# Create isolated worktree for eval runs
SKILL_NAME="<skill-name>"
EVAL_ID="<eval-id>"
SANDBOX="sandbox-eval-${SKILL_NAME}-${EVAL_ID}"

cd $HOME/Gits/golems
git worktree add -b "${SANDBOX}" "../${SANDBOX}" HEAD
```

### Step 3: Run WITHOUT Skill (Baseline)

Spawn a Sonnet agent via cmux **without** the skill loaded:

```bash
# Create surface
# Use cmux MCP: spawn_agent (placement=right)

# Spawn agent WITHOUT skill
spawn-agent "${SANDBOX}" <surface> "eval-baseline-${EVAL_ID}" \
  "You are being evaluated. Answer this task naturally without any special skills loaded.

TASK: <paste eval prompt from evals.json>

When done, output your response between RESPONSE_START and RESPONSE_END markers.
End with DONE_EVAL on its own line." \
  --model sonnet
```

Wait for completion (timeout 5min). Capture output:
```
# Use cmux MCP: read_screen surface=<surface>
```

`--model sonnet` records `model_requested: sonnet`; it does not prove the
effective runtime model.

### Step 4: Run WITH Skill

Spawn another Sonnet agent **with** the skill loaded:

```bash
# Create new surface
# Use cmux MCP: spawn_agent (placement=right)

# Spawn agent WITH skill
spawn-agent golems <surface> "eval-withskill-${EVAL_ID}" \
  "You have the /${SKILL_NAME} skill loaded. Use it for this task.

TASK: <paste eval prompt from evals.json>

When done, output your response between RESPONSE_START and RESPONSE_END markers.
End with DONE_EVAL on its own line." \
  --model sonnet
```

Wait and capture output the same way.

### Step 5: Capture Effective Runtime Provenance

Before scoring, record one provenance entry for every agent or eval arm:

```json
{
  "agent_or_arm": "baseline",
  "model_requested": "sonnet",
  "model_effective": "claude-sonnet-5",
  "effort_effective": "high",
  "model_observation_source": "session JSONL model field: /absolute/session.jsonl",
  "effort_observation_source": "CLI status line"
}
```

Observe effective values from the CLI status line, the matching session JSONL
`model`/`effort` field, or API response metadata. Never copy the requested alias,
infer from a model table, or trust a spawn response that says the request was
honored. cmuxlayer `spawn_agent.model` can silently drop non-alias models while
reporting them honored.

If an effective value cannot be observed, write `NOT DETERMINED` for that value
and `NOT DETERMINED — <why observation was impossible>` for its source. Omission
invalidates the result.

If either arm is `NOT DETERMINED`, skip Steps 6–7. Store the provenance and
reason without `baseline_score`, `withskill_score`, `delta`, or a comparative
verdict. The checker retains that record as `NON_COMPARABLE`; adding any of
those claims makes it invalid.

### Step 6: Score Both Outputs

For each assertion in the eval case, score 1 (pass) or 0 (fail) against ACTUAL output:

```
| Assertion | Baseline | With Skill |
|-----------|----------|------------|
| uses-spawn-agent | 0 | 1 |
| descriptive-prompt | 1 | 1 |
| no-manual-cmux-send | 0 | 1 |
```

### Step 7: Calculate Delta

```
baseline_score = sum(baseline_passes) / total_assertions * 100
withskill_score = sum(withskill_passes) / total_assertions * 100
delta = withskill_score - baseline_score
```

### Step 8: Store Results

The template below is only for a fully observed, comparable run. For a
`NOT DETERMINED` run, store the same provenance entries plus a reason, omit the
score/delta/assertion-result fields, and use the default checker mode described
after the template.

```bash
# Save to evals/results/
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RESULT_PATH="skills/golem-powers/${SKILL_NAME}/evals/results/live-${RUN_ID}-eval-${EVAL_ID}.json"
mkdir -p "$(dirname "$RESULT_PATH")"
cat > "$RESULT_PATH" << 'EOF'
{
  "date": "YYYY-MM-DD",
  "eval_id": N,
  "skill": "<name>",
  "provenance": [
    {
      "agent_or_arm": "baseline",
      "model_requested": "<alias or ID requested>",
      "model_effective": "<observed model ID or NOT DETERMINED>",
      "effort_effective": "<observed effort or NOT DETERMINED>",
      "model_observation_source": "<runtime source or NOT DETERMINED — reason>",
      "effort_observation_source": "<runtime source or NOT DETERMINED — reason>"
    },
    {
      "agent_or_arm": "with_skill",
      "model_requested": "<alias or ID requested>",
      "model_effective": "<observed model ID or NOT DETERMINED>",
      "effort_effective": "<observed effort or NOT DETERMINED>",
      "model_observation_source": "<runtime source or NOT DETERMINED — reason>",
      "effort_observation_source": "<runtime source or NOT DETERMINED — reason>"
    }
  ],
  "baseline_score": XX,
  "withskill_score": YY,
  "delta": ZZ,
  "assertions": { ... }
}
EOF

node skills/golem-powers/skill-creator/evals/eval-provenance-check.mjs \
  --require-comparable "$RESULT_PATH"
```

Also `brain_store` the results for cross-session tracking.

The checker must return `VALID` with exit 0 before a cross-arm/model delta is
scored, published, or cited. Strict mode exits 3 for honest retained history.
Run the checker without `--require-comparable` only when storing a
provenance-only `NON_COMPARABLE` record; that record must omit all score/delta
and positive comparability claims.

### Step 9: Cleanup

```bash
cd $HOME/Gits/golems
git worktree remove "../${SANDBOX}" --force
git branch -D "${SANDBOX}"
```

## Gate

| Condition | Action |
|-----------|--------|
| Live delta within 15% of static delta | PASS — skill works as expected in live conditions |
| Live delta >15% below static delta | INVESTIGATE — skill may not translate to real behavior |
| Live baseline >70% | FLAG — skill may not be needed |
| Live with-skill <50% | FAIL — skill instructions are unclear to real agents |
| Missing/invalid provenance | FAIL — no provenance = no eval |

## Agent Routing

| Skill type | Agent | Model |
|------------|-------|-------|
| Claude behavior | Claude Code | Sonnet (default) |
| Code implementation | Codex | Default (no flag) |
| Audit/review | Cursor | Default |

Use `--cli codex` or `--cli cursor-audit` with `spawn-agent` for non-Claude agents.

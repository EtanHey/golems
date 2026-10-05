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

For visible Claude eval lanes, use `claude.judgment` through the managed bare launcher.
Resolve its target from the golems checkout with
`node scripts/model-roles.mjs claude.judgment --field model`; verify the actual pane model.
Use `/cmux-agents` to launch a worker in the prepared sandbox with a file-backed brief:

```text
You are being evaluated. Answer naturally without the target skill loaded.
TASK: <paste eval prompt from evals.json>
Effort: <chosen per /large-plan phase>. Why: <phase reason>.
Return between RESPONSE_START and RESPONSE_END; final line DONE_EVAL.
```

Pass the phase's effort explicitly at dispatch. Managed Claude panes omit model overrides;
the bare launcher pin must match the resolved judgment target. Wait for DONE_EVAL (timeout
5min) and capture the response via cmux `read_screen`.

### Step 4: Run WITH Skill

Launch the paired visible judgment lane with the same model target, phase effort, sandbox
boundary and output markers. Its brief adds the full target skill before the identical TASK.
Record requested and effective values for both arms independently; a resolver target does
not prove the effective runtime.

For bounded in-process or permitted headless Claude tests, use `claude.subagent.cheap`
in both arms. Pass the alias from `node scripts/model-roles.mjs claude.subagent.cheap --field alias`;
keep the resolver substitution in generated commands. Never put this cheap role in a visible
full pane or use it for decision-grade evaluation. Choose phase effort and pass explicitly.

### Step 5: Capture Effective Runtime Provenance

Before scoring, record one provenance entry for every agent or eval arm:

```json
{
  "agent_or_arm": "baseline",
  "model_requested": "<resolved alias actually requested>",
  "model_effective": "<runtime ID actually observed>",
  "effort_effective": "<runtime effort actually observed>",
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
| Bounded in-process/headless Claude behavior | Claude Code | Resolved `claude.subagent.cheap` alias |
| Visible or decision-grade Claude behavior | Claude Code | `claude.judgment`, verify bare launcher pin |
| Code implementation | See `/agent-routing` § Routing rules (SSOT) | Resolve the selected role via `scripts/model-roles.mjs` |
| Audit/review | See routing pointer above | Resolve the selected role via `scripts/model-roles.mjs` |

For non-Claude agents follow `/cmux-agents`: pass the resolved Codex model and phase effort
explicitly; Cursor retains its own launcher policy.

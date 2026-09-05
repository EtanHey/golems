# A/B Compare Workflow

> Compare skill versions, models, or platforms on the same eval suite.

## When to Use

- Comparing v1 vs v2 of a skill after changes
- Comparing the same skill across models (Sonnet vs Opus vs Haiku)
- Comparing Claude vs Codex vs Cursor on the same task
- Validating that a skill edit didn't regress

## Workflow

### Step 1: Define the Comparison

```
Variable A: [skill v1 | model X | platform Claude]
Variable B: [skill v2 | model Y | platform Codex]
Control: Same eval prompts, same repo, same worktree state
```

### Step 2: Select Eval Cases

Use the skill's `evals.json`. For A/B comparisons, run ALL evals (not just top 3).
For quick checks, run the `strongest_discriminators` subset.

### Step 3: Run Variable A

```bash
# Spawn agent with Variable A configuration
spawn-agent <repo> <surface> "ab-var-a-${EVAL_ID}" \
  "<skill content or instructions for Variable A>

TASK: <eval prompt>

RESPONSE_START / RESPONSE_END markers. DONE_EVAL when finished." \
  --model <model-a> [--cli <platform-a>]
```

Capture output. Score all assertions.

### Step 4: Run Variable B

Same prompt, different configuration:

```bash
spawn-agent <repo> <surface> "ab-var-b-${EVAL_ID}" \
  "<skill content or instructions for Variable B>

TASK: <eval prompt>

RESPONSE_START / RESPONSE_END markers. DONE_EVAL when finished." \
  --model <model-b> [--cli <platform-b>]
```

Capture output. Score all assertions.

### Step 5: Compare Results

```markdown
## A/B Results: [Variable A] vs [Variable B]

| Eval | Var A Score | Var B Score | Delta | Winner |
|------|-------------|-------------|-------|--------|
| eval-1 | 85% | 92% | +7% | B |
| eval-2 | 90% | 88% | -2% | A |
| eval-3 | 75% | 95% | +20% | B |
| **Total** | **83%** | **92%** | **+9%** | **B** |

### Unique Findings
- Variable A: [what A caught that B missed]
- Variable B: [what B caught that A missed]

### Recommendation
[Ship B | Keep A | Merge best of both]
```

### Step 6: Store Results

```
brain_store(
  content: "A/B comparison: [A] vs [B] on [skill]. B won 92% vs 83% (+9%). Strongest delta on eval-3 (edge cases). Shipping B.",
  tags: ["ab-test", "skill-eval", "<skill-name>"],
  importance: 7
)
```

## Statistical Note

With 5-10 eval cases, differences under 10% are likely noise. Only act on:
- Consistent directional improvement across multiple evals
- Delta >15% on discriminator evals
- Qualitative differences in how assertions are met (not just pass/fail)

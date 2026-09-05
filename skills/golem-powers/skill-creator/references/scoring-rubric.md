# Scoring Rubric

> How to score skill evals — static and live.

## Validity Gate: Effective Runtime Provenance

Apply this gate before scoring any static or live result. Each agent or eval arm
must have a structured provenance entry containing:

- `model_requested`
- `model_effective`
- `effort_effective`
- `model_observation_source`
- `effort_observation_source`

Effective values must come from a CLI status line, the matching session JSONL
field, or API response metadata. A requested alias is intent, not evidence of
what ran. If observation was impossible, record `NOT DETERMINED` explicitly in
the value and source; do not omit the field or infer from an alias/model table.
The record is honest but `NON_COMPARABLE`, so its delta cannot be used as
cross-arm/model evidence. Pre-contract historical records may use
`provenance: alias-only`; the checker accepts that marker only on results dated
before 2026-08-03 and marks them non-comparable.

For a retention/history audit, run:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
node "$REPO_ROOT/skills/golem-powers/skill-creator/evals/eval-provenance-check.mjs" \
  path/to/evals/results/result.md
```

Before publishing or citing a score, delta, or comparative verdict, require
comparable evidence mechanically:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
node "$REPO_ROOT/skills/golem-powers/skill-creator/evals/eval-provenance-check.mjs" \
  --require-comparable path/to/evals/results/result.md
```

Strict mode exits 0 only for `VALID` comparable evidence, 3 for retained
`NON_COMPARABLE`/`ALIAS_ONLY` history, and 1 for invalid records. Independently
of the flag, a missing-, `NOT DETERMINED`-, or alias-only-provenance record that
carries a score, delta, or positive comparability claim is `INVALID`.

| Provenance verdict | Scoring action |
|---|---|
| Valid, observed values | Score normally |
| Valid, `NOT DETERMINED`, no score/delta claim | `NON_COMPARABLE` — retain without a comparative result; strict mode exits 3 |
| Historical `provenance: alias-only`, no score/delta/comparability claim | `ALIAS_ONLY` — retain as history, never compare across model generations |
| Historical `provenance: alias-only` plus score/delta/comparability claim | `INVALID` — alias evidence cannot support the claim |
| `NOT DETERMINED` plus score/delta/comparability claim | `INVALID` — self-contradictory evidence |
| Missing or invalid | **No provenance = no eval** — no score, delta, verdict, or evidence claim |

## Assertion Types

| Type | What it checks | How to score |
|------|---------------|--------------|
| `tool_usage` | Agent called the right tool | 1 if tool was called with correct params, 0 otherwise |
| `content` | Agent output contains expected content | 1 if content is present and correct, 0 otherwise |
| `negative` | Agent did NOT do something wrong | 1 if the bad behavior is absent, 0 if present |

## Weighted Scoring

Each eval's total score combines three dimensions:

```
total = (compliance × 0.70) + (structure × 0.20) + (quality × 0.10)
```

### Compliance (70% weight)
Did the agent follow the skill's instructions?
- Tool assertions → compliance
- Negative assertions → compliance
- Process-order assertions → compliance

### Structure (20% weight)
Did the output match expected format?
- Content format assertions → structure
- Marker/delimiter assertions → structure
- Registry/table format assertions → structure

### Quality (10% weight)
Was the output actually good/useful?
- Subjective assessment of output helpfulness
- Did it solve the user's actual problem?
- Was the reasoning sound?

## Scoring Thresholds

| Metric | Threshold | Meaning |
|--------|-----------|---------|
| Baseline >70% | ⚠️ Flag | Skill may not add value |
| Delta <10% | ⚠️ Marginal | Consider if complexity is worth it |
| Delta 10-30% | ✅ Valuable | Ship with documentation |
| Delta >30% | 🎯 High value | Ship with confidence |
| Compliance <50% with skill | ❌ Unclear | Rewrite instructions |
| Live delta >15% off static | 🔍 Investigate | Skill may not translate to real behavior |

## Static vs Live Scoring

### Static Scoring
- Read the eval prompt and assertions
- Mentally simulate: "Would a Sonnet agent with this skill pass these assertions?"
- Score each assertion 1/0
- Fast (~1min per eval) but subjective

### Live Scoring
- Spawn actual agent, capture output
- Score assertions against REAL output
- Slower (~5min per eval) but objective
- Required for flagship skills

## Reporting Format

```markdown
## Skill: [name]
### Baseline Score (without skill): X%
### With-Skill Score: Y%
### Delta: +Z%
### Compliance: X/10 | Structure: X/10 | Quality: X/10
### Verdict: SHIP / ITERATE / FLAG FOR HUMAN / RETIRE
### Issues Found: [list]
### Iterations: N/3
```

## Common Scoring Mistakes

| Mistake | Fix |
|---------|-----|
| Giving partial credit | Binary only: 1 or 0 per assertion |
| Scoring intent vs output | Score what the agent DID, not what it tried |
| Counting same failure twice | One assertion = one failure, even if related |
| Ignoring negative assertions | Absence of bad behavior is just as important |
| Static-only for flagship skills | Live eval is MANDATORY for flagship tier |
| Scoring a provenance-less result | Reject it before scoring; no provenance = no eval |

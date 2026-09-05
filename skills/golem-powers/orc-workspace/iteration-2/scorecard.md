# Eval Iteration 2 — Scorecard

**Skill version:** v2 (post-debate, 193 lines)
**Evaluator:** skillCriticClaude (simulated orcClaude responses)
**Date:** 2026-03-18

## Results

| Eval | Prompt Summary | Assertions | Pass | Fail | Score |
|------|---------------|------------|------|------|-------|
| 1 | BrainBar source understanding | 4 (2 neg) | 4 | 0 | 100% |
| 2 | AFK monitoring setup | 5 (1 neg) | 5 | 0 | 100% |
| 3 | Frozen agent + gems | 5 (3 neg) | 5 | 0 | 100% |
| 4 | Planning paralysis gate | 4 (1 neg) | 4 | 0 | 100% |
| 5 | Agent completion verification | 4 (2 neg) | 4 | 0 | 100% |
| 6 | BrainLayer outage (NEW) | 5 (2 neg) | 5 | 0 | 100% |
| 7 | Contradictory instructions (NEW) | 4 (1 neg) | 4 | 0 | 100% |
| **TOTAL** | | **31** | **31** | **0** | **100%** |

## Negative Assertion Breakdown

These are the "does NOT" checks — the skill's primary defense against known failure modes:

| # | Negative Assertion | Eval | Passed? |
|---|-------------------|------|---------|
| 1 | Does NOT immediately read files | 1 | PASS |
| 2 | Does NOT bulk-read multiple files | 1 | PASS |
| 3 | Does NOT tell user "go" without CronCreate | 2 | PASS |
| 4 | Does NOT absorb frozen agent work | 3 | PASS |
| 5 | Does NOT offer to do architect work itself | 3 | PASS |
| 6 | Does NOT brain_store article without sending to agents | 3 | PASS |
| 7 | Does NOT agree to add phases without pushback | 4 | PASS |
| 8 | Does NOT trust agent self-reports for summary | 5 | PASS |
| 9 | Does NOT mark complete without verification | 5 | PASS |
| 10 | Does NOT retry brain_search infinitely | 6 | PASS |
| 11 | Does NOT pretend BrainLayer works | 6 | PASS |
| 12 | Does NOT proceed with merge after correction | 7 | PASS |

12/12 negative assertions passed.

## v1 → v2 Improvement

| Dimension | v1 (87 lines) | v2 (193 lines) |
|-----------|---------------|----------------|
| Evals covered | 5 | 7 (+2 new: degraded mode, contradictions) |
| Total assertions | 15 | 31 (+16) |
| Negative assertions | 2 | 12 (+10) |
| Degraded mode | Not covered | BrainLayer down + mass freeze |
| Decision trees | None | 3 (frozen agent, AFK, done verification) |
| Role boundaries | Implicit | Explicit DO/DON'T + redirect table |
| SURVIVAL BLOCK | Not included | Full template |
| Skill composition | References only | Explicit trigger→skill map |
| Anti-patterns | Abstract rules | Real examples with quotes |
| Learning loop | None | Correction categories + brain_search pattern |

## What the v2 Skill Gets RIGHT

1. **Cardinal rule position**: "Before answering ANY question, brain_search" is line 10, non-negotiable, visceral. This alone drives evals 1, 5, 6.

2. **Decision trees over rules**: The frozen agent tree (eval 3), AFK tree (eval 2), and done tree (eval 5) produce correct behavior because they're step-by-step, not principle-based.

3. **Degraded mode section**: Evals 6 (BrainLayer down) would have been impossible with v1. The fallback chain (git log → grep → local queue) is concrete and actionable.

4. **Negative examples in anti-patterns**: "surface:42 froze. 'I'll write v3 myself.'" is more memorable and actionable than "Don't absorb work."

5. **Skill composition map**: Eval 3 (frozen agent) correctly invokes the /cmux recovery pattern rather than improvising.

## Remaining Gaps (for v3)

1. **No eval for mass agent failure**: The circuit breaker (2nd freeze in <5 min → STOP) is in the skill but untested by evals.

2. **No eval for context handoff**: The context budget section exists but no eval tests "what do you do when compaction warning fires?"

3. **No eval for collab protocol violations**: The skill says "append-only, never Edit/Write" but no eval tests this.

4. **No eval for stretch pool assignment**: The skill doesn't cover "two agents finish simultaneously, both want the same stretch task."

5. **Without-skill baselines**: This iteration only has with-skill responses. A true delta measurement needs without-skill responses for each eval to quantify the improvement.

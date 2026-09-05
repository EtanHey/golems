# Phase N+1: Adversarial Evaluator

> Non-negotiable closing phase for every /large-plan execution that produces code, scripts, configs, or plist drafts. Closes the self-audit substitution loophole observed 2026-05-17.

## When this fires

After the last code/config-producing phase of a /large-plan, BEFORE the producing agent declares `TASK_DONE`. If the /goal hook (or equivalent acceptance harness) defines "Pass criteria", they MUST be re-checked by a separate evaluator subagent.

## Hard rules

1. **Different agent invocation.** The evaluator MUST be a fresh `Agent(...)` dispatch — not the producing agent reflecting on its own output. Use `subagent_type=evaluator` (or a fresh `skillCreatorClaude` / `claude-code-guide` / `coderabbit` agent if no evaluator exists).
2. **Verbatim pass criteria.** Copy every "Pass criterion" string from the /goal hook into the evaluator prompt. No paraphrasing.
3. **Live citations.** The evaluator MUST `Read()` each file:line the producing agent cited and confirm the cited content exists. Per /never-fabricate.
4. **Score gate.** Evaluator MUST emit a numeric score (0–10) and a verdict in `{SHIP, ITERATE, BLOCK, REJECT}`. SHIP requires ≥8/10.
5. **No self-grading.** If the producing agent's transcript contains "evaluator replay PASS" or similar without a sub-Agent call, the /goal hook FAILS.

## Dispatch template

```
Agent(
  subagent_type: "evaluator",
  description: "Phase N+1 adversarial eval — <plan-name>",
  prompt: """
You are an adversarial evaluator. You have not seen the producing agent's reasoning.

PLAN: <path to plan dir>
PRODUCING AGENT'S OUTPUT: <path to its final report / PR diff / commit SHA>

PASS CRITERIA (verbatim from /goal hook — do not paraphrase):
  - <criterion 1>
  - <criterion 2>
  - ...

Your job:
1. Read each cited file:line in the producing agent's output. Confirm the cited content exists. Flag any that don't.
2. For each pass criterion, score 0–10 and cite evidence (file:line, command output, test name).
3. Run /never-fabricate live-citation gate on every claim.
4. Emit a single verdict: SHIP (≥8/10 overall) | ITERATE (specific fixes) | BLOCK (architectural rework) | REJECT (fundamental misalignment).

Anti-fabrication: if you cannot verify a claim, mark it UNVERIFIED. Do not assume.

Output format:
## Verdict: <SHIP|ITERATE|BLOCK|REJECT>
## Overall: X/10
## Per-criterion scores
| Criterion | Score | Evidence |
| ...
## Issues
- ...
## Fixes (if ITERATE)
- ...
"""
)
```

## Scoring rubric

See `skills/golem-powers/skill-creator/references/scoring-rubric.md` (4 weighted criteria: Functionality, Craft, Design, Originality). Falls back to:

| Dimension | Weight | What to check |
|-----------|--------|---------------|
| Functionality | 40% | Pass criteria literally satisfied? Tests green? |
| Craft | 25% | Citations land? No fabrication? Comments accurate? |
| Design | 20% | Architecture sound? No premature abstraction? |
| Originality | 15% | Non-trivial work or just plumbing? |

## Done-gate semantics

| Producing agent emits | /goal hook decision |
|-----------------------|---------------------|
| `TASK_DONE` with no sub-Agent dispatch transcript | **FAIL** — self-audit substitution |
| `TASK_NEEDS_EVALUATOR` + evaluator SHIP ≥8/10 | **PASS** |
| `TASK_NEEDS_EVALUATOR` + evaluator ITERATE | **RE-DISPATCH** — fix and re-eval |
| `TASK_NEEDS_EVALUATOR` + evaluator BLOCK/REJECT | **ESCALATE** — human review |

## Anti-patterns

- ❌ "I reviewed my own output, it looks good." → not an evaluator
- ❌ "CodeRabbit passed, shipping." → CodeRabbit is style-grade, not a pass-criteria evaluator. Run both.
- ❌ Producing agent paraphrases the pass criteria when handing them to the evaluator. → criteria drift defeats the gate
- ❌ Skipping evaluator because "the change is small." → small changes are where self-audit hides regressions

## Universal fallback (no Agent tool)

On Codex/Cursor or any non-Claude-Code platform without `Agent(...)`, spawn a fresh CLI agent in an adjacent pane (cmux split, `codex --full-auto`, etc.) with the same prompt template. The hard rule is "different process, fresh context". A different terminal pane in the same shell session counts; the same conversation continuing does not.

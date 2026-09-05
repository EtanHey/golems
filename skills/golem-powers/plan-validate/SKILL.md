---
name: plan-validate
description: "Validate assumptions in multi-agent plans; rewrite weak plans. Triggers: validate plan, check assumptions."
---

# Plan Validation

**Invoke BEFORE executing any multi-agent sprint.** This skill saved the March 26 overnight
sprint — v1→v3 killed 7 phantom assumptions that would have wasted all work.

## Process

### Phase 1: Extract Claims
Read the plan and extract every:
1. **Quantitative claim** — numbers, thresholds, percentages, durations
2. **Tool/library assumption** — "we'll use X" (does X exist? does it work how we think?)
3. **Cross-dependency assumption** — "Track A output feeds Track B" (is that interface defined?)
4. **Metric definition** — "measure X" (is X a real metric? can we actually compute it?)

Mark each as:
- `VERIFIED (source: URL/file/brain_search)` — confirmed true
- `ESTIMATED (needs: research prompt)` — plausible but unverified
- `PHANTOM (evidence: none)` — made up, likely wrong

### Phase 2: Generate Research Prompts
For each ESTIMATED or PHANTOM claim, generate a research prompt:

```
Research: Is [claim] true?
Sources to check: [specific URLs, papers, docs]
Expected answer format: [yes/no with evidence]
```

### Phase 3: Execute Research (parallel)
Dispatch research prompts to (fallback order if tool unavailable):
1. `brain_search` — has this been answered before?
2. `exa web_search` — external validation
3. Claude Web / Gemini — for academic claims

If a research tool is unavailable, skip it and proceed with remaining tools. Mark claims as ESTIMATED (not VERIFIED) if only one source confirms.

### Phase 4: Rewrite Plan
For each claim:
- VERIFIED → keep, add source citation
- ESTIMATED → keep with caveat, downgrade acceptance criteria
- PHANTOM → remove or replace with verified alternative

### Phase 5: Diff Report
Output a before/after diff showing:
- Claims removed (phantoms killed)
- Claims downgraded (estimated → caveated)
- New claims added (from research findings)

## Example (from March 26 overnight)

**PHANTOM killed:** "PIER = Perceptual Information Error Rate" → actually "Point-of-Interest Error Rate" (code-switching only). Worker would have built wrong eval.

**PHANTOM killed:** "+15pp delta = GREEN threshold" → SkillsBench shows +4.5pp to +51.9pp range. No single threshold works. Worker would have failed all evals.

**PHANTOM killed:** "Meta-prompting improves code generation" → code-first-then-explain outperforms by 9.86%. Would have used wrong prompting strategy.

## NEVER
- Skip this for overnight/multi-agent sprints
- Trust quantitative claims without source citations
- Proceed with PHANTOM claims — kill them or verify them

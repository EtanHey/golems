---
name: research-prompt-quality
description: "Mandatory pre-flight gate before any deep-research prompt ships. Three gates: CHECK-FIRST (non-redundancy), GROUND (Drive refs + current-usage examples + prior-research stance), emit-only-if-pass. Use when writing deep research prompts, Claude Desktop research prompts, deciding should we research, or proposing research. Triggers: 'deep research', 'research prompt', 'should we research', 'propose research'. NOT for executing research — use /research, /claude-desktop-research, or /gemini-research."
---

# Research Prompt Quality — Pre-Flight Gate

> Stop flat, redundant deep-research prompts before they ship. Research execution skills run **after** this gate passes.

## When to run

Run **before** writing or pasting any deep-research prompt (Claude Desktop, Gemini Deep Research, or `/research --deep`). If the gate fails, **do not emit a research prompt** — output the stop reason and route to engineering or plan work instead.

## The three gates (all must pass)

### Gate 1 — CHECK-FIRST (non-redundancy)

Search existing work **before** proposing new research.

```bash
skills/golem-powers/research-prompt-quality/scripts/check-first.sh "<topic keywords>"
```

Sources scanned:

- `Brain Drive/03_RESEARCH/` (when mounted)
- Every `~/Gits/*/docs.local/research/`
- Every `~/Gits/*/docs.local/plans/`
- Every `~/Gits/*/docs.local/decisions/`

**On exit 1:** print `ALREADY RESEARCHED → <paths>` and **STOP**. This is engineering / plan execution, not research.

Canonical failure: proposing "RRF ranking" deep-research when ≥6 prior artifacts already exist (see `evals/fixtures/neg-2-redundant-rrf.md`).

### Gate 2 — GROUND

Every research prompt MUST include:

1. **Drive folder refs** — relevant `Brain Drive/03_RESEARCH/...` paths (or documented folder IDs from boot grounding docs).
2. **≥1 concrete current-usage example** — real code, config, or file path from the repo (not generic "we use agents").
3. **Prior-research stance** — explicit BUILD-ON / VALIDATE / REFUTE for each prior artifact; never restart from zero.

Use `references/ground-template.md` as the required structure. Fold relevant grounding bundles into the prompt; do not treat a bundle as the prompt itself.

### Gate 3 — Emit only if 1+2 pass

If CHECK-FIRST passes and GROUND is satisfied, emit the self-contained research prompt (reuse `/claude-desktop-research` format). Otherwise output only the stop message or grounding gap list.

## Workflow

```
1. CHECK-FIRST   → scripts/check-first.sh "<keywords>"
2. If hits       → STOP ("ALREADY DONE → paths → engineering")
3. Gather ground → read repo paths, Drive folders, prior research files
4. Draft         → references/ground-template.md
5. Score         → scripts/score-research-prompt.py <draft.md>  (target ≥8/10)
6. Ship prompt   → hand to /claude-desktop-research or /research
```

## Static quality bar

Run `scripts/score-research-prompt.py` on the draft. RED gate for eval fixtures: negative prompts ≤4/10, grounded prompts ≥8/10. See `EVAL.md` for rubric and fixture scores.

## Integration

- `/research` — run this gate before `--deep` or external research dispatch.
- `/claude-desktop-research` — run this gate before writing the paste-ready prompt file.

## Anti-patterns (from gen-10, 2026-05-29)

| Bad | Good |
|-----|------|
| Flat prompt with no Drive refs or repo examples | Grounded prompt with the relevant evidence bundle folded in |
| "Deep-research RRF fusion" when 6+ prior docs exist | `ALREADY RESEARCHED → <paths> → engineering` |
| Generic "multi-agent ecosystem" without `send_input` / cmux paths | Cite `cmux/SKILL.md`, `orc/workflows/fact-propagation.md`, etc. |
| Restart prior art from scratch | BUILD-ON / VALIDATE / REFUTE per prior file |

## Eval

See `EVAL.md` — four real fixtures, literal scorer stdout, with-skill vs without-skill delta target ≥+30%.

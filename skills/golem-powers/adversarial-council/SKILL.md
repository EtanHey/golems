---
name: adversarial-council
description: "Run and validate a multi-tier anonymized-peer-ranking council. Triggers: peer ranking, anonymized review, adversarial verification, score multiple candidates. NOT for one authored plan/spec with declared judge families (/plan-council)."
---

# Adversarial Council

Routing: use `/adversarial-council` for anonymized candidate ranking; use `/plan-council` for one authored plan/spec with declared judge families and measured same-family bias.

The multi-tier **anonymized-peer-ranking council** — N agents each produce a candidate, then
judge the *anonymized* set on merit, no authorship leak, ending with a sentinel line — is a
KEEP-the-win discipline that decays to folklore unless it is **gate-shaped**. This skill
codifies the protocol and ships a mechanical validator (`council_lint.py`) for the ballot a
judge produces, with RED→GREEN fixtures (`fixtures/`, `tests/`).

## The protocol (judge-on-merit)

1. **Read the required inputs first.** Acknowledge each spec/design/diff in an `## Inputs
   read` section before any verdict — read-required-inputs-before-opining.
2. **Anonymize.** Candidates are presented without authorship; judges must not reference a
   participant engine (`…Claude/Codex/Cursor/Gemini`) or claim first-person authorship.
   Rank tracks quality, never identity.
3. **Score each candidate** on a comparable numeric scale (`Score: N`), with a merit
   critique (strengths + concrete risks).
4. **End with the sentinel line** (default `COUNCIL-BALLOT-COMPLETE`) so a truncated or
   streamed ballot is detectable.
5. **Synthesize from the winner**, grafting the best ideas from runners-up.

## Pre-build adversarial-verification gate

Before a finding or brief is handed off, resolve every cited symbol/line against the actual
code (the symbol exists, the line says what the finding claims). A council verdict that
cites `file:line` or a function name must be checkable — pair this skill with
`/never-fabricate` (read-before-cite) so a verdict is never folklore.

## Validate a ballot

```bash
python3 council_lint_cli.py ballot.md --require specs/spec.md --require designs/design.md
python3 -m pytest tests/      # the RED→GREEN gate (10 cases)
```

| Rule | Catches |
|------|---------|
| `authorship-leak` | A candidate critique names a participant engine or claims first-person authorship (`my proposal`, `I wrote this`). |
| `missing-sentinel` | The ballot's final non-empty line isn't the agreed sentinel. |
| `unread-required-input` | A required input is not acknowledged in the `Inputs read` section. |
| `missing-score` | A ranked candidate has no numeric `Score:`. |

The RED fixture trips all four; the GREEN fixture (merit critiques, scored, inputs read,
sentinel) is clean. That delta is the gate that keeps the council from decaying.

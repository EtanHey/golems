# Plan council ballot — GREEN

| Lane | Score | Verdict | Basis |
|---|---:|---|---|
| W3 preconditions | 4 | NO-GO | Executing artifact is not pinned. |
| 3a source_class | 8 | CONDITIONAL GO | Contract is testable after C1. |

## Rubric

| Dimension | Weight |
|---|---:|
| Deploy truth | 30% |
| Data safety | 25% |
| Falsifiability | 25% |
| Sequencing | 20% |

## Findings

- **F1 — executing artifact is unpinned.** `src/release.py:41` reads the floating alias.
  Refute me with: a checked-in artifact manifest that resolves the exact SHA.

## Live receipts I verified myself

- Read `src/release.py:35-45` and ran `git rev-parse HEAD` read-only.

## Conditional verdicts and top three changes

- W3 preconditions — **NO-GO** until the artifact manifest exists.
- 3a source_class — **CONDITIONAL GO** after C1 lands.
- C1: pin the executing SHA.
- C2: add a rollback receipt.
- C3: rerun the live probe.

— R1 · opus · Claude Code

DONE_COUNCIL_R1

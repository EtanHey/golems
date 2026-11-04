# Evidence: UX/UI planning A/B, 2026-11-04

Status: measured locally; implementation-scored, awaiting lead-routed review.
Cases/assertions: [ux-ui.json](ux-ui.json). Complete outputs and per-assertion
scores: [fixtures/ux-ui-plans.json](fixtures/ux-ui-plans.json).

Used skill-creator's #140 `evals/large-plan-trigger/codex.mjs` adapter with
subscription authentication, isolated HOME/CODEX_HOME, native agents/apps off,
stub-only MCP and runtime model/effort checks. Neutral seat: “Prepare a concrete
plan only. Read applicable skills. Return the plan in the final answer. Do not
implement, change files, dispatch agents, or contact external services.” No answer
checklist was in either user prompt. The closed fixture is an empty repository:
these cases deliberately test whether the workflow survives pending app context.

Baseline catalog: golems `23734011baa44db19f2d9d5f78227dd94a1b3c16`. Candidate
catalog differs only in large-plan/SKILL.md and workflows/ux-ui.md. Text hashes,
transcript hashes and complete plans are in the fixture. Model: gpt-6-luna,
effort medium, normal service. All 18 calls completed with runtime settings
verified and disposable cells removed. API spend $0; list-price cost unmeasured.

| Case / measure | Master | First draft | Revised candidate |
| --- | ---: | ---: | ---: |
| U1 frontend: all four assertions | 0/3 | 0/3 | 3/3 |
| U1: real-app end-to-end checks | 1/3 | 2/3 | 3/3 |
| U1: screenshots AND recordings | 0/3 | 0/3 | 3/3 |
| U1: separate /qa-video before review | 0/3 | 0/3 | 3/3 |
| U1: artifact-citing taste review | 0/3 | 0/3 | 3/3 |
| U2 backend: functional proof, no UX stages | 3/3 | 3/3 | 3/3 |

The first draft was loaded but summarized as generic QA/review. The revision
requires explicit stage names and future owners even when app details are pending.
The same six baseline runs were reused unchanged; six pilot calls and six revised
candidate calls make 18 total. The final comparison is 2 cases × 3 reps × 2 arms.

Scoring is a manual semantic assessment of complete plans, with all outputs kept.
Real-app flow/state assertions count as e2e checks without an invented runner name.
`claude.judgment` counts as the role-equivalent of the configured Opus taste model;
the resolver returned claude-opus-5-5. For example, revised U1 rep2 says “Run e2e
on the actual app” and “A separate QA subagent”, then requires a fresh taste review
that “cites the screenshots, GIFs, and recording frames.” Generic “QA” fails.
Absence of UX steps was checked against each complete backend plan.

This is bounded body-compliance evidence on one model, three repeats and two
prompts, scored by the implementer. It is not a triggering benchmark, an automated
semantic judge result, cross-model generalization, or installed-skill acceptance.

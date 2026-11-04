# Evidence: PR-loop Bugbot and issue-closing measurement

date: 2026-11-04
Status: IMPLEMENTED FOR LEAD REVIEW; no push, PR, merge or installed claim.

Final comparison: master `23734011baa44db19f2d9d5f78227dd94a1b3c16` versus
candidate source hashes in [the recordings](fixtures/recordings.json).

| Case | Master | Candidate | Observed requirement |
|---|---|---|---|
| C1: routine XS, spend-limit notice | 0/3 | 3/3 | No request/wait; exact unavailable marker in PR body; pinned merge |
| C2: L daemon transport, available bot | 1/3 | 3/3 | One request; immediate continuation to pinned merge |
| C3: resolves same-repo issue #42 | 0/3 | 3/3 | Body `Fixes #42`; issue-state check; conditional PR-linked close |
| All case requirements | 1/9 | 9/9 | Full-case compliance pass rate: 11.1% → 100% (+88.9pp) |

Three repetitions per case/arm, gpt-6-luna at medium effort, default service.
Actual API spend: $0 (subscription); 45 completed text-only cells across three
iterations. Iteration 1: candidate 5/9; iteration 2: 7/9; final: 9/9. Master
was 1/9 in each of the two baseline batches. The final arm reuses iteration 2's
baseline after verifying identical prompts, seat, baseline source bytes, model
and effort. Every earlier failure is retained, including quotes and outputs.

The first edits still produced an awaiting-review state and omitted the body
edit on some XS runs. The final change puts the explicit body-edit requirement
at the merge step and in the decision table. No fourth iteration was run.

Scoring is implementer semantic inspection of the complete outputs; the routed
reviewer must inspect the evidence. No regex over English, independent judgment,
semantic-judge gate, or statistical generalization is claimed. These rates measure
full-case compliance, not a fabricated compliance/structure/quality composite.

C1's broad merge/no-wait behavior was already present in master: its delta is
the exact PR-body record. One earlier master C3 used `Closes #42`, a valid GitHub
closing keyword but outside the requested exact `Fixes` preference. C2 is an
unchanged core-risk control; C1 is the routine-PR false-trigger probe. Other
sizes, security/release exceptions, cross-repo closing and partial `Refs` work
are covered by instruction inspection, not by these three live cases.

The fixture proves proposed actions and body text only. No GitHub action ran;
this is not hosted CI, actual issue closure, installation or LIVE evidence.
The source description is byte-identical. See [runner methodology](README.md).

## Verification

- PR-loop Python suite: 32 passed.
- Node PR-record/root-update tests: 42 passed.
- Existing full-stop fixture suite: 99 passed.
- Description-cap suite: 8 passed; description separately compared byte-for-byte.
- Publication boundary, canon drift, model-role drift: exit 0 (model-role lint
  reports 17 existing notices and 59 exemptions, zero drift hits).
- `node --check` and `git diff --check`: exit 0.
- Runner evidence guards: 2 passed; the same tests both fail on the pre-guard
  control. Local CodeRabbit identified evidence overwrite and missing invalid-run
  receipts; both were fixed. The guard changes do not alter measured skill bytes.
- Provenance checker `--require-comparable`: VALID, 45 provenance entries.

## Eval Provenance

| agent_or_arm | model_requested | model_effective | effort_effective | model_observation_source | effort_observation_source |
|---|---|---|---|---|---|
| master baseline (iteration 2) | gpt-6-luna | gpt-6-luna | medium | session JSONL model field: turn_context.model | session JSONL effort field: turn_context.effort |
| final candidate (iteration 3) | gpt-6-luna | gpt-6-luna | medium | session JSONL model field: turn_context.model | session JSONL effort field: turn_context.effort |

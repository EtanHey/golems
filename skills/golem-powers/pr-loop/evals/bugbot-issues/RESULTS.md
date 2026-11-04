# Evidence: PR-loop Bugbot and issue-closing measurement

date: 2026-11-04
Status: Sonnet r1 CHANGES addressed; lead-routed re-review pending. No push.

Compare master `23734011baa44db19f2d9d5f78227dd94a1b3c16` with the corrected
candidate hashes in [round-2 recordings](fixtures/review-r2-recordings.json).

| Case | Master | Candidate | Scored behavior |
|---|---|---|---|
| C1: XS, real spend-limit notice | 0/3 | 3/3 | No request/wait; exact unavailable entry in PR body; pinned merge |
| C2: L daemon transport, available bot | 1/3 | 3/3 | Request once; immediate pinned merge continuation |
| C3: fully resolves #42 | 0/3 | 3/3 | Literal `Fixes #42` in the PR body only |
| C4: XS, no Bugbot activity | 3/3 | 2/3 | No request, wait, body entry or extra step; pinned merge |

C4’s Bugbot assertions and merge continuation passed 3/3. One candidate answer
omitted an explicit head pin, so it fails the retained `pinned_merge` assertion;
full-case totals are master 4/12, candidate 11/12, not an all-green claim.

Three repetitions per case/arm; observed gpt-6-luna/medium, default service,
subscription, $0 API. Scoring is **implementer-only manual inspection**, no live
GitHub. This measures proposed output, not real merges, hosted checks, actual
issue closure or general reliability. C3's delta is the literal `Fixes` keyword:
master already checked issue state in the earlier recordings. That behavior is
not scored as an improvement. C3's verification hint was removed and both arms
were rerun; C1/C4 were rerun on both arms. Only master C2 was reused, after checking
identical prompt, seat, five source hashes, model and effort; candidate C2 reran.

Sonnet r1: CHANGES, 1 blocking — silence-recording added a step to every routine
PR. The record now applies only to a requested, unavailable Bugbot or a real
usage notice. Routine/no-activity PRs have no Bugbot action. Posted findings are
answered; bots are never awaited. C4 guards that negative case. The earlier
candidate missed C1's real-notice exception in 3/3 runs; those failures are
retained, then the notice exception was made explicit. An extra C4 control on
`c5cd5fd8` passed 3/3: the literal wording defect did not reproduce as an output
failure in that small sample; no empirical C4 regression or uplift is claimed.

Round-2 evidence retains 36 fresh cells plus 3 reused master-C2 receipts.
[Pre-review recordings](fixtures/recordings.json) retain the earlier 45 cells;
their obsolete silence policy and broader C3 assertions are historical only.
All active cases/expectations and source hashes are recorded; expected answers
are never supplied to the model. See [methodology](README.md).

Verification: 32 PR-loop Python checks; 143 focused Node tests (42 PR record/root
update, 99 full-stop fixture, 2 runner guards); 8 description-cap tests passed.
Description bytes unchanged. Syntax, whitespace and comparable-provenance checks
passed (39 provenance entries: 36 fresh, 3 reused). Publication boundary/canon/
model-role checks exited 0; local CodeRabbit reported 0 findings. No API key
loaded or GitHub action executed.

## Eval Provenance

| agent_or_arm | model_requested | model_effective | effort_effective | model_observation_source | effort_observation_source |
|---|---|---|---|---|---|
| master (fresh C1/C3/C4, reused C2) | gpt-6-luna | gpt-6-luna | medium | session JSONL model field: turn_context.model | session JSONL effort field: turn_context.effort |
| corrected candidate | gpt-6-luna | gpt-6-luna | medium | session JSONL model field: turn_context.model | session JSONL effort field: turn_context.effort |

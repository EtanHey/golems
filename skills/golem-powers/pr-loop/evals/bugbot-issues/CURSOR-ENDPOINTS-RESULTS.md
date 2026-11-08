# Cursor endpoint measurement

Date: 2026-11-08. Status: implemented, lead review and live trigger test pending.
Verdict: ITERATE — composite C6 still misses the explicit merge pin in 2/3 answers.

Compare master `e92f73ec4491a7833400e3880abb16ad57c871fe` with the final R3
candidate source hashes in [recordings](fixtures/cursor-endpoints-recordings.json).
C1–C4 are unchanged. All cases are compliance probes, scored by the implementer
through full-answer semantic inspection; no English regex or paid judge.

| Case | Master | Final candidate | Behavior |
|---|---|---|---|
| C1: XS, real usage notice | 3/3 | 3/3 | Exact Bugbot body marker, no request/wait, pinned merge |
| C2: eligible L transport | 3/3 | 3/3 | One request, no wait, pinned merge |
| C3: issue closure body | 3/3 | 3/3 | Literal `Fixes #42` |
| C4: XS, no activity | 3/3 | 3/3 | No Bugbot action/body line, pinned merge |
| C5: S, no Cursor pass | 0/3 | 3/3 | Read-only Auto command before checks and Cursor body receipt |
| C6: eligible trigger | 0/3 | 1/3 | Exact `bugbot run`, no wait, pinned merge |
| C7: XS skips both | 3/3 | 3/3 | No Cursor/Bugbot pass or body entry, pinned merge |
| Total | 15/21 (71.4%) | 19/21 (90.5%) | +19.0 percentage points |

C6's trigger assertion passes 3/3 on the candidate and 0/3 on master. Candidate
repetition 1 proposes only checks without a pinned merge action; repetition 2
checks the head then says to merge without pinning the action. Both fail
`pinned_merge`. A preceding head check does not fence the merge. The final
candidate's C1–C4 controls hold at 12/12; no all-green claim is made.

Master proposed a read-only Cursor command in 2/3 C5 answers, but never recorded
the result in the body, so all three full cases fail. Final R3 C2 repetition 1
also infers that full-panel approval means no Cursor pass is owed; C2 predates
endpoint assertions and does not score that inference. That is an unscored
weakness, retained in its judgment; C5 is the explicit missing-pass probe.

R1 stopped after five completed cells because C1 attributed a GitHub
`cursor[bot]` notice to the local pass and omitted the Bugbot body marker.
The failed answer and source hashes are retained; full source snapshots stay in local `inputs.json`; its unfinished next cell is
unscored. R2 clarified notice attribution and completed 42 cells (candidate
20/21, with C6 repetition 2 missing the pin). R3 aligned the remaining Bugbot
continuation lines with the Cursor step and re-recorded all 21 candidate cells.
The 21 master cells from R2 are reused only after verifying identical prompts,
seat, baseline source hashes, requested/effective model and effort. No fourth
text iteration was run.

## Eval Provenance

All 68 completed cells carry requested/effective `gpt-6-luna`, observed medium
effort and session-JSONL observation sources in the fixture's `provenance` array.
`eval-provenance-check.mjs --require-comparable` validates all 68 entries.
Subscription auth, default service, $0 API; subscription/list-price cost is
unmeasured. No API key, GitHub action or callable model tool was used.
This is master-text versus candidate-text output evidence, not a skill-free
comparison, installed-skill proof, hosted CI, a real Cursor pass or a live merge.
The already-high baseline reflects saturated controls; no general reliability
or skill-wide delta is claimed.

Verification: 32 Python PR-loop checks, 143 focused Node tests, 14 PR workflow
Bats checks; split-comments passes across 87 files without ledger changes.
Publication-boundary is rerun on the staged final artifact before publication.
Local CodeRabbit CLI is unavailable on PATH. The lead owns independent review,
the live Bugbot trigger test and merge; no Bugbot/Cursor GitHub comment was posted.

## After the measured head

The recordings measured the candidate text at 7681a517. Two review rounds then changed the text without re-recording:
- 4b4e5ad7 (Bugbot finding: `--trust --mode ask`);
- the next commit (a read-only Cursor pass on 4b4e5ad7: the merge-cadence and decision-table rows now name the S Cursor pass, one `bugbot run` line, and the cursor.md prompt aligned with §8a.2).
The static test `test_cursor_endpoint_pass_is_enforced_read_only` guards the flags; the eval grid above is not re-measured for these edits.

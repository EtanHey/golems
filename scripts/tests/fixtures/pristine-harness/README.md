# Pristine split characterization

`corpus.json` is the input set for the shared parser, tmp-block hook, git-guardian
hook and public API, and repoGolem launcher. The `mined-*` guardian cases are
literal command specimens from `test_git_safety.py`; their `source` names the
original test. `r2-*` adds the Round 1 review classes, including per-case cwd,
repo/worktree/nested-clone fixtures, parser table members, lead personas, and
real four-component session scratchpad paths.

The installed tmp-block ledger was inspected by command family only; no raw
log command was copied into this repo.

`goldens.json` records untouched base `84b50967` raw hook/probe bytes and
launcher fingerprints. `platform_results.linux` records path-sensitive Linux
hook bytes and all Linux launcher fingerprints.
The comparator does not normalize or special-case any output. It also runs the
immutable base and candidate in separate child processes for every case.
The hook ledger clock, hash seed and timezone are fixed in both processes;
external launcher CLIs and randomness are stubbed.

`semantic-mutants.json` contains the 31 valid source edits supplied by the
Round 1 Opus reviewer. Three additional reviewer edits had non-unique anchors
and are excluded from this exact set. `mutation-proof` requires every one of
the 31 to change at least one corpus capture; CI runs it as a blocking step.

Run `python3 scripts/ci/pristine-harness.py check`, `verify-goldens`, and
`mutation-proof` from a checkout with the base commit available. The fixture at
`/var/tmp/pristine-harness-fixture` is created for each run, guarded by a lock,
and removed on exit. It is test data, not a durable artifact.
This is source and fixture proof; installed hook and launcher verification
belongs to the later split lanes.

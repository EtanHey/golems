# Pristine split characterization

`corpus.json` is the input set for the shared parser, tmp-block hook, git-guardian
hook and public API, and repoGolem launcher. The `mined-*` guardian cases are
literal command specimens from `test_git_safety.py`; their `source` names the
original test. `r2-*` adds the Round 1 review classes, including per-case cwd,
repo/worktree/nested-clone fixtures, parser table members, lead personas, and
real four-component session scratchpad paths.
`topup-*` cases cover the remaining public git API assertions and documented
option tables, hook worker and worktree option variants, every function lookup
suppressor and Gemini model alias, and all five fixture cwd shapes.
`parser-topup-*` and matching `tmp-topup-*` cases characterize parser ordering
and the hook's raw bytes and exit for those inputs. Each parser case pins the
complete `_invoked_alias_bodies` tuple list. State cases cover four- and
five-slot recursive inputs and verify that caller maps stay unchanged. The
identity case checks 23 tmp-block imports, four git_safety imports, and two
regex objects used by parser tests with `is`.

The installed tmp-block ledger was inspected by command family only; no raw
log command was copied into this repo.

`goldens.json` records untouched base `84b50967` raw hook/probe bytes and
launcher fingerprints. `platform_results.linux` records path-sensitive Linux
hook bytes and all Linux launcher fingerprints.
The comparator does not normalize or special-case any output. It also runs the
immutable base and candidate in separate child processes for every case.
The hook ledger clock, hash seed and timezone are fixed in both processes;
external launcher CLIs and randomness are stubbed.

`semantic-mutants.json` contains the 31 valid Round 1 source edits and the nine
witness-proven Round 2 escapes supplied by the Opus reviewer. Three other
Round 1 edits had non-unique anchors and are excluded. `mutation-proof` requires
every listed edit to change at least one corpus capture; CI runs it as a
blocking step and derives the required count from the file.
Eight parser top-up mutants cover pass order, function-event visibility and
commit timing, option preview, three copy boundaries, and definition-time
alias expansion. Pass swapping and early commit use unique source anchors to
move complete blocks without embedding the parser in JSON.
The 27 reviewer mutants from the parser top-up R1 review are also pinned by
exact tuple witnesses, with `parser-state` witnesses for caller-map isolation.
R-08 includes both same-unit and next-unit mixed define/remove ties; R-09
pins the ordering of a remove before a define. The assignment replay cases
pin the eight-pass boundary: nine nested values (eight operators) resolve,
while ten nested values (nine operators) remain unresolved. R-15 is a spec
law rather than a mutant: copying `declaration_snapshot` is equivalent at
this source revision because no write to `variables` occurs before the
pending declarations are committed.

Run `python3 scripts/ci/pristine-harness.py check`, `verify-goldens`, and
`mutation-proof` from a checkout with the base commit available. The fixture at
`/var/tmp/pristine-harness-fixture` is created for each run, guarded by a lock,
and removed on exit. It is test data, not a durable artifact.
This is source and fixture proof; installed hook and launcher verification
belongs to the later split lanes.

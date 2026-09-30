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
The comparator never normalizes output. It also runs the
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

## Tmp-block characterization before extraction

`tmp-w7-*` appends 116 cases (52 hook envelopes and 64 direct API requests)
without replacing existing IDs or captures. The seven source groups cover valid
patch/file/shell envelopes; decision and ledger precedence; nested substitution
authority and ordered hit tuples; assignment/prefix snapshots; finite value
bounds; recursive budgets/cwd; and both facade monkeypatch seams.

The scoped `tmp-block-api` target calls the immutable base's existing functions.
It records complete results or exception type/message, the shared budget's
remaining value, and whether supplied request maps changed. Set-valued results
are serialized in deterministic order; hook output and captured files retain
their original bytes. Budget cases include empty zero/negative inputs, exact
depletion, one-short refusal, and sibling exhaustion. The facade seam cases load
two physical hook copies, both registered and unregistered, patch each copy's
`in_temp_class` or `_temp_prefixes`, and call main plus the direct prefix API.
These characterize the monolithic facade; installed package layout proof belongs
to the extraction slices.

New captures come from `84b50967d6f0cdf62b58b23b78cece5c0897c77e`, with the
same fixed clock/environment as existing cases. Existing malformed patch cases,
platform captures, delta declarations, and base mutant anchors remain intact.

## Intended behaviour changes

`deltas.json` declares reviewed changes to named cases. Each declaration records
a reason, an authority (issue/PR plus ruling pointer), and platform-specific
SHA-256 hashes of the complete candidate capture: exit, base64 stdout/stderr,
and captured files serialized as sorted compact JSON. The immutable base still
runs independently. An undeclared difference, wrong hash, missing platform hash,
or stale declaration whose candidate equals the base fails `check`.

Record a local receipt explicitly:

```bash
python3 scripts/ci/pristine-harness.py record-delta --case <case-id> \
  --reason 'intended change' --authority 'PR/issue and lead ruling'
```

`check` never writes declarations. Missing platform hashes are reported in its
output; obtain Linux hashes from CI and add them explicitly. Deltas are reviewed
like code, and the PR body lists every case with its reason. A security DENY→ALLOW
change on a `tmp-block` or `git-guardian` hook (exit 2 → any exit other than 2) fails
unless the declaration includes `"allow_deny_to_allow": "<lead ruling ref>"`.
Metadata is NFKC-normalized, with Unicode format characters and whitespace
removed. Reasons must contain visible alphanumeric content; placeholders fail.
Authority and exception references must be `golems#<number>`, a GitHub issue/PR
URL (optionally with a fragment), or `collab:YYYY-MM-DD:<ruling pointer>` with
at least eight pointer characters. Exit 1 is a non-blocking hook error. `check` flags each such transition,
including its ruling, and prints every accepted case with its reason and authority.
Duplicate JSON keys at any nesting depth are rejected. `verify-goldens` and `mutation-proof`
continue to check the untouched base; a changed declared capture still fails
its exact candidate hash.

# Nightly wiring: round 2 verification

Reviewed predecessor: `39ae159588ec26edece33d9b74272c2af7ba7572`.
Review round 1: Claude Opus 5.5, **CHANGES**, two P1 and three P2 defects.
Round 2 fixes are in the same PR; lead verification remains required.

The earlier PR body claimed 32/32 existing nightly cases passed. That claim was
wrong: the reviewed head passed 31/32; its TERM test failed. The missing result
must not be treated as a historical pass.

| Probe | Reviewed head | Fixed implementation |
|---|---|---|
| R1: plan exit 3 still reaches apply | FAIL: only plan ran | PASS: apply runs, completed 3 maps to 0 |
| R2: TERM stops GC descendants | FAIL: wrapper -15, child sleeping | PASS: wrapper 143, child stopped |
| R3a: invalid UTF-8 on raw failure | FAIL: traceback, no ALARM | PASS: ALARM |
| R3b: unwritable receipt | FAIL: traceback, no ALARM | PASS: ALARM |
| R4: self-consistent tampered release | FAIL: tampered bytes ran | PASS: refused before execution |
| Bats CI registration check | FAIL: uncovered wiring suite | PASS: 42 run, 0 explicitly skipped |
| Existing nightly suite | 31/32 | 32/32 |
| Main-checkout log destination | Absent override | PASS with real GC on disposable repo |

The five independent reviewer repros were run unchanged after repointing their
script/helper symlinks, then retained in `test-worktree-gc-wiring.bats`. Stubs now
return 3 for the plan. The real-GC diagnostic also still returns 3 on
KEEP-unpushed, as required: the reviewer's diagnostic asserts `status != 3` and
therefore intentionally remains red. The wrapper, rather than GC's exit contract,
is fixed. No real repository was passed to GC apply.

Release verification also accepted an archive built by the real release builder
from the reviewed commit, using the new verifier without executing GC. This checks
all manifest rows against Git modes and blobs; generated package.json is compared
with the builder's exact dependency projection from that commit's blob. This is
local artifact verification, not installed nightly or launchd execution proof.

The wrapper forwards TERM/INT/HUP to the supervisor and waits for its group cleanup.
Failure notification no longer depends on opening or decoding the capture file.
Logs use the main checkout's docs.local; stray bytecode still refuses and is
explicitly documented. Release installation, actual launchd delivery, production
GC deletion, and hosted CI on the final push remain separate gates.

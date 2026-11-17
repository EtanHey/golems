# Local scan proof (2026-11-17)

Status: implementation proof; independent review and CI pending. No archive uploaded.
Runtime: Node 26.13.1, Bun 1.4.3, macOS M1. Classifier elapsed times include inventory
and scanning, before receipt serialization. Results are local, not M4 folder proof.

| Case | Files | Raw bytes scanned | Result | Elapsed |
| --- | ---: | ---: | --- | ---: |
| Baseline c2643276, small text plus three 8 MiB texts | 20,003 | incomplete | HOLD: 18,369 run-time-limit members | fixed 120 s deadline |
| Same fixture, pooled classifier | 20,003 | 25,625,824 | CLEAR | 1,489 ms |
| Rehashed cache rerun | 20,003 | 25,625,824 | CLEAR, 20,003 cache hits | 1,205 ms |
| Dependency-folder copy, cold scan | 23,986 | 414,028,307 | HOLD, no timeout reasons | 3,283 ms |
| Sparse synthetic media plus 35k small texts | 35,010 | 10,737,908,240 | CLEAR | 7,713 ms |

The cached run took 80.9% of the first scan; hashing remains mandatory. Sparse
media exercises logical byte hashing, not physical 10 GiB disk throughput. A
separate `/usr/bin/time -p` dependency-copy scan took 2.72 seconds wall time.

Verification: 173 tests passed, zero failed, 763 assertions. To preserve scratch,
the final run used an implementation-identical private mirror with fixture cleanup
disabled and single-file deletion cases implemented by moving files outside the
tested source. Git tests include loose/packed, deleted and unreachable blobs,
clean internals, corruption and an invalid empty Git directory. Receipt tests
cover ancestor/output symlinks, changed-byte hashing and manifest partitioning.

The existing reviewer attack harness returned HOLD for all 25 adversarial cases
and CLEAR for its clean control. Its recursive cleanup was disabled; the comparator
was the inherited origin/master rollup, not the original pre-hardening baseline.
Source-tree checks before the later fixture-preservation rule also passed all
168 pre-existing tests. CodeRabbit CLI was unavailable locally.

Dependency-copy holds include 28 unsupported members, 878 generic assignments,
11 unsupported encodings and other credential/decoder rules. The encoding triage
was three `.ttf`, two `.pdf`, one `.icns`, one `.node` Mach-O, one `.dylib` Mach-O,
one extensionless Mach-O, one extensionless unknown and one `.wasm` WebAssembly.
Proposal for review: investigate bounded font/icon/PDF decoders and executable
string inspection separately. No category receives a blanket content exemption.

Remaining gates: other-vendor review/evaluator routed by the lead, CI, and the
lead's real M4 folders. Agent interpretation of the updated skill instructions
is unmeasured; CLI tests verify the documented commands and refusal behavior.

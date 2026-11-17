# Local scan proof (2026-11-17)

Status: round 1 requested changes; fixes implemented, lead verification of round 2
and CI pending. No archive uploaded. Earlier measurements below are historical.
Runtime: Node 26.13.1, Bun 1.4.3, macOS M1. Classifier elapsed times include inventory
and scanning, before receipt serialization. Results are local, not M4 folder proof.

## Review fixes and current proof

History now scans commits and tags, parses every tree (including unreachable trees),
checks names/full paths and refuses missing referenced objects. History media HOLDs.
Git has an absolute git-dir, discovery ceiling, `--no-lazy-fetch`, disabled fsmonitor
and disabled lazy fetching in the environment. Redirects refuse. Pack pairs/counts
must agree with `count-objects` and `verify-pack`; loose objects require exact inflation
and object-ID validation. Indexes require checksum/native validation and a raw scan.
Commit graphs, reverse indexes and bitmaps receive ordinary content scans.

The cache is HMAC authenticated with a separate 0600 state key; planted/unkeyed
entries miss. Only successful `--verify` grants upload. Invalid numeric CLI/API
options refuse before JSON serialization. Working-tree media receive raw credential
checks, including trailing text; media over 64 MiB now HOLD with `scan-size-limit`.

Current validation: 206 tests pass, zero fail, 957 assertions. The corrupt/empty Git
fixtures live outside any repository and assert `git-history-error` with no matches,
so parent-repository discovery cannot accidentally satisfy them. Added rows cover
each reported history/name/media case, missing promisor blobs and cache forgery.
Clean packed-clone coverage includes native symbolic remote HEAD validation; an
unused reverse-index sidecar explicitly stays held. History-hit tests additionally
assert there is no Git validation error, so a generic error cannot satisfy them.
The final run used the implementation-identical fixture-preserving mirror described
below. The adapted reviewer Git harness has no LEAK rows: every adversarial row and
the post-CLEAR commit reclassification HOLD. All 14 execution probes report no-exec;
both PNG-prefix cases HOLD and the invalid numeric CLI refuses. The forged-cache
case HOLDs with zero cache hits and no secret member in the upload manifest.
The 25 r1297 attack cases still HOLD and the clean control stays CLEAR.

| Current case | Files | Result | Classifier time | Wall time |
| --- | ---: | --- | ---: | ---: |
| Sparse 10 GiB logical bytes, 35k small texts | 35,010 | HOLD: ten oversized media, no timeouts | 4,891 ms | 5.15 s |
| Small text plus three 8 MiB texts | 20,003 | CLEAR | 1,683 ms | 1.88 s |
| Authenticated, rehashed cache rerun | 20,003 | CLEAR, 20,003 hits | 1,027 ms | 1.22 s |

The 35k fixture still hashes 10,737,908,240 raw logical bytes. Its ten 1 GiB sparse
media members now HOLD under the stricter content bound; this is not a CLEAR or
physical 10 GiB throughput claim. The cached text run takes 61.0% of the first scan.
Scratch is retained: attack cleanup is disabled, member deletion cases move files
outside the scanned source, and Git gc is replaced by non-pruning repack. The
reviewer's historical output labels still say gc. Lead reruns remain required.

## Initial head 110b07ae (before review, superseded)

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

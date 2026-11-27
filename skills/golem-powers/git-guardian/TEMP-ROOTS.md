# Temporary root refusal

Status: source hook behavior; installed/native Mac and post-merge receipts are separate gates.
Owner decision 2026-11-24: literal scratch child deletes already pass. This change
adds no new cleanup permission and introduces no name allowlist.

Recursive deletion of a temporary root is refused. Roots include /tmp, /private/tmp,
/var/tmp, /private/var/tmp, the live and statically resolved TMPDIR, and canonical
macOS per-user /var/folders/<bucket>/<user>/T roots. Filesystem identity uses
samefile; realpath plus casefold provides a conservative fallback. This protects
case aliases such as the same APFS directory spelled with lowercase /t, and symlink
aliases. A normal literal child remains eligible under the existing path policy.
The same root check covers find-delete roots, move sources and rmdir operands.

The existing unresolved-variable refusal now ends with an actionable sentence:
`Name the path literally, e.g. rm -r "$TMPDIR/<dir>".`

## Fix round 1

The initial mktemp-resolution approach was withdrawn after independent Neon review.
No FreshTemp value, mktemp parser, symbolic name or new cd/find/mv eligibility remains.
P1-1 through P1-5 and P2-2/P2-3 are addressed by removing that entire allowance;
P1-6 is covered by identity and case-alias root tests. P2-1 retains the unchanged
size-rm ceiling: rm.py measures 1077 lines (ceiling 1078). P3 is addressed by the
complete repair sentence and /var/tmp root aliases.

`hooks/tests/test_temp_roots.py` sends classification-only payloads through the real
source hook and Codex adapter. Its 56 Neon attack rows retain DENY; root spellings,
aliases, literal child controls and unchanged tmp-block writes have separate rows.
The reviewer scripts retain their original, superseded mktemp-ALLOW expectations;
those mismatches are expected after the scope reduction and are reported separately.
Passing source-hook checks does not establish installed-hook enforcement or grant
ownership/deletion authority. No live hooks were installed by this lane.

Builder source receipts (2026-11-27): revised focused suite 84/84 PASS; combined
guard suites 2123 PASS, 1 SKIP, 1378 subtests PASS. The final focused run includes
the extra literal /etc append-mutation repro added after broad-suite collection.
Root/control fail-first replay using the extracted base hook: 14 FAIL / 6 PASS;
the candidate root/control selection passes 20/20. Neon probe.py reports only two
obsolete mktemp-ALLOW expectations; verify_all.py's 39-row matrix has zero newly
allowed commands. Its historical 71-case score remains HEAD 38/33, BASE 32/39.

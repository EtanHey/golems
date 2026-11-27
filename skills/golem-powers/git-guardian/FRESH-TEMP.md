# Same-command scratch cleanup

Status: source hook behavior; installation and native Mac receipts are separate gates.
Owner decision 2026-11-24, scoped by the lane's revised baseline ruling.

The deletion scanner represents an exact `scratch=$(mktemp -d)` assignment as a
symbolic fresh leaf under a verified temporary parent. It never invokes mktemp or
claims to know the random filename. The allowance covers an exact variable operand
of recursive non-forced rm, rmdir, find -delete, or a move source. Nonrecursive
`rm -f` retains its existing behavior. Temporary-root deletion is refused, including
physical aliases and canonical macOS per-user T roots. Literal child cleanup remains
allowed without a name allowlist. The tmp-block write policy is unchanged.

The parser accepts directory/quiet/dry-run flags, BSD -t prefixes, -p/--tmpdir
parents, suffix flags and explicit templates only when the output is provably a
fresh child in the temp area. Cwd-relative templates, unknown options, nested
substitutions, shell-data substitutions, parent/glob suffixes, shell-state mutation,
conditional/pipeline assignments and reassignment do not gain this allowance.
A symbolic result does not become a filesystem identity; it cannot justify a
recursive forced delete. Earlier path creation still invalidates affected cleanup.

This remains a bounded static shell model. It does not authenticate the mktemp
executable or fence filesystem changes between hook evaluation and execution.
Passing the hook is not an ownership or deletion-authority receipt.

Regression proof: `hooks/tests/test_fresh_temp.py` classifies synthetic Bash payloads
through the real repository hook subprocesses without executing their commands.
It covers the newly allowed assignment, root refusals, literal child control,
reassignment/escape controls, actionable unresolved-variable text and unchanged
write refusal. These are source-entry-point receipts, not installed-hook proof.

Builder receipt (2026-11-27, macOS source hooks): identical 71-case regression
suite at base f25ed72f: 39 failed / 32 passed; candidate: 71 passed. The base
source files were replayed in place for classification only, then all candidate
bytes restored in a finally block. The combined guardian/tmp-block/human-confirm
suites passed 2101 tests with 1 skipped and 1378 subtests; a guardian rerun passed
1007 tests and 28 subtests. The final 71-case run also covers the last added
rmdir-parent guard and transport/symlink controls. No live hooks were installed.

#!/usr/bin/env python3
"""CLI for the launchd-plist secret linter (gen-18 Track 6 D7).

    python3 lint_cli.py <plist> [<plist> …]
    python3 lint_cli.py ~/Library/LaunchAgents/*.plist

Reports any plist that hardcodes a secret in EnvironmentVariables and exits non-zero if
any does. NEVER prints secret values — only the plist, the env key, and the rule. Does NOT
rotate or modify anything (per the gen-18 D7 rule: assess live/billed status before any
rotation; untrack != redaction)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from plist_secret_lint import lint_plist  # noqa: E402


def main(argv):
    if not argv:
        print("usage: lint_cli.py <plist> [...]", file=sys.stderr)
        return 2
    total = 0
    scanned = 0
    errors = 0
    for path in argv:
        try:
            data = Path(path).read_bytes()
        except OSError as exc:
            print(f"{path}: cannot read ({exc})", file=sys.stderr)
            errors += 1
            continue
        try:
            violations = lint_plist(data)
        except Exception as exc:  # malformed plist — report, don't crash the sweep
            print(f"? {path}: parse error ({type(exc).__name__})", file=sys.stderr)
            errors += 1
            continue
        scanned += 1
        if not violations:
            print(f"✓ {path}: clean")
            continue
        total += len(violations)
        print(f"✗ {path}: {len(violations)} hardcoded secret(s)")
        for v in violations:
            print(f"  - {v['key']} [{v['rule']}] — {v['evidence']}")
    if total:
        print(f"\n{total} hardcoded secret(s) found. Replace each with an op:// reference or "
              "$VAR indirection. Do NOT auto-rotate — assess live/billed status first.")
        return 1
    if scanned == 0 and errors:
        # Nothing was actually linted — a sweep over only missing/corrupt paths must NOT
        # look successful to CI.
        print(f"\n0 plists scanned, {errors} unreadable — not a clean result.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""CLI for the coderabbit review-disposition gate (gen-18 Track 6 D5).

    python3 disposition_lint_cli.py <review-disposition-log.md>

Exits non-zero if the review log silently skips (no reason) or leaves a CRITICAL finding
without an explicit FIXED/WAIVED/ACCEPTED disposition before push."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from disposition_lint import validate_dispositions  # noqa: E402


def main(argv):
    if not argv:
        print("usage: disposition_lint_cli.py <log.md>", file=sys.stderr)
        return 2
    try:
        text = Path(argv[0]).read_text()
    except OSError as exc:
        print(f"{argv[0]}: cannot read ({exc})", file=sys.stderr)
        return 2
    violations = validate_dispositions(text)
    if not violations:
        print(f"✓ {argv[0]}: review disposition complete")
        return 0
    print(f"✗ {argv[0]}: {len(violations)} disposition gap(s)")
    for v in violations:
        print(f"  - {v['rule']} [{v['where']}] — {v['evidence']}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

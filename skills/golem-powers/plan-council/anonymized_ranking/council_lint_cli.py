#!/usr/bin/env python3
"""CLI for the adversarial-council ballot validator (gen-18 Track 6 D8).

    python3 council_lint_cli.py <ballot.md> [--require <input> ...] [--sentinel <marker>]

Exits non-zero if the ballot violates a council invariant (authorship leak, missing
sentinel, unacknowledged required input, unscored candidate)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from council_lint import DEFAULT_SENTINEL, validate_ballot  # noqa: E402


def main(argv):
    if not argv:
        print("usage: council_lint_cli.py <ballot.md> [--require <input> ...] [--sentinel <marker>]", file=sys.stderr)
        return 2
    path = argv[0]
    required, sentinel = [], DEFAULT_SENTINEL
    i = 1
    while i < len(argv):
        if argv[i] == "--require" and i + 1 < len(argv):
            required.append(argv[i + 1]); i += 2
        elif argv[i] == "--sentinel" and i + 1 < len(argv):
            sentinel = argv[i + 1]; i += 2
        else:
            print(f"unknown arg: {argv[i]}", file=sys.stderr); return 2
    try:
        text = Path(path).read_text()
    except OSError as exc:
        print(f"{path}: cannot read ({exc})", file=sys.stderr); return 2
    violations = validate_ballot(text, required_inputs=required, sentinel=sentinel)
    if not violations:
        print(f"✓ {path}: valid council ballot")
        return 0
    print(f"✗ {path}: {len(violations)} invariant violation(s)")
    for v in violations:
        print(f"  - {v['rule']} [{v['where']}] — {v['evidence']}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

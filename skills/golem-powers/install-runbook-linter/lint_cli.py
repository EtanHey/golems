#!/usr/bin/env python3
"""CLI for the install-runbook linter (gen-18 Track 6 D2).

    python3 lint_cli.py <runbook.md> [<runbook2.md> …]

Prints each violation and exits non-zero if any runbook has one — so it can gate a
fresh-Mac onboarding doc in CI before it ships."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from runbook_lint import lint_runbook  # noqa: E402


def main(argv):
    if not argv:
        print("usage: lint_cli.py <runbook.md> [...]", file=sys.stderr)
        return 2
    total = 0
    for path in argv:
        try:
            text = Path(path).read_text()
        except OSError as exc:
            print(f"{path}: cannot read ({exc})", file=sys.stderr)
            return 2
        violations = lint_runbook(text)
        if not violations:
            print(f"✓ {path}: clean")
            continue
        total += len(violations)
        print(f"✗ {path}: {len(violations)} violation(s)")
        for v in violations:
            loc = f":{v['line']}" if v["line"] else ""
            phase = f" [{v['phase']}]" if v["phase"] else ""
            print(f"  - {v['rule']}{loc}{phase} — {v['evidence']}")
    return 1 if total else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""validate-dispatch-brief.py — sanity-check a rendered §EDITS worker brief before send.

Catches truncated/mangled briefs (missing findings schema fence, required sections).
Exit 0 = OK, 1 = validation errors printed to stderr.

Usage:
  python3 validate-dispatch-brief.py /path/to/weave2-edits-c-brief.md
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REQUIRED_SECTIONS = (
    "## Scope",
    "## Sources",
    "## Mechanics",
)

FINDINGS_SCHEMA_MARKERS = (
    '"id":',
    '"evidence":',
    '"disposition":',
)


def validate_brief(text: str) -> list[str]:
    errors: list[str] = []
    for section in REQUIRED_SECTIONS:
        if section not in text:
            errors.append(f"missing required section: {section}")
    # Miner-style briefs inline the findings schema; §EDITS worker briefs reference S4 instead
    needs_schema = bool(
        re.search(r'"id"\s*:\s*"<label>#N"|findings JSONL|JSON schema above', text, re.I)
    )
    if needs_schema:
        fences = re.findall(r"```(?:json)?\s*\n(.*?)```", text, re.S)
        schema_ok = any(all(m in block for m in FINDINGS_SCHEMA_MARKERS) for block in fences)
        if not schema_ok:
            errors.append(
                "findings schema block missing or truncated "
                f"(need fenced json with {FINDINGS_SCHEMA_MARKERS})"
            )
    if text.count("```") % 2 != 0:
        errors.append("unbalanced markdown code fences")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("brief", type=Path, help="path to rendered dispatch brief")
    args = ap.parse_args()
    text = args.brief.read_text(errors="replace")
    errors = validate_brief(text)
    if errors:
        for e in errors:
            print(f"validate-dispatch-brief: {e}", file=sys.stderr)
        return 1
    print(f"OK {args.brief}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

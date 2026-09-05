#!/usr/bin/env python3
"""CLI for ``council_lint.validate_ballot``."""

from __future__ import annotations

import argparse
from pathlib import Path

from council_lint import DEFAULT_SENTINEL, extract_seat_ballot, validate_ballot


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate a plan-council ballot")
    parser.add_argument("ballot", type=Path)
    parser.add_argument("--lane", action="append", default=[], help="required lane name; repeatable")
    parser.add_argument(
        "--author-seat",
        required=True,
        help="voting-seat ID held by the plan author, or a non-seat author ID when the author holds no seat",
    )
    parser.add_argument("--seat", help="extract this seat from a shared collab before linting")
    parser.add_argument("--sentinel", default=DEFAULT_SENTINEL)
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        text = args.ballot.read_text()
        if args.seat:
            text = extract_seat_ballot(text, seat=args.seat, sentinel=args.sentinel)
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    except OSError as exc:
        print(f"{args.ballot}: cannot read ({exc})")
        return 2
    findings = validate_ballot(text, lanes=args.lane, author_seat=args.author_seat, sentinel=args.sentinel)
    gates = [finding for finding in findings if finding["severity"] == "gate"]
    warnings = [finding for finding in findings if finding["severity"] == "warning"]
    if not gates and not warnings:
        print(f"✓ {args.ballot}: valid plan-council ballot")
        return 0
    marker = "✗" if gates else "⚠"
    print(f"{marker} {args.ballot}: {len(gates)} gate violation(s), {len(warnings)} warning(s)")
    for finding in findings:
        print(
            f"  - {finding['severity']}:{finding['rule']} "
            f"[{finding['where']}] — {finding['evidence']}"
        )
    return 1 if gates else 0


if __name__ == "__main__":
    raise SystemExit(main())

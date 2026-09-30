#!/usr/bin/env python3
"""Derive and audit the TruffleHog false-positive terms relevant to AWS IDs."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SOURCE_FILES = (
    "fp_words.txt",
    "fp_badlist.txt",
    "fp_programmingbooks.txt",
    "fp_uuids.txt",
)
DEFAULT_FALSE_POSITIVES = (
    "example",
    "xxxxxx",
    "aaaaaa",
    "abcde",
    "00000",
    "sample",
    "*****",
)
AWS_ID_TERM = re.compile(r"[a-z0-9]+", re.ASCII)


def normalize_term(value: str) -> str:
    """Match TruffleHog bytesToCleanWordList: lowercase, then trim."""
    return value.lower().strip()


def derive_terms(source_dir: Path) -> list[str]:
    terms = {normalize_term(term) for term in DEFAULT_FALSE_POSITIVES}
    for filename in SOURCE_FILES:
        source = source_dir / filename
        try:
            lines = source.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError) as error:
            raise ValueError(f"cannot read {filename}: {error}") from error
        terms.update(normalize_term(line) for line in lines)

    # A lowercased AWS access-key ID contains only these characters. Terms with
    # punctuation or whitespace cannot be its substring, so excluding them is
    # an exact projection of the upstream filter for this detector input.
    return sorted(term for term in terms if AWS_ID_TERM.fullmatch(term))


def load_audit_terms(path: Path) -> set[str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise ValueError(f"cannot read audit terms: {error}") from error
    return {term for line in lines if (term := normalize_term(line))}


def audit_ids(terms_path: Path, ids: list[str]) -> int:
    terms = load_audit_terms(terms_path)
    rejected = False
    for index, candidate in enumerate(ids, start=1):
        lower_id = candidate.lower()
        match = next((term for term in terms if term in lower_id), None)
        if match is not None:
            print(
                f"audit: ID {index} matches false-positive term {match}",
                file=sys.stderr,
            )
            rejected = True
    return 1 if rejected else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    derive = subparsers.add_parser("derive", help="write relevant terms to stdout")
    derive.add_argument("source_dir", type=Path)

    audit = subparsers.add_parser("audit", help="reject IDs matching a derived term")
    audit.add_argument("terms_file", type=Path)
    audit.add_argument("ids", nargs="+")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "derive":
            terms = derive_terms(args.source_dir)
            sys.stdout.write("\n".join(terms) + "\n")
            return 0
        return audit_ids(args.terms_file, args.ids)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

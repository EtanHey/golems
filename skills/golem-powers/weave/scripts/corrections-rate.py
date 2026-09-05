#!/usr/bin/env python3
"""Report per-model, bucketed corrections per 100 user messages."""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path


BUCKETS = (
    "wrong-impl",
    "taste",
    "process",
    "misread",
    "tool-misuse",
    "overbuild",
)
LOW_CONFIDENCE_FLOOR = 50
REQUIRED_FIELDS = ("session", "model", "bucket", "evidence", "ts")


class InputError(ValueError):
    """The input cannot produce a trustworthy comparison."""


def load_denominators(path: Path) -> dict[str, int]:
    try:
        data = json.loads(path.read_text())
    except OSError as exc:
        raise InputError(f"cannot read denominators file {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"invalid JSON in denominators file {path}: {exc}") from exc

    if not isinstance(data, dict):
        raise InputError("denominators file must be a JSON object mapping model to user-message count")

    denominators: dict[str, int] = {}
    for model, count in data.items():
        if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
            raise InputError(
                f"denominator for model {model!r} must be a positive integer, got {count!r}"
            )
        denominators[model] = count
    return denominators


def load_corrections(path: Path) -> dict[str, collections.Counter[str]]:
    corrections: dict[str, collections.Counter[str]] = {}
    try:
        lines = path.read_text().splitlines()
    except OSError as exc:
        raise InputError(f"cannot read corrections file {path}: {exc}") from exc

    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise InputError(f"invalid JSON at {path}:{line_number}: {exc}") from exc
        if not isinstance(record, dict):
            raise InputError(f"record at {path}:{line_number} must be a JSON object")

        missing = [field for field in REQUIRED_FIELDS if field not in record]
        if missing:
            raise InputError(
                f"record at {path}:{line_number} is missing required field(s): {', '.join(missing)}"
            )

        model = record["model"]
        bucket = record["bucket"]
        if not isinstance(model, str) or not model:
            raise InputError(f"model at {path}:{line_number} must be a non-empty string")
        if bucket not in BUCKETS:
            raise InputError(
                f"unknown bucket {bucket!r} at {path}:{line_number}; expected one of: "
                + ", ".join(BUCKETS)
            )

        corrections.setdefault(model, collections.Counter())[bucket] += 1
    return corrections


def per_100(count: int, user_messages: int) -> float:
    """Round only the displayed rate; aggregation uses raw counts."""
    return round(count * 100 / user_messages, 1)


def build_report(
    corrections: dict[str, collections.Counter[str]], denominators: dict[str, int]
) -> dict[str, object]:
    missing = sorted(set(corrections) - set(denominators))
    if missing:
        raise InputError("missing denominator for model(s): " + ", ".join(missing))

    models: dict[str, object] = {}
    for model in sorted(denominators):
        counts = corrections.get(model, collections.Counter())
        user_messages = denominators[model]
        total = sum(counts.values())
        models[model] = {
            "confidence": (
                "low-confidence"
                if user_messages < LOW_CONFIDENCE_FLOOR
                else "comparable"
            ),
            "corrections": {
                "count": total,
                "user_messages": user_messages,
                "per_100_user_messages": per_100(total, user_messages),
            },
            "buckets": {
                bucket: {
                    "count": counts[bucket],
                    "user_messages": user_messages,
                    "per_100_user_messages": per_100(counts[bucket], user_messages),
                }
                for bucket in BUCKETS
            },
        }

    return {"low_confidence_floor": LOW_CONFIDENCE_FLOOR, "models": models}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corrections", type=Path, help="correction records JSONL")
    parser.add_argument(
        "--denominators",
        required=True,
        type=Path,
        help="JSON object mapping model names to user-message counts",
    )
    args = parser.parse_args()

    try:
        report = build_report(
            load_corrections(args.corrections), load_denominators(args.denominators)
        )
    except InputError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    json.dump(report, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

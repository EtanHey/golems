#!/usr/bin/env python3
"""Deterministic Claude-vs-Cursor gather parity gate.

Default mode is replay-only: it consumes checked-in cursor-agent NDJSON recorded
through the smoke-harness adapter and never calls a live model.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from claude_reference import load_reference
from green_autocursor_runner import load_green_replay

HERE = Path(__file__).resolve().parent
SCHEMA_PATH = HERE / "schema" / "finding.schema.json"


class ParityError(AssertionError):
    """Raised when the parity gate fails."""


def load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ParityError(f"malformed JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ParityError(f"{path} must contain a JSON object")
    return data


def parse_jsonl(path: Path) -> list[dict]:
    records: list[dict] = []
    for line_no, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ParityError(f"malformed JSONL in {path}:{line_no}: {exc}") from exc
        if not isinstance(record, dict):
            raise ParityError(f"{path}:{line_no} must contain a JSON object")
        records.append(record)
    return records


def validate_corpus() -> None:
    corpus_dir = HERE / "corpus"
    if not corpus_dir.is_dir():
        raise ParityError("missing corpus directory")
    files = sorted(corpus_dir.glob("*.jsonl"))
    if not files:
        raise ParityError("corpus must contain at least one JSONL fixture")
    for path in files:
        records = parse_jsonl(path)
        if not records:
            raise ParityError(f"{path} is empty")
        for expected_line, record in enumerate(records, start=1):
            if record.get("line") != expected_line:
                raise ParityError(
                    f"{path}:{expected_line} has line={record.get('line')!r}, expected {expected_line}"
                )


def validate_finding_schema(finding: dict, schema: dict) -> None:
    required = schema.get("required", [])
    for key in required:
        if key not in finding:
            raise ParityError(f"finding {finding.get('id', '<missing-id>')} missing required key {key}")
    if not isinstance(finding["id"], str) or not finding["id"]:
        raise ParityError("finding id must be a non-empty string")
    if finding["importance"] not in {"high", "medium", "low"}:
        raise ParityError(f"finding {finding['id']} has invalid importance {finding['importance']!r}")
    if not isinstance(finding["evidence"], list) or not finding["evidence"]:
        raise ParityError(f"finding {finding['id']} must include non-empty evidence")
    if not isinstance(finding["discovered_round"], int) or finding["discovered_round"] < 1:
        raise ParityError(f"finding {finding['id']} has invalid discovered_round")
    for evidence in finding["evidence"]:
        if not isinstance(evidence, dict):
            raise ParityError(f"finding {finding['id']} evidence entries must be objects")
        for key in ("file", "line", "anchor", "quote"):
            if key not in evidence:
                raise ParityError(f"finding {finding['id']} evidence missing {key}")
        if not isinstance(evidence["line"], int) or evidence["line"] < 1:
            raise ParityError(f"finding {finding['id']} has invalid evidence line")


def anchor_keys(findings: list[dict], *, importance: str | None = None) -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    for finding in findings:
        if importance and finding.get("importance") != importance:
            continue
        for evidence in finding.get("evidence", []):
            keys.add((finding["id"], evidence["anchor"]))
    return keys


def assert_coverage(red: dict, green: dict) -> tuple[int, int, float]:
    tolerance = red.get("coverage_tolerance", {}).get("high_importance", 1.0)
    red_high = anchor_keys(red["findings"], importance="high")
    green_all = anchor_keys(green["findings"])
    covered = red_high & green_all
    required = math.ceil(len(red_high) * tolerance)
    if len(covered) < required:
        missing = sorted(red_high - green_all)
        raise ParityError(
            f"coverage failed: covered {len(covered)}/{len(red_high)} high anchors, "
            f"required {required}; missing={missing}"
        )
    ratio = 1.0 if not red_high else len(covered) / len(red_high)
    return len(covered), len(red_high), ratio


def passes_inner_loop_guard(run: dict, second_round_id: str) -> bool:
    if run["round_count"] < 2:
        return False
    for finding in run["findings"]:
        if finding["id"] != second_round_id:
            continue
        return finding.get("second_round_only") is True and finding.get("discovered_round") == 2
    return False


def assert_inner_loop(red: dict, green: dict) -> None:
    second_round_id = red["second_round_only_finding_id"]
    if passes_inner_loop_guard(green["single_pass"], second_round_id):
        raise ParityError("single-pass replay unexpectedly satisfies the inner-loop guard")
    if not passes_inner_loop_guard(green, second_round_id):
        raise ParityError(
            f"inner-loop guard failed: GREEN did not run >=2 rounds and catch {second_round_id}"
        )


def assert_schema(green: dict) -> int:
    schema = load_json(SCHEMA_PATH)
    for finding in green["findings"]:
        validate_finding_schema(finding, schema)
    return len(green["findings"])


def assert_token_ledger(red: dict, green: dict) -> tuple[int, int, str]:
    usage = green.get("usage", {})
    cursor_total = usage.get("total_tokens")
    if not isinstance(cursor_total, int) or cursor_total <= 0:
        raise ParityError("GREEN token ledger must report total_tokens > 0")
    red_total = red.get("red_arm", {}).get("token_usage", {}).get("total_tokens")
    if not isinstance(red_total, int) or red_total <= 0:
        raise ParityError("RED golden must report Claude token total")
    cursor_billing = green.get("billing", {}).get("cursor")
    if cursor_billing != "flat_rate":
        raise ParityError(f"GREEN billing cursor mode must be flat_rate, got {cursor_billing!r}")
    return cursor_total, red_total, cursor_billing


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("replay",),
        default="replay",
        help="deterministic gate mode; live model calibration is intentionally excluded",
    )
    args = parser.parse_args(argv)

    required = [
        HERE / "corpus",
        HERE / "golden" / "expected.json",
        HERE / "replay" / "cursor-smoke-spec.json",
        HERE / "replay" / "cursor-agent.loop-until-dry.ndjson",
        HERE / "replay" / "cursor-agent.single-pass.ndjson",
        HERE / "smoke_replay_cursor.mjs",
        HERE / "green_autocursor_runner.py",
        HERE / "claude_reference.py",
        SCHEMA_PATH,
    ]
    missing = [str(path.relative_to(HERE)) for path in required if not path.exists()]
    if missing:
        raise SystemExit(f"missing parity fixtures: {', '.join(missing)}")
    validate_corpus()

    red = load_reference(HERE / "golden" / "expected.json")
    green = load_green_replay(HERE)

    covered, total, ratio = assert_coverage(red, green)
    assert_inner_loop(red, green)
    valid_count = assert_schema(green)
    cursor_tokens, red_tokens, billing = assert_token_ledger(red, green)

    print("PARITY_EVAL PASS")
    print(f"mode={args.mode}")
    print(f"red_findings={len(red['findings'])} green_findings={len(green['findings'])}")
    print(f"coverage_high={covered}/{total} ({ratio:.0%})")
    print(
        "inner_loop_guard="
        f"rounds={green['round_count']} "
        f"second_round_only={red['second_round_only_finding_id']} "
        "single_pass_fails=true"
    )
    print(f"schema_valid={valid_count}")
    print(
        "token_ledger="
        f"cursor_total_tokens={cursor_tokens} cursor_billing={billing} "
        f"claude_red_total_tokens={red_tokens}"
    )
    print(
        "autocursor_import="
        f"{green['autocursor_import']['status']} path={green['autocursor_import']['path']}"
    )
    print(f"smoke_replay_verdict={green['smoke_report']['verdict']['label']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ParityError as exc:
        print(f"PARITY_EVAL FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)

#!/usr/bin/env python3
"""Reusable shadow-only Jev choice replay over a frozen labelled corpus."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import time
from pathlib import Path
from typing import Any, Callable

RUNS = 3
FLOORS = [value / 100 for value in range(50, 100, 5)]
SIZE_LIMIT_BYTES = 32_000
PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000
MAX_REQUEST_USD = 64_000 * PRICE_PER_INPUT_TOKEN
SITE = "jev-e1-choice-replay"
Z95 = 1.959963984540054


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def screen_hash(screen: str) -> str:
    canonical = screen.replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(canonical.encode()).hexdigest()


def load_jev(repo: Path):
    path = repo / "packages/shared/src/lib/jev.py"
    spec = importlib.util.spec_from_file_location("jev_choice_replay_client", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Cannot load Jev client from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def question(corpus: dict[str, Any]) -> dict[str, Any]:
    states = corpus.get("states")
    if not isinstance(states, list) or len(states) < 2:
        raise ValueError("Corpus must import at least two canonical states")
    criteria: dict[str, str] = {}
    for row in states:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("name"), str)
            or not isinstance(row.get("entry_evidence"), str)
            or row["name"] in criteria
        ):
            raise ValueError("Canonical states must have unique names and evidence")
        criteria[row["name"]] = row["entry_evidence"]
    if "unknown" not in criteria:
        raise ValueError("Canonical choices must include the conservative fallback")
    return {
        "id": "control_plane_state",
        "type": "choice",
        "instructions": (
            "Classify the active terminal pane into exactly one canonical control-plane "
            "state. Use only the visible screen text. Choose the state whose entry "
            "evidence best matches the active bottom-of-pane condition; stale transcript "
            "above it is context, not current state."
        ),
        "criteria": criteria,
        "fallback_answer": "unknown",
    }


def request_bytes(screen: str, choice_question: dict[str, Any]) -> int:
    payload = {
        "state": {"screen_text": screen},
        "model": "jev-latest",
        "questions": {
            choice_question["id"]: {
                key: value
                for key, value in choice_question.items()
                if key not in {"id", "fallback_answer"}
            }
        },
    }
    return len(canonical_json(payload).encode())


def preflight_corpus(path: Path) -> dict[str, Any]:
    corpus = json.loads(path.read_text(encoding="utf-8"))
    choice_question = question(corpus)
    subsets = {"parser": corpus.get("parser"), "painpoint": corpus.get("painpoints")}
    decisions: list[dict[str, Any]] = []
    seen: dict[tuple[str, str], str] = {}
    for subset, rows in subsets.items():
        if not isinstance(rows, list) or not rows:
            raise ValueError(f"Corpus subset {subset} must be non-empty")
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("screen"), str):
                raise ValueError(f"Corpus subset {subset} has no screen")
            canonical = row["screen"].replace("\r\n", "\n").replace("\r", "\n")
            digest = screen_hash(canonical)
            if row.get("screen_hash") != digest:
                raise ValueError(f"Corpus screen hash mismatch in {subset}")
            label = row.get("label")
            baseline = row.get("regex")
            if (
                label not in choice_question["criteria"]
                or baseline not in choice_question["criteria"]
            ):
                raise ValueError(f"Corpus answer outside imported choices in {subset}")
            key = (subset, digest)
            if key in seen:
                if seen[key] != label:
                    raise ValueError(f"Conflicting duplicate label in {subset}")
                continue
            seen[key] = label
            size = request_bytes(canonical, choice_question)
            if size > SIZE_LIMIT_BYTES:
                raise ValueError(f"Serialized request exceeds {SIZE_LIMIT_BYTES} bytes")
            decisions.append(
                {
                    "subset": subset,
                    "screen": canonical,
                    "screen_hash": digest,
                    "label": label,
                    "baseline": baseline,
                    "provenance": row.get("provenance", []),
                    "serialized_bytes": size,
                }
            )
    return {
        "corpus": corpus,
        "question": choice_question,
        "decisions": sorted(
            decisions, key=lambda row: (row["subset"], row["screen_hash"])
        ),
    }


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def usage_delta(path: Path, offset: int) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_bytes()[offset:].decode().splitlines()
        if line
    ]


def fallback_reason(state_dir: Path) -> str:
    rows = read_jsonl(state_dir / "decisions.jsonl")
    return str(rows[-1].get("fallback_reason") if rows else "unknown")


def score_decision(
    jev_client,
    decision: dict[str, Any],
    choice_question: dict[str, Any],
    state_dir: Path,
    key_file: Path | None,
    timeout_seconds: float,
    transport: Callable[[dict[str, Any], str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    usage_path = state_dir / "usage.jsonl"
    offset = usage_path.stat().st_size if usage_path.exists() else 0
    started = time.monotonic()
    answers = jev_client.jev_shadow(
        {"screen_text": decision["screen"]},
        [choice_question],
        lambda value: value,
        site=SITE,
        state_dir=state_dir,
        key_file=key_file,
        transport=transport,
        timeout_seconds=timeout_seconds,
    )
    elapsed = time.monotonic() - started
    if len(answers) != 1:
        raise RuntimeError(
            "Scoring aborted: incomplete shadow answer; "
            f"fallback_reason={fallback_reason(state_dir)}"
        )
    answer = answers[0]
    if (
        answer.get("source") != "jev"
        or answer.get("acted") is not False
        or answer.get("type") != "choice"
        or answer.get("question_id") != choice_question["id"]
        or answer.get("answer") not in choice_question["criteria"]
        or not isinstance(answer.get("confidence"), (int, float))
        or isinstance(answer.get("confidence"), bool)
        or not math.isfinite(answer["confidence"])
        or not 0 <= answer["confidence"] <= 1
    ):
        raise RuntimeError(
            "Scoring aborted: fallback, non-shadow, or invalid answer; "
            f"fallback_reason={fallback_reason(state_dir)}"
        )
    delta = usage_delta(usage_path, offset)
    reservations = [row for row in delta if row.get("kind") == "reservation"]
    reconciliations = [row for row in delta if row.get("kind") == "reconciliation"]
    if (
        len(reservations) != 1
        or len(reconciliations) != 1
        or reservations[0].get("reservation_id")
        != reconciliations[0].get("reservation_id")
    ):
        raise RuntimeError("Scoring aborted: usage ledger was not exactly reconciled")
    receipt = reconciliations[0]
    return {
        **{
            key: decision[key]
            for key in ("subset", "screen_hash", "label", "baseline", "provenance")
        },
        "answer": answer["answer"],
        "confidence": answer["confidence"],
        "probabilities": answer.get("probabilities"),
        "model": receipt.get("model", "unknown"),
        "input_tokens": receipt["input_tokens"],
        "cost_usd": sum(row["cost_usd"] for row in delta),
        "wall_seconds": elapsed,
    }


def prediction(row: dict[str, Any], floor: float) -> str:
    return row["answer"] if row["confidence"] >= floor else "ABSTAIN"


def accuracy(rows: list[dict[str, Any]], floor: float, key: str) -> tuple[int, int]:
    return sum(prediction(row, floor) == row[key] for row in rows), len(rows)


def wilson(successes: int, total: int) -> tuple[float, float]:
    if total == 0:
        return 0.0, 1.0
    proportion = successes / total
    denominator = 1 + Z95 * Z95 / total
    center = (proportion + Z95 * Z95 / (2 * total)) / denominator
    margin = (
        Z95
        * math.sqrt(
            proportion * (1 - proportion) / total + Z95 * Z95 / (4 * total * total)
        )
        / denominator
    )
    return center - margin, center + margin


def choose_floor(run_one: list[dict[str, Any]]) -> tuple[float, bool]:
    parser_rows = [row for row in run_one if row["subset"] == "parser"]
    painpoint_rows = [row for row in run_one if row["subset"] == "painpoint"]
    baseline_correct = sum(row["baseline"] == row["label"] for row in painpoint_rows)
    for floor in FLOORS:
        parser_correct, parser_total = accuracy(parser_rows, floor, "label")
        painpoint_correct, painpoint_total = accuracy(painpoint_rows, floor, "label")
        if (
            parser_correct / parser_total >= 0.90
            and painpoint_correct / painpoint_total > baseline_correct / painpoint_total
        ):
            return floor, True
    return 0.50, False


def summarize(
    observations: list[dict[str, Any]], decisions: list[dict[str, Any]]
) -> dict[str, Any]:
    run_one = [row for row in observations if row["run"] == 1]
    floor, calibration_passed = choose_floor(run_one)
    subsets: dict[str, Any] = {}
    for subset in ("parser", "painpoint"):
        baseline_rows = [row for row in decisions if row["subset"] == subset]
        baseline_correct = sum(row["baseline"] == row["label"] for row in baseline_rows)
        curves = []
        frozen = []
        for run in range(1, RUNS + 1):
            rows = [
                row
                for row in observations
                if row["subset"] == subset and row["run"] == run
            ]
            for candidate in FLOORS:
                label_correct, total = accuracy(rows, candidate, "label")
                regex_correct, _ = accuracy(rows, candidate, "baseline")
                curves.append(
                    {
                        "run": run,
                        "floor": candidate,
                        "jev_vs_label": [label_correct, total],
                        "jev_vs_baseline": [regex_correct, total],
                        "coverage": sum(row["confidence"] >= candidate for row in rows),
                    }
                )
            correct, total = accuracy(rows, floor, "label")
            frozen.append(
                {
                    "run": run,
                    "jev_vs_label": [correct, total],
                    "wilson_95": wilson(correct, total),
                }
            )
        subsets[subset] = {
            "baseline_vs_label": [baseline_correct, len(baseline_rows)],
            "baseline_wilson_95": wilson(baseline_correct, len(baseline_rows)),
            "threshold_curve": curves,
            "frozen_floor": frozen,
        }
    return {
        "floor": floor,
        "calibration_passed": calibration_passed,
        "subsets": subsets,
    }


def append_observation(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--max-usd", type=float, default=1.0)
    parser.add_argument("--timeout-seconds", type=float, default=30)
    args = parser.parse_args()
    if not 0 < args.max_usd <= 5:
        raise RuntimeError("--max-usd must be positive and no greater than 5")

    preflight = preflight_corpus(args.corpus)
    planned_calls = len(preflight["decisions"]) * RUNS
    if planned_calls * MAX_REQUEST_USD > args.max_usd:
        raise RuntimeError("Conservative preflight exceeds --max-usd")
    if args.run_dir.exists():
        raise RuntimeError("Fresh --run-dir required; a scored replay is never resumed")
    args.run_dir.mkdir(parents=True, mode=0o700)
    state_dir = args.run_dir / "state"
    observations_path = args.run_dir / "observations.jsonl"
    repo = Path(__file__).resolve().parents[1]
    jev_client = load_jev(repo)
    previous_cap = os.environ.get("JEV_DAILY_USD_CAP")
    previous_site = os.environ.get("JEV_SITE_JEV_E1_CHOICE_REPLAY")
    os.environ["JEV_DAILY_USD_CAP"] = str(args.max_usd)
    os.environ["JEV_SITE_JEV_E1_CHOICE_REPLAY"] = "shadow"
    observations = []
    try:
        for run in range(1, RUNS + 1):
            for decision in preflight["decisions"]:
                row = score_decision(
                    jev_client,
                    decision,
                    preflight["question"],
                    state_dir,
                    args.key_file,
                    args.timeout_seconds,
                )
                row["run"] = run
                append_observation(observations_path, row)
                observations.append(row)
    finally:
        if previous_cap is None:
            os.environ.pop("JEV_DAILY_USD_CAP", None)
        else:
            os.environ["JEV_DAILY_USD_CAP"] = previous_cap
        if previous_site is None:
            os.environ.pop("JEV_SITE_JEV_E1_CHOICE_REPLAY", None)
        else:
            os.environ["JEV_SITE_JEV_E1_CHOICE_REPLAY"] = previous_site
    if len(observations) != planned_calls:
        raise RuntimeError("Scoring aborted: incomplete observation set")
    summary = summarize(observations, preflight["decisions"])
    (args.run_dir / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "calls": len(observations),
                "floor": summary["floor"],
                "calibration_passed": summary["calibration_passed"],
                "summary": str(args.run_dir / "summary.json"),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

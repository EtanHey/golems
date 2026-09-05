#!/usr/bin/env python3
"""Compute plan-council conservative merges and measured same-family bias."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

_TABLE_SEPARATOR = re.compile(r"^\|(?:\s*:?-+:?\s*\|)+\s*$")
_SIGNATURE = re.compile(r"^\s*[—-]\s*R\d+\s*·[^\n]+$", re.IGNORECASE | re.MULTILINE)


def _plain(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace(chr(96), "").replace("**", "").replace("__", "")).strip()


def _header_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", _plain(value).casefold())


def _family(value: str) -> str | None:
    lowered = value.casefold()
    if "fable" in lowered:
        return "fable"
    if "codex" in lowered or re.search(r"\bsol\b", lowered):
        return "sol"
    if "opus" in lowered:
        return "opus"
    return None


def _lane_key(value: str) -> str:
    label = _plain(value).casefold().replace("wave ", "w")
    match = re.match(r"w?(\d+(?:\.\d+)?(?:-r\d+|[a-z])?)\b", label)
    if not match:
        return re.sub(r"[^a-z0-9_]+", " ", label).strip()
    code = match.group(1)
    if re.fullmatch(r"3[a-d]", code) or "-r" in code or "." in code:
        return code
    if code == "3" and "precondition" in label:
        return "w3 preconditions"
    if code == "3" and "two-host" in label:
        return "w3 two-host"
    return re.sub(r"[^a-z0-9_]+", " ", label).strip()


def _table_rows(text: str):
    lines = text.splitlines()
    for index in range(len(lines) - 1):
        header = lines[index].strip()
        if not (header.startswith("|") and _TABLE_SEPARATOR.match(lines[index + 1].strip())):
            continue
        headers = [_header_key(cell) for cell in header.strip("|").split("|")]
        cursor = index + 2
        while cursor < len(lines) and lines[cursor].strip().startswith("|"):
            cells = [cell.strip() for cell in lines[cursor].strip().strip("|").split("|")]
            if len(cells) == len(headers):
                yield headers, cells
            cursor += 1


def _index(headers: list[str], kind: str) -> int | None:
    if kind == "lane":
        matches = [i for i, header in enumerate(headers) if "lane" in header]
    elif kind == "score":
        matches = [i for i, header in enumerate(headers) if "score" in header]
    elif kind == "merged":
        matches = [i for i, header in enumerate(headers) if "merged" in header]
    else:
        matches = []
    return matches[-1] if matches else None


def parse_ballot(path: Path) -> dict:
    text = path.read_text()
    signature = _SIGNATURE.search(text)
    if not signature:
        raise ValueError(f"{path}: missing family signature")
    family = _family(signature.group(0))
    if not family:
        raise ValueError(f"{path}: signature has no recognized model family")
    lanes = {}
    for headers, cells in _table_rows(text):
        lane_i, score_i = _index(headers, "lane"), _index(headers, "score")
        if lane_i is None or score_i is None:
            continue
        lane = _plain(cells[lane_i]).strip()
        score_match = re.search(r"-?\d+(?:\.\d+)?", _plain(cells[score_i]))
        merged_i = _index(headers, "merged")
        merged_match = (
            re.search(r"-?\d+(?:\.\d+)?", _plain(cells[merged_i]))
            if merged_i is not None
            else None
        )
        if lane and score_match:
            key = _lane_key(lane)
            lanes[key] = {
                "display": lane,
                "score": float(score_match.group(0)),
                "merged": float(merged_match.group(0)) if merged_match else None,
            }
    if not lanes:
        raise ValueError(f"{path}: no Lane/Score table rows")
    return {"path": path, "family": family, "lanes": lanes}


def analyze_ballots(paths, author_family: str) -> dict:
    ballots = [parse_ballot(Path(path)) for path in paths]
    author_family = _family(author_family) or author_family.strip().casefold()
    if len({ballot["family"] for ballot in ballots}) != len(ballots):
        raise ValueError("each ballot must represent a distinct model family")
    lane_sets = [set(ballot["lanes"]) for ballot in ballots]
    shared_lanes = sorted(set.intersection(*lane_sets))
    if not shared_lanes:
        raise ValueError("ballots have no shared normalized lanes")
    skipped_lanes = sorted(set.union(*lane_sets) - set(shared_lanes))
    rows, bad_merges = [], []
    for lane_key in shared_lanes:
        scores = {
            ballot["family"]: ballot["lanes"][lane_key]["score"]
            for ballot in ballots
        }
        non_family = [score for family, score in scores.items() if family != author_family]
        if not non_family:
            raise ValueError(f"{lane_key}: no non-author-family scores")
        conservative = min(non_family)
        same_score = scores.get(author_family)
        delta = same_score - conservative if same_score is not None else None
        declared = {
            ballot["lanes"][lane_key]["merged"]
            for ballot in ballots
            if ballot["lanes"][lane_key]["merged"] is not None
        }
        if len(declared) > 1:
            raise ValueError(f"{lane_key}: conflicting declared merged scores: {sorted(declared)}")
        declared_merge = next(iter(declared), None)
        bad_merge = declared_merge is not None and abs(declared_merge - conservative) > 1e-9
        display_lane = next(ballot["lanes"][lane_key]["display"] for ballot in ballots)
        if bad_merge:
            bad_merges.append(display_lane)
        rows.append({
            "lane": display_lane,
            "lane_key": lane_key,
            "scores": scores,
            "conservative_non_family": conservative,
            "same_family_delta": delta,
            "bias_flag": delta is not None and delta >= 2.0,
            "declared_merge": declared_merge,
            "bad_merge": bad_merge,
        })
    deltas = [row["same_family_delta"] for row in rows if row["same_family_delta"] is not None]
    return {
        "author_family": author_family,
        "families": sorted({ballot["family"] for ballot in ballots}),
        "lanes": rows,
        "round_mean_bias": sum(deltas) / len(deltas) if deltas else None,
        "bad_merges": bad_merges,
        "skipped_lanes": skipped_lanes,
    }


def analyze_directory(directory: Path, author_family: str) -> dict:
    paths = sorted(Path(directory).glob("*.md"))
    if not paths:
        raise ValueError(f"{directory}: no .md ballots found")
    return analyze_ballots(paths, author_family)


def _number(value) -> str:
    return "—" if value is None else f"{value:g}"


def render_report(report: dict) -> str:
    families = report["families"]
    headers = ["Lane", *families, "Conservative non-family", "Same-family Δ", "Declared merge", "Flag"]
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] + ["---:"] * (len(headers) - 1)) + "|"]
    for row in report["lanes"]:
        values = [
            row["lane"],
            *[_number(row["scores"].get(family)) for family in families],
            _number(row["conservative_non_family"]),
            _number(row["same_family_delta"]),
            _number(row["declared_merge"]),
            "BAD MERGE" if row["bad_merge"] else ("BIAS ≥+2" if row["bias_flag"] else "—"),
        ]
        lines.append("| " + " | ".join(values) + " |")
    lines.append("")
    lines.append(f"Round mean same-family bias: {_number(report['round_mean_bias'])}")
    if report["skipped_lanes"]:
        lines.append(f"Skipped non-shared lane keys: {', '.join(report['skipped_lanes'])}")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Report plan-council same-family bias and conservative merges")
    parser.add_argument("ballot_directory", type=Path)
    parser.add_argument("--author-family", required=True)
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = analyze_directory(args.ballot_directory, args.author_family)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}")
        return 2
    print(render_report(report))
    if report["bad_merges"]:
        print("Invalid merge source: " + ", ".join(report["bad_merges"]))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

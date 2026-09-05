#!/usr/bin/env python3
"""Static scorer for deep-research prompt quality (5 dims × 0-2 → /10)."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

DIM_NAMES = [
    "existing-work-check",
    "drive-grounding",
    "current-usage-examples",
    "prior-research-reconciliation",
    "non-redundancy",
]

RRF_PRIOR_PATHS = [
    "orchestrator/docs.local/research/2026-05-26-cormack-vs-brainlayer-corpus.md",
    "brainlayer/docs.local/research/2026-05-26-research-lead/A8-per-agent-ranking-and-syllabi.md",
    "brainlayer/docs.local/research/2026-05-26-rrf-domain-stage1.md",
    "skill-creator/docs.local/handoffs/2026-05-17/web-weave/rrf-k-tuning.md",
    "brainlayer/docs.local/plans/2026-05-15-bl-overhaul/phase-3-hybrid-search-rrf",
    "coach/docs.local/decisions/2026-05-26-cormack-rrf-deep-research.md",
]


def read_text(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"@include:\s*(\S+)", raw)
    if m:
        inc = Path(m.group(1)).expanduser()
        if inc.is_file():
            return inc.read_text(encoding="utf-8", errors="replace")
    # NEG fixtures wrap the prompt in a fenced block — score that body only
    if "neg-" in path.name and "```" in raw:
        m = re.search(r"```[a-z]*\n(.*?)```", raw, re.S)
        if m:
            return m.group(1)
    return raw


def score_existing_work(text: str) -> int:
    low = text.lower()
    if re.search(r"already\s+(researched|done)|engineering,\s*not\s+research|stop:\s*rrf", low):
        return 2
    if re.search(r"check-first|prior\s+research|existing\s+work|docs\.local/(research|plans|decisions)", low):
        return 1
    if re.search(r"\brrf\b|reciprocal\s+rank\s+fusion", low, re.I) and not re.search(
        r"already|prior|build\s+on|do\s+not\s+re-?derive", low
    ):
        return 0
    if re.search(r"grounding bundle|not a prompt", low):
        return 1
    return 0


def score_drive_grounding(text: str) -> int:
    low = text.lower()
    drive_hits = len(
        re.findall(
            r"brain\s+drive|03_research|drive/03_research|drive folder|1mgwni", low, re.I
        )
    )
    if drive_hits >= 2 or "03_research" in low:
        return 2
    if drive_hits >= 1:
        return 1
    return 0


def score_current_usage(text: str) -> int:
    path_hits = re.findall(
        r"(~/?Gits/[^\s\)`\"]+|~/?\.claude/[^\s\)`\"]+|[\w.-]+/docs\.local/[^\s\)`\"]+|docs\.local/[^\s\)`\"]+|mcp__cmux__|send_(?:input|to_agent))",
        text,
        re.I,
    )
    mechanism = len(
        re.findall(
            r"send_input|send_to_agent|stdin|pty|fact-propagation|cmux|hook|mcp__|brain_search|agada-bench|rrf",
            text,
            re.I,
        )
    )
    if len(path_hits) >= 3 and mechanism >= 2:
        return 2
    if len(path_hits) >= 1 and mechanism >= 1:
        return 1
    if re.search(r"cli stdin|injecting text", text, re.I):
        return 1
    return 0


def score_prior_reconciliation(text: str) -> int:
    low = text.lower()
    stances = len(re.findall(r"build[- ]on|validate|refute|do not re-?derive|prior research", low))
    prior_paths = len(re.findall(r"docs\.local/(?:research|plans|decisions|handoffs)/", low))
    if stances >= 2 and prior_paths >= 2:
        return 2
    if stances >= 1 or prior_paths >= 2:
        return 1
    if re.search(r"compare three options|answer these", low) and stances == 0:
        return 0
    return 0


def score_non_redundancy(text: str) -> int:
    low = text.lower()
    if re.search(
        r"already\s+researched|removed\s+—\s*not\s+a\s+research|engineering,\s*not\s+research|rrf\s+was\s+dropped|keep\s+rrf\s+\+",
        low,
    ):
        return 2
    rrf_propose = bool(
        re.search(r"evaluate ranking/fusion|compare rank-based rrf|weighted fusion", low)
    )
    cites_prior = sum(1 for p in RRF_PRIOR_PATHS if p.split("/")[-1].lower() in low or p in text)
    if rrf_propose and cites_prior < 2:
        return 0
    if rrf_propose and cites_prior >= 2:
        return 1
    if re.search(r"grounding bundle|evidence-only bundle", low):
        return 2
    if re.search(r"do not re-derive from scratch", low):
        return 2
    return 1


def score_file(path: Path) -> tuple[int, list[int]]:
    text = read_text(path)
    dims = [
        score_existing_work(text),
        score_drive_grounding(text),
        score_current_usage(text),
        score_prior_reconciliation(text),
        score_non_redundancy(text),
    ]
    return sum(dims), dims


def main() -> int:
    parser = argparse.ArgumentParser(description="Score a research prompt file (/10).")
    parser.add_argument("files", nargs="*", type=Path, help="Prompt or fixture paths")
    parser.add_argument("--all-fixtures", action="store_true", help="Score evals/fixtures/*.md")
    args = parser.parse_args()

    skill_root = Path(__file__).resolve().parents[1]
    if args.all_fixtures:
        files = sorted((skill_root / "evals" / "fixtures").glob("*.md"))
    elif args.files:
        files = [p.resolve() for p in args.files]
    else:
        parser.error("provide files or --all-fixtures")

    failures = 0
    for f in files:
        if not f.is_file():
            print(f"ERROR: missing {f}", file=sys.stderr)
            failures += 1
            continue
        total, dims = score_file(f)
        print(f"=== {f.name} ===")
        print(f"path: {f}")
        for name, val in zip(DIM_NAMES, dims):
            print(f"  {name}: {val}/2")
        print(f"TOTAL: {total}/10")
        label = f.stem.split("-")[0] if "-" in f.stem else ""
        if label.startswith("neg") and total > 4:
            print(f"RED GATE FAIL: expected ≤4, got {total}")
            failures += 1
        elif label.startswith("pos") and total < 8:
            print(f"RED GATE FAIL: expected ≥8, got {total}")
            failures += 1
        else:
            print("RED GATE: pass")
        print()

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""check-first.sh — non-redundancy gate (python for macOS bash 3.2 portability)."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path


def keywords(query: str) -> list[str]:
    parts = re.split(r"[^a-z0-9+]+", query.lower())
    return [p for p in parts if len(p) >= 3]


def drive_roots() -> list[Path]:
    roots: list[Path] = []
    home = Path.home()
    for candidate in (
        home / "Brain Drive" / "03_RESEARCH",
        home / "Library/CloudStorage/GoogleDrive-My Drive/Brain Drive" / "03_RESEARCH",
        home / "Library/CloudStorage/GoogleDrive/Brain Drive" / "03_RESEARCH",
    ):
        if candidate.is_dir():
            roots.append(candidate)
    return roots


def search_file(path: Path, pattern: re.Pattern[str]) -> bool:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return bool(pattern.search(text))


coordination_root = Path(os.environ.get("RESEARCH_ARCHIVE_ROOT", Path.home() / ".local/share/golems/research"))
skill_tools_root = Path(os.environ.get("SKILL_TOOLS_ARCHIVE_ROOT", Path.home() / ".local/share/golems/skill-tools"))
coach_root = Path(os.environ.get("COACH_ARCHIVE_ROOT", Path.home() / ".local/share/golems/coach"))

CANONICAL_RRF = [
    coordination_root / "2026-05-26-cormack-vs-brainlayer-corpus.md",
    Path.home() / "Gits/brainlayer/docs.local/research/2026-05-26-research-lead/A8-per-agent-ranking-and-syllabi.md",
    Path.home() / "Gits/brainlayer/docs.local/research/2026-05-26-rrf-domain-stage1.md",
    skill_tools_root / "2026-05-17/web-weave/rrf-k-tuning.md",
    Path.home() / "Gits/brainlayer/docs.local/plans/2026-05-15-bl-overhaul/phase-3-hybrid-search-rrf",
    coach_root / "decisions/2026-05-26-cormack-rrf-deep-research.md",
]


def search_tree(root: Path, pattern: re.Pattern[str]) -> list[Path]:
    hits: list[Path] = []
    if not root.is_dir():
        return hits
    for p in root.rglob("*.md"):
        if p.is_file() and search_file(p, pattern):
            hits.append(p)
    # plans/decisions may be directories without .md extension
    for p in root.rglob("*"):
        if p.is_dir() and pattern.search(p.name):
            hits.append(p)
    return hits


def main() -> int:
    if len(sys.argv) < 2:
        print('usage: check-first.sh "<topic keywords>"', file=sys.stderr)
        return 2

    query = " ".join(sys.argv[1:])
    kws = keywords(query)
    if not kws:
        print("check-first: no searchable keywords (need length>=3)", file=sys.stderr)
        return 2

    pattern = re.compile("|".join(re.escape(k) for k in kws), re.I)
    gits_root = Path(os.environ.get("GITS_ROOT", Path.home() / "Gits"))
    min_hits = int(os.environ.get("CHECK_FIRST_MIN_HITS", "3"))

    hits: list[Path] = []
    drive = drive_roots()
    for dr in drive:
        hits.extend(search_tree(dr, pattern))

    if gits_root.is_dir():
        for repo in sorted(gits_root.iterdir()):
            if not repo.is_dir():
                continue
            for sub in ("research", "plans", "decisions"):
                local = repo / "docs.local" / sub
                hits.extend(search_tree(local, pattern))

    seen: set[str] = set()
    unique: list[Path] = []
    for h in hits:
        key = str(h.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(h.resolve())

    print(f'check-first: query="{query}" pattern=({"|".join(kws)})')
    print(f"check-first: scanned Drive roots={len(drive)} repos under {gits_root}")

    if not unique:
        print("check-first: no prior hits — OK to propose new research (still run GROUND gate)")
        return 0

    if re.search(r"\brrf\b", query, re.I):
        print("check-first: canonical prior RRF artifacts (verified):")
        for p in CANONICAL_RRF:
            status = "OK" if p.exists() else "MISSING"
            print(f"  - [{status}] {p}")

    print(f"check-first: {len(unique)} hit(s) (showing up to 30):")
    for h in unique[:30]:
        print(f"  - {h}")
    if len(unique) > 30:
        print(f"  ... and {len(unique) - 30} more")

    if len(unique) >= min_hits:
        paths = " ".join(str(u) for u in unique)
        print()
        print(f"ALREADY RESEARCHED → {paths}")
        print("STOP: this is engineering / plan execution, not new deep research.")
        return 1

    print(
        f"check-first: weak overlap ({len(unique)} < {min_hits}) — proceed with GROUND gate"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

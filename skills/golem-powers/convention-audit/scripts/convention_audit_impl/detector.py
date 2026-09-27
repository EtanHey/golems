"""Deterministic SQLite timestamp-window inventory."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any

DETECTOR_IGNORED_DIRS = {
    "build",
    "dist",
    "node_modules",
    "site-packages",
    "vendor",
    "venv",
}

SQLITE_RECENT_WINDOW_PATTERN = re.compile(
    r"(?:"
    r"datetime\s*\(\s*(?P<normalized_column>[A-Za-z_][A-Za-z0-9_.]*(?:_at|timestamp))\s*\)"
    r"|(?P<raw_column>[A-Za-z_][A-Za-z0-9_.]*(?:_at|timestamp))"
    r")\s*(?:>|>=)\s*datetime\s*\(",
    re.IGNORECASE,
)

def detect_sqlite_recent_window_candidates(repo: Path) -> dict[str, Any]:
    """Inventory lower-bound SQLite time windows and flag raw text comparisons."""

    implementation_sites: list[dict[str, Any]] = []
    divergent_sites: list[dict[str, Any]] = []
    for path in sorted(repo.rglob("*.py")):
        relative = path.relative_to(repo)
        if any(
            part.startswith(".")
            or part in {"tests", "__tests__", "__pycache__"}
            or part.lower() in DETECTOR_IGNORED_DIRS
            for part in relative.parts
        ):
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(lines, start=1):
            if line.lstrip().startswith("#"):
                continue
            for match in SQLITE_RECENT_WINDOW_PATTERN.finditer(line):
                normalized_column = match.group("normalized_column")
                column = normalized_column or match.group("raw_column")
                normalized = normalized_column is not None
                implementation_sites.append(
                    {
                        "path": relative.as_posix(),
                        "line": line_number,
                        "summary": (
                            f"normalizes {column} through SQLite datetime() before the lower-bound comparison"
                            if normalized
                            else f"compares raw {column} text to a SQLite datetime() lower bound"
                        ),
                    }
                )
                if not normalized:
                    divergent_sites.append(
                        {
                            "path": relative.as_posix(),
                            "line": line_number,
                            "reason": (
                                f"raw {column} text can use an ISO separator that sorts differently from "
                                "SQLite datetime() output"
                            ),
                        }
                    )

    findings: list[dict[str, Any]] = []
    normalized_site_count = len(implementation_sites) - len(divergent_sites)
    if len(implementation_sites) >= 2 and divergent_sites and normalized_site_count > 0:
        findings.append(
            {
                "concept": "SQLite recent timestamp-window comparison",
                "implementation_sites": implementation_sites,
                "divergent_sites": divergent_sites,
                "shared_helper_shape": (
                    "One parameterized recent_timestamp_clause(column, amount, unit) that always applies "
                    "SQLite datetime() normalization."
                ),
                "confidence": "high",
            }
        )
    return {"worker": "static-sqlite-recent-window-detector", "findings": findings}

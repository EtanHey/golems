"""Review-disposition gate for the coderabbit flow (gen-18 Track 6 D5).

Two false-green failure modes this gate closes:
  1. Silent-skip — a review is skipped/rate-limited/timed-out and the agent moves on
     without recording WHY, so "no findings" is indistinguishable from "never reviewed".
  2. Undisposed CRITICAL — a CRITICAL finding is left without an explicit disposition
     before push, so it silently ships.

The gate validates a "review disposition log": a status line plus one line per finding.
Every CRITICAL must carry an explicit disposition (FIXED / WAIVED / ACCEPTED), and a
SKIPPED status must carry a reason. Pure functions over the log text — deterministic.

Log shape (markdown, case-insensitive keywords):

    Status: COMPLETED
    - CRITICAL: SQL injection in handler — FIXED (commit abc123)
    - CRITICAL: missing auth check — WAIVED (endpoint is internal-only, see thread)
    - HIGH: N+1 query — FIXED

or, when the tool could not run:

    Status: SKIPPED — OSS rate limit hit; fell back to red-team prompt review (see below)
"""

from __future__ import annotations

import re

_STATUS = re.compile(r"^\s*status\s*[:=]\s*(.+)$", re.IGNORECASE | re.MULTILINE)
_FINDING = re.compile(r"^\s*[-*]?\s*(critical|high|medium|low)\b\s*[:\-—]\s*(.+)$", re.IGNORECASE | re.MULTILINE)
# The disposition is the trailing status of the finding line, after the last
# space-dash-space separator, and must START with an affirmative marker — so prose that
# merely contains "fixed" ("not fixed yet", "the fixed-width buffer") is NOT a disposition
# (PR #539 Bugbot).
_DISPOSITION_MARKER = re.compile(
    r"^\s*[\[(]?\s*(?:fixed|waived|accepted|wontfix|won'?t[- ]?fix)\b",
    re.IGNORECASE,
)


def _is_dispositioned(body: str) -> bool:
    segments = re.split(r"\s+[—–-]\s+", body)
    return len(segments) > 1 and bool(_DISPOSITION_MARKER.match(segments[-1]))
_SKIPPED = re.compile(r"\bskip(?:ped)?\b|\brate[- ]?limit|\btimed?\s*out\b|\bunavailable\b", re.IGNORECASE)


def validate_dispositions(text: str) -> list[dict]:
    """Return a list of violations: {rule, where, evidence}."""
    violations = []

    status_match = _STATUS.search(text)
    status = status_match.group(1).strip() if status_match else ""
    if not status:
        violations.append({
            "rule": "missing-status",
            "where": "Status",
            "evidence": "no review Status line (COMPLETED or SKIPPED: <reason>)",
        })
    elif _SKIPPED.search(status):
        # A skip/rate-limit/timeout must explain itself — never a silent skip. Strip the
        # skip keyword(s) + punctuation; a real reason leaves >=2 substantive words.
        residual = _SKIPPED.sub(" ", status)
        residual_words = re.sub(r"[^A-Za-z0-9]+", " ", residual).split()
        if len(residual_words) < 2:
            violations.append({
                "rule": "silent-skip",
                "where": "Status",
                "evidence": "review was skipped without a recorded reason / fallback",
            })

    for level, body in _FINDING.findall(text):
        if level.lower() == "critical" and not _is_dispositioned(body):
            violations.append({
                "rule": "undisposed-critical",
                "where": "finding",
                "evidence": f"CRITICAL without an explicit FIXED/WAIVED/ACCEPTED disposition: {body.strip()[:80]}",
            })
    return violations

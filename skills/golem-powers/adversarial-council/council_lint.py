"""Adversarial-council ballot validator (gen-18 Track 6 D8).

The multi-tier anonymized-peer-ranking council is a KEEP-the-win discipline that decays to
folklore unless it is gate-shaped. The council works only if its structural invariants
hold; this validator turns those invariants into a mechanical, replayable gate over a
council ballot (the markdown a judge produces).

Four rules:
  1. authorship-leak — a candidate's critique names a participant engine
     (`…Claude/Codex/Cursor/Gemini`) or claims first-person authorship ("my proposal",
     "I wrote this"). Anonymized peer ranking means judging on merit with NO authorship
     signal; a leak lets rank track identity instead of quality.
  2. missing-sentinel — the ballot's final non-empty line must be the agreed sentinel, so
     a truncated/streamed ballot is detectable (sentinel-final-line discipline).
  3. unread-required-input — every required input (spec/design/diff) must be acknowledged
     in the ballot's "Inputs read" section before any verdict (read-required-inputs-
     before-opining).
  4. missing-score — every ranked candidate must carry a numeric `Score: N` so the ranking
     is on a comparable scale, not vibes.

Pure functions over the ballot text — deterministic, no I/O.
"""

from __future__ import annotations

import re

DEFAULT_SENTINEL = "COUNCIL-BALLOT-COMPLETE"

# A participant engine token (anonymization leak), e.g. orcClaude / skillCreatorCodex /
# agentcodex. Two arms (PR #537 Bugbot — lowercase suffixes bypassed exact casing):
#   1. a Capitalized engine name with an optional identifier prefix (Claude, orcClaude),
#   2. a lowercase engine name that is the SUFFIX of a longer identifier (agentcodex).
# The required prefix in arm 2 keeps the bare word "cursor" (a text caret) from matching.
_ENGINE_TOKEN = re.compile(
    r"\b\w*(?:Claude|Codex|Cursor|Gemini)\b"
    r"|\b\w+(?:claude|codex|cursor|gemini)\b"
)
# First-person authorship claims that break anonymity.
_AUTHORSHIP_CLAIM = re.compile(
    r"\b(?:my (?:proposal|submission|design|approach|entry|candidate|solution)"
    r"|I (?:wrote|authored|submitted|designed|proposed) (?:this|it)"
    r"|as the author|is mine\b|my own\b)",
    re.IGNORECASE,
)
# A candidate header is `## Candidate A` / `## Option B2` / `## Entry 3 — fast path`: the
# keyword followed by a SHORT LABEL (starts uppercase/digit). Aux sections like
# `## Entry criteria` / `## Candidate rubric` (lowercase word after the keyword) are NOT
# candidates and must not stop input-ack scanning or be scored (PR #537 Bugbot).
_CANDIDATE_HEADER = re.compile(r"^##\s+(?i:candidate|option|entry)\s+[A-Z0-9][\w-]*\b")
_INPUTS_HEADER = re.compile(r"^##\s+.*\b(inputs?\s+read|inputs?\b|sources?\s+read)\b.*$", re.IGNORECASE)
_SCORE = re.compile(r"^\s*score\s*[:=]\s*(\d+(?:\.\d+)?)", re.IGNORECASE | re.MULTILINE)


def _sections(text: str):
    """Yield (header_line_text, body_text) for each `##` section."""
    lines = text.splitlines()
    idxs = [i for i, ln in enumerate(lines) if ln.startswith("## ")]
    for n, start in enumerate(idxs):
        end = idxs[n + 1] if n + 1 < len(idxs) else len(lines)
        yield lines[start][3:].strip(), "\n".join(lines[start + 1:end])


def _final_nonempty_line(text: str) -> str:
    for ln in reversed(text.splitlines()):
        if ln.strip():
            return ln.strip()
    return ""


def _inputs_acknowledged(text: str) -> str:
    """The concatenated body of any 'Inputs read' section that appears BEFORE the first
    candidate — read-required-inputs-BEFORE-opining. An Inputs section placed after the
    verdicts does not count (it was not read before judging)."""
    chunks = []
    for header, body in _sections(text):
        if _CANDIDATE_HEADER.match("## " + header):
            break  # reached the verdicts; stop crediting input acks
        if _INPUTS_HEADER.match("## " + header):
            chunks.append(body)
    return "\n".join(chunks)


def _input_is_acknowledged(required: str, acked: str) -> bool:
    """True if `required` appears as a whole path token in `acked` (not a loose substring,
    so a required `a.md` is not satisfied by `draft-a.md`)."""
    for token in re.split(r"\s+", acked):
        token = token.strip().strip(",;)(`'\"")
        if token == required or token.endswith("/" + required):
            return True
    return False


def validate_ballot(text: str, required_inputs=None, sentinel: str = DEFAULT_SENTINEL) -> list[dict]:
    """Return a list of violations: {rule, where, evidence}."""
    violations = []
    required_inputs = required_inputs or []

    # Rule 2: sentinel final-line.
    if _final_nonempty_line(text) != sentinel:
        violations.append({
            "rule": "missing-sentinel",
            "where": "final line",
            "evidence": f"ballot must end with the sentinel {sentinel!r}",
        })

    # Rule 3: required inputs acknowledged before opining.
    acked = _inputs_acknowledged(text)
    for required in required_inputs:
        if not _input_is_acknowledged(required, acked):
            violations.append({
                "rule": "unread-required-input",
                "where": "Inputs read",
                "evidence": f"required input not acknowledged before the verdicts: {required}",
            })

    # Rules 1 & 4: per candidate section.
    for header, body in _sections(text):
        if not _CANDIDATE_HEADER.match("## " + header):
            continue
        if not _SCORE.search(body):
            violations.append({
                "rule": "missing-score",
                "where": header,
                "evidence": f"candidate '{header}' has no numeric Score:",
            })
        leak = _ENGINE_TOKEN.search(body) or _AUTHORSHIP_CLAIM.search(body)
        if leak:
            violations.append({
                "rule": "authorship-leak",
                "where": header,
                "evidence": f"candidate '{header}' leaks authorship: {leak.group(0)!r}",
            })
    return violations

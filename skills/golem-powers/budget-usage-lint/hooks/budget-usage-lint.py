#!/usr/bin/env python3
"""budget-usage-lint — non-blocking PostToolUse/Stop hook.

Flags Claude weekly-budget / usage-percent / "conserve Claude" / "stay thin" /
"go light" framing in agent-facing output. Gen-18 Track 1 #5, closes R-032
("most re-encoded family" — the conserve-Claude premise that kept re-appearing
across sessions and getting re-litigated).

WHY THIS EXISTS — corrected provenance (pin this, do not lose it):
  Full-throttle is the STANDING rule. There is NO real conservation premise.
  - The "free Codex cap" that triggered the original conserve push was
    SELF-INFLICTED (a config choice), not an external budget limit.
  - The famous "76% of the weekly budget" quote was an orc RELAY paraphrase,
    NOT a direct Etan turn. It was treated for sessions as if Etan had ordered
    conservation; he did not. The relay manufactured a premise.
  Net: any agent-facing output that frames work around conserving Claude /
  staying thin / going light / switching to a cheaper model "to save budget"
  is re-encoding a premise that was never real. This hook surfaces it so it
  gets corrected once, loudly, instead of silently re-litigated.

CONTRACT:
  - Input: hook JSON on stdin (PostToolUse or Stop event).
  - Scans the agent-facing text (assistant message / tool output / transcript
    tail, whatever the event carries).
  - On a conserve-framing hit: emit a NON-BLOCKING warning — exit 0 with a
    {"systemMessage": "..."} on stdout AND a human note on stderr.
  - FAIL OPEN: any error, malformed payload, empty text -> exit 0, no warning.
    This hook NEVER blocks real work. It is advisory only.

CALIBRATION — must FIRE (RED), must NOT fire (GREEN):
  RED  (conserve-framing about Claude / token spend):
    - "we're at 76% of the weekly budget, let's conserve Claude"
    - "stay thin on tokens"
    - "go light / conserve"
    - "usage is high, switch to a cheaper model to save budget"
  GREEN (never flag):
    - normal full-throttle output with no conserve framing
    - factual+sourced cost reporting (a verified invoice amount, a number with
      a source) — reporting a cost is fine; FRAMING WORK AROUND conserving is not
    - "time budget", "context budget", "token budget estimation" — the word
      "budget" in planning/estimation contexts is NOT a conserve signal.

Exit code is ALWAYS 0 (advisory hook). The signal is the presence/absence of
a systemMessage, never a block.
"""

from __future__ import annotations

import json
import re
import sys

# Sentinel embedded in this hook's OWN warning text. The warning necessarily
# quotes the very phrases the lint detects ("76% of the weekly budget",
# "conserve framing"), so a naive re-scan of the hook's output — when the
# warning is echoed back in a later payload's systemMessage, or the assistant
# repeats the correction — would re-fire the lint on non-violating text (Cursor
# Bugbot MEDIUM, PR #528). Any text carrying this sentinel is the lint talking
# about itself and is excluded from scanning.
_SELF_SENTINEL = "BUDGET-USAGE-LINT"

# --- Conserve-framing detectors ----------------------------------------------
# A hit requires CONSERVE FRAMING tied to Claude / token / model spend. The
# word "budget" alone is NOT enough (context budget / token budget estimation
# are legitimate). We look for the verbs/phrases of conservation.

# Tier 1: explicit conserve-Claude / stay-thin / go-light directives.
_CONSERVE_PHRASES = [
    # "conserve Claude" / "conserve tokens" / "conserve usage/budget/our spend"
    re.compile(r"\bconserve\s+(?:claude|tokens?|usage|budget|spend|model\s+use)\b", re.IGNORECASE),
    # bare "let's conserve" / "we should conserve" (conserve as the directive)
    re.compile(r"\b(?:let'?s|we\s+should|need\s+to|have\s+to|gotta)\s+conserve\b", re.IGNORECASE),
    # "stay thin on tokens/budget/usage" or bare "stay thin"
    re.compile(r"\bstay\s+thin\b", re.IGNORECASE),
    # "go light" (conserve sense) — "go light / conserve", "go light on tokens"
    re.compile(r"\bgo\s+light\b(?:\s*/\s*conserve\b|\s+on\s+(?:tokens?|usage|budget|spend|claude))?", re.IGNORECASE),
]

# Tier 2: weekly-budget / usage-percent conserve framing. Requires a
# usage/budget percentage OR weekly-budget reference COMBINED with a
# conserve/save/cut intent — so "we're at 76% of the weekly budget" fires only
# when paired with conserve intent, but a bare sourced cost report does not.
_USAGE_PERCENT = re.compile(
    r"\b\d{1,3}\s*%\s*(?:of\s+(?:the\s+)?)?(?:weekly\s+)?(?:budget|usage|quota|limit|cap)\b",
    re.IGNORECASE,
)
_WEEKLY_BUDGET = re.compile(r"\bweekly\s+(?:budget|usage|quota|limit|cap)\b", re.IGNORECASE)
_USAGE_HIGH = re.compile(r"\busage\s+is\s+(?:high|getting\s+high|too\s+high|up)\b", re.IGNORECASE)
_CONSERVE_INTENT = re.compile(
    r"\b(?:conserve|save\s+budget|save\s+(?:on\s+)?tokens?|cut\s+(?:back|down|spend)|"
    r"slow\s+down|ease\s+up|dial\s+(?:it\s+)?back|be\s+(?:more\s+)?(?:thin|frugal|sparing)|"
    r"switch\s+to\s+(?:a\s+)?cheaper\s+model|use\s+(?:a\s+)?cheaper\s+model|"
    r"reduce\s+(?:our\s+)?(?:claude|model|token)\s+(?:use|usage|spend))\b",
    re.IGNORECASE,
)

# Tier 3: "switch to a cheaper model to save budget" — model downgrade for cost.
_CHEAPER_MODEL = re.compile(
    r"\b(?:switch\s+to|use|move\s+to|drop\s+to|downgrade\s+to)\s+(?:a\s+)?cheaper\s+model\b",
    re.IGNORECASE,
)
_SAVE_FRAME = re.compile(
    r"\b(?:to\s+)?save\s+(?:budget|tokens?|money|cost|usage|spend)\b|"
    r"\bto\s+conserve\b",
    re.IGNORECASE,
)


def _find_signals(text: str) -> list[str]:
    """Return human-readable labels for each conserve-framing signal found.
    Empty list = no signal = no warning (fail-quiet / GREEN)."""
    if not isinstance(text, str) or not text.strip():
        return []
    # Self-exclusion: never lint the lint's own warning (Bugbot MEDIUM #528).
    if _SELF_SENTINEL in text:
        return []
    signals: list[str] = []

    for rx in _CONSERVE_PHRASES:
        m = rx.search(text)
        if m:
            signals.append(f"conserve-phrase: {m.group(0).strip()!r}")

    # weekly-budget / usage-% framing only counts WITH conserve intent.
    pct = _USAGE_PERCENT.search(text)
    wk = _WEEKLY_BUDGET.search(text)
    uh = _USAGE_HIGH.search(text)
    intent = _CONSERVE_INTENT.search(text)
    if (pct or wk or uh) and intent:
        anchor = (pct or wk or uh).group(0).strip()
        signals.append(f"usage-conserve framing: {anchor!r} + {intent.group(0).strip()!r}")

    # cheaper-model downgrade for cost.
    cm = _CHEAPER_MODEL.search(text)
    if cm and _SAVE_FRAME.search(text):
        signals.append(f"cheaper-model-to-save: {cm.group(0).strip()!r}")

    # de-dup while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for s in signals:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


# --- Agent-facing text extraction --------------------------------------------
# PostToolUse and Stop events carry different shapes. We scan whatever
# agent-facing text the payload exposes, defensively. Anything unexpected =>
# empty text => no warning (fail open).

_TEXT_KEYS = (
    "systemMessage",
    "message",
    "text",
    "content",
    "stdout",
    "output",
    "response",
    "transcript",
    "last_assistant_message",
)


def _coerce_text(value, depth: int = 0) -> str:
    """Best-effort flatten of a value into searchable text. Bounded depth so a
    pathological payload can't recurse us to death (fail open on overflow)."""
    if depth > 6:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return ""
    parts: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            # Only descend into text-ish keys at the top level; deeper, take all
            # string leaves (tool output / message blocks vary in shape).
            if depth == 0 and k not in _TEXT_KEYS and k != "tool_response":
                continue
            parts.append(_coerce_text(v, depth + 1))
    elif isinstance(value, (list, tuple)):
        for item in value:
            parts.append(_coerce_text(item, depth + 1))
    return "\n".join(p for p in parts if p)


def extract_agent_text(hook_input: dict) -> str:
    """Pull the agent-facing text out of a PostToolUse/Stop hook payload."""
    if not isinstance(hook_input, dict):
        return ""
    chunks: list[str] = []
    # Tool output (PostToolUse): tool_response holds the result the agent sees.
    tr = hook_input.get("tool_response")
    if tr is not None:
        chunks.append(_coerce_text({"tool_response": tr}))
    # Direct top-level text-ish keys (Stop / generic).
    chunks.append(_coerce_text(hook_input))
    return "\n".join(c for c in chunks if c)


def main() -> None:
    try:
        raw = sys.stdin.read()
        if not raw or not raw.strip():
            sys.exit(0)  # nothing to scan — fail open
        hook_input = json.loads(raw)
        if not isinstance(hook_input, dict):
            sys.exit(0)

        text = extract_agent_text(hook_input)
        signals = _find_signals(text)
        if not signals:
            sys.exit(0)  # GREEN — no conserve framing

        listed = "; ".join(signals)
        warning = (
            "⚠️ BUDGET-USAGE-LINT: agent-facing output frames work around "
            "conserving Claude / token spend (" + listed + "). "
            "Full-throttle is the STANDING rule — there is NO real conservation "
            "premise. The free-Codex cap was self-inflicted; the famous "
            '"76% of the weekly budget" quote was an orc RELAY paraphrase, NOT a '
            "direct Etan turn. Drop the conserve framing and proceed at full "
            "throttle (or surface a REAL, sourced limit if one actually exists). "
            "[gen-18 Track 1 #5, R-032]"
        )
        # Non-blocking: stdout systemMessage surfaces in-band, stderr for logs.
        json.dump({"systemMessage": warning}, sys.stdout)
        print(warning, file=sys.stderr)
        sys.exit(0)
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001 — FAIL OPEN, advisory hook never blocks.
        sys.exit(0)


if __name__ == "__main__":
    main()

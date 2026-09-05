#!/usr/bin/env python3
"""
Frustration Capture UserPromptSubmit hook.

Detects user correction/frustration signals in the literal user prompt and
injects guidance to answer first, then run /frustration-capture in the same turn. The hook never
calls BrainLayer directly and always fails open.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import traceback
from dataclasses import dataclass
from pathlib import Path

DEADLINE_MS = 450
REGEX_BAIL_MS = 300
SKILL_MD_PATH = os.environ.get(
    "FRUSTRATION_SKILL_PATH",
    str(Path(__file__).resolve().parent.parent / "SKILL.md"),
)


@dataclass(frozen=True)
class Pattern:
    tier: int
    category: str
    regex: re.Pattern[str]


_SECOND_PERSON_FAILURE_VERBS = (
    r"are|were|did|deleted|broke|ignored|missed|used|pushed|keep|should|need"
)

_SECOND_PERSON_FAILURE_CUE = (
    rf"(?:you\s+(?:{_SECOND_PERSON_FAILURE_VERBS})|"
    r"you(?:['’]?re)\s+(?:not\s+)?[a-z]+ing|"
    r"you['’]ve\s+(?:not\s+)?[a-z]+(?:ed|en))"
)


PATTERNS = [
    # Tier 1: direct corrections
    Pattern(1, "communication", re.compile(r"\bno\b", re.IGNORECASE)),
    Pattern(1, "communication", re.compile(r"\bnot that\b", re.IGNORECASE)),
    Pattern(1, "communication", re.compile(r"\bwrong\b", re.IGNORECASE)),
    Pattern(1, "scope-drift", re.compile(r"\bstop\b", re.IGNORECASE)),
    Pattern(1, "communication", re.compile(r"\bI told you\b", re.IGNORECASE)),
    Pattern(1, "communication", re.compile(r"\bas I said\b", re.IGNORECASE)),
    Pattern(1, "communication", re.compile(r"\bit'?s not new\b", re.IGNORECASE)),
    Pattern(1, "communication", re.compile(r"\bwe spoke about\b", re.IGNORECASE)),
    Pattern(1, "scope-drift", re.compile(r"\bwait,?\s*(are|why)\b", re.IGNORECASE)),
    Pattern(1, "fabrication", re.compile(r"\bwhat do you mean\b", re.IGNORECASE)),
    # Tier 2: frustration escalation
    Pattern(2, "communication", re.compile(r"\bwhat the (hell|fuck)\b", re.IGNORECASE)),
    Pattern(2, "communication", re.compile(r"\bdamn it\b", re.IGNORECASE)),
    Pattern(2, "communication", re.compile(r"\bdumb\s?ass\b", re.IGNORECASE)),
    Pattern(2, "communication", re.compile(r"\bcome on\b", re.IGNORECASE)),
    Pattern(
        2,
        "communication",
        re.compile(r"\b(?:motherfucker|fuck(?:ing|ed|er|s)?)\b", re.IGNORECASE),
    ),
    Pattern(
        2,
        "communication",
        re.compile(
            r"\b(?:can|could|would|will)\s+you\b[^.!?\n]{0,80}"
            r"\bbullshit(?:ting)?\b|"
            r"\bbullshit(?:ting)?\b[^.!?\n]{0,80}"
            r"\b(?:fix|figure out|read|listen|stop|use|run|check|get)\b|"
            r"\bbullshit(?:ting)?\b[^.!?\n]{0,80}"
            rf"\b{_SECOND_PERSON_FAILURE_CUE}\b",
            re.IGNORECASE,
        ),
    ),
    Pattern(2, "communication", re.compile(r"\bare you (serious|kidding)\b", re.IGNORECASE)),
    Pattern(2, "communication", re.compile(r"\bno(?:\W+no){2,}\b", re.IGNORECASE)),
    Pattern(2, "communication", re.compile(r"\bno{3,}\b", re.IGNORECASE)),
    Pattern(2, "communication", re.compile(r"\b(?:ARGH|GEEZ|JEEZ|UGHH?|GAAH|STOP|JESUS|CHRIST|PLEASE|FINE|REALLY)\b")),
    # Tier 3: subtle frustration / user taking over
    Pattern(3, "overcomplicate", re.compile(r"\bwhy not just\b", re.IGNORECASE)),
    Pattern(3, "communication", re.compile(r"\bthat'?s fine,?\s*I guess\b", re.IGNORECASE)),
    Pattern(3, "deferral", re.compile(r"\bI can .* myself\b", re.IGNORECASE)),
]


# --- Stage A: speaker / context gate (SHIP-1 v2) -------------------------------
# The regex layer matches literal substrings regardless of WHO is speaking. In
# agent panes the "user prompt" is frequently agent-to-agent relay or harness-
# injected instruction text — not an Etan correction. Matching "no"/"stop"/"NOT"
# inside that text is the dominant false-fire source (observed 3x in one session:
# autonomous-loop instructions, an orc relay, a green-light relay). Stage A
# SUPPRESSES the hook only when CONFIDENT the prompt is non-Etan (clear relay /
# harness markers). When ambiguous it does nothing and lets the regex layer run,
# so a genuine Etan correction is never suppressed (recall-preserving by design).

# Agent-to-agent relay header, e.g. "[orc gen-9 → skillCreator] ..." or
# "[skillCreator->voicelayer-LEAD] ...". Arrow may be Unicode "→" or ASCII "->".
_RELAY_HEADER = re.compile(r"^\s*\[[^\]\n]{0,80}?(?:→|->)[^\]\n]{0,80}?\]")

# orc fleet-monitor cron opener — "FLEET TICK (...)" or "FLEET MONITOR TICK (...)".
# Generalized from the literal "fleet monitor tick" substring (#479 miss on gen-12
# phrasing). RE-SCORE §2: live payloads read "FLEET TICK (gen-12 orc, ...)".
_FLEET_TICK_OPENER = re.compile(r"^\s*FLEET(?:\s+MONITOR)?\s+TICK\b", re.IGNORECASE)

# Structured worker-status/escalation prompt, e.g. "ITEM-2 BLOCKER under
# LANE-LAW #6: ... No commit/push/PR yet."  These are lead-facing relays, not
# operator corrections, even when the transport records them as typed prompts.
_WORKER_STATUS_OPENER = re.compile(
    r"^\s*(?:ITEM-\d+|[A-Z][A-Z0-9_-]{2,})\s+(?:BLOCKER|STATUS|UPDATE)\b"
)

# --- E14 (weave 2026-06-07): orc/lead relay + spawn-brief guard ---------------
# 4 false fires across 3 sessions (cmux__64446d9b#15 x2, voicelayer/d42dca22#2,
# voicelayer/da17f55d#8): correction keywords inside relay/brief instruction
# text fired as Etan corrections. Gated the same way #483 gated FLEET TICK —
# confident openers/markers only; ambiguous text still reaches the regex layer.

# Agent self-identifying relay opener, e.g. "orcClaude-gen13 here (s:62) — ..."
# or "orcClaude-gen13: ETAN ORDER — ...". Requires an engine token with a
# prefix or suffix (bare "Claude:" / "Claude," stays live) plus a separator
# (":", em/en dash, " - ", or "]") before the body. Segment bodies exclude
# "-"/"_" so separator/body classes are disjoint — no ambiguous backtracking
# (PR #500 CodeQL py/redos).
_AGENT_RELAY_OPENER = re.compile(
    r"^\s*\[?"
    r"(?:[A-Za-z][A-Za-z0-9.]*(?:Claude|Codex|Cursor|Gemini)(?:[-_][A-Za-z0-9.]+)*"
    r"|(?:Claude|Codex|Cursor|Gemini)(?:[-_][A-Za-z0-9.]+)+)"
    r"(?:\s+here)?\s*(?:\([^)\n]{0,60}\))?\s*(?:\]|:|—|–|\s-+\s)"
)

# Spawn-brief opener, e.g. "You are voicelayerClaude-DESIGN (E5) under
# voicelayerClaude-LEAD-v2 — a CLAUDE worker...". The engine token must sit
# INSIDE the first identifier after "You are", with a prefix or suffix — so
# "You are wrong", "You are using Codex wrong", "You are an agent, no" and
# bare "You are Claude" all stay live (PR #500 Codex/Macroscope review).
_SPAWN_BRIEF_OPENER = re.compile(
    r"^\s*you are\s+"
    r"(?:[§\w-]{1,40}?(?:claude|codex|cursor|gemini)[\w-]{0,40}"
    r"|(?:claude|codex|cursor|gemini)[\w-]{1,40})\b",
    re.IGNORECASE,
)

# Brief plumbing that never appears in raw typed Etan turns. Contract forms
# only ("TASK_DONE: ..." / "TASK_DONE (phase 1): ...") so a live complaint
# that merely mentions TASK_DONE keeps firing (PR #500 Codex review); also
# guarded by looks_like_live_correction so a pasted brief + live correction
# still fires.
_SPAWN_BRIEF_MARKERS = (
    "task_done:",   # completion-contract line in dispatch briefs
    "task_done (",  # contract with qualifier, e.g. "TASK_DONE (phase 1):"
    "⛔",        # constraint glyph ("⛔ No server restarts...")
)

# Harness / system-injected markers. Presence => not a raw Etan message.
_HARNESS_MARKERS = (
    "<system-reminder>",
    "userpromptsubmit hook additional context",
    "important: after completing your current task",
    "# autonomous loop",
    "autonomous loop tick",
    "<<autonomous-loop",
    "[frustration signal detected",
    "[brainlayer auto]",
    "[brainlayer deep]",
    "[entity:",
    "this is ambient context",
    "the user sent a new message while you were working",
    # orchestrator-monitor cron prompts (recurring false-fire class): these are
    # scheduled agent prompts, never Etan corrections, but contain "no"/"stop".
    "silent orchestrator-monitor",
    "stay silent unless a real event",
    "# autonomous loop tick",
    "run the autonomous check",
    # legacy substring kept for mid-body mentions; line-start openers use _FLEET_TICK_OPENER.
    "fleet monitor tick",
    # workflow/queue plumbing can quote prior Etan corrections; not a live turn.
    "<task-notification",
    "</task-notification>",
    '"commandmode":"task-notification"',
    '"commandmode": "task-notification"',
    "queued_command",
    '"type":"queue-operation"',
    '"type": "queue-operation"',
    '"operation":"enqueue"',
    '"operation": "enqueue"',
)

_STANDING_RULE_RELAY_MARKERS = (
    "standing-rules block",
    "standing rules",
    "standing rule",
    "dispatch brief",
    "worker brief",
    "quoted in dispatch",
    "brief quoting",
)

_STANDING_RULE_TERMS = (
    "no --print",
    "no -p",
    "--print/-p",
    "no source ~/.zshrc",
    "do not use source ~/.zshrc",
)

_NEGATIVE_NO_CONTEXTS = (
    re.compile(r"\(\s*no\s+action\s*\)", re.IGNORECASE),
    re.compile(r"\bno[- ]op\b", re.IGNORECASE),
    re.compile(r"\bno\s+need\b", re.IGNORECASE),
    re.compile(r"\bfor\s+no\s+reason\b", re.IGNORECASE),
    re.compile(r"\bno\s+(?:commit|push|pr|change|update|result)s?(?:[/\w-]+)*\s+yet\b", re.IGNORECASE),
    re.compile(r"\bno\s+longer\b", re.IGNORECASE),
    re.compile(
        r"\bno\s+(?:rush|problem|worries|hurry|idea|preference|budget|way)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bno\s+(?:time|(?:ci\s+)?budget|docs?|one|reason|big\s+deal)\b",
        re.IGNORECASE,
    ),
)

_CONTINUATION_RESPONSE = re.compile(
    r"\bno,?\s+(?:continue(?:\s+(?:from\s+)?(?:the\s+)?(?:last\s+)?\d+)?|"
    r"go on|keep going)\b",
    re.IGNORECASE,
)

_SHORT_STANDALONE_NO = re.compile(r"^\s*no[.!?]?\s*$", re.IGNORECASE)

_NO_SUPPLIED_ANSWER_CUE = re.compile(
    r"^no(?:[.!?,:;]|\s*[—–])?\s+the\s+[a-z][a-z0-9 _-]{0,40}\s+is\b",
    re.IGNORECASE,
)

_NO_DIRECT_COMMAND_CUE = re.compile(
    r"^no(?:[.!?,:;]|\s*[—–])?\s+(?:just\s+)?(?:use|run|open|close|send)\b",
    re.IGNORECASE,
)

_NO_CORRECTION_CUES = re.compile(
    r"\b(?:wrong|not that|instead|i told you|as i said|we spoke about|i use|"
    r"i\s+(?:meant|asked for|said|wanted)|the other|"
    r"should be|"
    r"do it\s+[^.!?\n]{0,40}\s+way|"
    rf"{_SECOND_PERSON_FAILURE_CUE}|"
    r"that(?:'s| is)\s+(?:wrong|not)|this is not)\b",
    re.IGNORECASE,
)

_HISTORICAL_QUOTE_CUES = re.compile(
    r"\b(historical|quote|quoted|verbatim|previous|prior|earlier|yesterday|"
    r"transcript|evidence|digest|line\s+\d+|etan said|user said|standing rules?|"
    r"keyword|matcher|hook|pattern|matched)\b",
    re.IGNORECASE,
)

_F_WORD = re.compile(r"\bfuck(?:ing|ed|er|s)?\b", re.IGNORECASE)

_ESCALATION_CONTEXT = re.compile(
    r"\b(?:we need to|you need to|can you|could you|figure out|get this|"
    r"i(?:'ve| have) already said|i told you)\b",
    re.IGNORECASE,
)

_LIVE_CORRECTION_CUES = re.compile(
    r"^\s*(no\b|stop\b|wait\b|why\b|what\b|are you\b)|"
    r"\b(i told you|as i said|we spoke about|this is live)\b",
    re.IGNORECASE,
)

_STATUS_LIVE_CORRECTION_CUE = re.compile(
    rf"\bno[!,]?\s+{_SECOND_PERSON_FAILURE_CUE}\b|"
    r"\bno[!,]?\s+(?:not\s+that\b|"
    r"that(?:['’]s| is)\s+(?:not\b|(?:the\s+)?wrong\b))",
    re.IGNORECASE,
)


# --- gen-18 Track 6 D4 (weave 2026-06-21): review-mode brief gate ----------------
# False-fire class: a code-review / eval INSTRUCTION brief that tells a reviewer to be
# critical ("Review this PR as an adversarial reviewer — flag anything wrong", "Red-team
# review mode: assume the implementation is wrong") trips the regex layer on its
# instruction words ("wrong"/"no"/"stop") even though it is a brief handed TO a reviewer,
# not an Etan correction (corpus shapes: aftercode/72678720#1, orchestrator/0fe7bd59#1).
#
# Gated like every other Stage-A guard (_RELAY_HEADER / _SPAWN_BRIEF_OPENER /
# _FLEET_TICK_OPENER): match the OPENER only, anchored at `^`. A brief OPENS as a review
# directive; a live complaint ABOUT a past rubber-stamp review does not ("your review was
# a rubber stamp …", "you approved a broken diff", "no, …") — even when it reuses the same
# imperative wording ("flag anything", "do not just approve") mid-sentence. Opener-
# anchoring is what makes this recall-preserving: PR #523 Bugbot correctly flagged that a
# marker-anywhere + cue-anywhere match would suppress such complaints. `not
# looks_like_live_correction` stays as a belt-and-suspenders veto.
#
# The agent's-own-self-correction shape (da456dfd#1) is deliberately NOT gated: it is
# lexically indistinguishable from a genuine "No wait, I was wrong…" on reconstructed
# specimens and needs the verbatim turn + the Codex pair before any suppressor ships.
_REVIEW_BRIEF_OPENER = re.compile(
    r"^\s*\[?"
    r"(?:review (?:this|the )"
    r"|(?:red|blue).?team review\b"
    r"|review mode\b"
    r"|as an? (?:critical |adversarial |harsh |strict )?reviewer\b"
    r"|reviewer brief\b)",
    re.IGNORECASE,
)


def review_brief_suppresses(prompt: str) -> bool:
    """True when the prompt OPENS as a reviewer-instruction brief, not a live correction.

    Opener-anchored (not marker-anywhere): a complaint about a past review reuses brief
    wording mid-sentence but never opens as a review directive, so it still reaches the
    regex layer. `not looks_like_live_correction` is a defensive veto.
    """
    return bool(_REVIEW_BRIEF_OPENER.search(prompt)) and not looks_like_live_correction(prompt)


def looks_like_live_correction(prompt: str) -> bool:
    return bool(_LIVE_CORRECTION_CUES.search(prompt))


def speaker_suppresses(prompt: str) -> tuple[bool, str]:
    """Return (suppress, reason) when CONFIDENT the prompt is non-Etan.

    Conservative: only suppress on unambiguous relay/harness markers. Ambiguous
    or genuine-looking text returns (False, "") so the regex layer still runs.
    """
    if os.environ.get("FRUSTRATION_STAGE_A_DISABLED") == "1":
        return (False, "")
    if not prompt:
        return (False, "")
    if _RELAY_HEADER.search(prompt):
        return (True, "agent-relay header")
    if _FLEET_TICK_OPENER.search(prompt):
        return (True, "fleet-tick cron opener")
    if (
        _WORKER_STATUS_OPENER.search(prompt)
        and not looks_like_live_correction(prompt)
        and not _STATUS_LIVE_CORRECTION_CUE.search(prompt)
    ):
        return (True, "worker-status escalation opener")
    if _AGENT_RELAY_OPENER.search(prompt):
        return (True, "agent-relay opener")
    if _SPAWN_BRIEF_OPENER.search(prompt) and not looks_like_live_correction(prompt):
        return (True, "spawn-brief opener")
    lowered = prompt.lower()
    for marker in _HARNESS_MARKERS:
        if marker in lowered:
            return (True, f"harness marker: {marker!r}")
    if any(marker in lowered for marker in _SPAWN_BRIEF_MARKERS) and not looks_like_live_correction(prompt):
        return (True, "spawn-brief marker")
    if any(marker in lowered for marker in _STANDING_RULE_RELAY_MARKERS) and any(
        term in lowered for term in _STANDING_RULE_TERMS
    ) and not looks_like_live_correction(prompt):
        return (True, "relayed standing-rules block")
    if review_brief_suppresses(prompt):
        return (True, "review-mode reviewer brief")
    return (False, "")


def should_activate() -> bool:
    if os.environ.get("FRUSTRATION_HOOK_DISABLED") == "1":
        return False
    if os.environ.get("BRAINLAYER_HOOKS_DISABLED") == "1":
        return False
    if os.environ.get("CLAUDE_NON_INTERACTIVE") == "1":
        return False
    return True


def elapsed_ms(start: float) -> float:
    return (time.monotonic() - start) * 1000


def log_error(exc: BaseException) -> None:
    log_path = Path(
        os.environ.get(
            "FRUSTRATION_HOOK_LOG",
            str(Path.home() / "Library/Logs/frustration-hook.err.log"),
        )
    )
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(f"[{time.strftime('%Y-%m-%dT%H:%M:%S%z')}] {type(exc).__name__}: {exc}\n")
            handle.write(traceback.format_exc())
            handle.write("\n")
    except Exception:
        pass


def empty_json() -> None:
    print("{}")


def extract_prompt(payload: dict) -> str:
    prompt = payload.get("user_prompt")
    if prompt is None:
        prompt = payload.get("prompt", "")
    return prompt if isinstance(prompt, str) else ""


def spans_overlap(first: tuple[int, int], second: tuple[int, int]) -> bool:
    return max(first[0], second[0]) < min(first[1], second[1])


def span_inside_quote(prompt: str, start: int, end: int) -> bool:
    line_start = prompt.rfind("\n", 0, start) + 1
    line_end = prompt.find("\n", end)
    if line_end == -1:
        line_end = len(prompt)
    line = prompt[line_start:line_end]
    local_start = start - line_start
    local_end = end - line_start

    def single_quote_is_delimiter(index: int) -> bool:
        previous_char = line[index - 1] if index > 0 else ""
        next_char = line[index + 1] if index + 1 < len(line) else ""
        return not (previous_char.isalnum() and next_char.isalnum())

    def scan_symmetric_quote(quote: str) -> bool:
        opened_at: int | None = None
        for index, char in enumerate(line):
            if char != quote:
                continue
            if quote == "'" and not single_quote_is_delimiter(index):
                continue
            if opened_at is None:
                opened_at = index
                continue
            if opened_at < local_start and local_end <= index:
                return True
            opened_at = None
        return False

    def scan_paired_quote(open_quote: str, close_quote: str) -> bool:
        opened_at: int | None = None
        for index, char in enumerate(line):
            if char == open_quote and opened_at is None:
                opened_at = index
                continue
            if char == close_quote and opened_at is not None:
                if opened_at < local_start and local_end <= index:
                    return True
                opened_at = None
        return False

    for quote in ('"', "'", "`"):
        if scan_symmetric_quote(quote):
            return True
    for open_quote, close_quote in (("“", "”"), ("‘", "’")):
        if scan_paired_quote(open_quote, close_quote):
            return True

    return False


def match_is_negative_context(prompt: str, match: re.Match[str]) -> bool:
    start, end = match.span()
    matched = match.group(0).lower()
    if matched == "no":
        for regex in _NEGATIVE_NO_CONTEXTS:
            for context_match in regex.finditer(prompt):
                if spans_overlap((start, end), context_match.span()):
                    return True
        for continuation_match in _CONTINUATION_RESPONSE.finditer(prompt):
            if spans_overlap((start, end), continuation_match.span()):
                return True
        if not _SHORT_STANDALONE_NO.fullmatch(prompt):
            window = prompt[max(0, start - 100) : min(len(prompt), end + 140)]
            supplied_answer = prompt[start : min(len(prompt), end + 100)]
            if not (
                _NO_CORRECTION_CUES.search(window)
                or _NO_SUPPLIED_ANSWER_CUE.search(supplied_answer)
                or _NO_DIRECT_COMMAND_CUE.search(supplied_answer)
            ):
                return True

    if span_inside_quote(prompt, start, end):
        window = prompt[max(0, start - 180) : min(len(prompt), end + 180)]
        if _HISTORICAL_QUOTE_CUES.search(window):
            return True

    return False


def detect(prompt: str, start: float) -> list[tuple[Pattern, str]]:
    matches: list[tuple[Pattern, str]] = []
    for pattern in PATTERNS:
        if elapsed_ms(start) > REGEX_BAIL_MS:
            return []
        for match in pattern.regex.finditer(prompt):
            if match_is_negative_context(prompt, match):
                continue
            matches.append((pattern, match.group(0)))
            break
    return matches


def choose_category(prompt: str, matches: list[tuple[Pattern, str]]) -> str:
    if not matches:
        return "communication"
    lower = prompt.lower()
    if any(re.search(rf"\b{re.escape(word)}", lower) for word in ("brave", "helium", "chrome", "browser")) or "i use" in lower:
        return "assumption"
    if "fake" in lower or "fabricat" in lower or "made up" in lower or "what do you mean" in lower:
        return "fabrication"
    if any(re.search(rf"\b{re.escape(word)}\b", lower) for word in ("tool", "command", "flag", "cursor", "claude", "codex")):
        return "tool-misuse"
    if any(re.search(rf"\b{re.escape(word)}\b", lower) for word in ("wait", "scope")) or "wrong task" in lower:
        return "scope-drift"
    if "why not just" in lower or "overcomplicat" in lower:
        return "overcomplicate"
    return matches[0][0].category


def importance_for(tier: int, matches: list[tuple[Pattern, str]]) -> int:
    importance = tier + 6
    matched_text = " ".join(text.lower() for _, text in matches)
    has_repetition_signal = any(
        phrase in matched_text
        for phrase in ("i told you", "as i said", "we spoke about", "no no")
    )
    if has_repetition_signal or (tier >= 2 and len(matches) > 1):
        importance += 1
    return min(10, importance)


def tier_for(prompt: str, matches: list[tuple[Pattern, str]]) -> int:
    """Return severity tier, promoting sustained directed profanity to Tier 3."""
    tier = max(pattern.tier for pattern, _ in matches)
    if len(_F_WORD.findall(prompt)) >= 2 and _ESCALATION_CONTEXT.search(prompt):
        return max(tier, 3)
    return tier


def build_context(prompt: str, matches: list[tuple[Pattern, str]]) -> str:
    highest_tier = tier_for(prompt, matches)
    category = choose_category(prompt, matches)
    importance = importance_for(highest_tier, matches)
    matched_values = [text.strip() for _, text in matches]
    first_match = matched_values[0]
    multiple_line = ""
    if len(matched_values) > 1:
        quoted = ", ".join(f"'{value}'" for value in matched_values[:5])
        multiple_line = f"\nMultiple correction/frustration patterns matched: {quoted}."

    return (
        f"[FRUSTRATION SIGNAL DETECTED - Tier {highest_tier}, category {category}]\n"
        f"User correction pattern matched: '{first_match}'.{multiple_line}\n"
        "ANSWER the user FIRST — never make them wait on ceremony. Then check whether this "
        "is a genuine correction; store only if real. If genuine, run /frustration-capture "
        f"in the same turn, AFTER the answer, at importance >={importance}, quoting the user "
        "verbatim. If the user is actively conversing, the store rides the answer turn - it "
        "never precedes or replaces it. Do not fabricate a correction from a lexical match.\n\n"
        f"See {SKILL_MD_PATH} for full template."
    )


def emit(additional_context: str) -> None:
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": additional_context,
        },
    }
    print(json.dumps(payload, ensure_ascii=True))


def main() -> int:
    start = time.monotonic()
    try:
        try:
            payload = json.loads(sys.stdin.read() or "{}")
        except json.JSONDecodeError as exc:
            log_error(exc)
            empty_json()
            return 0

        if not should_activate():
            return 0

        prompt = extract_prompt(payload)
        if not prompt or prompt.strip().startswith("/"):
            return 0

        # Stage A: suppress when confident the prompt is agent-relay / harness
        # text rather than an Etan correction (kills the dominant false-fires).
        suppress, _reason = speaker_suppresses(prompt)
        if suppress:
            return 0

        matches = detect(prompt, start)
        if not matches:
            return 0

        if elapsed_ms(start) > DEADLINE_MS:
            return 0

        emit(build_context(prompt, matches))
        return 0
    except Exception as exc:
        log_error(exc)
        empty_json()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

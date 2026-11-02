#!/usr/bin/env python3
"""Research-link reminder: a UserPromptSubmit hook that never blocks.

When the literal user prompt carries a Google Docs document link or a Gemini
share link, it adds one line of context telling the agent to load
/research-lifecycle first. Otherwise it prints nothing. It never denies, and
any failure exits 0 with no output (fail open). It recognizes literal URLs only:
percent-encoded or otherwise obfuscated links are not decoded or covered.

Why a hook rather than better description wording: Etan pastes research doc
links bare and never says "research lifecycle", so the description never
matches (skill-creator E2/E3, 2026-11-02). A link is a deterministic input
shape, and placement reaches it where wording cannot.
"""

from __future__ import annotations

import os
import sys

# AIDEV-NOTE: no hook dir is ever FIRST on sys.path, even when this file runs
# without the launcher: the stdlib must win over anything planted beside it.
_HOOK_DIR = os.path.dirname(os.path.realpath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) != _HOOK_DIR] + [_HOOK_DIR]

import json
import re

# AIDEV-NOTE: the skip clause is measured wording (E3 iteration 2): without it the
# reminder loaded the skill on a CV link and on a doc link a PR review cited.
REMINDER = (
    "Load /research-lifecycle first: this prompt carries a research doc link "
    "({kinds}). Its § INCOMING RESEARCH DOC LINK says how to harvest it. "
    "Skip this only when the prompt itself says the doc is not research "
    "(for example a CV, onboarding notes, or a link a PR or code change cites)."
)

# Google Docs documents only (not /spreadsheets/ or /presentation/), with or
# without a /u/<n>/ account segment, plus Gemini share links in both forms.
LINK_PATTERNS = (
    ("Google Docs document", re.compile(r"https?://docs\.google\.com/document/(?:u/\d+/)?d/[A-Za-z0-9_-]{10,}")),
    ("Gemini share", re.compile(r"https?://gemini\.google\.com/share/[A-Za-z0-9_-]{6,}")),
    ("Gemini share", re.compile(r"https?://g\.co/gemini/share/[A-Za-z0-9_-]{6,}")),
)

# Text that quotes a link instead of handing one over: fenced code (a diff, a
# config, a log) and inline code spans. Fences follow CommonMark: a line opening
# with 3+ backticks or 3+ tildes (up to 3 spaces of indent) runs until a line of
# the SAME character at least as long, or to the end of the prompt if unclosed.
# A shorter or different fence inside (``` inside ````, ``` inside ~~~) is content.
_FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_INLINE_CODE = re.compile(r"(`+)(?!`).+?(?<!`)\1(?!`)")

# Harness-written prompts that replay old links: compaction summaries and
# background-task notifications.
_HARNESS_OPENERS = (
    "This session is being continued from a previous conversation",
    "<task-notification",
)


def extract_prompt(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    prompt = payload.get("prompt")
    if prompt is None:
        prompt = payload.get("user_prompt", "")
    return prompt if isinstance(prompt, str) else ""


def strip_fenced(prompt: str) -> str:
    kept: list[str] = []
    fence: str | None = None
    for line in prompt.split("\n"):
        if fence is None:
            opened = _FENCE_OPEN.match(line)
            if opened and not (opened.group(1)[0] == "`" and "`" in line[opened.end():]):
                fence = opened.group(1)
                continue
            kept.append(line)
            continue
        closing = re.match(r"^ {0,3}(" + re.escape(fence[0]) + r"{" + str(len(fence)) + r",})\s*$", line)
        if closing:
            fence = None
    return "\n".join(kept)


def link_kinds(prompt: str) -> list[str]:
    if prompt.lstrip().startswith(_HARNESS_OPENERS):
        return []
    text = _INLINE_CODE.sub(" ", strip_fenced(prompt))
    kinds: list[str] = []
    for kind, pattern in LINK_PATTERNS:
        if pattern.search(text) and kind not in kinds:
            kinds.append(kind)
    return kinds


def build_output(prompt: str) -> dict | None:
    kinds = link_kinds(prompt)
    if not kinds:
        return None
    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": REMINDER.format(kinds=", ".join(kinds)),
        }
    }


def main() -> int:
    try:
        if os.environ.get("RESEARCH_LINK_HOOK_DISABLED") == "1":
            return 0
        payload = json.loads(sys.stdin.read() or "{}")
        output = build_output(extract_prompt(payload))
        if output is not None:
            print(json.dumps(output, ensure_ascii=True))
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

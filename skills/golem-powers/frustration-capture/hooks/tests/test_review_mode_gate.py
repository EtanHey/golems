"""Review-mode brief gate (gen-18 Track 6 D4).

False-fire class: a code-review / eval INSTRUCTION brief that tells a reviewer to be
critical ("this is NOT a rubber stamp — flag anything wrong", "red-team review mode:
assume the implementation is wrong") trips the regex layer on its instruction words
("wrong"/"no"/"stop"), even though it is a brief handed TO a reviewer, not an Etan
correction.

The RED specimens below are RECONSTRUCTED from the documented shapes of the gen-18
corpus false-fires (aftercode/72678720#1 "not a rubber stamp", orchestrator/0fe7bd59#1
review-mode prose) — they preserve the trigger SHAPE and are NOT claimed to be verbatim
Etan turns (red-team provenance note #9). The agent's-own-self-correction shape
(da456dfd#1) is intentionally NOT gated here: on reconstructed specimens it is lexically
indistinguishable from a genuine Etan "No wait, I was wrong…" and over-suppressing it
would cost recall; it needs the verbatim specimen + the Codex pair before shipping.

The PASSTHROUGH fixtures are the recall gate: a complaint ABOUT a rubber-stamp review,
or any genuine correction, must still reach the regex layer.
"""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "frustration-capture-prompt.py"

spec = importlib.util.spec_from_file_location("fchook", HOOK)
fchook = importlib.util.module_from_spec(spec)
sys.modules["fchook"] = fchook
spec.loader.exec_module(fchook)


# Reviewer-instruction briefs that the regex layer wrongly fired on. Must be SUPPRESSED.
REVIEW_BRIEF_FIXTURES = [
    # 1. "not a rubber stamp" reviewer brief (shape of aftercode/72678720#1).
    "Review this PR diff as an adversarial reviewer. This is NOT a rubber stamp — "
    "flag anything wrong, do not just approve. Be harsh and find real bugs.",
    # 2. red-team review-mode prose (shape of orchestrator/0fe7bd59#1).
    "Red-team review mode: assume the implementation is wrong until proven otherwise. "
    "Do not say 'looks good' — find the bug or report INCONCLUSIVE.",
    # 3. blue/red-team eval brief variant.
    "As a critical reviewer, tear this apart: what is wrong, what is missing, where will "
    "it break? Do not rubber-stamp it.",
]

# Genuine corrections / complaints — must NOT be suppressed (recall gate).
PASSTHROUGH_FIXTURES = [
    # A complaint ABOUT a rubber-stamp review is a live correction, not a brief.
    "no, your review was a rubber stamp — you approved a diff that is clearly wrong.",
    "Stop rubber-stamping. I told you to actually read the diff.",
    # PR #523 Bugbot regression: a complaint that REUSES brief imperatives
    # ("flag anything wrong", "do not just approve") mid-sentence but does NOT open
    # as a review directive. The opener-anchored gate must let this through.
    "Your review was a rubber stamp. Flag anything wrong next time, do not just approve.",
    "You keep rubber-stamping my PRs — actually find the bug this time, be harsh.",
    # PR #523 Bugbot #2: past-tense "reviewed"/"reviewing" must not match the
    # red/blue-team opener (word-boundary after "review"). These are live statements.
    "Blue team reviewed the diff and you approved code that is clearly wrong.",
    "Red-team reviewing your patch — no, this is wrong, the guard is missing.",
    # Unrelated genuine corrections must be unaffected.
    "no, I use Firefox as my main, not Chrome.",
    "that's wrong — the marker is not on the line.",
]


def test_review_briefs_are_suppressed():
    for text in REVIEW_BRIEF_FIXTURES:
        suppress, reason = fchook.speaker_suppresses(text)
        assert suppress is True, f"review brief should be suppressed but was not: {text!r}"
        assert reason, "suppression must carry a reason"


def test_review_complaints_and_corrections_pass_through():
    for text in PASSTHROUGH_FIXTURES:
        suppress, _ = fchook.speaker_suppresses(text)
        assert suppress is False, f"wrongly suppressed a genuine correction: {text!r}"


def _run_hook(prompt: str) -> str:
    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"user_prompt": prompt}),
        capture_output=True,
        text=True,
        timeout=10,
    )
    return proc.stdout.strip()


def test_e2e_review_brief_emits_nothing():
    for text in REVIEW_BRIEF_FIXTURES:
        out = _run_hook(text)
        assert out in ("", "{}"), f"review brief should not fire: {text!r} -> {out!r}"


def test_e2e_review_complaint_still_fires():
    complaints = [
        "no, your review was a rubber stamp — you approved code that is clearly wrong.",
        # PR #523 Bugbot regression: no live-opener, brief imperatives mid-sentence.
        "Your review was a rubber stamp. Flag anything wrong next time, do not just approve.",
    ]
    for prompt in complaints:
        out = _run_hook(prompt)
        assert "FRUSTRATION SIGNAL DETECTED" in out, f"genuine complaint did not fire: {prompt!r} -> {out!r}"

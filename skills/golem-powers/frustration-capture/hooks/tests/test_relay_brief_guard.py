"""Stage A extension: orc/lead relay + spawn-brief guard (E14, weave 2026-06-07).

The 4 SUPPRESS fixtures are synthetic equivalents of the documented false-fires
(4 fires, 3 sessions — every seat refused correctly, but the hook kept crying
wolf). Shapes match the raw sessions; wording/names are genericized:

- cmux__64446d9b#15 (x2): correction keywords inside orc-relay text
  ("stop" at [line 1162] via the relay at [line 1157]; "NO" at [line 1299] via
  the relay at [line 1293]) fired as operator corrections at the seat.
- voicelayer/d42dca22#2: fired on a spawn brief's instruction text
  ("⛔ No server restarts...") [line 15], brief at [line 6].
- voicelayer/da17f55d#8: Tier-1 false positive on dispatch text ("NOT the web
  page", "no way to delete") [line 35], brief at [line 25].

The PASSTHROUGH fixtures are paraphrased operator corrections that brush against
the new guard shapes (bare engine names, "You are wrong...") and MUST still reach
the regex layer (recall-preserving, same contract as test_stage_a_gate.py).
"""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "frustration-capture-prompt.py"

spec = importlib.util.spec_from_file_location("fchook_relay", HOOK)
fchook = importlib.util.module_from_spec(spec)
sys.modules["fchook_relay"] = fchook  # register so @dataclass can resolve __module__
spec.loader.exec_module(fchook)


# --- The 4 documented false-fires (verbatim session excerpts) ------------------

SUPPRESS_FIXTURES = [
    # 1. cmux__64446d9b#15 — orc relay, self-identifying opener; fired on "stop"
    #    ("stop monitors"). Raw session [line 1157], misfire noted [line 1162].
    #    Synthetic equivalent: same opener + trigger shapes, genericized body.
    "orcClaude-gen13 here (s:62) — §4d ACK posted in the shared collab; keys + "
    "convergence authority taken. Your watches are ABSORBED: the resource "
    "sampler is re-armed as a DETACHED launchd job. Per the operator's "
    "consolidation order: post your final entry in the state-fixes collab (any "
    "last state I should hold), then retire clean — stop monitors, close your "
    "own pane.",
    # 2. cmux__64446d9b#15 — orc relay of an operator order; fired on "NO"
    #    ("NO restart"). Raw session [line 1293], misfire noted [line 1299].
    #    Synthetic equivalent: same relay-colon opener + NO-restart shape.
    "orcClaude-gen13: OPERATOR ORDER — the 05:30 maintenance ritual is DISARMED "
    "(launchctl unload verified; it would collide with the morning-briefing "
    "pipeline). Replacement safety net, you own it: if footprint crosses ~20GB "
    "before 04:30, fire the ritual MANUALLY at that point; after 04:30, NO "
    "restart until the briefing publishes (~06:15) unless panic-class "
    "thresholds (free<20%). Post ACK to the shared collab.",
    # 3. voicelayer/d42dca22#2 — spawn brief; fired on "no"/"stop" in the
    #    constraint tail "⛔ No server restarts...". Raw session [line 6],
    #    misfire noted [line 15]. Synthetic equivalent: same "You are
    #    <agent-role>" opener + TASK_DONE contract + ⛔ tail.
    "You are voicelayerClaude-DESIGN (E5) under voicelayerClaude-LEAD-v2 — a "
    "CLAUDE worker, spawned because the operator explicitly asked for a "
    "dedicated design pass. Repo: voicelayer. Your surface: the review-web "
    "session page. Screenshot the CURRENT page in every reachable state on "
    ":8860 (the working instance — read-only, do NOT disturb; the operator may "
    "be using it). TASK_DONE (phase 1): spec path + screenshot dir + the 5 "
    "highest-impact changes ranked. ⛔ No server restarts, no app/daemon/screen "
    "touches, headless browser only.",
    # 4. voicelayer/da17f55d#8 — dispatch brief; Tier-1 false positive on task
    #    text ("NOT the web page", "no way to delete"). Raw session [line 25],
    #    misfire noted [line 35]. Synthetic equivalent: same brief opener +
    #    quoted-complaint shape with genericized wording.
    "You are voicelayerClaude-SETTINGS-DESIGN under voicelayerClaude-LEAD-v2 — "
    "a CLAUDE worker; the operator explicitly asked for a dedicated design "
    "agent. Repo: voicelayer. Surface: the app SETTINGS WINDOW. This is the "
    "macOS native app, NOT the web page. Reported issue: \"I can't remove "
    "entries or add new ones... there's no place to add an entry... no way to "
    "delete or add entries\" — Corrections has add; Terms has NOTHING. "
    "TASK_DONE: PR number + spec path + before/after screenshots.",
]

# Paraphrased operator corrections that brush against the new guard shapes — Stage A
# must NOT suppress these (regex layer must still run).
PASSTHROUGH_FIXTURES = [
    # Starts with "You are" but carries no agent-role token — live correction.
    "You are wrong — stop, I told you Firefox not Chrome.",
    # Bare engine name + comma is how the operator addresses the seat, not a relay header.
    "Claude, no — stop. I use Firefox, not Chrome.",
    "no Claude, stop — that's the wrong pane.",
    # Engine name mid-sentence, not an opener.
    "why is Codex doing that? no, stop it.",
    # PR #500 Codex/Macroscope review: engine/role words in ordinary "You are"
    # sentences are NOT brief openers — these must keep firing.
    "You are using Codex wrong — stop doing that.",
    "You are an agent, no, stop using Chrome.",
    "You are Claude, not Codex — stop, wrong tool.",
    # PR #500 Codex review: a TASK_DONE mention in a live complaint is not
    # brief plumbing — the contract-form marker must not eat it.
    "The TASK_DONE result is wrong, do it again.",
]


def test_pathological_agent_name_is_linear_time():
    # PR #500 CodeQL py/redos: the relay-opener regex must not backtrack
    # exponentially on long ambiguous agent-name shapes.
    import time

    pathological = "orcCodex" + "-a._" * 300 + "!"
    start = time.monotonic()
    fchook.speaker_suppresses(pathological)
    assert time.monotonic() - start < 0.1, "relay-opener regex backtracks superlinearly"


def test_suppresses_documented_relay_and_brief_false_fires():
    for text in SUPPRESS_FIXTURES:
        suppress, reason = fchook.speaker_suppresses(text)
        assert suppress is True, f"should suppress but did not: {text[:80]!r}"
        assert reason, "suppression must carry a reason"


def test_passes_through_genuine_corrections_near_guard_shapes():
    for text in PASSTHROUGH_FIXTURES:
        suppress, _ = fchook.speaker_suppresses(text)
        assert suppress is False, f"wrongly suppressed a genuine correction: {text!r}"


# --- End-to-end: hook emits nothing for the false-fires, fires for real ones ---

def _run_hook(prompt: str) -> str:
    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"user_prompt": prompt}),
        capture_output=True,
        text=True,
        timeout=10,
    )
    return proc.stdout.strip()


def test_e2e_documented_false_fires_emit_nothing():
    for text in SUPPRESS_FIXTURES:
        out = _run_hook(text)
        assert out in ("", "{}"), f"expected no activation for {text[:80]!r}, got: {out!r}"


def test_e2e_genuine_corrections_near_guard_shapes_still_fire():
    for text in PASSTHROUGH_FIXTURES:
        out = _run_hook(text)
        assert "FRUSTRATION SIGNAL DETECTED" in out, (
            f"genuine correction did not fire: {text!r} -> {out!r}"
        )

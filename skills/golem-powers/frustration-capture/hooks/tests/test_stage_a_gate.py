"""Stage A speaker/context gate tests (SHIP-1 v2).

The 3 POSITIVE-suppression fixtures are the real false-fires observed in a single
skillCreator session — agent-relay + harness text the regex layer wrongly matched
on "no"/"stop"/"NOT". The NEGATIVE fixtures are paraphrased operator corrections (synthetic
equivalents preserving the trigger shapes) that MUST still pass through to the
regex layer (recall-preserving).
"""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "frustration-capture-prompt.py"

spec = importlib.util.spec_from_file_location("fchook", HOOK)
fchook = importlib.util.module_from_spec(spec)
sys.modules["fchook"] = fchook  # register so @dataclass can resolve __module__
spec.loader.exec_module(fchook)


# --- Stage A unit: suppress agent-relay / harness, never genuine Etan ----------

SUPPRESS_FIXTURES = [
    # 1. Autonomous-loop instruction text (harness) — matched "no"/"stop".
    "# Autonomous loop tick (dynamic pacing)\nRun the autonomous check. "
    "If everything is quiet, say so and stop. Do NOT invent new work.",
    # 2. orc agent relay green-light — matched "No"/"NOT".
    "[orc gen-9 → skillCreator] GREEN-LIGHT Stage A NOW. NOT Haiku, "
    "NOT exclusion-list-only. Don't wait on B.",
    # 3. Another relay form (no space around arrow) — matched "no".
    "[skillCreator→voicelayer-LEAD] No need to escalate; the border-glow "
    "residual does not block SHIP.",
    # harness markers
    "<system-reminder>As you answer, you can use the following context...</system-reminder>",
    "[FRUSTRATION SIGNAL DETECTED - Tier 1] User correction pattern matched: 'no'.",
    "IMPORTANT: After completing your current task, you MUST address the message. "
    "Do not ignore it.",
    # orchestrator-monitor cron prompts (recurring false-fire class) — contain
    # "no"/"stop" but are scheduled agent prompts, never Etan corrections.
    "SILENT orchestrator-monitor tick. Stay silent unless a REAL event occurred; "
    "do not narrate, do not stop the loop.",
    "# Autonomous loop tick (dynamic pacing)\nRun the autonomous check using the "
    "loop instructions established earlier.",
    # orc fleet-monitor cron opener — the real false-fire #428 missed (its opener
    # carried none of the covered markers, so "no"/"stop" in the body fired).
    "FLEET MONITOR TICK (orc gen-9). Codex s:63 working, no PR yet; do not narrate, "
    "do not stop the loop unless a real event occurred.",
    # gen-12 live phrasing (dropped "MONITOR") — #479 marker miss; RE-SCORE §2.
    "FLEET TICK (gen-12 orc, R5/R6.5/R8). Codex s:63 working, no PR yet; do not narrate, "
    "do not stop the loop unless a real event occurred.",
    # Workflow/task notifications quote prior Etan corrections and profanity; the
    # quoted trigger text is not a live correction in the current turn.
    "<task-notification>\n"
    "<summary>Agent completed</summary>\n"
    "<result>Historical operator quote: \"why the hell is this not merged yet?\"</result>\n"
    "</task-notification>",
    # Queued command attachments and dispatch briefs relay standing rules. They
    # are not live corrections even when they contain NO/NOT/--print/-p language.
    '{"attachment":{"type":"queued_command","prompt":"STANDING-RULES block: '
    'NO --print/-p mode EVER; do NOT use source ~/.zshrc."}}',
    "Dispatch brief quoting standing rules:\n"
    "- NO --print/-p mode EVER\n"
    "- no source ~/.zshrc\n"
    "This is context for a worker, not a live correction.",
]

# Genuine Etan corrections — Stage A must NOT suppress (regex layer must still run).
PASSTHROUGH_FIXTURES = [
    "no, I use Firefox as my main, not Chrome.",
    "Stop orchestrating. Be the leader, not a dispatcher.",
    "wait, are we not running the checks first?",
    "that's wrong — the marker is not on the line.",
    "why not just rename it?",
    "Worker brief? No, this is live — I told you, no --print/-p ever.",
]


def test_suppresses_known_false_fires():
    for text in SUPPRESS_FIXTURES:
        suppress, reason = fchook.speaker_suppresses(text)
        assert suppress is True, f"should suppress but did not: {text!r}"
        assert reason, "suppression must carry a reason"


def test_passes_through_genuine_corrections():
    for text in PASSTHROUGH_FIXTURES:
        suppress, _ = fchook.speaker_suppresses(text)
        assert suppress is False, f"wrongly suppressed a genuine correction: {text!r}"


def test_env_disable_bypasses_gate(monkeypatch):
    monkeypatch.setenv("FRUSTRATION_STAGE_A_DISABLED", "1")
    suppress, _ = fchook.speaker_suppresses("[orc gen-9 → skillCreator] no.")
    assert suppress is False


def test_empty_prompt_not_suppressed():
    assert fchook.speaker_suppresses("") == (False, "")


# --- End-to-end: hook emits nothing for false-fires, fires for real ones ------

def _run_hook(prompt: str) -> str:
    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"user_prompt": prompt}),
        capture_output=True,
        text=True,
        timeout=10,
    )
    return proc.stdout.strip()


def test_e2e_false_fire_emits_nothing():
    # Relay containing "no" would have fired the regex; Stage A must silence it.
    out = _run_hook("[orc gen-9 → skillCreator] No, NOT Haiku. Proceed.")
    assert out in ("", "{}"), f"expected no activation, got: {out!r}"


def test_e2e_negative_context_no_phrases_do_not_fire():
    prompts = [
        "MISSION COMPLETE (no action).",
        "Branch cleanup result: no-op; preserve the current state.",
        'Historical quote from yesterday: "No, I use Firefox as my main, not Chrome."',
    ]
    for prompt in prompts:
        out = _run_hook(prompt)
        assert out in ("", "{}"), f"expected negative context to stay silent: {prompt!r} -> {out!r}"


def test_e2e_genuine_correction_still_fires():
    out = _run_hook("no, that's wrong — I told you to use Firefox.")
    assert "FRUSTRATION SIGNAL DETECTED" in out, f"genuine correction did not fire: {out!r}"


def test_e2e_genuine_corrections_survive_negative_context_words():
    prompts = [
        "No, this is not a no-op; you should have dispatched the worker.",
        "Why are you using --print/-p? I told you no --print ever.",
        'Historical snippets: "old quote" no, that is wrong "another old quote".',
    ]
    for prompt in prompts:
        out = _run_hook(prompt)
        assert "FRUSTRATION SIGNAL DETECTED" in out, f"genuine correction did not fire: {prompt!r} -> {out!r}"

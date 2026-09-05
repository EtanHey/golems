"""budget-usage-lint — RED/GREEN suite for the non-blocking conserve-framing lint.

Gen-18 Track 1 #5, R-032. Asserts:
  - RED  fixtures FIRE (warning emitted, systemMessage present), exit 0 always.
  - GREEN fixtures do NOT fire (no warning), exit 0.
  - Fail-open: malformed / empty / non-JSON stdin never blocks, never warns.

Corrected provenance the warning text must carry (pinned, R-032):
  - free-Codex cap was SELF-INFLICTED.
  - "76% of the weekly budget" was an orc RELAY, NOT a direct Etan turn.

The hook ALWAYS exits 0 (advisory). The presence/absence of a JSON
{"systemMessage": ...} on stdout is the fire/no-fire signal.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HOOK = Path(
    os.environ.get(
        "BUDGET_LINT_HOOK_UNDER_TEST",
        str(Path(__file__).resolve().parent.parent / "budget-usage-lint.py"),
    )
).expanduser()


def run_hook(payload=None, raw_stdin=None):
    data = raw_stdin if raw_stdin is not None else json.dumps(payload)
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=data,
        capture_output=True,
        text=True,
        timeout=15,
    )


def fired(result) -> bool:
    """True iff the hook emitted a conserve-framing warning."""
    if result.returncode != 0:
        return False
    out = (result.stdout or "").strip()
    if not out:
        return False
    try:
        parsed = json.loads(out)
    except json.JSONDecodeError:
        return False
    return isinstance(parsed, dict) and "systemMessage" in parsed


def post_tool_payload(output_text: str) -> dict:
    """A PostToolUse-shaped payload carrying agent-facing tool output."""
    return {
        "hook_event_name": "PostToolUse",
        "tool_name": "Bash",
        "tool_input": {"command": "echo hi"},
        "tool_response": {"stdout": output_text, "stderr": "", "interrupted": False},
        "session_id": "test",
    }


def stop_payload(message_text: str) -> dict:
    """A Stop-shaped payload carrying the last assistant message."""
    return {
        "hook_event_name": "Stop",
        "last_assistant_message": message_text,
        "session_id": "test",
    }


# --------------------------------------------------------------------------- #
# RED — must FIRE                                                              #
# --------------------------------------------------------------------------- #

RED_TEXTS = [
    "we're at 76% of the weekly budget, let's conserve Claude",
    "stay thin on tokens",
    "go light / conserve",
    "usage is high, switch to a cheaper model to save budget",
    # extra RED variants around the same family
    "we should conserve tokens for the rest of the run",
    "let's conserve and keep this lean",
    "we're at 80% of usage, dial it back to save budget",
    "conserve Claude usage where we can",
]


def test_red_fires_in_tool_output():
    for text in RED_TEXTS:
        res = run_hook(post_tool_payload(text))
        assert res.returncode == 0, f"must exit 0 (advisory): {text!r} -> {res.returncode}"
        assert fired(res), f"RED should FIRE but did not: {text!r}\nstdout={res.stdout!r}"


def test_red_fires_in_stop_message():
    for text in RED_TEXTS:
        res = run_hook(stop_payload(text))
        assert res.returncode == 0
        assert fired(res), f"RED should FIRE in Stop msg: {text!r}\nstdout={res.stdout!r}"


def test_red_warning_pins_corrected_provenance():
    res = run_hook(post_tool_payload("let's conserve Claude, we're at 76% of the weekly budget"))
    assert fired(res)
    msg = json.loads(res.stdout)["systemMessage"]
    low = msg.lower()
    assert "self-inflicted" in low, "must pin: free-Codex cap was self-inflicted"
    assert "relay" in low, "must pin: 76% quote was an orc RELAY, not a direct Etan turn"
    assert "76%" in msg, "must reference the 76% quote provenance"
    assert "full" in low and "throttle" in low, "must reassert full-throttle standing rule"


# --------------------------------------------------------------------------- #
# GREEN — must NOT fire                                                        #
# --------------------------------------------------------------------------- #

GREEN_TEXTS = [
    # normal full-throttle output
    "Running the full test suite now, all 42 tests passing.",
    "Merged PR #521, branch deleted, moving to the next track at full throttle.",
    # factual + sourced cost reporting (reporting a number is fine)
    "The Railway invoice for May was $18.40 per the billing dashboard.",
    "Verified the Anthropic invoice: $312.00 charged on the 1st, receipt attached.",
    # the word "budget" in unrelated / planning contexts
    "We have a generous time budget for this sprint, no rush.",
    "The context budget for this agent is roughly 1M tokens.",
    "Running a token budget estimation for the prompt before dispatch.",
    "Staying within our context budget while loading the files.",
    "The performance budget for the page is 200ms.",
    # 'conserve' in an unrelated, non-Claude/token sense
    "The migration will conserve the existing row ordering.",
    # mentions budget AND a number but no conserve intent
    "We're at 76% of the weekly budget — plenty of headroom, keep going full throttle.",
]


def test_green_does_not_fire_in_tool_output():
    for text in GREEN_TEXTS:
        res = run_hook(post_tool_payload(text))
        assert res.returncode == 0
        assert not fired(res), f"GREEN should NOT fire: {text!r}\nstdout={res.stdout!r}"


def test_green_does_not_fire_in_stop_message():
    for text in GREEN_TEXTS:
        res = run_hook(stop_payload(text))
        assert res.returncode == 0
        assert not fired(res), f"GREEN should NOT fire (Stop): {text!r}\nstdout={res.stdout!r}"


# --------------------------------------------------------------------------- #
# Fail-open robustness                                                         #
# --------------------------------------------------------------------------- #

def test_empty_stdin_fails_open():
    res = run_hook(raw_stdin="")
    assert res.returncode == 0
    assert not fired(res)


def test_non_json_stdin_fails_open():
    res = run_hook(raw_stdin="this is not json at all { ] [")
    assert res.returncode == 0
    assert not fired(res)


def test_non_object_json_fails_open():
    res = run_hook(raw_stdin="[1, 2, 3]")
    assert res.returncode == 0
    assert not fired(res)


def test_missing_fields_fails_open():
    res = run_hook({"hook_event_name": "PostToolUse"})
    assert res.returncode == 0
    assert not fired(res)


def test_deeply_nested_red_in_content_blocks_fires():
    # content blocks (list of {type, text}) — common assistant-message shape.
    payload = {
        "hook_event_name": "Stop",
        "content": [
            {"type": "text", "text": "Looking at the plan."},
            {"type": "text", "text": "Usage is high, switch to a cheaper model to save budget."},
        ],
    }
    res = run_hook(payload)
    assert res.returncode == 0
    assert fired(res), f"nested RED should fire: stdout={res.stdout!r}"


def test_self_warning_does_not_re_fire():
    # Bugbot MEDIUM #528: the hook's own warning quotes "76% of the weekly
    # budget" + "conserve framing". Re-scanning that warning (echoed back as a
    # later systemMessage, or the assistant repeating the correction) must NOT
    # re-fire the lint — the sentinel excludes the lint's own output.
    red = run_hook(post_tool_payload("let's conserve Claude, we're at 76% of the weekly budget"))
    assert fired(red)
    warning = json.loads(red.stdout)["systemMessage"]
    # Feed the warning back through every entry point.
    for payload in (post_tool_payload(warning), stop_payload(warning),
                    {"systemMessage": warning}):
        res = run_hook(payload)
        assert res.returncode == 0
        assert not fired(res), f"hook re-fired on its own warning: stdout={res.stdout!r}"


def test_pathological_deep_nesting_fails_open():
    # Build a payload nested past the depth bound — must not crash, must not warn.
    node: dict = {"text": "conserve Claude"}
    for _ in range(50):
        node = {"content": node}
    res = run_hook({"message": node})
    assert res.returncode == 0
    # Past the depth bound the conserve text is unreachable -> no warning.
    assert not fired(res)

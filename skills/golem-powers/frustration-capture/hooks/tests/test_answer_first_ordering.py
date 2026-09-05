"""Injected guidance must order ANSWER FIRST, store after (Etan-ratified
store-discipline: do the thing, then store — never store-before-work as ritual).
Regression for the 2026-08-10 stall where an agent stored while Etan waited."""
import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "frustration-capture-prompt.py"


def _context():
    payload = json.dumps(
        {"prompt": "What the fuck, I told you no", "session_id": "test-answer-first"}
    )
    result = subprocess.run(
        [sys.executable, str(HOOK)],
        input=payload,
        text=True,
        capture_output=True,
        timeout=1,
        check=False,
    )
    assert result.returncode == 0
    return json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]


def test_orders_answer_before_store():
    context = _context()
    assert "ANSWER the user FIRST" in context
    assert "before responding" not in context.lower()
    assert "store the correction first" not in context.lower()


def test_store_is_same_turn_after_answer():
    assert "same turn, AFTER the answer" in _context()


def test_mid_conversation_store_rides_the_answer_turn():
    assert "actively conversing" in _context()

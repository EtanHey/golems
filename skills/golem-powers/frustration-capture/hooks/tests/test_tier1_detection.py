import json
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).resolve().parents[1] / "frustration-capture-prompt.py"


def run_hook(prompt):
    payload = json.dumps({"user_prompt": prompt, "session_id": "test-tier1"})
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=payload,
        text=True,
        capture_output=True,
        timeout=1,
        check=False,
    )


def test_tier1_detection():
    result = run_hook("No, that's wrong")
    assert result.returncode == 0
    data = json.loads(result.stdout)
    context = data["hookSpecificOutput"]["additionalContext"]
    assert "FRUSTRATION SIGNAL DETECTED - Tier 1" in context
    assert "User correction pattern matched:" in context
    assert "importance >=7" in context

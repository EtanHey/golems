import json
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).resolve().parents[1] / "frustration-capture-prompt.py"


def test_tier2_escalation_multiple_patterns():
    payload = json.dumps(
        {
            "prompt": "What the fuck, I told you no",
            "session_id": "test-tier2",
        }
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
    data = json.loads(result.stdout)
    context = data["hookSpecificOutput"]["additionalContext"]
    assert "FRUSTRATION SIGNAL DETECTED - Tier 2" in context
    assert "Multiple correction/frustration patterns matched" in context
    assert "importance >=9" in context

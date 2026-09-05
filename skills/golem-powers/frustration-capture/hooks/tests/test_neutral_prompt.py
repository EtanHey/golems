import json
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).resolve().parents[1] / "frustration-capture-prompt.py"


def test_neutral_prompt_has_no_output():
    result = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"user_prompt": "Check the build status"}),
        text=True,
        capture_output=True,
        timeout=1,
        check=False,
    )

    assert result.returncode == 0
    assert result.stdout == ""

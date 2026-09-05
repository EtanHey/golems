import json
import subprocess
import sys
import time
from pathlib import Path


HOOK = Path(__file__).resolve().parents[1] / "frustration-capture-prompt.py"


PROMPTS = [
    "No, that's wrong",
    "What the fuck, I told you no",
    "Check the build status",
    "Why not just use the existing hook?",
    "STOP doing that",
    "No no no no no, read the file",
    "What do you mean by green?",
    "I can do it myself",
    "Please review the PR",
    "Are you serious, we spoke about this",
]


def test_all_prompts_under_500ms():
    timings = []
    for prompt in PROMPTS:
        start = time.perf_counter()
        result = subprocess.run(
            [sys.executable, str(HOOK)],
            input=json.dumps({"user_prompt": prompt}),
            text=True,
            capture_output=True,
            timeout=1,
            check=False,
        )
        elapsed_ms = (time.perf_counter() - start) * 1000
        timings.append(elapsed_ms)
        assert result.returncode == 0

    assert max(timings) < 500, timings

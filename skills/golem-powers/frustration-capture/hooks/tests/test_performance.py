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


def test_pathological_no_context_prompt_is_linear():
    # CodeQL py/redos #2: "no commit" + many '-' with no "yet" made the
    # negative-context regex backtrack exponentially.
    start = time.perf_counter()
    result = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"user_prompt": "no commit" + "-" * 40 + "!"}),
        text=True,
        capture_output=True,
        timeout=5,
        check=False,
    )
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert result.returncode == 0
    assert elapsed_ms < 1000, elapsed_ms

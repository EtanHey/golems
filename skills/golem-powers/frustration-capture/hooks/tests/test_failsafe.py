import json
import os
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).resolve().parents[1] / "frustration-capture-prompt.py"


def test_corrupted_stdin_fails_open_and_logs(tmp_path):
    log_path = tmp_path / "frustration-hook.err.log"
    env = os.environ.copy()
    env["FRUSTRATION_HOOK_LOG"] = str(log_path)

    result = subprocess.run(
        [sys.executable, str(HOOK)],
        input="{not valid json",
        text=True,
        capture_output=True,
        timeout=1,
        check=False,
        env=env,
    )

    assert result.returncode == 0
    assert json.loads(result.stdout) == {}
    assert log_path.exists()
    assert "JSONDecodeError" in log_path.read_text()

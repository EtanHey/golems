"""Run the actual hook with a synthetic installed helper, lock and suite."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import pytest

ROOT = Path(__file__).resolve().parents[2]
HOOK = ROOT / ".githooks/pre-push"


@pytest.mark.parametrize("availability", ["installed", "missing-helper", "missing-python"])
@pytest.mark.parametrize("status", [0, 7])
def test_pre_push_wraps_suite_and_preserves_fallback_status(tmp_path, availability, status):
    home, bin_dir = tmp_path / "home", tmp_path / "bin"
    home.mkdir(); bin_dir.mkdir()
    helper = home / "Gits/golems/.worktrees/hooks-live/scripts/hooks/heavy-suite.py"
    if availability != "missing-helper":
        helper.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "scripts/hooks/heavy-suite.py", helper)
    if availability != "missing-python":
        (bin_dir / "python3").symlink_to(sys.executable)
    # A dev helper exists even when the pinned helper is absent; never use it.
    dev = home / "Gits/golems/scripts/hooks/heavy-suite.py"
    dev.parent.mkdir(parents=True); dev.write_text("raise SystemExit(99)\n")
    record, lock = tmp_path / "argv", tmp_path / "suite.lock"
    bun = bin_dir / "bun"
    bun.write_text('#!/bin/sh\nprintf "%s\\n" "$*" > "$SUITE_RECORD"\nexit "$SUITE_STATUS"\n')
    bun.chmod(0o755)
    env = {k: v for k, v in os.environ.items() if not k.startswith("GOLEMS_HEAVY_")}
    env.update(HOME=str(home), PATH=str(bin_dir), SUITE_RECORD=str(record),
               SUITE_STATUS=str(status), GOLEMS_HEAVY_LOCK=str(lock),
               GOLEMS_HEAVY_MAX_LOAD="99999")
    result = subprocess.run([shutil.which("bash"), str(HOOK)], cwd=ROOT,
                            env=env, capture_output=True, text=True, timeout=5)
    assert result.returncode == status, result.stderr
    assert record.read_text().strip() == "run test"
    if availability == "installed":
        assert "QUEUED" in result.stderr and "SUITE START" in result.stderr
        assert "SUITE DONE" in result.stderr
        assert json.loads(lock.read_text())["exit_code"] == status
    else:
        assert "helper missing; running unqueued" in result.stderr
        assert not lock.exists()


def test_pre_push_is_executable():
    assert os.access(HOOK, os.X_OK)

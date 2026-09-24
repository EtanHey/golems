"""The parity eval's replay leg needs skill-creator's smoke-harness.js, which
lives in a private repo. An outside cloner has no copy, so the eval must skip
with a reason line instead of failing."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


PARITY_DIR = Path(__file__).resolve().parents[1] / "evals" / "parity"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def isolated_parity(tmp_path: Path) -> tuple[Path, dict]:
    # A copy outside the repo, so none of the sibling-checkout candidates resolve.
    copy = tmp_path / "parity"
    shutil.copytree(PARITY_DIR, copy)
    env = {k: v for k, v in os.environ.items() if k not in ("SMOKE_HARNESS_JS", "SKILL_CREATOR_ROOT")}
    return copy, env


def test_smoke_replay_skips_with_reason_when_harness_is_absent(tmp_path):
    copy, env = isolated_parity(tmp_path)
    result = subprocess.run(
        ["node", str(copy / "smoke_replay_cursor.mjs")],
        cwd=copy, env=env, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("SKIP smoke replay: "), result.stdout
    assert "SMOKE_HARNESS_JS" in result.stdout


def test_parity_eval_reports_skip_when_harness_is_absent(tmp_path):
    copy, env = isolated_parity(tmp_path)
    result = subprocess.run(
        [sys.executable, str(copy / "run_parity.py")],
        cwd=copy, env=env, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("PARITY_EVAL SKIP: smoke replay: "), result.stdout

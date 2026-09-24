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
    return copy, clean_env()


def clean_env() -> dict:
    return {
        k: v
        for k, v in os.environ.items()
        if k not in ("SMOKE_HARNESS_JS", "SKILL_CREATOR_ROOT") and not k.startswith("GIT_")
    }


def run_smoke(copy: Path, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", str(copy / "smoke_replay_cursor.mjs")],
        cwd=copy, env=env, capture_output=True, text=True, check=False,
    )


def test_smoke_replay_skips_with_reason_when_harness_is_absent(tmp_path):
    copy, env = isolated_parity(tmp_path)
    result = run_smoke(copy, env)
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


FAKE_HARNESS = """export function replaySmoke() {
  return { marker: "fake-harness", with: { byCategory: { compliance: { total: 0 } } } };
}
"""


@pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")
def test_smoke_replay_finds_sibling_skill_creator_from_a_linked_worktree(tmp_path):
    # ~/Gits/{golems,skill-creator} with the eval run from golems/.worktrees/<name>.
    harness = tmp_path / "skill-creator" / "src" / "smoke-harness.js"
    harness.parent.mkdir(parents=True)
    harness.write_text(FAKE_HARNESS)
    main = tmp_path / "golems"
    env = clean_env()
    git = lambda *args, cwd=main: subprocess.run(
        ["git", *args], cwd=cwd, env=env, check=True, capture_output=True
    )
    main.mkdir()
    git("init", "-q")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init")
    git("worktree", "add", "-q", str(main / ".worktrees" / "wt"))
    copy = main / ".worktrees" / "wt" / "skills" / "golem-powers" / "cursor-workflows" / "evals" / "parity"
    shutil.copytree(PARITY_DIR, copy)

    result = run_smoke(copy, env)
    assert result.returncode == 0, result.stderr
    assert '"marker": "fake-harness"' in result.stdout, result.stdout


def test_smoke_replay_fails_when_explicit_harness_path_is_missing(tmp_path):
    copy, env = isolated_parity(tmp_path)
    env["SMOKE_HARNESS_JS"] = str(tmp_path / "nope" / "smoke-harness.js")
    result = run_smoke(copy, env)
    assert result.returncode == 1, result.stdout
    assert "SMOKE_HARNESS_JS" in result.stderr
    assert not result.stdout.startswith("SKIP")

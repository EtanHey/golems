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


@pytest.fixture(params=["installed", "missing-helper"])
def git_env_hook(tmp_path, request):
    """Keep every git write inside disposable fixture and decoy repositories."""
    git = shutil.which("git")
    local_names = subprocess.check_output(
        [git, "rev-parse", "--local-env-vars"], text=True).splitlines()
    clean_env = {k: v for k, v in os.environ.items() if k not in local_names}
    home, bin_dir, decoy = (tmp_path / name for name in ("home", "bin", "decoy"))
    home.mkdir(); bin_dir.mkdir(); decoy.mkdir()
    if request.param == "installed":
        helper = home / "Gits/golems/.worktrees/hooks-live/scripts/hooks/heavy-suite.py"
        helper.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "scripts/hooks/heavy-suite.py", helper)
        (bin_dir / "python3").symlink_to(sys.executable)
    clean_env.update(HOME=str(home), GIT_CONFIG_NOSYSTEM="1",
                     GIT_CONFIG_GLOBAL=os.devnull)

    def decoy_git(*args):
        return subprocess.check_output([git, "-C", str(decoy), *args],
                                       env=clean_env, text=True)

    decoy_git("init")
    decoy_git("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost",
              "commit", "--allow-empty", "-m", "Decoy baseline")
    before = (decoy_git("rev-parse", "HEAD"), (decoy / ".git/config").read_bytes(),
              decoy_git("config", "--get", "core.bare"))
    (bin_dir / "git").symlink_to(git)
    record = tmp_path / "suite.json"
    env = dict(clean_env, PATH=str(bin_dir), SUITE_RECORD=str(record),
               SUITE_GIT=git, SUITE_FIXTURE=str(tmp_path / "fixture"),
               SUITE_LOCAL_NAMES=json.dumps(local_names),
               GOLEMS_HEAVY_LOCK=str(tmp_path / "suite.lock"),
               GOLEMS_HEAVY_MAX_LOAD="99999",
               GIT_DIR=str(decoy / ".git"), GIT_WORK_TREE=str(decoy),
               GIT_INDEX_FILE=str(decoy / ".git/index"))
    return bin_dir, decoy, env, record, before, decoy_git


def run_git_env_hook(setup, body):
    bin_dir, decoy, env, record, before, decoy_git = setup
    bun = bin_dir / "bun"
    bun.write_text(f"#!{sys.executable}\n" + body)
    bun.chmod(0o755)
    result = subprocess.run([shutil.which("bash"), str(HOOK)], cwd=decoy,
                            env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    return record


def test_pre_push_clears_all_git_local_env(git_env_hook):
    record = run_git_env_hook(git_env_hook, """
import json, os
from pathlib import Path
names = json.loads(os.environ["SUITE_LOCAL_NAMES"])
Path(os.environ["SUITE_RECORD"]).write_text(json.dumps(
    {name: os.environ[name] for name in names if name in os.environ}))
""")
    assert json.loads(record.read_text()) == {}


def test_pre_push_git_fixture_cannot_mutate_decoy(git_env_hook):
    run_git_env_hook(git_env_hook, """
import os, subprocess
from pathlib import Path
fixture = Path(os.environ["SUITE_FIXTURE"])
fixture.mkdir()
def git(*args):
    subprocess.run([os.environ["SUITE_GIT"], "-C", str(fixture), *args], check=True)
git("init")
git("-c", "user.name=Fixture", "-c", "user.email=fixture@localhost",
    "commit", "--allow-empty", "-m", "Fixture commit")
""")
    _, decoy, env, _, before, decoy_git = git_env_hook
    after = (decoy_git("rev-parse", "HEAD"), (decoy / ".git/config").read_bytes(),
             decoy_git("config", "--get", "core.bare"))
    assert after == before
    assert (Path(env["SUITE_FIXTURE"]) / ".git/HEAD").is_file()

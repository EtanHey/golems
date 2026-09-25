"""pre_tool_use.py (vendored GO-5 PR-2b): git_safety comes from the hook's own tree.

The unversioned copy imported git_safety from the MAIN checkout
(~/Gits/golems/...), so every pull or branch switch there changed a live guard.
Installed as a symlink into hooks-live, it must resolve git_safety next to its
real path and ignore whatever the main checkout holds.
"""

import json
import os
import subprocess
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "pre_tool_use.py"


def _fake_home(tmp_path):
    home = tmp_path / "home"
    poisoned = home / "Gits" / "golems" / "skills" / "golem-powers" / "git-guardian"
    poisoned.mkdir(parents=True)
    (poisoned / "git_safety.py").write_text(
        "def dangerous_shell_reason(command, **_):\n"
        "    return 'FAKE main-checkout git_safety'\n"
        "def shell_text_without_heredoc_bodies(command):\n"
        "    return command\n"
    )
    hooks = home / ".claude" / "hooks"
    hooks.mkdir(parents=True)
    (hooks / "pre_tool_use.py").symlink_to(HOOK)  # the install-hooks layout
    return home


def _run(home, command):
    env = {k: v for k, v in os.environ.items() if k not in ("GIT_GUARDIAN_LIB", "CLAUDE_WORKER")}
    env["HOME"] = str(home)
    payload = {"tool_name": "Bash", "tool_input": {"command": command}, "session_id": "t"}
    return subprocess.run(
        ["python3", str(home / ".claude" / "hooks" / "pre_tool_use.py")],
        input=json.dumps(payload), capture_output=True, text=True, env=env, check=False,
    )


def test_a_poisoned_main_checkout_does_not_reach_the_installed_hook(tmp_path):
    home = _fake_home(tmp_path)
    result = _run(home, "ls -la")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "FAKE" not in result.stdout


def test_the_installed_hook_still_blocks_through_its_own_git_safety(tmp_path):
    home = _fake_home(tmp_path)
    result = _run(home, "git push --force origin main")
    assert result.returncode == 2
    assert "FAKE" not in result.stdout
    assert "git push --force" in json.loads(result.stdout)["reason"]


# ── GO-5 E2 cleanup ────────────────────────────────────────────────────────────

def _run_with(home, tool_name, tool_input, path_prefix=None):
    env = {k: v for k, v in os.environ.items() if k not in ("GIT_GUARDIAN_LIB", "CLAUDE_WORKER")}
    env["HOME"] = str(home)
    if path_prefix:
        env["PATH"] = f"{path_prefix}:{env.get('PATH', '')}"
    payload = {"tool_name": tool_name, "tool_input": tool_input, "session_id": "t"}
    return subprocess.run(
        ["python3", str(home / ".claude" / "hooks" / "pre_tool_use.py")],
        input=json.dumps(payload), capture_output=True, text=True, env=env, check=False,
    )


def test_no_global_audit_log_and_no_task_tracker_state(tmp_path):
    # hooks-audit: permissions_audit.jsonl grew to 136.8 MB, never rotated; the
    # Task tracker (E1) wrote agent_states nothing reads.
    home = _fake_home(tmp_path)
    assert _run_with(home, "Bash", {"command": "echo hi"}).returncode == 0
    assert _run_with(home, "Task", {"description": "x", "subagent_type": "y"}).returncode == 0
    assert not (home / ".claude" / "permissions_audit.jsonl").exists()
    assert not (home / ".claude" / "agent_states").exists()


def test_a_block_does_not_shell_out_to_notify(tmp_path):
    home = _fake_home(tmp_path)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    marker = tmp_path / "notify-called"
    (bin_dir / "notify").write_text(f"#!/bin/sh\ntouch {marker}\n")
    (bin_dir / "notify").chmod(0o755)
    result = _run_with(home, "Bash", {"command": "rm -rf ~"}, path_prefix=bin_dir)
    assert result.returncode == 2
    assert not marker.exists()


def test_a_redirect_into_a_credentials_file_is_blocked(tmp_path):
    # w6 (PR-4): `echo x > credentials.json` passed, because the op check wanted
    # the literal substring "echo >".
    home = _fake_home(tmp_path)
    for command in ("echo x > credentials.json", "printf x >> config/secrets.yaml", "cat a >.env"):
        result = _run_with(home, "Bash", {"command": command})
        assert result.returncode == 2, (command, result.stdout)
        assert "Sensitive file" in json.loads(result.stdout)["reason"]
    for command in ("cat credentials.json", "echo 'see credentials.json' >> notes.md", "echo x > notes.md"):
        assert _run_with(home, "Bash", {"command": command}).returncode == 0, command

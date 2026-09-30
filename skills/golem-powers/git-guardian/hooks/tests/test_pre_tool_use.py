"""pre_tool_use.py (vendored GO-5 PR-2b): git_safety comes from the hook's own tree.

The unversioned copy imported git_safety from the golems MAIN checkout,
so every pull or branch switch there changed a live guard.
Installed as a symlink into hooks-live, it must resolve git_safety next to its
real path and ignore whatever the main checkout holds.
"""

import importlib.util
import json
import os
import shutil
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


def test_copied_hook_loads_its_own_split_implementation_from_another_cwd(tmp_path):
    installed = tmp_path / "installed" / "golem-powers"
    installed.mkdir(parents=True)
    guardian = installed / "git-guardian"
    shutil.copytree(HOOK.parents[1], guardian, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(HOOK.parents[2] / "_shared", installed / "_shared")
    shell = guardian / "git_safety_impl" / "shell.py"
    with shell.open("a") as handle:
        handle.write("\ndef dangerous_shell_reason(command, *, cwd=None, env=None, _depth=0, api=None):\n"
                     "    return 'COPIED SPLIT IMPLEMENTATION'\n")
    home = tmp_path / "home"
    hooks = home / ".claude" / "hooks"
    hooks.mkdir(parents=True)
    hook = hooks / "pre_tool_use.py"
    hook.symlink_to(guardian / "hooks" / "pre_tool_use.py")
    other_cwd = tmp_path / "other-cwd"
    other_cwd.mkdir()
    env = {k: v for k, v in os.environ.items()
           if k not in ("GIT_GUARDIAN_LIB", "CLAUDE_WORKER", "PYTHONDONTWRITEBYTECODE", "PYTHONPYCACHEPREFIX")}
    env["HOME"] = str(home)
    result = subprocess.run(
        ["python3", str(hook)], cwd=other_cwd, env=env, text=True, capture_output=True,
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "echo safe"}, "session_id": "t"}),
        check=False,
    )
    assert result.returncode == 2, result.stdout + result.stderr
    assert "Dangerous command: COPIED SPLIT IMPLEMENTATION" in json.loads(result.stdout)["reason"]
    assert not (guardian / "git_safety_impl" / "__pycache__").exists()


def _nested_wrapper(kind, depth, tail):
    if kind in {"sudo", "nice", "xargs"}:
        return f"{kind} " * depth + tail
    if kind == "env":
        return "env A=1 " * depth + tail
    if kind == "env-unset":
        return "env -u X " * depth + tail
    if kind == "time-posix":
        return "time -p " * depth + tail
    if kind in {"command", "exec", "nohup", "builtin"}:
        return f"{kind} " * depth + tail
    if kind == "env-split":
        return "env -S " * depth + tail
    if kind == "find-exec":
        return "find . -exec " * depth + tail + " {} +" * depth
    prefixes = ("sudo ", "nice ", "xargs ", "find . -exec ")
    command = "".join(prefixes[index % len(prefixes)] for index in range(depth)) + tail
    return command + " {} +" * sum(index % len(prefixes) == 3 for index in range(depth))


def _copied_hook(tmp_path):
    installed = tmp_path / "installed" / "golem-powers"
    installed.mkdir(parents=True)
    guardian = installed / "git-guardian"
    shutil.copytree(HOOK.parents[1], guardian, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(HOOK.parents[2] / "_shared", installed / "_shared")
    home = tmp_path / "home"
    hooks = home / ".claude" / "hooks"
    hooks.mkdir(parents=True)
    hook = hooks / "pre_tool_use.py"
    hook.symlink_to(guardian / "hooks" / "pre_tool_use.py")
    launcher = HOOK.parents[4] / "scripts" / "hooks" / "fail-open.py"
    other_cwd = tmp_path / "other-cwd"
    other_cwd.mkdir()
    env = {k: v for k, v in os.environ.items()
           if k not in ("GIT_GUARDIAN_LIB", "CLAUDE_WORKER", "PYTHONDONTWRITEBYTECODE", "PYTHONPYCACHEPREFIX")}
    env["HOME"] = str(home)
    return guardian, hook, launcher, other_cwd, env


def test_wrapper_depth_matrix_blocks_through_copied_hook_and_fail_open_launcher(tmp_path):
    guardian, hook, launcher, other_cwd, env = _copied_hook(tmp_path)
    broad_kinds = ("sudo", "nice", "xargs", "find-exec", "mixed")
    boundary_kinds = (
        "env", "env-unset", "time-posix", "command", "exec", "nohup",
        "builtin", "env-split",
    )
    for kind in (*broad_kinds, *boundary_kinds):
        depths = (63, 64, 65, 500, 1000, 5000) if kind in broad_kinds else (64, 65)
        for depth in depths:
            for tail in ("rm -rf /", "git push --force origin main", "echo safe"):
                command = _nested_wrapper(kind, depth, tail)
                result = subprocess.run(
                    ["python3", str(launcher), str(hook)], cwd=other_cwd, env=env,
                    input=json.dumps({"tool_name": "Bash", "tool_input": {"command": command}, "session_id": "t"}),
                    text=True, capture_output=True, check=False,
                )
                should_block = tail != "echo safe" or depth > 64
                assert result.returncode == (2 if should_block else 0), (
                    kind, depth, tail, result.stdout, result.stderr
                )
                if depth > 64:
                    assert "wrapper nesting exceeds 64" in json.loads(result.stdout)["reason"]
                assert "golems-fail-open" not in result.stderr
    assert not (guardian / "git_safety_impl" / "__pycache__").exists()


def test_policy_error_blocks_value_free_through_fail_open_launcher(tmp_path):
    guardian, hook, launcher, other_cwd, env = _copied_hook(tmp_path)
    shell = guardian / "git_safety_impl" / "shell.py"
    with shell.open("a") as handle:
        handle.write(
            "\ndef dangerous_shell_reason(command, *, cwd=None, env=None, _depth=0, api=None):\n"
            "    raise RuntimeError('SENSITIVE POLICY DETAIL')\n"
        )
    result = subprocess.run(
        ["python3", str(launcher), str(hook)], cwd=other_cwd, env=env,
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "echo safe"}, "session_id": "t"}),
        text=True, capture_output=True, check=False,
    )
    assert result.returncode == 2, result.stdout + result.stderr
    reason = json.loads(result.stdout)["reason"]
    assert "security policy could not evaluate command safely" in reason
    assert "SENSITIVE POLICY DETAIL" not in result.stdout + result.stderr
    assert "golems-fail-open" not in result.stderr


def test_second_policy_parse_error_is_value_free_red(monkeypatch):
    spec = importlib.util.spec_from_file_location("pre_tool_use_second_parse", HOOK)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    monkeypatch.setattr(loaded, "dangerous_shell_reason", lambda _command: None)
    monkeypatch.setattr(
        loaded, "shell_text_without_heredoc_bodies",
        lambda _command: (_ for _ in ()).throw(RuntimeError("SENSITIVE SECOND PARSE DETAIL")),
    )
    assert loaded.classify_tool("Bash", {"command": "echo safe"}) == (
        "RED", "security policy could not evaluate command safely",
    )


def test_literal_find_exec_argument_cannot_hide_destructive_sibling(tmp_path):
    _guardian, hook, launcher, other_cwd, env = _copied_hook(tmp_path)
    for tail in ("rm -rf /", "git push --force origin main"):
        command = f"find . -exec echo -exec {{}} + -exec {tail} {{}} +"
        result = subprocess.run(
            ["python3", str(launcher), str(hook)], cwd=other_cwd, env=env,
            input=json.dumps({"tool_name": "Bash", "tool_input": {"command": command}, "session_id": "t"}),
            text=True, capture_output=True, check=False,
        )
        assert result.returncode == 2, (tail, result.stdout, result.stderr)
        assert "golems-fail-open" not in result.stderr


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

"""Security regression tests for #411 hook dependency import failures."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]
POWERS = ROOT / "skills" / "golem-powers"
FAIL_OPEN = ROOT / "scripts" / "hooks" / "fail-open.py"
SENSITIVE_DETAIL = "SENSITIVE ISSUE411 IMPORT DETAIL"
RECOVERY_HINT = (
    "FLAG THIS TO THE USER: reinstall hooks from the prompt: "
    "`! bash ~/Gits/golems/scripts/hooks/install-hooks.sh "
    "--host <host> --update --apply`"
)


def _copied_hooks(
    tmp_path: Path,
    parser_state: str,
    *,
    file_symlink_facades: bool = False,
) -> tuple[Path, Path, Path]:
    hooks = tmp_path / "installed" / "hooks"
    shared = hooks / "_shared"
    shared.mkdir(parents=True)
    for name in ("shell_parse.py", "harness_paths.py"):
        shutil.copy2(POWERS / "_shared" / name, shared / name)

    if parser_state != "missing":
        shutil.copytree(POWERS / "_shared" / "shell_parse_impl", shared / "shell_parse_impl")
        tokens = shared / "shell_parse_impl" / "tokens.py"
        if parser_state == "partial":
            tokens.unlink()
        elif parser_state == "corrupt":
            tokens.write_text(
                "import sys\n"
                f'print("{SENSITIVE_DETAIL}")\n'
                f'print("{SENSITIVE_DETAIL}", file=sys.stderr)\n'
                f'raise RuntimeError("{SENSITIVE_DETAIL}")\n'
            )
        elif parser_state == "system-exit":
            tokens.write_text(f'raise SystemExit("{SENSITIVE_DETAIL}")\n')

    if file_symlink_facades:
        for name in ("shell_parse.py", "harness_paths.py"):
            (shared / name).unlink()
            (shared / name).symlink_to(POWERS / "_shared" / name)

    tmp_hook = hooks / "tmp-block" / "hooks" / "tmp-block-pretooluse.py"
    tmp_hook.parent.mkdir(parents=True)
    shutil.copy2(
        POWERS / "tmp-block" / "hooks" / "tmp-block-pretooluse.py",
        tmp_hook,
    )

    guardian = hooks / "git-guardian"
    (guardian / "hooks").mkdir(parents=True)
    shutil.copy2(POWERS / "git-guardian" / "git_safety.py", guardian / "git_safety.py")
    shutil.copytree(
        POWERS / "git-guardian" / "git_safety_impl",
        guardian / "git_safety_impl",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    guardian_hook = guardian / "hooks" / "pre_tool_use.py"
    shutil.copy2(
        POWERS / "git-guardian" / "hooks" / "pre_tool_use.py",
        guardian_hook,
    )

    other_cwd = tmp_path / "other-cwd"
    other_cwd.mkdir()
    return tmp_hook, guardian_hook, other_cwd


def _run_hook(
    hook: Path,
    cwd: Path,
    command: str,
    *,
    through_launcher: bool,
    env_overrides: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {
            "CLAUDE_WORKER",
            "GIT_GUARDIAN_LIB",
            "GOLEM_EFFORT",
            "GOLEM_ROLE",
            "PYTHONPATH",
            "PYTHONPYCACHEPREFIX",
            "WEAVE_ALLOW_TMP",
        }
    }
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env.update(env_overrides or {})
    argv = [sys.executable, str(hook)]
    if through_launcher:
        argv = [sys.executable, str(FAIL_OPEN), str(hook)]
    payload = json.dumps(
        {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": str(cwd)}
    )
    return subprocess.run(
        argv,
        cwd=cwd,
        env=env,
        input=payload,
        text=True,
        capture_output=True,
        check=False,
    )


def _assert_value_free_deny(
    result: subprocess.CompletedProcess[str],
    hook_name: str,
    *,
    expect_recovery_hint: bool = True,
) -> None:
    assert result.returncode == 2, (result.stdout, result.stderr)
    response = json.loads(result.stdout)
    assert response["decision"] == "block"
    assert response["reason"]
    if expect_recovery_hint:
        assert RECOVERY_HINT in response["reason"]
    assert SENSITIVE_DETAIL not in result.stdout + result.stderr
    assert result.stderr == ""
    if hook_name == "tmp-block":
        hook_output = response["hookSpecificOutput"]
        assert hook_output["hookEventName"] == "PreToolUse"
        assert hook_output["permissionDecision"] == "deny"
        assert hook_output["permissionDecisionReason"]


@pytest.mark.parametrize(
    "parser_state", ("missing", "partial", "corrupt", "system-exit")
)
@pytest.mark.parametrize("through_launcher", (False, True))
@pytest.mark.parametrize(
    ("hook_name", "command"),
    (
        ("tmp-block", "echo hi > /tmp/issue411-deny"),
        ("git-guardian", "git push --force origin master"),
    ),
)
def test_copied_hook_parser_import_failures_deny_value_free(
    tmp_path: Path,
    parser_state: str,
    through_launcher: bool,
    hook_name: str,
    command: str,
) -> None:
    tmp_hook, guardian_hook, other_cwd = _copied_hooks(tmp_path, parser_state)
    hook = tmp_hook if hook_name == "tmp-block" else guardian_hook
    result = _run_hook(
        hook,
        other_cwd,
        command,
        through_launcher=through_launcher,
    )
    _assert_value_free_deny(result, hook_name)


@pytest.mark.parametrize("through_launcher", (False, True))
def test_misrouted_git_guardian_import_denies_value_free(
    tmp_path: Path,
    through_launcher: bool,
) -> None:
    other_cwd = tmp_path / "other-cwd"
    other_cwd.mkdir()
    decoy = tmp_path / "decoy"
    decoy.mkdir()
    (decoy / "git_safety.py").write_text(
        f'print("{SENSITIVE_DETAIL}")\n'
        "def dangerous_shell_reason(*_args, **_kwargs):\n"
        "    return None\n"
        "def shell_text_without_heredoc_bodies(command):\n"
        "    return command\n"
    )
    hook = POWERS / "git-guardian" / "hooks" / "pre_tool_use.py"
    result = _run_hook(
        hook,
        other_cwd,
        "git push --force origin master",
        through_launcher=through_launcher,
        env_overrides={
            "GIT_GUARDIAN_LIB": str(tmp_path / "misrouted"),
            "PYTHONPATH": str(decoy),
        },
    )
    _assert_value_free_deny(result, "git-guardian")


@pytest.mark.parametrize("through_launcher", (False, True))
@pytest.mark.parametrize("missing_module", ("harness_paths.py", "shell_parse.py"))
def test_tmp_block_rejects_same_named_module_outside_shared_root(
    tmp_path: Path,
    through_launcher: bool,
    missing_module: str,
) -> None:
    tmp_hook, _guardian_hook, other_cwd = _copied_hooks(tmp_path, "complete")
    (tmp_hook.parents[2] / "_shared" / missing_module).unlink()
    decoy = tmp_path / "decoy"
    decoy.mkdir()
    (decoy / missing_module).write_text(
        f'print("{SENSITIVE_DETAIL}")\n'
        "def _temp_prefixes():\n"
        "    return set()\n"
        "def is_harness_scratchpad(*_args, **_kwargs):\n"
        "    return False\n"
    )
    result = _run_hook(
        tmp_hook,
        other_cwd,
        "echo hi > /tmp/issue411-deny",
        through_launcher=through_launcher,
        env_overrides={"PYTHONPATH": str(decoy)},
    )
    _assert_value_free_deny(result, "tmp-block")


@pytest.mark.parametrize("through_launcher", (False, True))
def test_complete_copied_hooks_keep_allow_and_deny_behavior(
    tmp_path: Path,
    through_launcher: bool,
) -> None:
    tmp_hook, guardian_hook, other_cwd = _copied_hooks(tmp_path, "complete")
    for hook in (tmp_hook, guardian_hook):
        allowed = _run_hook(hook, other_cwd, "ls", through_launcher=through_launcher)
        assert allowed.returncode == 0, (hook, allowed.stdout, allowed.stderr)
        assert json.loads(allowed.stdout) == {}
    _assert_value_free_deny(
        _run_hook(
            tmp_hook,
            other_cwd,
            "echo hi > /tmp/issue411-deny",
            through_launcher=through_launcher,
        ),
        "tmp-block",
        expect_recovery_hint=False,
    )
    _assert_value_free_deny(
        _run_hook(
            guardian_hook,
            other_cwd,
            "git push --force origin master",
            through_launcher=through_launcher,
        ),
        "git-guardian",
        expect_recovery_hint=False,
    )


@pytest.mark.parametrize("through_launcher", (False, True))
def test_complete_file_symlinked_facades_keep_tmp_block_allow_and_deny_behavior(
    tmp_path: Path,
    through_launcher: bool,
) -> None:
    tmp_hook, _guardian_hook, other_cwd = _copied_hooks(
        tmp_path,
        "complete",
        file_symlink_facades=True,
    )
    allowed = _run_hook(
        tmp_hook,
        other_cwd,
        "ls",
        through_launcher=through_launcher,
    )
    assert allowed.returncode == 0, (allowed.stdout, allowed.stderr)
    assert json.loads(allowed.stdout) == {}
    _assert_value_free_deny(
        _run_hook(
            tmp_hook,
            other_cwd,
            "echo hi > /tmp/issue411-deny",
            through_launcher=through_launcher,
        ),
        "tmp-block",
        expect_recovery_hint=False,
    )

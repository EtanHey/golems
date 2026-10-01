from pathlib import Path as _PartsPath
__file__ = str(_PartsPath(__file__).resolve().parent.parent / 'test_worktree_anchor.py')

"""Regression coverage for static worktree anchors around shell substitutions."""


import importlib.util


import io


import json


import os


import sys


from pathlib import Path


import pytest


HOOK_PATH = (
    Path(__file__).resolve().parents[1] / "hooks" / "tmp-block-pretooluse.py"
)


SPEC = importlib.util.spec_from_file_location("tmp_block_pretooluse", HOOK_PATH)


assert SPEC is not None and SPEC.loader is not None


HOOK = importlib.util.module_from_spec(SPEC)


SPEC.loader.exec_module(HOOK)


@pytest.fixture(autouse=True)
def isolate_checkout_root_from_host_temp_class(monkeypatch):
    """Keep checkout-location tests portable without exempting other temp paths."""
    checkout = HOOK_PATH.parents[4]
    original = HOOK.in_temp_class

    def classified(raw_path):
        if isinstance(raw_path, str):
            candidate = os.path.expanduser(
                raw_path.strip().strip('"').strip("'")
            )
            if os.path.isabs(candidate):
                candidate = os.path.normpath(candidate)
                try:
                    if os.path.commonpath((str(checkout), candidate)) == str(
                        checkout
                    ):
                        return False
                except ValueError:
                    pass
        return original(raw_path)

    monkeypatch.setattr(HOOK, "in_temp_class", classified)


def make_home_repo(tmp_path, monkeypatch):
    """Create the ~/Gits/golems checkout assumed by captured commands."""
    home = tmp_path / "home"
    repo = home / "Gits" / "golems"
    (repo / ".git").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    # These specimens exercise repo/worktree classification, not Rule 1's
    # host-specific temp roots. pytest intentionally locates tmp_path there.
    monkeypatch.setattr(HOOK, "_temp_prefixes", lambda: set())
    return repo


def assert_no_prompt(payload):
    """The two-valued contract (2026-08-17) has no prompt path.

    This used to ban `hookSpecificOutput` outright, which was a sound proxy
    while `permissionDecision: "ask"` was the only reason to emit the key. It
    stopped being sound on 2026-08-19, when the refusal started carrying
    `permissionDecision: "deny"` as well — the dialect Codex documents for
    PreToolUse. So the tripwire now pins the thing the law actually forbids:
    the decision may be `deny`, never `ask`."""
    specific = payload.get("hookSpecificOutput")
    if not isinstance(specific, dict):
        assert specific is None, (
            f"hookSpecificOutput must be an object when present: {payload!r}"
        )
        return
    decision = specific.get("permissionDecision")
    assert decision != "ask", f"hook emitted a PreToolUse prompt: {payload!r}"
    assert decision in (None, "deny", "allow"), (
        f"unexpected permissionDecision: {decision!r} in {payload!r}"
    )


def decision_for(command, monkeypatch):
    """Run the imported hook and return its externally visible decision."""
    stdout = io.StringIO()
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO(
            json.dumps(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": command},
                    "session_id": "worktree-anchor-test",
                }
            )
        ),
    )
    monkeypatch.setattr(sys, "stdout", stdout)

    try:
        HOOK.main()
    except SystemExit as exc:
        exit_code = exc.code
    else:  # pragma: no cover - allow and deny both exit through the hook API
        raise AssertionError("hook did not exit")

    output = json.loads(stdout.getvalue() or "{}")
    assert_no_prompt(output)
    decision = output.get("decision")
    if decision == "block":
        return "deny", exit_code, output
    if decision in (None, "allow"):
        return "allow", exit_code, output
    raise AssertionError(f"unexpected hook decision: {decision!r}")


def state_for(command):
    """(values, literal_prefixes) visible to the command's last segment."""
    tokens, cmd_pos, seg_of, scopes = HOOK._parse_bash(command)
    return HOOK._static_shell_variable_state_before(
        tokens, cmd_pos, seg_of, scopes, max(seg_of) if seg_of else 0
    )


__all__ = [name for name in globals() if not name.startswith("__") and name != "_PartsPath"]

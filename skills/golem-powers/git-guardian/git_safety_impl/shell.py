"""Top-level and recursive shell policy moved from git_safety.py."""

from __future__ import annotations

import os
import re

# GO-5 PR-4 (#4): a whole command that is one `for V in <plain names>; do …; done`
# is checked once per value with V bound, so a loop-local target resolves. The
# body must not change directory (iterations share a cwd).
_LITERAL_FOR_LOOP_RE = re.compile(
    r"for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]*?)\s*[;\n]\s*do\s+(.*?)\s*;?\s*done", re.DOTALL
)
_LITERAL_LOOP_VALUE_RE = re.compile(r"[A-Za-z0-9._+-]+")


def _literal_loop(command: str, *, api: dict):
    loop = api['_LITERAL_FOR_LOOP_RE'].fullmatch(command.strip())
    if loop is None or re.search(r"\b(?:cd|pushd|popd)\b", loop.group(3)):
        return None
    values = loop.group(2).split()
    if not values or not all(api['_LITERAL_LOOP_VALUE_RE'].fullmatch(value) for value in values):
        return None
    return loop.group(1), values, loop.group(3)


def dangerous_shell_reason(command: str, *, cwd: str | None = None, env=None, _depth: int = 0, api: dict):
    """Return the tracked git-guardian block reason, or None."""
    # AIDEV-NOTE: the execution-depth limit below currently shadows this on
    # recursive payload paths. Keep the wrapper cap as belt-and-braces so this
    # entry point preserves the shared policy invariant if that stricter limit
    # changes or a caller supplies an already-accumulated wrapper depth.
    if _depth > api['_MAX_WRAPPER_DEPTH']:
        return api['_wrapper_depth_reason']()
    if _depth > api['_MAX_EXECUTION_DEPTH']:
        return (
            f"Dangerous command: nested execution too deep to check "
            f"(more than {api['_MAX_EXECUTION_DEPTH']} levels of eval/$()/piped shells)"
        )
    loop = api['_literal_loop'](command)
    if loop is not None:
        name, values, body = loop
        base = dict(os.environ if env is None else env)
        for value in values:
            reason = api['dangerous_shell_reason'](body, cwd=cwd, env={**base, name: value}, _depth=_depth + 1)
            if reason:
                return reason
        return None
    active = api['shell_text_without_heredoc_bodies'](command)
    # Top-level backticks only: `$()` bodies are recursed into via
    # _executed_payloads, where their own quoted heredocs are stripped first.
    outer = api['without_dollar_paren_bodies'](active)
    for body in api['_backtick_bodies'](outer) + api['_executed_payloads'](command, active):
        nested_reason = api['dangerous_shell_reason'](body, cwd=cwd, env=env, _depth=_depth + 1)
        if nested_reason:
            return nested_reason
    blocked, reason = api['_is_dangerous_rm_at_depth'](
        command, cwd=cwd, env=env, _depth=_depth
    )
    if blocked:
        return reason
    git_reason = api['_dangerous_git_reason_at_depth'](active, _depth=_depth)
    if git_reason:
        return git_reason
    return None

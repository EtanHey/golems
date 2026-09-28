"""Mechanical git-safety checks for git-guardian (gen-18 Track 6 D6).

git-guardian's rules lived only as SKILL.md prose + LLM-judged evals — the
"prose-doesn't-stick" shape gen-18 exists to replace. This module turns the three
highest-value, most-footgun-prone D6 rules into pure, importable, replayably-tested
functions:

  1. is_destructive_restore — `git checkout -- …` / `git restore …` that would discard
     UNOWNED in-session changes (the agent clobbering the user's or another agent's
     uncommitted work). Prefer `git stash`.
  2. pr_body_is_empty — post-create gh-pr-body-non-empty assert (a PR body that is blank
     or only template boilerplate should never ship).
  3. is_unauthorized_no_verify — `--no-verify` on commit/push bypasses safety hooks and
     must be authorized, not silently used.
  4. dangerous_shell_reason — F8's resolved rm-breadth check plus heredoc-aware
     destructive-command scanning.

Pure functions, no I/O, no deps. The active `~/.claude/hooks/pre_tool_use.py` enforcer
imports the F8 scanner from this module; tests pin the behavior against rule drift.
"""

from __future__ import annotations

import os
import functools
import posixpath
import re
import shlex
import sys

# S13 (GO-5): shell parsing lives in _shared/shell_parse.py; this module keeps
# policy. shell_text_without_heredoc_bodies stays importable from here
# (~/.claude/hooks/pre_tool_use.py imports it by this name).
sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "_shared"))
from harness_paths import is_harness_scratchpad  # noqa: E402
from shell_parse import (  # noqa: E402 F401
    _backtick_bodies,
    dollar_paren_bodies,
    shell_text_without_heredoc_bodies,
    without_dollar_paren_bodies,
)


# ── F8. Safe rm breadth + heredoc-aware destructive scanning ────────────────────

_FILE_REDIRECT_RE = re.compile(r"(?<![<>])(?:>>|>)(?![>&])")
_ASSIGNMENT_RE = re.compile(
    r"(?:^|[;&\n]\s*)([A-Za-z_][A-Za-z0-9_]*)="
    r"(?:\"([^\"]*)\"|'([^']*)'|([^\s;&]+))"
)
_SHELL_CONTROL_PREFIXES = {
    "!", "if", "then", "elif", "else", "while", "until", "do", "fi", "done",
}


# GO-5 PR-4 (#4): a whole command that is one `for V in <plain names>; do …; done`
# is checked once per value with V bound, so a loop-local target resolves. The
# body must not change directory (iterations share a cwd).
_LITERAL_FOR_LOOP_RE = re.compile(
    r"for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]*?)\s*[;\n]\s*do\s+(.*?)\s*;?\s*done", re.DOTALL
)
_LITERAL_LOOP_VALUE_RE = re.compile(r"[A-Za-z0-9._+-]+")


def _literal_loop(command: str):
    loop = _LITERAL_FOR_LOOP_RE.fullmatch(command.strip())
    if loop is None or re.search(r"\b(?:cd|pushd|popd)\b", loop.group(3)):
        return None
    values = loop.group(2).split()
    if not values or not all(_LITERAL_LOOP_VALUE_RE.fullmatch(value) for value in values):
        return None
    return loop.group(1), values, loop.group(3)


# GO-5 guard gaps: text that a command EXECUTES (r7 on #222; never checked on master).
_SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}
_MAX_EXECUTION_DEPTH = 8
_PIPED_INTERPRETER_HEREDOC_RE = re.compile(
    r"^[^\n]*\b(?:python3?|node|bun|deno|ruby|perl)\b[^\n]*<<-?\s*['\"]?([A-Za-z_]\w*)['\"]?"
    r"[^\n]*\|\s*(?:sh|bash|zsh|dash|ksh)\b[^\n]*\n(.*?)^\s*\1\s*$",
    re.MULTILINE | re.DOTALL,
)
_STRING_LITERAL_RE = re.compile(r"'([^'\n]*)'|\"([^\"\n]*)\"")


def _printed_text(words: list[str]) -> str | None:
    """What an `echo`/`printf` segment writes to stdout, as far as is static."""
    name = os.path.basename(words[0])
    if name == "echo":
        rest = words[1:]
        while rest and rest[0] in {"-n", "-e", "-E", "-ne", "-en"}:
            rest = rest[1:]
        return " ".join(rest)
    if name == "printf" and len(words) > 1:
        return words[1].replace("\\n", "\n")
    return None


def _executed_payloads(command: str, active: str) -> list[str]:
    """Strings the shell will run as commands: $() bodies (also inside "…"),
    eval arguments, echo/printf output piped into a stdin shell or given to one
    as a <(…) script, git `!` aliases, and string literals of an interpreter
    heredoc piped into a shell."""
    payloads = list(dollar_paren_bodies(active))
    for match in _PIPED_INTERPRETER_HEREDOC_RE.finditer(command):
        payloads.extend(a or b for a, b in _STRING_LITERAL_RE.findall(match.group(2)))
    for match in re.finditer(r"(?:\b(?:sh|bash|zsh|dash|ksh|source)|(?:^|[;&|]\s*)\.)\s+<\(", active):
        inner = next(iter(dollar_paren_bodies("$(" + active[match.end():])), "")
        try:
            printed = _printed_text(shlex.split(inner)) if inner.strip() else None
        except ValueError:
            printed = None
        if printed:
            payloads.append(printed)
    try:
        lexer = shlex.shlex(active.replace("\n", " ; "), posix=True, punctuation_chars=";&|()<>")
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return payloads
    segments: list[tuple[list[str], str]] = []
    words: list[str] = []
    for token in tokens:
        if token and all(ch in ";&|()<>" for ch in token):
            segments.append((words, token))
            words = []
        else:
            words.append(token)
    segments.append((words, ""))
    for index, (words, operator) in enumerate(segments):
        words = [w for w in words if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w)] if words else words
        if not words:
            continue
        name = os.path.basename(words[0])
        if name == "eval" and len(words) > 1:
            payloads.append(" ".join(words[1:]))
        if name == "git":
            for position, word in enumerate(words[1:], 1):
                value = words[position + 1] if word == "-c" and position + 1 < len(words) else (
                    word[2:] if word.startswith("-c") and len(word) > 2 else "")
                if value.startswith("alias.") and "=!" in value:
                    payloads.append(value.split("=!", 1)[1])
        if operator == "|" and index + 1 < len(segments):
            reader = segments[index + 1][0]
            reads_stdin = reader and os.path.basename(reader[0]) in _SHELLS and all(
                w.startswith("-") for w in reader[1:])
            printed = _printed_text(words)
            if reads_stdin and printed:
                payloads.append(printed)
    return [payload for payload in payloads if payload.strip()]


def dangerous_shell_reason(command: str, *, cwd: str | None = None, env=None, _depth: int = 0):
    """Return the tracked git-guardian block reason, or None."""
    if _depth > _MAX_EXECUTION_DEPTH:
        return (
            f"Dangerous command: nested execution too deep to check "
            f"(more than {_MAX_EXECUTION_DEPTH} levels of eval/$()/piped shells)"
        )
    loop = _literal_loop(command)
    if loop is not None:
        name, values, body = loop
        base = dict(os.environ if env is None else env)
        for value in values:
            reason = dangerous_shell_reason(body, cwd=cwd, env={**base, name: value}, _depth=_depth + 1)
            if reason:
                return reason
        return None
    active = shell_text_without_heredoc_bodies(command)
    # Top-level backticks only: `$()` bodies are recursed into via
    # _executed_payloads, where their own quoted heredocs are stripped first.
    outer = without_dollar_paren_bodies(active)
    for body in _backtick_bodies(outer) + _executed_payloads(command, active):
        nested_reason = dangerous_shell_reason(body, cwd=cwd, env=env, _depth=_depth + 1)
        if nested_reason:
            return nested_reason
    blocked, reason = is_dangerous_rm(command, cwd=cwd, env=env)
    if blocked:
        return reason
    git_reason = _dangerous_git_reason(active)
    if git_reason:
        return git_reason
    return None


# Load the implementation by this facade's real path. Two checkout copies must
# never share an implementation through sys.path or a bare module name.
import hashlib
import importlib
import importlib.util
from pathlib import Path

_IMPL_ROOT = Path(__file__).resolve().parent / "git_safety_impl"
_IMPL_NAME = "_git_safety_impl_" + hashlib.sha256(str(_IMPL_ROOT).encode()).hexdigest()[:20]
_write_bytecode = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    if _IMPL_NAME not in sys.modules:
        _spec = importlib.util.spec_from_file_location(
            _IMPL_NAME, _IMPL_ROOT / "__init__.py",
            submodule_search_locations=[str(_IMPL_ROOT)],
        )
        _package = importlib.util.module_from_spec(_spec)
        sys.modules[_IMPL_NAME] = _package
        _spec.loader.exec_module(_package)
    _git_impl = importlib.import_module(_IMPL_NAME + ".git")
finally:
    sys.dont_write_bytecode = _write_bytecode

_norm = _git_impl._norm
_HTML_COMMENT = _git_impl._HTML_COMMENT
_SKELETON_LINES = _git_impl._SKELETON_LINES
_GLOBAL_OPTS_WITH_SEPARATE_VALUE = _git_impl._GLOBAL_OPTS_WITH_SEPARATE_VALUE
_MESSAGE_FLAGS_WITH_VALUE = _git_impl._MESSAGE_FLAGS_WITH_VALUE


def pr_body_is_empty(body: str | None) -> bool:
    return _git_impl.pr_body_is_empty(body, api=globals())


def split_git(command: str):
    return _git_impl.split_git(command, api=globals())


def is_unauthorized_no_verify(command: str, authorized: bool = False) -> bool:
    return _git_impl.is_unauthorized_no_verify(
        command, authorized, split_git_fn=split_git, api=globals()
    )


def restore_targets(command: str) -> list[str] | None:
    return _git_impl.restore_targets(command, split_git_fn=split_git)


def is_destructive_restore(command: str, owned_paths=None) -> dict:
    return _git_impl.is_destructive_restore(
        command, owned_paths, restore_targets_fn=restore_targets, api=globals()
    )


def _import_impl(name: str):
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        return importlib.import_module(_IMPL_NAME + "." + name)
    finally:
        sys.dont_write_bytecode = previous


_paths_impl = _import_impl("paths")
_SHELL_VAR_RE = _paths_impl._SHELL_VAR_RE


def _expand_known_vars(value: str, variables: dict[str, str]) -> tuple[str, bool]:
    return _paths_impl._expand_known_vars(value, variables, _SHELL_VAR_RE)


def _outermost_repo_root(path: str) -> str | None:
    return _paths_impl._outermost_repo_root(path)


def _within(path: str, root: str) -> bool:
    return _paths_impl._within(path, root)


def _gitfile_owner(checkout: str) -> str | None:
    return _paths_impl._gitfile_owner(checkout)


def _literal_tail_after_unresolved_var(target: str, variables: dict[str, str]) -> bool:
    return _paths_impl._literal_tail_after_unresolved_var(target, variables, _SHELL_VAR_RE)


def _rm_target_reason(target: str, cwd: str, variables: dict[str, str]) -> str | None:
    return _paths_impl._rm_target_reason(
        target, cwd, variables,
        expand_known_vars_fn=_expand_known_vars,
        literal_tail_fn=_literal_tail_after_unresolved_var,
        outermost_repo_root_fn=_outermost_repo_root,
        gitfile_owner_fn=_gitfile_owner,
        within_fn=_within,
        is_harness_scratchpad_fn=is_harness_scratchpad,
    )

_rm_impl = _import_impl("rm")


def _skip_options(words: list[str], position: int, options_with_values: set[str]) -> int:
    return _rm_impl._skip_options(words, position, options_with_values)


_rm_reason_in_words = functools.partial(_rm_impl._rm_reason_in_words, globals())
is_dangerous_rm = functools.partial(_rm_impl.is_dangerous_rm, globals())

_commands_impl = _import_impl("commands")
_KILL_MATCHER_COMMANDS = _commands_impl._KILL_MATCHER_COMMANDS
_KILL_OPTIONS_WITH_VALUE = _commands_impl._KILL_OPTIONS_WITH_VALUE
_KILL_FULL_MATCH_OPTIONS = _commands_impl._KILL_FULL_MATCH_OPTIONS
_KILL_GUIDANCE = _commands_impl._KILL_GUIDANCE


def _top_level_alternation(pattern: str) -> list[str]:
    return _commands_impl._top_level_alternation(pattern)


def _degenerate_kill_pattern(pattern: str) -> bool:
    return _commands_impl._degenerate_kill_pattern(pattern, api=globals())


def _kill_matcher_reason(words: list[str], position: int, command_name: str) -> str | None:
    return _commands_impl._kill_matcher_reason(words, position, command_name, api=globals())


def _dangerous_non_rm_in_words(words: list[str], position: int = 0) -> str | None:
    return _commands_impl._dangerous_non_rm_in_words(words, position, api=globals())


def _dangerous_git_reason(command: str) -> str | None:
    return _commands_impl._dangerous_git_reason(command, api=globals())

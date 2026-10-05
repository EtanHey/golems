"""Import-stable git-guardian facade; policy lives in git_safety_impl."""
from __future__ import annotations

import hashlib
import importlib
import importlib.util
import os
import posixpath
import re
import shlex
import sys
from pathlib import Path

# Resolve the installed hook's real tree, never a checkout found on sys.path.
_IMPL_ROOT = Path(__file__).resolve().parent / "git_safety_impl"
_IMPL_NAME = "_git_safety_impl_" + hashlib.sha256(str(_IMPL_ROOT).encode()).hexdigest()[:20]
_write_bytecode = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    if _IMPL_NAME not in sys.modules:
        _spec = importlib.util.spec_from_file_location(
            _IMPL_NAME, _IMPL_ROOT / "__init__.py", submodule_search_locations=[str(_IMPL_ROOT)]
        )
        _package = importlib.util.module_from_spec(_spec)
        sys.modules[_IMPL_NAME] = _package
        _spec.loader.exec_module(_package)
    _pkg = sys.modules[_IMPL_NAME]
    _git, _paths, _rm, _commands, _payloads, _shell = (
        importlib.import_module(f"{_IMPL_NAME}.{name}")
        for name in ("git", "paths", "rm", "commands", "payloads", "shell")
    )
finally:
    sys.dont_write_bytecode = _write_bytecode
is_harness_scratchpad = _pkg.harness_paths.is_harness_scratchpad
_backtick_bodies = _pkg.shell_parse._backtick_bodies
dollar_paren_bodies = _pkg.shell_parse.dollar_paren_bodies
_invoked_alias_bodies = _pkg.shell_parse._invoked_alias_bodies
shell_text_without_heredoc_bodies = _pkg.shell_parse.shell_text_without_heredoc_bodies
without_dollar_paren_bodies = _pkg.shell_parse.without_dollar_paren_bodies
executable_shell_structure = _pkg.shell_parse.executable_shell_structure
executable_shell_structure_has_open_state = (
    _pkg.shell_parse.executable_shell_structure_has_open_state
)
process_substitution_at = _pkg.shell_parse.process_substitution_at
policy_command_size_reason = _pkg.shell_parse.policy_command_size_reason
PolicyEvaluationDeadlineExceeded = _pkg.shell_parse.PolicyEvaluationDeadlineExceeded
cancel_policy_evaluation_deadline = _pkg.shell_parse.cancel_policy_evaluation_deadline
policy_evaluation_deadline = _pkg.shell_parse.policy_evaluation_deadline

# Names remain patchable on this facade; implementation calls look them up here.
for _module, _names in (
    (_git, "_norm _HTML_COMMENT _SKELETON_LINES _GLOBAL_OPTS_WITH_SEPARATE_VALUE _MESSAGE_FLAGS_WITH_VALUE"),
    (_paths, "_SHELL_VAR_RE _outermost_repo_root _within _gitfile_owner"),
    (_rm, "_skip_options"),
    (_commands, "_KILL_MATCHER_COMMANDS _KILL_OPTIONS_WITH_VALUE _KILL_FULL_MATCH_OPTIONS _KILL_GUIDANCE _top_level_alternation"),
    (_payloads, "_SHELLS _MAX_EXECUTION_DEPTH _PIPED_INTERPRETER_HEREDOC_RE _STRING_LITERAL_RE _FUNCTION_DEFINITION_RE _printed_text"),
    (_shell, "_LITERAL_FOR_LOOP_RE _LITERAL_LOOP_VALUE_RE"),
):
    for _name in _names.split():
        globals()[_name] = getattr(_module, _name)
_FILE_REDIRECT_RE = re.compile(r"(?<![<>])(?:>>|>)(?![>&])")
_ASSIGNMENT_RE = re.compile(r"(?:^|[;&\n]\s*)([A-Za-z_][A-Za-z0-9_]*)=" r"(?:\"([^\"]*)\"|'([^']*)'|([^\s;&]+))")
_SHELL_CONTROL_PREFIXES = {"!", "if", "then", "elif", "else", "while", "until", "do", "fi", "done"}
_MAX_WRAPPER_DEPTH = 64


def _shell_text_with_comments_blanked(command: str) -> str:
    """Blank real shell comments without swallowing their trailing newline.

    ``shlex`` treats every ``#`` as a comment opener and consumes the newline.
    Shell comments instead require an unquoted token boundary, and ``#`` is an
    operator inside ``${...}``.  Keeping newlines preserves command boundaries
    for a destructive sibling on the next line.
    """
    output = list(command)
    quote = None
    parameter_depth = 0
    index = 0
    while index < len(command):
        char = command[index]
        if char == "\\" and quote != "'":
            index += 2
            continue
        if quote is not None:
            if char == quote:
                quote = None
            index += 1
            continue
        if char in "'\"":
            quote = char
            index += 1
            continue
        if command.startswith("${", index):
            parameter_depth += 1
            index += 2
            continue
        if char == "}" and parameter_depth:
            parameter_depth -= 1
            index += 1
            continue
        if (
            char == "#"
            and not parameter_depth
            and (index == 0 or command[index - 1].isspace() or command[index - 1] in ";|&()")
        ):
            while index < len(command) and command[index] not in "\r\n":
                output[index] = " "
                index += 1
            continue
        index += 1
    return "".join(output)


def _wrapper_depth_reason() -> str:
    return f"wrapper nesting exceeds {_MAX_WRAPPER_DEPTH}; refusing to evaluate"

def pr_body_is_empty(body: str | None) -> bool:
    return _git.pr_body_is_empty(body, api=globals())

def split_git(command: str):
    return _git.split_git(command, api=globals())

def is_unauthorized_no_verify(command: str, authorized: bool = False) -> bool:
    return _git.is_unauthorized_no_verify(command, authorized, split_git_fn=split_git, api=globals())

def restore_targets(command: str) -> list[str] | None:
    return _git.restore_targets(command, split_git_fn=split_git)

def is_destructive_restore(command: str, owned_paths=None) -> dict:
    return _git.is_destructive_restore(command, owned_paths, restore_targets_fn=restore_targets, api=globals())

def _expand_known_vars(value: str, variables: dict[str, str]) -> tuple[str, bool]:
    return _paths._expand_known_vars(value, variables, _SHELL_VAR_RE)

def _literal_tail_after_unresolved_var(target: str, variables: dict[str, str]) -> bool:
    return _paths._literal_tail_after_unresolved_var(target, variables, _SHELL_VAR_RE)

def _rm_target_reason(target: str, cwd: str, variables: dict[str, str], protected_cwd: str | None = None, *, protected_only: bool = False) -> str | None:
    return _paths._rm_target_reason(
        target, cwd, variables, expand_known_vars_fn=_expand_known_vars,
        literal_tail_fn=_literal_tail_after_unresolved_var, outermost_repo_root_fn=_outermost_repo_root,
        gitfile_owner_fn=_gitfile_owner, within_fn=_within, is_harness_scratchpad_fn=is_harness_scratchpad,
        protected_cwd=protected_cwd, protected_only=protected_only,
    )

def _rm_reason_in_words(
    words: list[str], position: int, cwd: str, variables: dict[str, str],
    *, dynamic_input: bool = False, argument_variables: dict[str, str] | None = None,
) -> str | None:
    return _rm._rm_reason_in_words(
        globals(), words, position, cwd, variables, dynamic_input=dynamic_input,
        argument_variables=argument_variables, _depth=0,
    )


def _is_dangerous_rm_at_depth(
    command: str, *, cwd: str | None = None, env=None, _depth: int,
):
    return _rm.is_dangerous_rm(globals(), command, cwd=cwd, env=env, _depth=_depth)


def is_dangerous_rm(command: str, *, cwd: str | None = None, env=None):
    try:
        return _is_dangerous_rm_at_depth(command, cwd=cwd, env=env, _depth=0)
    except RecursionError:
        return True, _wrapper_depth_reason()

def _degenerate_kill_pattern(pattern: str) -> bool:
    return _commands._degenerate_kill_pattern(pattern, api=globals())

def _kill_matcher_reason(words: list[str], position: int, command_name: str) -> str | None:
    return _commands._kill_matcher_reason(words, position, command_name, api=globals())

def _dangerous_non_rm_in_words(words: list[str], position: int = 0) -> str | None:
    return _commands._dangerous_non_rm_in_words(globals(), words, position, _depth=0)


def _dangerous_git_reason_at_depth(command: str, *, _depth: int) -> str | None:
    return _commands._dangerous_git_reason(command, api=globals(), _depth=_depth)

def _dangerous_git_reason(command: str) -> str | None:
    try:
        return _dangerous_git_reason_at_depth(command, _depth=0)
    except RecursionError:
        return _wrapper_depth_reason()

def _literal_loop(command: str):
    return _shell._literal_loop(command, api=globals())

def _executed_payloads(command: str, active: str) -> list[str]:
    return _payloads._executed_payloads(command, active, api=globals())

def dangerous_shell_reason(command: str, *, cwd: str | None = None, env=None, _depth: int = 0):
    try:
        return _shell.dangerous_shell_reason(command, cwd=cwd, env=env, _depth=_depth, api=globals())
    except RecursionError:
        return _wrapper_depth_reason()

"""Shared shell parser for golems PreToolUse hooks (GO-5 S13).

Moved verbatim from tmp-block/hooks/tmp-block-pretooluse.py (the tokenizer,
heredoc stripping, `$()`/backtick substitution, command-position flags and
alias/function body expansion) and from git-guardian/git_safety.py (DATA text and substitution bodies, now
kept in separate implementation modules).
Hooks keep POLICY; this module only answers "what does Bash execute here".
Importers: tmp-block, git-guardian (and, through git_safety, pre_tool_use.py).

AIDEV-NOTE: a pure move. Behaviour is pinned by the tmp-block and
git-guardian suites; change parsing here, never re-fork it into a hook.
"""

from __future__ import annotations

import ast
import os
import re
import signal as _signal
import shlex
import time as _time
from contextlib import contextmanager as _contextmanager
from fnmatch import fnmatchcase
import hashlib as _hashlib
import importlib as _importlib
import importlib.util as _importlib_util
from pathlib import Path as _Path
import sys as _sys


MAX_POLICY_COMMAND_BYTES = 32 * 1024
POLICY_EVALUATION_DEADLINE_SECONDS = 3.0


class PolicyEvaluationDeadlineExceeded(BaseException):
    """The hook's in-process policy budget expired before a safe decision."""


_policy_deadline_active = False


def _raise_policy_deadline(_signum, _frame):
    raise PolicyEvaluationDeadlineExceeded(
        "policy evaluation exceeded its time budget; split the command or "
        "write the content to a file and pass it by path"
    )


def cancel_policy_evaluation_deadline() -> None:
    """Disarm the active policy timer before serializing a hook decision."""
    if _policy_deadline_active:
        _signal.setitimer(_signal.ITIMER_REAL, 0)


@_contextmanager
def policy_evaluation_deadline(
    seconds: float = POLICY_EVALUATION_DEADLINE_SECONDS,
):
    """Bound policy work and restore any caller-owned SIGALRM state."""
    global _policy_deadline_active
    previous_handler = _signal.getsignal(_signal.SIGALRM)
    previous_delay, previous_interval = _signal.getitimer(_signal.ITIMER_REAL)
    started = _time.monotonic()
    _signal.signal(_signal.SIGALRM, _raise_policy_deadline)
    _policy_deadline_active = True
    _signal.setitimer(_signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        cancel_policy_evaluation_deadline()
        _policy_deadline_active = False
        _signal.signal(_signal.SIGALRM, previous_handler)
        if previous_delay > 0:
            elapsed = _time.monotonic() - started
            _signal.setitimer(
                _signal.ITIMER_REAL,
                max(previous_delay - elapsed, 1e-6),
                previous_interval,
            )


def policy_command_size_reason(command: str) -> str | None:
    """Return a value-free refusal reason when policy parsing is out of budget."""
    if not isinstance(command, str):
        raise TypeError("shell command is not a string")
    try:
        encoded_size = len(command.encode("utf-8"))
    except UnicodeEncodeError:
        return (
            "command cannot be encoded safely for the policy parser; split it "
            "or write the content to a file and pass it by path"
        )
    if encoded_size > MAX_POLICY_COMMAND_BYTES:
        return (
            "command too large for the policy parser; split it or write the "
            "content to a file and pass it by path "
            f"(maximum {MAX_POLICY_COMMAND_BYTES} bytes)"
        )
    return None


# Load beside the facade's real file, so a file symlink cannot shadow its
# implementation with a different package beside the link.
_IMPL_DIR = _Path(os.path.realpath(__file__)).parent / "shell_parse_impl"
_IMPL_NAME = "_golems_shell_parse_impl_" + _hashlib.sha256(
    str(_IMPL_DIR).encode()
).hexdigest()[:16]
if _IMPL_NAME not in _sys.modules:
    _impl_spec = _importlib_util.spec_from_file_location(
        _IMPL_NAME, _IMPL_DIR / "__init__.py",
        submodule_search_locations=[str(_IMPL_DIR)],
    )
    _impl_package = _importlib_util.module_from_spec(_impl_spec)
    _sys.modules[_IMPL_NAME] = _impl_package
    _previous_bytecode, _sys.dont_write_bytecode = _sys.dont_write_bytecode, True
    try:
        _impl_spec.loader.exec_module(_impl_package)
    finally:
        _sys.dont_write_bytecode = _previous_bytecode
    del _impl_spec, _impl_package, _previous_bytecode


def _impl_module(name):
    # Preserve the caller's bytecode preference after loading our package.
    previous, _sys.dont_write_bytecode = _sys.dont_write_bytecode, True
    try:
        return _importlib.import_module(f"{_IMPL_NAME}.{name}")
    finally:
        _sys.dont_write_bytecode = previous


_quotes = _impl_module("quotes")
ansi_c_opens_at = _quotes.ansi_c_opens_at
ansi_c_readings = _quotes.ansi_c_readings
ansi_c_reading = _quotes.ansi_c_reading

_tokens = _impl_module("tokens")
for _name in (
    "_ASSIGNMENT_RE", "_RAW_SHELL_TOKEN_RE", "_RAW_FOR_WORD_RE",
    "_QUOTED_LBRACE", "_QUOTED_RBRACE", "_is_command_sub_open",
    "_is_command_sub_close", "_command_sub_word_continues",
    "_shell_tokens", "_is_separator", "_WRAPPER_CMDS",
    "_FUNCTION_LOOKUP_SUPPRESSORS", "_UNRESOLVED_EVAL_MARKER",
):
    globals()[_name] = getattr(_tokens, _name)
del _name

_masks = _impl_module("masks")
for _name in (
    "_blank_quoted", "_mask_quoted_operator_words",
    "_mask_function_definition_bodies",
):
    globals()[_name] = getattr(_masks, _name)
del _name


_heredocs = _impl_module("heredocs")
for _name in (
    "_HEREDOC_START_RE", "_blank_shell_comment", "_strip_heredoc_bodies",
    "_mask_heredoc_body_lines", "_heredoc_delimiter_word",
    "_after_heredoc_bodies", "_heredoc_executable_text",
):
    globals()[_name] = getattr(_heredocs, _name)
del _name


_substitutions = _impl_module("substitutions")
for _name in (
    "_dollar_substitution", "_backtick_substitution",
    "_executable_subcommands", "_shell_command_payloads",
):
    globals()[_name] = getattr(_substitutions, _name)
del _name


_positions = _impl_module("positions")
for _name in (
    "_segment_for_offset", "_nested_segment", "_nested_alias_segment",
    "_segment_is_fully_exposed", "_segment_is_prefix",
    "_shell_integer_arithmetic", "_WRAPPER_VALUE_OPTS",
    "_command_position_flags", "_parse_bash", "_function_signature_parens",
):
    globals()[_name] = getattr(_positions, _name)
del _name


_structure = _impl_module("structure")
_units = _impl_module("units")
_function_expansion = _impl_module("function_expansion")
_patterns = _impl_module("patterns")
_conditions = _impl_module("conditions")
_variables = _impl_module("variables")
_eval_payloads = _impl_module("eval_payloads")
_expansion_state = _impl_module("expansion_state")
_expansion = _impl_module("expansion")


# AIDEV-NOTE: heredocs and substitutions import each other, so bind this
# genuine scanner seam after both modules load. The backtick goldens pin it.
_heredocs._dollar_substitution = _dollar_substitution
_heredocs._backtick_substitution = _backtick_substitution


def executable_shell_structure(command: str) -> str:
    """Length-preserving shell text with non-executable data blanked.

    Command substitutions are checked recursively by their callers, so this
    outer structural view hides them along with quotes, comments, and heredoc
    bodies. Process substitutions remain visible for exact-span parsing.
    """
    return _structure.structural_source(_mask_heredoc_body_lines(command))


def executable_shell_structure_has_open_state(command: str) -> bool:
    """Whether the structural mask ended in an open quote or heredoc."""
    masked, heredoc_closed = _heredocs._mask_heredoc_body_lines_with_status(
        command
    )
    _structural, quotes_closed = _structure.structural_source_with_status(masked)
    return not (heredoc_closed and quotes_closed)


def process_substitution_at(command: str, start: int) -> tuple[str, int]:
    """Return the body and end offset of the process substitution at `start`.

    Reuse the balanced substitution parser from the exact opening token. It
    stops at that token's matching close instead of scanning later command
    text, and malformed executed substitutions fail closed.
    """
    if command[start:start + 2] not in {"<(", ">("}:
        raise ValueError("expected process substitution")
    synthetic = command[:start] + "$" + command[start + 1:]
    found = _dollar_substitution(synthetic, start)
    if found is None:
        raise ValueError("unterminated process substitution")
    return found


_invoked_alias_bodies = _expansion._invoked_alias_bodies



_data_text = _impl_module("data_text")
for _name in (
    "_HEREDOC_RE", "_heredoc_word", "_literal_file_heredoc_header",
    "_simple_command_end", "_executable_expansions", "_HEREDOC_INTERPRETERS",
    "_DATA_COMMANDS", "_GIT_DATA_SUBCOMMANDS", "_interpreter_heredoc_header",
    "_is_data_command", "_EXECUTOR_RE", "_has_unquoted_pipe",
    "_mask_data_argument_quotes", "shell_text_without_heredoc_bodies",
    "_data_argument_quote_end", "_data_backtick_end", "_data_dollar_paren_end",
):
    globals()[_name] = getattr(_data_text, _name)
del _name

_data_substitutions = _impl_module("data_substitutions")
for _name in (
    "_backtick_bodies", "_dollar_paren_spans", "dollar_paren_bodies",
    "without_dollar_paren_bodies",
):
    globals()[_name] = getattr(_data_substitutions, _name)
del _name

"""Shared shell parser for golems PreToolUse hooks (GO-5 S13).

Moved verbatim from tmp-block/hooks/tmp-block-pretooluse.py (the tokenizer,
heredoc stripping, `$()`/backtick substitution, command-position flags and
alias/function body expansion) and from git-guardian/git_safety.py (its
file-write heredoc stripping and backtick bodies, in the last section).
Hooks keep POLICY; this module only answers "what does Bash execute here".
Importers: tmp-block, git-guardian (and, through git_safety, pre_tool_use.py).

AIDEV-NOTE: a pure move. Behaviour is pinned by the tmp-block and
git-guardian suites; change parsing here, never re-fork it into a hook.
"""

from __future__ import annotations

import ast
import os
import re
import shlex
from fnmatch import fnmatchcase
import hashlib as _hashlib
import importlib as _importlib
import importlib.util as _importlib_util
from pathlib import Path as _Path
import sys as _sys


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


def _invoked_alias_bodies(command, _initial_state=None):
    """Return alias bodies expanded on later lines when Bash enables them."""
    expansion_state = _expansion_state.initial_state(_initial_state)
    enabled = expansion_state.enabled
    nocasematch = expansion_state.nocasematch
    aliases = expansion_state.aliases
    function_bodies = expansion_state.function_bodies
    expanded_function_bodies = expansion_state.expanded_function_bodies
    invoked = expansion_state.invoked
    offset = expansion_state.offset
    invocation_index = expansion_state.invocation_index
    unit_nocasematch = nocasematch
    command_vars = expansion_state.command_vars






    def active_compounds_execute(
        prefix_tokens,
        raw_case_groups=None,
        raw_for_counts=None,
        require_definite=False,
    ):
        return _conditions.active_compounds_execute(
            prefix_tokens, raw_case_groups, raw_for_counts,
            require_definite, unit_nocasematch=unit_nocasematch,
        )

    executable_source = _mask_heredoc_body_lines(command)
    for source_unit in _units.parse_units(executable_source):
        unit = _expansion_state.make_source_unit(source_unit, nocasematch)
        line = unit.line
        unit_nocasematch = unit.unit_nocasematch
        parse_line = unit.parse_line
        tokens, cmd_pos, seg_of, _scope_of = (
            unit.tokens, unit.cmd_pos, unit.seg_of, unit.scope_of
        )
        literal_tokens = unit.literal_tokens

        def standalone_separator_at(index, separators):
            return _expansion_state.standalone_separator_at(unit, index, separators)

        def command_is_parent_local(command_index):
            return _expansion_state.command_is_parent_local(unit, command_index)

        _expansion_state.prepare_alias_metadata(unit)
        builtin_token_indices = unit.builtin_token_indices
        alias_ineligible_builtin_indices = unit.alias_ineligible_builtin_indices
        raw_alias_bodies = unit.raw_alias_bodies
        line_definitions = _expansion_state.collect_line_definitions(
            unit, expansion_state, active_compounds_execute
        )
        function_events = _expansion_state.build_function_events(
            unit, line_definitions, active_compounds_execute,
            command_is_parent_local,
        )
        unit.function_events = function_events
        apply_function_event = _expansion_state.apply_function_event

        def function_state_at(token_index):
            return _expansion_state.function_state_at(
                unit, expansion_state, token_index
            )

        def variable_state_at(token_index):
            return _expansion_state.variable_state_at(
                unit, expansion_state, token_index,
                command_is_parent_local, active_compounds_execute,
            )

        for body, sub_outer_seg, _sub_index, exposed in _executable_subcommands(
            line
        ):
            if exposed:
                continue
            token_index = next(
                (
                    i
                    for i, segment in enumerate(seg_of)
                    if segment == sub_outer_seg
                ),
                len(tokens),
            )
            bodies, expanded_bodies = function_state_at(token_index)
            state = (enabled, aliases, bodies, expanded_bodies, nocasematch)
            for nested_body, _nested_seg, _nested_index in _invoked_alias_bodies(
                body,
                state,
            ):
                invoked.append(
                    (
                        nested_body,
                        _segment_for_offset(command, offset) + sub_outer_seg,
                        invocation_index,
                    )
                )
                invocation_index += 1

        for i, token in enumerate(tokens):
            if not cmd_pos[i]:
                continue
            if not active_compounds_execute(
                tokens[:i],
                _patterns.case_pattern_groups(line),
                _patterns.literal_for_word_counts(line),
            ):
                continue
            segment_commands = [
                tokens[j]
                for j in range(i)
                if seg_of[j] == seg_of[i] and cmd_pos[j]
            ]
            if (
                segment_commands
                and os.path.basename(segment_commands[0])
                in _FUNCTION_LOOKUP_SUPPRESSORS
            ):
                continue
            bodies, expanded_bodies = function_state_at(i)
            resolved_token = token
            variable = re.fullmatch(r"\$([A-Za-z_][A-Za-z0-9_]*)", token)
            if variable:
                resolved_token = variable_state_at(i).get(variable.group(1), token)
            if resolved_token not in bodies:
                continue
            outer_seg = _segment_for_offset(command, offset) + seg_of[i]
            invocation_arguments = [
                tokens[j]
                for j in range(i + 1, len(tokens))
                if seg_of[j] == seg_of[i]
            ]
            invoked.append(
                (
                    _function_expansion.expand_function_arguments(
                        _function_expansion.expand_function(
                            expansion_state,
                            expanded_bodies.get(
                                resolved_token,
                                bodies[resolved_token],
                            ),
                            bodies=bodies,
                            expanded_bodies=expanded_bodies,
                        ),
                        invocation_arguments,
                    ),
                    outer_seg,
                    invocation_index,
                )
            )
            invocation_index += 1
        for i, token in enumerate(tokens):
            payload = _eval_payloads.detect_eval_payload(
                i,
                token,
                variable_state_at=variable_state_at,
                tokens=tokens,
                seg_of=seg_of,
                cmd_pos=cmd_pos,
                active_compounds_execute=active_compounds_execute,
                line=line,
                function_state_at=function_state_at,
                literal_tokens=literal_tokens,
            )
            if payload is None:
                continue
            eval_source, eval_variables, bodies, expanded_bodies = payload
            eval_source = _eval_payloads.resolve_eval_source(
                eval_source,
                eval_variables,
                enabled=enabled,
                expansion_state=expansion_state,
            )
            invoked.append(
                (
                    eval_source,
                    _segment_for_offset(command, offset) + seg_of[i],
                    invocation_index,
                )
            )
            invocation_index += 1
            if "$(" in eval_source or "`" in eval_source:
                invoked.append(
                    (
                        eval_source.replace("$(", " ")
                        .replace(")$", " ")
                        .replace("`", " "),
                        _segment_for_offset(command, offset) + seg_of[i],
                        invocation_index,
                    )
                )
                invocation_index += 1
            eval_tokens, eval_cmd_pos, eval_seg_of, _ = _parse_bash(eval_source)
            for eval_index, name in enumerate(eval_tokens):
                if not eval_cmd_pos[eval_index]:
                    continue
                segment_commands = [
                    eval_tokens[j]
                    for j in range(eval_index)
                    if eval_seg_of[j] == eval_seg_of[eval_index]
                    and eval_cmd_pos[j]
                ]
                if (
                    segment_commands
                    and os.path.basename(segment_commands[0])
                    in _FUNCTION_LOOKUP_SUPPRESSORS
                ):
                    continue
                if not active_compounds_execute(
                    eval_tokens[:eval_index],
                    _patterns.case_pattern_groups(eval_source),
                    _patterns.literal_for_word_counts(eval_source),
                ):
                    continue
                invoked_names = (
                    [name]
                    if name in bodies
                    else list(bodies)
                    if "$" in name or "`" in name
                    else []
                )
                for invoked_name in invoked_names:
                    invoked.append(
                        (
                            _function_expansion.expand_function(
                                expansion_state,
                                expanded_bodies.get(
                                    invoked_name,
                                    bodies[invoked_name],
                                ),
                                bodies=bodies,
                                expanded_bodies=expanded_bodies,
                            ),
                            _segment_for_offset(command, offset) + seg_of[i],
                            invocation_index,
                        )
                    )
                    invocation_index += 1
        if enabled:
            for i, token in enumerate(tokens):
                if (
                    cmd_pos[i]
                    and token in aliases
                    and active_compounds_execute(
                        tokens[:i],
                        _patterns.case_pattern_groups(line),
                        _patterns.literal_for_word_counts(line),
                    )
                ):
                    bodies, expanded_bodies = function_state_at(i)
                    outer_seg = _segment_for_offset(command, offset) + seg_of[i]
                    expanded = _function_expansion.expand_alias(expansion_state, token)
                    tail = [
                        tokens[j]
                        for j in range(i + 1, len(tokens))
                        if seg_of[j] == seg_of[i]
                    ]
                    if (
                        aliases[token].endswith((" ", "\t"))
                        and tail
                        and tail[0] in aliases
                    ):
                        expanded = f"{expanded}{_function_expansion.expand_alias(expansion_state, tail.pop(0))}"
                    if tail:
                        expanded = f"{expanded} {' '.join(tail)}"
                    invoked.append(
                        (
                            _function_expansion.expand_function(
                                expansion_state,
                                expanded,
                                bodies=bodies,
                                expanded_bodies=expanded_bodies,
                            ),
                            outer_seg,
                            invocation_index,
                        )
                    )
                    invocation_index += 1
        for event in function_events:
            apply_function_event(
                function_bodies,
                expanded_function_bodies,
                event,
            )
        # Shell parses a complete line before executing it, so shopt/alias
        # changes here affect only subsequent lines.
        for i, token in enumerate(tokens):
            if not cmd_pos[i]:
                continue
            if not active_compounds_execute(
                tokens[:i],
                _patterns.case_pattern_groups(line),
                _patterns.literal_for_word_counts(line),
            ):
                continue
            definitely_executes = active_compounds_execute(
                tokens[:i],
                _patterns.case_pattern_groups(line),
                _patterns.literal_for_word_counts(line),
                require_definite=True,
            )
            if not command_is_parent_local(i):
                continue
            same_segment = [
                tokens[j]
                for j in range(i + 1, len(tokens))
                if seg_of[j] == seg_of[i]
            ]
            effective_token = token
            if (
                token == "builtin"
                and same_segment
                and not (
                    enabled
                    and token in aliases
                    and i not in alias_ineligible_builtin_indices
                )
            ):
                effective_token = same_segment.pop(0)
            if effective_token == "shopt" and "expand_aliases" in same_segment:
                if "-s" in same_segment:
                    enabled = True
                elif "-u" in same_segment and definitely_executes:
                    enabled = False
            if effective_token == "shopt" and "nocasematch" in same_segment:
                if "-s" in same_segment:
                    nocasematch = True
                elif "-u" in same_segment and definitely_executes:
                    nocasematch = False
            if effective_token == "alias":
                for definition in same_segment:
                    if "=" not in definition:
                        continue
                    name, body = definition.split("=", 1)
                    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
                        aliases[name] = raw_alias_bodies.get(name, body)
            if effective_token == "unalias" and definitely_executes:
                if "-a" in same_segment:
                    aliases.clear()
                else:
                    for name in same_segment:
                        if not name.startswith("-"):
                            aliases.pop(name, None)
        command_vars = variable_state_at(len(tokens))
        offset += len(source_unit)
        expansion_state.enabled = enabled
        expansion_state.nocasematch = nocasematch
        expansion_state.command_vars = command_vars
        expansion_state.offset = offset
        expansion_state.invocation_index = invocation_index
    return invoked



# ── git-guardian: file-write heredoc stripping (moved from git_safety.py) ──────
# A second, narrower heredoc model than _strip_heredoc_bodies above: it masks
# only bodies that `cat` writes to a file and keeps `$()`/backticks from
# unquoted ones. Both live here so they can converge in one place (GO-5 PR-4).


_HEREDOC_RE = re.compile(r"(?<!<)<<(-?)\s*([^\s;|&<>]+)")


def _heredoc_word(raw: str) -> tuple[str, bool]:
    quoted = any(char in raw for char in "'\"\\")
    return raw.replace("'", "").replace('"', "").replace("\\", ""), quoted


def _literal_file_heredoc_header(header: str, *, piped: bool = False) -> bool:
    """True when `cat` consumes heredoc data without executing it as code."""
    try:
        lexer = shlex.shlex(
            header,
            posix=True,
            punctuation_chars=";&|()<>",
        )
        lexer.whitespace_split = True
        lexer.commenters = "#"
        words = list(lexer)
    except ValueError:
        return False
    command = next(
        (
            word
            for word in words
            if "=" not in word
            and not word.startswith("-")
            and word not in {";", "&", "|", "(", ")", "<", ">", ">>", "<<"}
        ),
        "",
    )
    if os.path.basename(command) != "cat":
        return False
    literal_file_redirect = False
    safe_process_sink = False
    for index, word in enumerate(words[:-1]):
        if word not in {">", ">>"}:
            continue
        target = words[index + 1]
        if target in {">(", "<("}:
            sink = words[index + 2] if index + 2 < len(words) else ""
            if os.path.basename(sink) in {"cat", "tee"}:
                safe_process_sink = True
                continue
            return False
        if target.startswith(">(") or target.startswith("<("):
            continue
        if target == "&" or target.isdigit():
            continue
        literal_file_redirect = True
    if literal_file_redirect or safe_process_sink:
        return True
    return not piped


def _simple_command_end(line: str, start: int) -> int:
    """Find the next unquoted top-level shell-list separator."""
    quote = None
    escaped = False
    paren_depth = 0
    index = start
    while index < len(line):
        char = line[index]
        if escaped:
            escaped = False
            index += 1
            continue
        if char == "\\" and quote != "'":
            escaped = True
            index += 1
            continue
        if quote:
            if char == quote:
                quote = None
            index += 1
            continue
        if char in {"'", '"'}:
            quote = char
            index += 1
            continue
        if char == "(" and index and line[index - 1] in {"$", "<", ">"}:
            paren_depth += 1
            index += 1
            continue
        if char == ")" and paren_depth:
            paren_depth -= 1
            index += 1
            continue
        if not paren_depth and char in ";|&":
            return index
        index += 1
    return len(line)


def _executable_expansions(line: str) -> str:
    """Keep command substitutions Bash executes in an unquoted heredoc."""
    found = []
    i = 0
    while i < len(line):
        if line[i] == "\\":
            i += 2
            continue
        if line.startswith("$(", i):
            j = _data_dollar_paren_end(line, i)
            body = shell_text_without_heredoc_bodies(
                line[i + 2:j - 1], _preserve_heredoc_delimiters=True
            )
            found.append("$(" + body + ")")
            i = j
            continue
        if line[i] == "`":
            j = _data_backtick_end(line, i)
            body = shell_text_without_heredoc_bodies(
                line[i + 1:j - 1], _preserve_heredoc_delimiters=True
            )
            found.append("`" + body + "`")
            i = j
            continue
        i += 1
    return " ".join(found)


# GO-5 PR-4: heredoc bodies a non-shell interpreter reads are its program text,
# and `tee`/`gh` read them as data (a file, a PR body). None of it is shell;
# Bash itself only runs an unquoted heredoc's `$()`/backticks.
_HEREDOC_INTERPRETERS = {"python", "python3", "node", "bun", "deno", "ruby", "perl", "tee", "gh"}

# Commands whose quoted arguments are data (messages, bodies, printed text).
# Anything else keeps its quoted text: `psql -c '…'`, `bash -c '…'`, `eval`.
_DATA_COMMANDS = {"echo", "printf", "gh"}
_GIT_DATA_SUBCOMMANDS = {"commit", "tag", "notes"}


def _interpreter_heredoc_header(header: str, *, piped: bool = False) -> bool:
    """True when a non-shell reader (_HEREDOC_INTERPRETERS) consumes the
    heredoc and its output is not piped on, e.g. into `sh`."""
    if piped:
        return False
    try:
        lexer = shlex.shlex(header, posix=True, punctuation_chars=";&|()<>")
        lexer.whitespace_split = True
        words = [w for w in lexer if "=" not in w]
    except ValueError:
        return False
    return bool(words) and os.path.basename(words[0]) in _HEREDOC_INTERPRETERS


def _is_data_command(words: list[str]) -> bool:
    words = [w for w in words if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w)]
    if not words:
        return False
    name = os.path.basename(words[0])
    if name in _DATA_COMMANDS:
        return True
    rest = [w for w in words[1:] if not w.startswith("-")]
    # A config override (`-c k=v`, `-ck=v`, `--config-env`) can name a program
    # git then runs (core.editor, alias.x=!…); any override makes git non-data.
    overrides = any(w.startswith(("-c", "--config-env")) for w in words[1:])
    return name == "git" and not overrides and bool(rest) and rest[0] in _GIT_DATA_SUBCOMMANDS


# Executors named anywhere in a command (as a word, or a path ending in one),
# plus `.` in command position. `ssh`, `shell`, `bash_profile` do not match.
_EXECUTOR_RE = re.compile(
    r"(?<![\w.-])(?:psql|sqlite3|mysql|sh|bash|zsh|eval|source)(?![\w-])"
    r"|(?:^|[;&|(\n])\s*\.\s"
)


def _has_unquoted_pipe(text: str) -> bool:
    """True when `text` has a single `|` (or `|&`) outside quotes; `||` is not one."""
    quote = None
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and quote != "'":
            index += 2
            continue
        if quote:
            if char == quote:
                quote = None
        elif char in "'\"":
            quote = char
        elif char == "|" and text[index + 1:index + 2] != "|" and text[index - 1:index] != "|":
            return True
        index += 1
    return False


def _mask_data_argument_quotes(text: str) -> str:
    """Blank the quoted arguments of data-only commands (echo/printf/gh, git
    commit|tag|notes), keeping any `$()`/backticks Bash runs inside "…".

    Fail-visible (GO-5 PR-4 round 3): nothing is masked when the command has
    an unquoted pipe or names an executor, since the data may reach it. A file
    written here and run by a LATER command is out of scope (never covered).
    """
    if "$'" in text:
        return text  # ANSI-C quoting is not modelled; never risk a desync
    if _has_unquoted_pipe(text) or _EXECUTOR_RE.search(text):
        return text
    out = []
    words: list[str] = []
    word = ""
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text):
            out.append(text[index:index + 2])
            word += text[index:index + 2]
            index += 2
            continue
        if char in "'\"":
            end = _data_argument_quote_end(text, index)
            body = text[index + 1:end]
            if words and _is_data_command(words):
                body = "" if char == "'" else _executable_expansions(body)
            out.append(char + body + (char if end < len(text) else ""))
            word += char
            index = end + 1
            continue
        if char in ";|&()\n":
            words, word = [], ""
        elif char in " \t":
            if word:
                words.append(word)
            word = ""
        else:
            word += char
        out.append(char)
        index += 1
    return "".join(out)


def _data_argument_quote_end(text: str, start: int) -> int:
    """Find a data-command argument's real closing quote.

    A double-quoted argument may contain complete `$()` or backtick regions
    with their own quotes.  Those inner delimiters cannot close the argument.
    The caller intentionally receives ``len(text)`` for an unclosed argument,
    preserving the established fail-visible behavior.
    """
    quote = text[start]
    index = start + 1
    while index < len(text):
        char = text[index]
        if quote == '"' and char == "\\":
            index += 2
            continue
        if quote == '"' and text.startswith("$(", index):
            index = _data_dollar_paren_end(text, index)
            continue
        if quote == '"' and char == "`":
            index = _data_backtick_end(text, index)
            continue
        if char == quote:
            return index
        index += 1
    return len(text)


def shell_text_without_heredoc_bodies(
    command: str, *, _preserve_heredoc_delimiters: bool = False
) -> str:
    """Remove heredoc prose while retaining executable substitutions.

    GO-5 PR-4: also drops heredoc bodies read by a non-shell interpreter and
    the quoted prose of data-only commands (see _DATA_COMMANDS), so callers'
    SQL/credential text scans see only what Bash would execute.

    The F8 reports were file-write heredocs whose prose quoted destructive
    commands. Scanning that prose blocks the act of reporting the bug. Quoted
    heredocs execute nothing; unquoted heredocs expose only `$()`/backticks.
    """
    output = []
    pending: list[tuple[str, bool, bool, bool]] = []
    for source_line in command.splitlines(keepends=True):
        line = source_line.rstrip("\r\n")
        ending = source_line[len(line):]
        if pending:
            delimiter, quoted, strip_tabs, mask_body = pending[0]
            candidate = line.lstrip("\t") if strip_tabs else line
            if candidate == delimiter:
                pending.pop(0)
                output.append(
                    source_line
                    if mask_body and _preserve_heredoc_delimiters
                    else ending if mask_body else source_line
                )
            else:
                if mask_body:
                    kept = "" if quoted else _executable_expansions(line)
                    output.append(kept + ending)
                else:
                    # In an unquoted heredoc, quotes are literal to the parent
                    # shell while `$()`/backticks still execute.  Preserve
                    # those expansions before the raw body is later parsed as
                    # child-shell text, so a literal apostrophe cannot hide
                    # the parent-side command.
                    if not quoted:
                        kept = _executable_expansions(line)
                        if kept:
                            output.append(kept + ending)
                    output.append(source_line)
            continue
        for match in _HEREDOC_RE.finditer(line):
            delimiter, quoted = _heredoc_word(match.group(2))
            if delimiter:
                segment_start = max(
                    line.rfind(separator, 0, match.start())
                    for separator in (";", "|", "&")
                )
                segment_end = _simple_command_end(line, match.end())
                header = _HEREDOC_RE.sub(
                    "", line[segment_start + 1:segment_end]
                )
                piped = segment_end < len(line) and line[segment_end] == "|"
                file_write = _literal_file_heredoc_header(
                    header, piped=piped
                ) or _interpreter_heredoc_header(header, piped=piped)
                pending.append(
                    (delimiter, quoted, bool(match.group(1)), file_write)
                )
        output.append(source_line)
    return _mask_data_argument_quotes("".join(output))


def _data_backtick_end(text: str, start: int) -> int:
    """Index after a DATA-model legacy substitution, or fail closed.

    Backtick bodies keep the GENERAL parser's legacy rule: an escaped backtick
    is data for the recursive pass, while the first unescaped backtick closes
    the body. Quote state belongs to that recursive body, not this delimiter.
    """
    index = start + 1
    while index < len(text):
        if text[index] == "\\":
            index += 2
            continue
        if text[index] == "`":
            return index + 1
        index += 1
    raise ValueError("unterminated command substitution")


def _data_dollar_paren_end(text: str, start: int) -> int:
    """Index after a quote-aware DATA-model `$()` substitution.

    This deliberately stays separate from the GENERAL parser model. It mirrors
    its shell quote rules while skipping nested substitutions as complete
    regions so their delimiters cannot close the containing `$()`.
    """
    found = _dollar_substitution(text, start)
    if found is None:
        raise ValueError("unterminated command substitution")
    _body, end = found
    return end


def _backtick_bodies(command: str) -> list[str]:
    """Extract executable legacy command substitutions, excluding single quotes."""
    bodies = []
    quote = None
    index = 0
    while index < len(command):
        char = command[index]
        if char == "\\" and quote != "'":
            index += 2
            continue
        if char == "'" and quote != '"':
            quote = None if quote == "'" else "'"
            index += 1
            continue
        if char == '"' and quote != "'":
            quote = None if quote == '"' else '"'
            index += 1
            continue
        if char != "`" or quote == "'":
            index += 1
            continue
        end = _data_backtick_end(command, index)
        bodies.append(command[index + 1:end - 1].replace("\\`", "`"))
        index = end
    return bodies


def _dollar_paren_spans(text: str) -> list[tuple[int, int]]:
    """(start, end) of each complete outermost `$()` outside single quotes."""
    spans = []
    quote = None
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and quote != "'":
            index += 2
            continue
        if quote == "'":
            if char == "'":
                quote = None
            index += 1
            continue
        if char == "'" and quote is None:
            quote = "'"
        elif char == '"':
            quote = None if quote == '"' else '"'
        elif char == "`":
            index = _data_backtick_end(text, index)
            continue
        elif text.startswith("$(", index):
            end = _data_dollar_paren_end(text, index)
            if text.startswith("$((", index):
                body = text[index + 2:end - 1]
                depth = 0
                quote_in_body = None
                escaped = False
                fallback = False
                for body_index, body_char in enumerate(body):
                    if escaped:
                        escaped = False
                        continue
                    if body_char == "\\" and quote_in_body != "'":
                        escaped = True
                        continue
                    if quote_in_body is not None:
                        if body_char == quote_in_body:
                            quote_in_body = None
                        continue
                    if body_char in "'\"":
                        quote_in_body = body_char
                    elif body_char == "(":
                        depth += 1
                    elif body_char == ")" and depth:
                        depth -= 1
                        if depth == 0:
                            # A newline is itself a shell command separator. Strip
                            # only horizontal whitespace so `$((group)\n cmd)` is
                            # recognized as command substitution, not arithmetic.
                            suffix = body[body_index + 1:].lstrip(" \t")
                            fallback = suffix.startswith((";", "&&", "||", "&", "|", "\n"))
                            break
                if not fallback:
                    index += 3
                    continue
            spans.append((index, end))
            index = end
            continue
        index += 1
    return spans


def dollar_paren_bodies(text: str) -> list[str]:
    """Bodies of `$( … )` command substitutions outside single quotes (GO-5).

    Double quotes do not stop Bash from running a `$()`, so `echo "x $(cmd)"`
    yields `cmd`. `$((` arithmetic is skipped. Nested substitutions come back
    as part of their outer body and are found again when that body is checked.
    """
    bodies = []
    for start, end in _dollar_paren_spans(text):
        bodies.append(text[start + 2:end - 1])
    return bodies


def without_dollar_paren_bodies(text: str) -> str:
    """`text` with every `$( … )` body blanked to `$()`. The bodies are checked
    on their own (where their quoted heredocs are stripped), so a caller scanning
    the outer text must not re-read what is inside them (GO-5, r7 on #233)."""
    out = []
    cursor = 0
    for start, end in _dollar_paren_spans(text):
        out.append(text[cursor:start] + "$()")
        cursor = end
    out.append(text[cursor:])
    return "".join(out)

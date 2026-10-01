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
    if _initial_state is None:
        enabled = False
        nocasematch = False
        aliases = {}
        function_bodies = {}
        expanded_function_bodies = {}
    else:
        enabled, initial_aliases, initial_functions, initial_expanded = (
            _initial_state[:4]
        )
        nocasematch = _initial_state[4] if len(_initial_state) > 4 else False
        aliases = dict(initial_aliases)
        function_bodies = dict(initial_functions)
        expanded_function_bodies = dict(initial_expanded)
    invoked = []
    offset = 0
    invocation_index = 0
    unit_nocasematch = nocasematch
    command_vars = {}
    expansion_state = _function_expansion.ExpansionState(
        aliases, function_bodies, expanded_function_bodies
    )







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
        line = _structure.normalize_function_signature_braces(
            source_unit.rstrip("\r\n")
        )
        unit_nocasematch = nocasematch or bool(
            re.search(
                r"(?:^|[;|&])\s*(?:builtin\s+)?shopt\s+-s\b"
                r"[^\n;|&]*\bnocasematch\b",
                line,
            )
        )
        parse_line = _structure.mask_quoted_braces(line)
        tokens, cmd_pos, seg_of, _scope_of = _parse_bash(parse_line)
        literal_tokens = _shell_tokens(line)

        def standalone_separator_at(index, separators):
            if index < 0 or index >= len(tokens) or tokens[index] not in separators:
                return False
            token = tokens[index]
            return not (
                (index > 0 and tokens[index - 1] == token)
                or (index + 1 < len(tokens) and tokens[index + 1] == token)
            )

        def command_is_parent_local(command_index):
            prefix_tokens = tokens[:command_index]
            signature_parens = _function_signature_parens(prefix_tokens)
            subshell_depth = sum(
                1 if token == "(" else -1 if token == ")" else 0
                for index, token in enumerate(prefix_tokens)
                if index not in signature_parens
            )
            if subshell_depth > 0:
                return False
            if standalone_separator_at(command_index - 1, {"|"}):
                return False
            for index in range(command_index + 1, len(tokens)):
                if tokens[index] not in {";", "|", "&"}:
                    continue
                return not standalone_separator_at(index, {"|", "&"})
            return True

        builtin_token_indices = [
            i for i, token in enumerate(tokens) if token == "builtin"
        ]
        alias_ineligible_builtin_indices = {
            token_index
            for alias_eligible, token_index in zip(
                _patterns.builtin_alias_eligibility(line),
                builtin_token_indices,
            )
            if not alias_eligible
        }
        raw_alias_bodies = {
            match.group(1): match.group(3)
            for match in re.finditer(
                r"(?:^|[;|&]\s*)(?:builtin\s+)?alias\s+"
                r"([A-Za-z_][A-Za-z0-9_]*)=(['\"])(.*?)\2"
                r"(?=\s*(?:[;|&]|$))",
                line,
            )
        }
        # Aliases enabled before this line are expanded while Bash parses a
        # function definition. Record definitions as ordered events: each one
        # becomes callable only after its closing brace executes.
        line_definitions = []
        source_definitions = _units.raw_function_definitions(line)
        source_definition_index = 0
        line_pos = 0
        while line_pos + 3 < len(tokens):
            function_name = None
            body_open = None
            if (
                re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tokens[line_pos])
                and tokens[line_pos + 1:line_pos + 4] == ["(", ")", "{"]
            ):
                function_name = tokens[line_pos]
                body_open = line_pos + 3
            elif tokens[line_pos] == "function" and line_pos + 2 < len(tokens):
                function_name = tokens[line_pos + 1]
                if tokens[line_pos + 2] == "{":
                    body_open = line_pos + 2
                elif tokens[line_pos + 2:line_pos + 5] == ["(", ")", "{"]:
                    body_open = line_pos + 4
            if body_open is None:
                line_pos += 1
                continue
            depth = 1
            close = body_open + 1
            while close < len(tokens) and depth:
                if tokens[close] == "{":
                    depth += 1
                elif tokens[close] == "}":
                    depth -= 1
                close += 1
            if not depth:
                raw_body = " ".join(tokens[body_open + 1:close - 1])
                if source_definition_index < len(source_definitions):
                    source_name, source_body = source_definitions[
                        source_definition_index
                    ]
                    source_definition_index += 1
                    if source_name == function_name:
                        raw_body = source_body
                expanded_body = _function_expansion.expand_alias_commands(expansion_state, raw_body)
                prefix_tokens = tokens[:line_pos]
                prefix = " ".join(tokens[:line_pos])
                signature_parens = _function_signature_parens(prefix_tokens)
                subshell_depth = sum(
                    1
                    if token == "("
                    else -1
                    if token == ")"
                    else 0
                    for index, token in enumerate(prefix_tokens)
                    if index not in signature_parens
                )
                pipeline_local = standalone_separator_at(
                    line_pos - 1, {"|"}
                ) or standalone_separator_at(close, {"|", "&"})
                inheritable = (
                    not _structure.has_unclosed_function_definition(prefix)
                    and subshell_depth <= 0
                    and not pipeline_local
                    and active_compounds_execute(
                        prefix_tokens,
                        _patterns.case_pattern_groups(line),
                        _patterns.literal_for_word_counts(line),
                    )
                )
                line_definitions.append(
                    (
                        close,
                        function_name,
                        raw_body,
                        expanded_body,
                        inheritable,
                    )
                )
                line_pos = close
                continue
            line_pos += 1

        function_events = [
            (close, "define", name, raw_body, expanded_body, inheritable)
            for close, name, raw_body, expanded_body, inheritable in line_definitions
        ]
        for i, token in enumerate(tokens):
            if token != "unset" or not cmd_pos[i]:
                continue
            same_segment = [
                tokens[j]
                for j in range(i + 1, len(tokens))
                if seg_of[j] == seg_of[i]
            ]
            if "-f" not in same_segment or not active_compounds_execute(
                tokens[:i],
                _patterns.case_pattern_groups(line),
                _patterns.literal_for_word_counts(line),
                require_definite=True,
            ):
                continue
            if not command_is_parent_local(i):
                continue
            for name in same_segment:
                if not name.startswith("-"):
                    function_events.append((i, "remove", name, None, None, True))
        function_events.sort(key=lambda event: event[0])

        def apply_function_event(bodies, expanded_bodies, event):
            _position, action, name, raw_body, expanded_body, inheritable = event
            if not inheritable:
                return
            if action == "remove":
                bodies.pop(name, None)
                expanded_bodies.pop(name, None)
                return
            bodies[name] = raw_body
            if expanded_body != raw_body:
                expanded_bodies[name] = expanded_body
            else:
                expanded_bodies.pop(name, None)

        def function_state_at(token_index):
            bodies = dict(function_bodies)
            expanded_bodies = dict(expanded_function_bodies)
            for event in function_events:
                if event[0] >= token_index:
                    break
                apply_function_event(bodies, expanded_bodies, event)
            return bodies, expanded_bodies

        def variable_state_at(token_index):
            variables = dict(command_vars)
            for index, candidate in enumerate(tokens[:token_index]):
                if cmd_pos[index]:
                    same_segment = [
                        tokens[j]
                        for j in range(index + 1, token_index)
                        if seg_of[j] == seg_of[index]
                    ]
                    def resolve_state_word(word):
                        variable = re.fullmatch(
                            r"\$([A-Za-z_][A-Za-z0-9_]*)",
                            word,
                        )
                        if not variable:
                            return word
                        name = variable.group(1)
                        if name in variables:
                            return variables[name] or word
                        return os.environ.get(name, word)

                    effective_command = resolve_state_word(candidate)
                    while effective_command == "builtin" and same_segment:
                        effective_command = resolve_state_word(
                            same_segment.pop(0)
                        )
                    definitely_executes = (
                        command_is_parent_local(index)
                        and active_compounds_execute(
                            tokens[:index],
                            _patterns.case_pattern_groups(line),
                            _patterns.literal_for_word_counts(line),
                            require_definite=True,
                        )
                    )
                    if effective_command == "unset" and definitely_executes:
                        if "-f" in same_segment:
                            continue
                        for unset_name in same_segment:
                            if re.fullmatch(
                                r"[A-Za-z_][A-Za-z0-9_]*",
                                unset_name,
                            ):
                                variables[unset_name] = None
                        continue
                    if effective_command == "set" and definitely_executes:
                        if "--" not in same_segment:
                            continue
                        for name in list(variables):
                            if name.isdigit():
                                variables.pop(name)
                        positional_words = same_segment[
                            same_segment.index("--") + 1:
                        ]
                        for position, value in enumerate(
                            positional_words,
                            start=1,
                        ):
                            if value in {"<", ">", ">>"}:
                                break
                            if any(marker in value for marker in ("$", "`")):
                                value = _UNRESOLVED_EVAL_MARKER
                            variables[str(position)] = value
                        continue
                    if (
                        effective_command == "printf"
                        and "-v" in same_segment
                        and definitely_executes
                    ):
                        value_index = same_segment.index("-v") + 1
                        if value_index < len(same_segment):
                            assigned_name = same_segment[value_index]
                            if re.fullmatch(
                                r"[A-Za-z_][A-Za-z0-9_]*",
                                assigned_name,
                            ):
                                variables[assigned_name] = (
                                    _UNRESOLVED_EVAL_MARKER
                                )
                        continue
                    if effective_command == "read" and definitely_executes:
                        found_destination = False
                        read_option_value = None
                        read_options_done = False
                        value_options = set("adinNptu")
                        for assigned_name in same_segment:
                            if assigned_name in {"<", ">", ">>"}:
                                break
                            if read_option_value is not None:
                                if (
                                    read_option_value == "a"
                                    and re.fullmatch(
                                        r"[A-Za-z_][A-Za-z0-9_]*",
                                        assigned_name,
                                    )
                                ):
                                    found_destination = True
                                    variables[assigned_name] = (
                                        _UNRESOLVED_EVAL_MARKER
                                    )
                                read_option_value = None
                                continue
                            if not read_options_done and assigned_name == "--":
                                read_options_done = True
                                continue
                            if (
                                not read_options_done
                                and assigned_name.startswith("-")
                                and assigned_name != "-"
                            ):
                                option_chars = assigned_name[1:]
                                for option_index, option in enumerate(option_chars):
                                    if option in value_options:
                                        attached_value = option_chars[
                                            option_index + 1:
                                        ]
                                        if attached_value:
                                            if (
                                                option == "a"
                                                and re.fullmatch(
                                                    r"[A-Za-z_][A-Za-z0-9_]*",
                                                    attached_value,
                                                )
                                            ):
                                                found_destination = True
                                                variables[attached_value] = (
                                                    _UNRESOLVED_EVAL_MARKER
                                                )
                                        else:
                                            read_option_value = option
                                        break
                                continue
                            if re.fullmatch(
                                r"[A-Za-z_][A-Za-z0-9_]*",
                                assigned_name,
                            ):
                                found_destination = True
                                variables[assigned_name] = (
                                    _UNRESOLVED_EVAL_MARKER
                                )
                        if not found_destination:
                            variables["REPLY"] = _UNRESOLVED_EVAL_MARKER
                        continue
                    if (
                        effective_command in {"mapfile", "readarray"}
                        and definitely_executes
                    ):
                        destination = None
                        option_value = False
                        options_done = False
                        value_options = set("dnOsuCc")
                        for word in same_segment:
                            if word in {"<", ">", ">>"}:
                                break
                            if option_value:
                                option_value = False
                                continue
                            if not options_done and word == "--":
                                options_done = True
                                continue
                            if (
                                not options_done
                                and word.startswith("-")
                                and word != "-"
                            ):
                                option_chars = word[1:]
                                for option_index, option in enumerate(
                                    option_chars
                                ):
                                    if option in value_options:
                                        option_value = (
                                            option_index
                                            == len(option_chars) - 1
                                        )
                                        break
                                continue
                            if re.fullmatch(
                                r"[A-Za-z_][A-Za-z0-9_]*",
                                word,
                            ):
                                destination = word
                                break
                        variables[destination or "MAPFILE"] = (
                            _UNRESOLVED_EVAL_MARKER
                        )
                        continue
                    if (
                        effective_command
                        in {"local", "declare", "typeset", "export", "readonly"}
                        and definitely_executes
                    ):
                        if "-f" in same_segment:
                            continue
                        declaration_snapshot = dict(variables)
                        pending_declarations = {}
                        for declaration in same_segment:
                            if not _ASSIGNMENT_RE.match(declaration):
                                continue
                            name, value = declaration.split("=", 1)
                            nameref_mode = any(
                                re.fullmatch(r"-[A-Za-z]+", option)
                                and "n" in option[1:]
                                for option in same_segment
                            )
                            if nameref_mode:
                                pending_declarations[name] = (
                                    _UNRESOLVED_EVAL_MARKER
                                )
                                continue
                            if "$(" in value or "`" in value:
                                pending_declarations[name] = (
                                    _UNRESOLVED_EVAL_MARKER
                                )
                                continue
                            def resolve_declaration_variable(match):
                                referenced = match.group(1) or match.group(2)
                                if referenced in declaration_snapshot:
                                    return declaration_snapshot[referenced] or ""
                                return os.environ.get(
                                    referenced,
                                    match.group(0),
                                )

                            pending_declarations[name] = re.sub(
                                r"\$([A-Za-z_][A-Za-z0-9_]*)"
                                r"|\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
                                resolve_declaration_variable,
                                value,
                            )
                        variables.update(pending_declarations)
                        continue
                if not cmd_pos[index] or not _ASSIGNMENT_RE.match(candidate):
                    continue
                assignment_name, assignment_value = candidate.split("=", 1)
                if "$(" in assignment_value and active_compounds_execute(
                    tokens[:index],
                    _patterns.case_pattern_groups(line),
                    _patterns.literal_for_word_counts(line),
                    require_definite=True,
                ):
                    close_index = next(
                        (
                            j
                            for j in range(index + 1, token_index)
                            if seg_of[j] == seg_of[index]
                            and _is_command_sub_close(tokens[j])
                        ),
                        None,
                    )
                    if close_index is not None:
                        variables[assignment_name] = _UNRESOLVED_EVAL_MARKER
                        continue
                lookahead = index + 1
                while (
                    lookahead < token_index
                    and _ASSIGNMENT_RE.match(tokens[lookahead])
                ):
                    lookahead += 1
                standalone = (
                    lookahead == token_index
                    or tokens[lookahead] in {"\n", ";", "|", "&"}
                )
                if not standalone or not active_compounds_execute(
                    tokens[:index],
                    _patterns.case_pattern_groups(line),
                    _patterns.literal_for_word_counts(line),
                    require_definite=True,
                ):
                    continue
                name, value = candidate.split("=", 1)
                def resolve_assignment_operator(match):
                    referenced, operator, word = match.groups()
                    if referenced in variables:
                        is_set = variables[referenced] is not None
                        current = variables[referenced] or ""
                    else:
                        is_set = referenced in os.environ
                        current = os.environ.get(referenced, "")
                    missing = not is_set or (
                        operator.startswith(":") and current == ""
                    )
                    operation = operator[-1]
                    if operation in {"-", "="}:
                        result = word if missing else current
                        if operation == "=" and missing:
                            variables[referenced] = word
                        return result
                    if operation == "+":
                        return "" if missing else word
                    if operation == "?":
                        return "" if missing else current
                    return current

                def resolve_assignment_variable(match):
                    referenced = match.group(1) or match.group(2)
                    if referenced in variables:
                        return variables[referenced] or ""
                    return os.environ.get(referenced, match.group(0))

                for _ in range(8):
                    previous = value
                    value = re.sub(
                        r"\$\{([A-Za-z_][A-Za-z0-9_]*)"
                        r"(:?[-+?=])([^{}]*)\}",
                        resolve_assignment_operator,
                        value,
                    )
                    value = re.sub(
                        r"\$([A-Za-z_][A-Za-z0-9_]*)"
                        r"|\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
                        resolve_assignment_variable,
                        value,
                    )
                    if value == previous:
                        break
                variables[name] = value
            return variables

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
            eval_variables = variable_state_at(i)
            resolved_eval_token = token
            eval_variable = re.fullmatch(
                r"\$([A-Za-z_][A-Za-z0-9_]*)",
                token,
            )
            if eval_variable:
                variable_name = eval_variable.group(1)
                if variable_name in eval_variables:
                    resolved_eval_token = eval_variables[variable_name]
                else:
                    resolved_eval_token = os.environ.get(
                        variable_name,
                        token,
                    )
            prior_words = [
                tokens[j]
                for j in range(i)
                if seg_of[j] == seg_of[i]
                and not _ASSIGNMENT_RE.match(tokens[j])
            ]

            def resolved_prior_word(word):
                variable = re.fullmatch(
                    r"\$([A-Za-z_][A-Za-z0-9_]*)",
                    word,
                )
                if variable:
                    return eval_variables.get(variable.group(1), word)
                return word

            resolved_prior_words = [
                resolved_prior_word(word) for word in prior_words
            ]

            def executable_builtin_wrapper_chain(words):
                index = 0
                while index < len(words):
                    wrapper = words[index]
                    if wrapper == "command":
                        index += 1
                        while index < len(words) and words[index] in {"-p", "--"}:
                            index += 1
                        if index < len(words) and words[index] in {"-v", "-V"}:
                            return False
                        continue
                    if wrapper == "builtin":
                        index += 1
                        if index < len(words) and words[index] == "--":
                            index += 1
                        continue
                    return False
                return bool(words)

            builtin_eval = (
                executable_builtin_wrapper_chain(resolved_prior_words)
                and next(
                    (
                        cmd_pos[j]
                        for j in range(i)
                        if seg_of[j] == seg_of[i]
                        and not _ASSIGNMENT_RE.match(tokens[j])
                    ),
                    False,
                )
            )
            eval_position = (
                builtin_eval if prior_words else cmd_pos[i]
            )
            if (
                resolved_eval_token != "eval"
                or not eval_position
                or not active_compounds_execute(
                    tokens[:i],
                    _patterns.case_pattern_groups(line),
                    _patterns.literal_for_word_counts(line),
                )
            ):
                continue
            bodies, expanded_bodies = function_state_at(i)
            payload_words = [
                (
                    literal_tokens[j]
                    if len(literal_tokens) == len(tokens)
                    else tokens[j]
                )
                for j in range(i + 1, len(tokens))
                if seg_of[j] == seg_of[i]
            ]
            # eval joins its arguments with spaces and parses the result as a
            # fresh shell program.  Re-tokenize that complete source so a
            # quoted outer-shell argument such as `eval 'f arg'` exposes `f`
            # as the inner command instead of the opaque token `f arg`.
            eval_source = " ".join(payload_words)

            def resolve_eval_variable(match):
                name = match.group(1) or match.group(2)
                if name in eval_variables:
                    return eval_variables[name] or ""
                return os.environ.get(name, match.group(0))

            def resolve_eval_parameter_operator(match):
                name, operator, word = match.groups()
                if name in eval_variables:
                    is_set = eval_variables[name] is not None
                    value = eval_variables[name] or ""
                else:
                    is_set = name in os.environ
                    value = os.environ.get(name, "")
                colon = operator.startswith(":")
                operation = operator[-1]
                missing = not is_set or (colon and value == "")
                if operation == "-":
                    return word if missing else value
                if operation == "+":
                    return "" if missing else word
                if operation == "?":
                    return "" if missing else value
                if operation == "=":
                    if missing:
                        eval_variables[name] = word
                        return word
                    return value
                return value

            def resolve_eval_indirect(match):
                reference_name = match.group(1)
                if reference_name in eval_variables:
                    target_name = eval_variables[reference_name] or ""
                else:
                    target_name = os.environ.get(reference_name, "")
                if target_name in eval_variables:
                    return eval_variables[target_name] or ""
                return os.environ.get(target_name, "")

            eval_source = re.sub(
                r"\$\{!([A-Za-z_][A-Za-z0-9_]*)\}",
                resolve_eval_indirect,
                eval_source,
            )

            eval_source = re.sub(
                r"\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-+?=])([^{}]*)\}",
                resolve_eval_parameter_operator,
                eval_source,
            )

            def resolve_eval_substring(match):
                name, offset_expression, length_expression = match.groups()
                if name in eval_variables:
                    value = eval_variables[name] or ""
                else:
                    value = os.environ.get(name, "")
                offset = _shell_integer_arithmetic(offset_expression)
                if offset is None:
                    return value
                start = offset if offset >= 0 else len(value) + offset
                start = max(0, start)
                if length_expression is None:
                    return value[start:]
                length = _shell_integer_arithmetic(length_expression)
                if length is None:
                    return value
                if length >= 0:
                    return value[start:start + length]
                return value[start:length]

            eval_source = re.sub(
                r"\$\{([A-Za-z_][A-Za-z0-9_]*):"
                r"(?![-+?=])([^}:]+)"
                r"(?::([^}]+))?\}",
                resolve_eval_substring,
                eval_source,
            )

            eval_source = re.sub(
                r"\$([A-Za-z_][A-Za-z0-9_]*|[0-9]+)"
                r"|\$\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+)\}",
                resolve_eval_variable,
                eval_source,
            )
            for _ in range(8):
                previous_eval_source = eval_source
                eval_source = re.sub(
                    r"\$\{!([A-Za-z_][A-Za-z0-9_]*)\}",
                    resolve_eval_indirect,
                    eval_source,
                )
                eval_source = re.sub(
                    r"\$\{([A-Za-z_][A-Za-z0-9_]*)"
                    r"(:?[-+?=])([^{}]*)\}",
                    resolve_eval_parameter_operator,
                    eval_source,
                )
                eval_source = re.sub(
                    r"\$\{([A-Za-z_][A-Za-z0-9_]*):"
                    r"(?![-+?=])([^}:]+)"
                    r"(?::([^}]+))?\}",
                    resolve_eval_substring,
                    eval_source,
                )
                eval_source = re.sub(
                    r"\$([A-Za-z_][A-Za-z0-9_]*|[0-9]+)"
                    r"|\$\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+)\}",
                    resolve_eval_variable,
                    eval_source,
                )
                if eval_source == previous_eval_source:
                    break
            def preserve_unresolved_named_modifier(match):
                name, modifier = match.groups()
                if name in eval_variables:
                    value = eval_variables[name] or ""
                else:
                    value = os.environ.get(
                        name,
                        _UNRESOLVED_EVAL_MARKER,
                    )
                return f"{value} {modifier}"

            eval_source = re.sub(
                r"\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}",
                preserve_unresolved_named_modifier,
                eval_source,
            )
            if "$(" in eval_source or "`" in eval_source:
                eval_source = _UNRESOLVED_EVAL_MARKER
            if enabled:
                eval_source = _function_expansion.expand_alias_commands(expansion_state, eval_source)
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
        elif text.startswith("$(", index) and not text.startswith("$((", index):
            end = _data_dollar_paren_end(text, index)
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

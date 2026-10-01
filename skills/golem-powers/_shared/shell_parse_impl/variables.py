"""Replay variable state as of a token in the current source unit."""

from __future__ import annotations

import os
import re

from . import patterns as _patterns
from .tokens import (
    _ASSIGNMENT_RE,
    _UNRESOLVED_EVAL_MARKER,
    _is_command_sub_close,
)


# AIDEV-TODO #372: decompose this existing whole-moved replay helper later.
def variable_state_at(
    token_index,
    *,
    command_vars,
    tokens,
    cmd_pos,
    seg_of,
    command_is_parent_local,
    active_compounds_execute,
    line,
):
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

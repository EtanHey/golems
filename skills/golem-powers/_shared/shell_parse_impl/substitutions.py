"""Executable command substitutions and shell -c payloads."""

from __future__ import annotations

from .quotes import shell_code

import os

from .heredocs import _after_heredoc_bodies
from .positions import _segment_for_offset
from .quotes import ansi_c_quote, ansi_c_opens_at


def _parameter_expansion_end(command, start):
    """Return the index after a balanced `${...}`, or None.

    Quotes inside a parameter expansion have their own state even when the
    expansion appears inside an outer double-quoted `$()` body.  Skipping the
    region as one unit prevents a literal `)` in a default value from closing
    the containing command substitution.
    """
    depth = 1
    quote = None
    i = start + 2
    while i < len(command):
        char = command[i]
        if quote is None and ansi_c_opens_at(command, i):
            _value, i = ansi_c_quote(command, i)
            continue
        if char == "\\" and quote != "'":
            i += 2
            continue
        if quote is not None:
            if char == quote:
                quote = None
                i += 1
                continue
            if quote == '"' and command.startswith("$(", i):
                nested = _dollar_substitution(command, i)
                if nested is None:
                    return None
                _body, i = nested
                continue
            i += 1
            continue
        if char in "\"'":
            quote = char
            i += 1
            continue
        if command.startswith("${", i):
            depth += 1
            i += 2
            continue
        if command.startswith("$(", i):
            nested = _dollar_substitution(command, i)
            if nested is None:
                return None
            _body, i = nested
            continue
        if char == "`":
            nested = _backtick_substitution(command, i)
            if nested is None:
                return None
            _body, i = nested
            continue
        if char == "}":
            depth -= 1
            i += 1
            if depth == 0:
                return i
            continue
        i += 1
    return None


def _dollar_substitution(command, start):
    """Return (`body`, index_after_close) for `$(` at `start`, or None."""
    depth = 1
    case_states = []
    case_pattern_started = []
    case_pattern_depths = []
    at_command_start = True
    quote = None
    i = start + 2
    while i < len(command):
        char = command[i]
        if quote is None and ansi_c_opens_at(command, i):
            _value, i = ansi_c_quote(command, i)
            at_command_start = False
            continue
        if char == "\\":
            i += 2
            continue
        if quote == "'":
            if char == "'":
                quote = None
            i += 1
            continue
        if quote == '"':
            if char == '"':
                quote = None
                i += 1
                continue
            if command.startswith("${", i):
                end = _parameter_expansion_end(command, i)
                if end is None:
                    return None
                i = end
                continue
            if command.startswith("$(", i) and not command.startswith("$((", i):
                nested = _dollar_substitution(command, i)
                if nested is None:
                    return None
                _body, i = nested
                continue
            i += 1
            continue
        if char.isspace():
            if char == "\n":
                at_command_start = True
            i += 1
            continue
        if char in "\"'":
            quote = char
            at_command_start = False
            i += 1
            continue
        if command.startswith("${", i):
            end = _parameter_expansion_end(command, i)
            if end is None:
                return None
            i = end
            continue
        if command.startswith("$(", i):
            nested = _dollar_substitution(command, i)
            if nested is None:
                return None
            _body, i = nested
            continue
        if char == "#" and (
            i == 0
            or command[i - 1].isspace()
            or command[i - 1] in ";|&()"
        ):
            newline = command.find("\n", i)
            i = len(command) if newline < 0 else newline + 1
            at_command_start = True
            continue
        if command.startswith("<<", i) and not command.startswith("<<<", i):
            after_bodies = _after_heredoc_bodies(command, i)
            if after_bodies is not None:
                i = after_bodies
                continue
        if char.isalpha() or char == "_":
            end = i + 1
            while end < len(command) and (
                command[end].isalnum() or command[end] == "_"
            ):
                end += 1
            word = command[i:end]
            if word == "case" and at_command_start:
                case_states.append("await-in")
                case_pattern_started.append(False)
                case_pattern_depths.append(0)
            elif case_states and case_states[-1] == "await-in" and word == "in":
                case_states[-1] = "pattern"
                case_pattern_started[-1] = False
                case_pattern_depths[-1] = 0
            elif (
                case_states
                and word == "esac"
                and (
                    (case_states[-1] == "body" and at_command_start)
                    or (
                        case_states[-1] == "pattern"
                        and not case_pattern_started[-1]
                    )
                )
            ):
                case_states.pop()
                case_pattern_started.pop()
                case_pattern_depths.pop()
            elif case_states and case_states[-1] == "pattern":
                case_pattern_started[-1] = True
            if word in {
                "if",
                "then",
                "elif",
                "else",
                "while",
                "until",
                "do",
            }:
                at_command_start = True
            else:
                at_command_start = False
            i = end
            continue
        case_terminator = next(
            (
                marker
                for marker in (";;&", ";;", ";&")
                if command.startswith(marker, i)
            ),
            None,
        )
        if case_states and case_states[-1] == "body" and case_terminator:
            case_states[-1] = "pattern"
            case_pattern_started[-1] = False
            case_pattern_depths[-1] = 0
            at_command_start = False
            i += len(case_terminator)
            continue
        if char in ";|&":
            at_command_start = True
            i += 1
            continue
        if char == "(":
            if case_states and case_states[-1] == "pattern":
                if case_pattern_started[-1]:
                    case_pattern_depths[-1] += 1
                else:
                    case_pattern_started[-1] = True
                i += 1
                continue
            depth += 1
        elif char == ")":
            if case_states and case_states[-1] == "pattern":
                if case_pattern_depths[-1]:
                    case_pattern_depths[-1] -= 1
                    i += 1
                    continue
                case_states[-1] = "body"
                at_command_start = True
                i += 1
                continue
            depth -= 1
            if depth == 0:
                return command[start + 2:i], i + 1
        elif not char.isspace():
            if case_states and case_states[-1] == "pattern":
                case_pattern_started[-1] = True
            at_command_start = False
        i += 1
    return None


def _backtick_substitution(command, start):
    """Return (`body`, index_after_close) for a legacy backtick command."""
    i = start + 1
    while i < len(command):
        if command[i] == "\\" and i + 1 < len(command):
            i += 2
            continue
        if command[i] == "`":
            # Within a legacy backtick body, `\`` represents a nested
            # backtick delimiter. Normalize it before recursively scanning.
            body = command[start + 1:i].replace("\\`", "`")
            return body, i + 1
        i += 1
    return None


def _executable_subcommands(command):
    """Extract executable `$()`/backtick bodies, including quoted contexts.

    The primary tokenizer preserves parent-shell word/cwd semantics. This
    recursive view covers the contexts intentionally opaque to that tokenizer
    (double quotes and arithmetic) without treating ordinary arithmetic words
    as commands. Single quotes remain literal.
    """
    bodies = []
    in_double = False
    at_boundary = True
    parameter_quote_states = []
    substitution_index = 0
    arithmetic_depth = 0
    i = 0
    while i < len(command):
        char = command[i]
        if not in_double and ansi_c_opens_at(command, i):
            _value, i = ansi_c_quote(command, i)
            at_boundary = False
            continue
        if char == "\\":
            at_boundary = False
            i += 2
            continue
        if (
            not in_double
            and char == "#"
            and at_boundary
            and not parameter_quote_states
        ):
            while i < len(command) and command[i] != "\n":
                i += 1
            continue
        if not in_double and char == "'":
            end = command.find("'", i + 1)
            i = len(command) if end < 0 else end + 1
            at_boundary = False
            continue
        if char == '"':
            in_double = not in_double
            at_boundary = False
            i += 1
            continue
        if command.startswith("${", i):
            parameter_quote_states.append(in_double)
            at_boundary = False
            i += 2
            continue
        if (
            char == "}"
            and parameter_quote_states
            and in_double == parameter_quote_states[-1]
        ):
            parameter_quote_states.pop()
            at_boundary = False
            i += 1
            continue
        if command.startswith("$((", i):
            arithmetic_depth += 2
            at_boundary = False
            i += 3
            continue
        if command.startswith("$(", i) and not command.startswith("$((", i):
            start = i
            exposed_to_primary = not in_double and arithmetic_depth == 0
            found = _dollar_substitution(command, i)
            if found is None:
                i += 2
                continue
            body, i = found
            bodies.append(
                (
                    body,
                    _segment_for_offset(command, start),
                    substitution_index,
                    exposed_to_primary,
                )
            )
            substitution_index += 1
            at_boundary = False
            continue
        if char == "`":
            start = i
            exposed_to_primary = not in_double and arithmetic_depth == 0
            found = _backtick_substitution(command, i)
            if found is None:
                i += 1
                continue
            body, i = found
            bodies.append(
                (
                    body,
                    _segment_for_offset(command, start),
                    substitution_index,
                    exposed_to_primary,
                )
            )
            substitution_index += 1
            at_boundary = False
            continue
        if arithmetic_depth and char == "(":
            arithmetic_depth += 1
            at_boundary = False
            i += 1
            continue
        if arithmetic_depth and char == ")":
            arithmetic_depth -= 1
            at_boundary = False
            i += 1
            continue
        if not in_double and char in ";|&\n":
            at_boundary = True
        elif char.isspace():
            at_boundary = True
        else:
            at_boundary = False
        i += 1
    return bodies


def _shell_command_payloads(tokens, cmd_pos, seg_of):
    """Yield quoted command strings executed by shell `-c` wrappers."""
    shells = {"bash", "sh", "zsh", "dash", "ksh"}
    payloads = []
    payload_index = 0
    for index, token in enumerate(tokens):
        if not cmd_pos[index] or os.path.basename(token).lower() not in shells:
            continue
        segment = seg_of[index]
        cursor = index + 1
        while cursor < len(tokens) and seg_of[cursor] == segment:
            option = tokens[cursor]
            if option == "--":
                break
            carries_command = option == "--command" or (
                option.startswith("-")
                and not option.startswith("--")
                and "c" in option[1:]
            )
            if carries_command and cursor + 1 < len(tokens):
                # The outer lexer does not retain PID expansion provenance.
                # An ambiguous Zsh payload must also retain its regular-quote
                # reading after an outer shell materializes that expansion.
                payloads.append(
                    (shell_code(tokens[cursor + 1], "both" if os.path.basename(token).lower() == "zsh" else "bash" if os.path.basename(token).lower() in {"bash", "sh"} else "both"), segment, payload_index)
                )
                payload_index += 1
                break
            cursor += 1
    return payloads

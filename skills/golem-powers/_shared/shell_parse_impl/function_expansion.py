"""Function and alias expansion with live map references."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from contextvars import ContextVar

_argument_expander = ContextVar("golems_argument_expander", default=None)

from .positions import _parse_bash, _shell_integer_arithmetic
from .tokens import _ASSIGNMENT_RE, _FUNCTION_LOOKUP_SUPPRESSORS


def hide_function_bodies(tokens, positions):
    """Invoked bodies are inspected with bound argv, never as raw definitions."""
    i = 0
    while i < len(tokens):
        start = i + 1 if tokens[i] == 'function' else i
        if start+3 < len(tokens) and tokens[start+1:start+4] == ['(', ')', '{']:
            opening = start+3
        elif start != i and start+1 < len(tokens) and tokens[start+1] == '{':
            opening = start+1
        else:
            i += 1; continue
        level, j = 1, opening+1
        while j < len(tokens) and level:
            level += (tokens[j] == '{') - (tokens[j] == '}')
            j += 1
        if level: raise ValueError('unclosed function body')
        positions[i:j] = [False]*(j-i)
        i = j


def call_arguments(source, tokens, index):
    """Opt-in invocation argv with lexical separators/redirections excluded."""
    from .tokens import _shell_tokens, _ShellOperator
    from .heredocs import _strip_heredoc_bodies
    raw = _shell_tokens(_strip_heredoc_bodies(source), _operator_origin=True)
    name = tokens[index]
    matches = [j for j,t in enumerate(raw) if t == name]
    if len(matches) != tokens.count(name): raise ValueError('uncertain function argv')
    ordinal = tokens[:index+1].count(name)-1
    args, j = [], matches[ordinal]+1
    while j < len(raw):
        word = raw[j]
        if isinstance(word, _ShellOperator):
            if word in ('<', '>') and j+1 < len(raw) and raw[j+1] == '(':
                args.append('${process-substitution}')
                level, j = 1, j+2
                while j < len(raw) and level:
                    if isinstance(raw[j], _ShellOperator):
                        level += (raw[j] == '(') - (raw[j] == ')')
                    j += 1
                if level: raise ValueError('unclosed process substitution')
                continue
            if word in ('<', '>', '>>', '>|', '<>', '<<<', '<<'):
                j += 2; continue
            break
        args.append(str(word)); j += 1
    return args


@dataclass
class ExpansionState:
    aliases: dict[str, str]
    function_bodies: dict[str, str]
    expanded_function_bodies: dict[str, str]


def expand_function(
    state,
    body,
    seen=None,
    bodies=None,
    expanded_bodies=None,
):
    seen = set() if seen is None else seen
    bodies = state.function_bodies if bodies is None else bodies
    expanded_bodies = (
        state.expanded_function_bodies
        if expanded_bodies is None
        else expanded_bodies
    )
    body_tokens, body_flags, body_segs, _body_scopes = _parse_bash(body)
    expanded = []
    changed = False
    consumed_arguments = set()
    for i, token in enumerate(body_tokens):
        if i in consumed_arguments:
            continue
        segment_commands = [
            body_tokens[j]
            for j in range(i)
            if body_segs[j] == body_segs[i] and body_flags[j]
        ]
        lookup_suppressed = (
            bool(segment_commands)
            and os.path.basename(segment_commands[0])
            in _FUNCTION_LOOKUP_SUPPRESSORS
        )
        if (
            body_flags[i]
            and token in bodies
            and token not in seen
            and not lookup_suppressed
        ):
            target_body = expanded_bodies.get(token, bodies[token])
            invocation_arguments = [
                body_tokens[j]
                for j in range(i + 1, len(body_tokens))
                if body_segs[j] == body_segs[i]
            ]
            consumed_arguments.update(
                j
                for j in range(i + 1, len(body_tokens))
                if body_segs[j] == body_segs[i]
            )
            if _argument_expander.get() is not None:
                invocation_arguments = call_arguments(body, body_tokens, i)
            target_body = expand_function_arguments(target_body, invocation_arguments, source=body)
            expanded.append(
                expand_function(
                    state,
                    target_body,
                    seen | {token},
                    bodies,
                    expanded_bodies,
                )
            )
            changed = True
        else:
            expanded.append(token)
    return " ".join(expanded) if changed else body


def expand_function_arguments(body, arguments, bindings=None, source=None):
    """Substitute statically known invocation arguments in a body.

        This preserves forwarded eval payloads such as `eval "$@"` for the
        recursive scan. Ordinary positional write targets stay unresolved so
        they retain the guard's existing REFUSE behavior.
        """
    if _argument_expander.get() is not None:
        return _argument_expander.get()(body, arguments, bindings, source)
    joined = " ".join(arguments)
    static_variables = {}

    def positional(match):
        index = int(match.group(1) or match.group(2))
        return arguments[index - 1] if index <= len(arguments) else ""

    def parameter_operator(value, is_set, operator, word):
        colon = operator.startswith(":")
        operation = operator[-1]
        missing = not is_set or (colon and value == "")
        if operation == "-":
            return word if missing else value
        if operation == "+":
            return "" if missing else word
        if operation == "?":
            return "" if missing else value
        return value

    def positional_operator(match):
        position = int(match.group(1))
        is_set = position <= len(arguments)
        value = arguments[position - 1] if is_set else ""
        return parameter_operator(
            value,
            is_set,
            match.group(2),
            match.group(3),
        )

    def indirect_positional(match):
        position = int(match.group(1))
        if position > len(arguments):
            return ""
        return os.environ.get(arguments[position - 1], "")

    def positional_slice(match):
        offset = _shell_integer_arithmetic(match.group(2))
        if offset is None:
            return joined
        start = offset - 1 if offset > 0 else len(arguments) + offset
        selected = arguments[max(0, start):]
        if match.group(3) is not None:
            length = _shell_integer_arithmetic(match.group(3))
            if length is None:
                return joined
            if length < 0:
                return ""
            selected = selected[:length]
        return " ".join(selected)

    parts = re.split(r"([;|&\n]+)", body)
    for index in range(0, len(parts), 2):
        segment_tokens, segment_cmd_pos, _segments, _scopes = _parse_bash(
            parts[index]
        )

        def resolved_word(word):
            variable = re.fullmatch(
                r"\$([A-Za-z_][A-Za-z0-9_]*)",
                word,
            )
            if variable:
                return static_variables.get(variable.group(1), word)
            return word

        resolved_commands = [
            resolved_word(token)
            for token_index, token in enumerate(segment_tokens)
            if segment_cmd_pos[token_index]
        ]
        invokes_eval = "eval" in resolved_commands
        if invokes_eval:
            for variable_name, value in static_variables.items():
                if value == "eval":
                    parts[index] = re.sub(
                        rf"\${re.escape(variable_name)}\b",
                        "eval",
                        parts[index],
                    )
            parts[index] = re.sub(
                r"\$\{!([1-9][0-9]*)\}",
                indirect_positional,
                parts[index],
            )
            parts[index] = re.sub(
                r"\$\{([1-9][0-9]*)(:?[-+?])([^}]*)\}",
                positional_operator,
                parts[index],
            )
            parts[index] = re.sub(
                r"\$\{([@*]):([^}:]+)(?::([^}]+))?\}",
                positional_slice,
                parts[index],
            )
            parts[index] = re.sub(
                r"\$(?:@|\*)|\$\{(?:@|\*)\}",
                joined,
                parts[index],
            )
            parts[index] = re.sub(
                r"\$([1-9])|\$\{([1-9][0-9]*)\}",
                positional,
                parts[index],
            )
            parts[index] = re.sub(
                r"\$\{(?:!?[1-9][0-9]*|[@*])[^}]*\}",
                lambda match: f"{joined} {match.group(0)[2:-1]}",
                parts[index],
            )
        assignments = []
        if segment_tokens and all(
            _ASSIGNMENT_RE.match(token) for token in segment_tokens
        ):
            assignments = segment_tokens
        elif (
            segment_tokens
            and os.path.basename(resolved_word(segment_tokens[0]))
            in {"local", "declare", "typeset", "export", "readonly"}
        ):
            assignments = [
                token
                for token in segment_tokens[1:]
                if _ASSIGNMENT_RE.match(token)
            ]
        if assignments:
            for assignment in assignments:
                match = _ASSIGNMENT_RE.match(assignment)
                name = match.group("name")
                value = assignment.split("=", 1)[1]
                if (
                    match.group("subscript")
                    or match.group("append")
                    or any(marker in value for marker in ("$", "`", "~"))
                ):
                    static_variables.pop(name, None)
                else:
                    static_variables[name] = value
    return "".join(parts)


def expand_alias(state, name, seen=None):
    aliases = state.aliases
    seen = set() if seen is None else seen
    if name in seen:
        return aliases[name]
    seen.add(name)
    body = aliases[name]
    body_tokens, body_flags, _body_segs, _body_scopes = _parse_bash(body)
    expanded = []
    changed = False
    for i, token in enumerate(body_tokens):
        if body_flags[i] and token in aliases and token not in seen:
            expanded.append(expand_alias(state, token, seen.copy()))
            changed = True
        else:
            expanded.append(token)
    if not changed:
        return body
    result = " ".join(expanded)
    if body.endswith((" ", "\t")):
        result += body[-1]
    return result


def expand_alias_commands(state, body):
    aliases = state.aliases
    body_tokens, body_flags, _body_segs, _body_scopes = _parse_bash(body)
    expanded = [
        (
            expand_alias(state, token)
            if body_flags[i] and token in aliases
            else token
        )
        for i, token in enumerate(body_tokens)
    ]
    changed = any(
        body_flags[i] and token in aliases
        for i, token in enumerate(body_tokens)
    )
    return " ".join(expanded) if changed else body

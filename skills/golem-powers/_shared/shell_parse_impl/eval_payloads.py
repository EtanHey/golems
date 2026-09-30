"""Eval payload detection and token-local resolvers."""

from __future__ import annotations

import os
import re

from . import function_expansion as _function_expansion
from . import patterns as _patterns
from .positions import _shell_integer_arithmetic
from .tokens import _ASSIGNMENT_RE, _UNRESOLVED_EVAL_MARKER


def detect_eval_payload(
    i,
    token,
    *,
    variable_state_at,
    tokens,
    seg_of,
    cmd_pos,
    active_compounds_execute,
    line,
    function_state_at,
    literal_tokens,
):
    eval_variable = re.fullmatch(
        r"\$([A-Za-z_][A-Za-z0-9_]*)",
        token,
    )
    # Literal non-eval arguments cannot become eval. Avoid rebuilding the
    # complete prefix variable state for every argument; that was quadratic
    # on commands with thousands of quoted data words.
    if token != "eval" and eval_variable is None:
        return None
    eval_variables = variable_state_at(i)
    resolved_eval_token = token
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
        return None
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
    return eval_source, eval_variables, bodies, expanded_bodies


def resolve_eval_source(eval_source, eval_variables, *, enabled, expansion_state):
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
    return eval_source

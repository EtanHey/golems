"""Resolved rm breadth scanner moved from git_safety.py."""

from __future__ import annotations

import os
import re
import shlex

def _skip_options(
    words: list[str], position: int, options_with_values: set[str]
) -> int:
    """Return the first non-option position for a command wrapper."""
    while position < len(words):
        word = words[position]
        if word == "--":
            return position + 1
        if not word.startswith("-") or word == "-":
            return position
        option = word.split("=", 1)[0]
        position += 1
        if option in options_with_values and "=" not in word:
            position += 1
    return position


def _rm_reason_in_words(
    api: dict,
    words: list[str],
    position: int,
    cwd: str,
    variables: dict[str, str],
    *,
    dynamic_input: bool = False,
    argument_variables: dict[str, str] | None = None,
    _depth: int = 0,
    _find_cache: dict[tuple, str | None] | None = None,
) -> str | None:
    """Inspect command positions, including wrapper-owned nested commands."""
    if _depth > api["_MAX_WRAPPER_DEPTH"]:
        return api["_wrapper_depth_reason"]()
    if argument_variables is None:
        argument_variables = variables
    if _find_cache is None:
        _find_cache = {}
    while (
        position < len(words)
        and words[position].lower() in api["_SHELL_CONTROL_PREFIXES"]
    ):
        position += 1
    if position >= len(words):
        return None
    command_name = os.path.basename(words[position]).lower()

    if command_name in {"sudo", "command", "builtin", "nohup", "exec"}:
        option_values = {
            "-u", "--user", "-g", "--group", "-h", "--host",
            "-p", "--prompt", "-C", "--close-from", "-a",
        } if command_name == "sudo" else set()
        nested = api["_skip_options"](words, position + 1, option_values)
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            _depth=_depth + 1,
            _find_cache=_find_cache,
        )

    if command_name == "env":
        for index in range(position + 1, len(words)):
            option = words[index]
            split_value = None
            remainder = index + 1
            if option in {"-S", "--split-string"} and remainder < len(words):
                split_value = words[remainder]
                remainder += 1
            elif option.startswith("--split-string="):
                split_value = option.split("=", 1)[1]
            if split_value is None:
                continue
            try:
                split_words = shlex.split(split_value)
            except ValueError:
                return "rm command carried by env split-string cannot be parsed safely"
            return _rm_reason_in_words(
                api,
                split_words + words[remainder:],
                0,
                cwd,
                variables,
                dynamic_input=dynamic_input,
                argument_variables=argument_variables,
                _depth=_depth + 1,
                _find_cache={},
            )
        nested = api["_skip_options"](
            words,
            position + 1,
            {"-u", "--unset", "-C", "--chdir", "--argv0"},
        )
        local_variables = dict(variables)
        assignment_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.DOTALL)
        while nested < len(words):
            assignment = assignment_re.match(words[nested])
            if assignment is None:
                break
            expanded, complete = api["_expand_known_vars"](assignment.group(2), local_variables)
            if complete:
                local_variables[assignment.group(1)] = os.path.expanduser(expanded)
            nested += 1
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            local_variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            _depth=_depth + 1,
            _find_cache=_find_cache,
        )

    if command_name == "time":
        nested = api["_skip_options"](
            words, position + 1, {"-o", "--output", "-f", "--format"}
        )
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            _depth=_depth + 1,
            _find_cache=_find_cache,
        )

    if command_name == "nice":
        nested = api["_skip_options"](
            words, position + 1, {"-n", "--adjustment"}
        )
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            _depth=_depth + 1,
            _find_cache=_find_cache,
        )

    if command_name in {"bash", "sh", "zsh", "dash", "ksh"}:
        for index in range(position + 1, len(words) - 1):
            option = words[index]
            if option == "--command" or (
                option.startswith("-") and not option.startswith("--") and "c" in option[1:]
            ):
                blocked, reason = is_dangerous_rm(
                    api, words[index + 1], cwd=cwd, env=variables, _depth=_depth + 1
                )
                return reason if blocked else None
        return None

    if command_name == "find":
        for index in range(position + 1, len(words)):
            if words[index] in {"-exec", "-execdir"}:
                # Preserve the conservative sibling scan: token-only parsing cannot
                # safely decide which `{}` terminator belongs to a nested find.
                # Memoization bounds repeated safe nested chains without skipping
                # a later destructive -exec clause.
                cache_key = (
                    id(words), index + 1, _depth + 1, dynamic_input,
                    id(variables), id(argument_variables),
                )
                if cache_key not in _find_cache:
                    _find_cache[cache_key] = _rm_reason_in_words(
                        api,
                        words,
                        index + 1,
                        cwd,
                        variables,
                        dynamic_input=dynamic_input,
                        argument_variables=argument_variables,
                        _depth=_depth + 1,
                        _find_cache=_find_cache,
                    )
                reason = _find_cache[cache_key]
                if reason:
                    return reason
        return None

    if command_name == "xargs":
        nested = api["_skip_options"](
            words,
            position + 1,
            {
                "-a", "--arg-file", "-d", "--delimiter", "-E",
                "-I", "-L", "--max-lines", "-n",
                "--max-args", "-P", "--max-procs", "-s", "--max-chars",
            },
        )
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            variables,
            dynamic_input=True,
            argument_variables=argument_variables,
            _depth=_depth + 1,
            _find_cache=_find_cache,
        )

    if command_name != "rm":
        return None

    arguments = words[position + 1:]
    flags = [word for word in arguments if word.startswith("-") and word != "-"]
    recursive = any("r" in word or "R" in word for word in flags)
    force = any("f" in word for word in flags)
    if not (recursive and force):
        return None
    targets = [word for word in arguments if word not in flags and word != "--"]
    if dynamic_input:
        return "rm target supplied dynamically by xargs"
    for target in targets:
        reason = api["_rm_target_reason"](target, cwd, argument_variables)
        if reason:
            return reason
    return None


def is_dangerous_rm(
    api: dict, command: str, *, cwd: str | None = None, env=None, _depth: int = 0,
    _find_cache: dict[tuple, str | None] | None = None,
):
    """Return `(blocked, reason)` after resolving cwd and shell assignments."""
    if _depth > api["_MAX_WRAPPER_DEPTH"]:
        return True, api["_wrapper_depth_reason"]()
    if _find_cache is None:
        _find_cache = {}
    active = api["shell_text_without_heredoc_bodies"](command)
    lexer = shlex.shlex(
        active.replace("\n", " ; "),
        posix=True,
        punctuation_chars=";&|()",
    )
    lexer.whitespace_split = True
    lexer.commenters = "#"
    try:
        tokens = list(lexer)
    except ValueError:
        direct_rm = re.search(
            r"(?:^|[;&|(\n]\s*)(?:[^\s;&|]*/)?rm\b"
            r"(?=[^;&|\n]*(?:--recursive\b|-[A-Za-z]*[rR][A-Za-z]*))"
            r"(?=[^;&|\n]*(?:--force\b|-[A-Za-z]*f[A-Za-z]*))",
            active,
        )
        return (True, "rm command cannot be parsed safely") if direct_rm else (False, None)

    segments = []
    segment = []
    preceding_operator = None
    for token in tokens:
        if token and all(char in ";&|()" for char in token):
            if segment:
                segments.append((segment, preceding_operator, token))
                segment = []
            preceding_operator = token
            continue
        if token == "$" and not segment:
            continue
        segment.append(token)
    if segment:
        segments.append((segment, preceding_operator, None))

    variables = dict(os.environ if env is None else env)
    current = os.path.abspath(cwd or os.getcwd())
    assignment_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.DOTALL)

    for words, operator_before, operator_after in segments:
        argument_variables = dict(variables)
        local_variables = dict(variables)
        position = 0
        control_prefix_seen = False
        while (
            position < len(words)
            and words[position].lower() in api["_SHELL_CONTROL_PREFIXES"]
        ):
            control_prefix_seen = True
            position += 1
        assignments = []
        while position < len(words):
            assignment = assignment_re.match(words[position])
            if assignment is None:
                break
            expanded, complete = api["_expand_known_vars"](
                assignment.group(2), local_variables
            )
            if complete:
                local_variables[assignment.group(1)] = os.path.expanduser(expanded)
                assignments.append((assignment.group(1), local_variables[assignment.group(1)]))
            position += 1
        if position == len(words):
            if (
                control_prefix_seen
                or operator_before == "||"
                or (operator_before == "&&" and operator_after != "&&")
            ):
                for name, _value in assignments:
                    variables.pop(name, None)
            else:
                variables.update(assignments)
            continue

        command_name = os.path.basename(words[position])
        if command_name in {"export", "readonly", "declare", "typeset"}:
            for word in words[position + 1:]:
                assignment = assignment_re.match(word)
                if assignment is None:
                    continue
                expanded, complete = api["_expand_known_vars"](
                    assignment.group(2), argument_variables
                )
                if complete:
                    value = os.path.expanduser(expanded)
                    variables[assignment.group(1)] = value
                    local_variables[assignment.group(1)] = value
            continue
        if command_name == "popd":
            current = ""
            continue
        if command_name in {"cd", "pushd"}:
            if (
                control_prefix_seen
                or operator_before == "||"
                or (operator_before == "&&" and operator_after != "&&")
            ):
                current = ""
                continue
            if position + 1 >= len(words) or words[position + 1] == "-":
                current = ""
                continue
            target_position = position + 1
            if words[target_position] == "--":
                target_position += 1
            if target_position >= len(words) or words[target_position].startswith("-"):
                current = ""
                continue
            expanded, complete = api["_expand_known_vars"](
                words[target_position], argument_variables
            )
            if complete:
                expanded = os.path.expanduser(expanded)
                current = os.path.abspath(
                    expanded
                    if os.path.isabs(expanded)
                    else os.path.join(current, expanded)
                )
            else:
                current = ""
            continue

        reason = _rm_reason_in_words(
            api,
            words,
            position,
            current,
            local_variables,
            argument_variables=argument_variables,
            _depth=_depth,
            _find_cache=_find_cache,
        )
        if reason:
            return True, reason
    return False, None

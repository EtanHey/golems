"""Resolved rm breadth scanner moved from git_safety.py."""

from __future__ import annotations

import os
import re
import shlex

from . import shell_parse
from .paths import _expand_tilde

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


def _without_redirections(source: str) -> str:
    """Blank shell redirections before shlex erases quote/escape provenance.

    Literal quoted or escaped operators remain deletion operands. Consume a
    redirect's entire shell word, including concatenated quotes/substitutions,
    without consuming the next command or a process-substitution argument.
    """
    structure = shell_parse.executable_shell_structure(source)
    result = list(source)
    index = 0
    while index < len(source):
        if structure[index:index + 2] in {"<(", ">("}:
            try:
                _, index = shell_parse.process_substitution_at(source, index)
            except ValueError:
                return source  # preserve malformed syntax for the fail-closed lexer
            continue
        if structure[index] not in "<>":
            index += 1
            continue
        start = index
        # A preceding unquoted descriptor belongs to the redirection only when
        # it is the complete word (foo2>log still leaves operand foo2).
        while start > 0 and structure[start - 1].isdigit():
            start -= 1
        if start > 0 and structure[start - 1] not in " \t\r\n;|&()":
            start = index
        if index > 0 and structure[index - 1] == "&":
            start = index - 1
        match = re.match(r"(?:<<<|<<-|<<|>>|<>|>\||>&|<&|>|<)", structure[index:])
        end = index + len(match.group())
        while end < len(source) and source[end] in " \t":
            end += 1
        try:
            while end < len(source) and source[end] not in " \t\r\n;|&()<>":
                if source[end] in "'\"":
                    end = shell_parse._data_argument_quote_end(source, end) + 1
                    if end > len(source):
                        return source
                elif source[end] == "\\":
                    end += 2
                elif source.startswith("$(", end):
                    end = shell_parse._data_dollar_paren_end(source, end)
                elif source[end] == "`":
                    end = shell_parse._data_backtick_end(source, end)
                else:
                    end += 1
        except ValueError:
            return source
        for offset in range(start, min(end, len(source))):
            result[offset] = " "
        index = end
    return "".join(result)


def _rm_reason_in_words(
    api: dict,
    words: list[str],
    position: int,
    cwd: str,
    variables: dict[str, str],
    *,
    dynamic_input: bool = False,
    protected_cwd: str | None = None,
    argument_variables: dict[str, str] | None = None,
    _depth: int = 0,
    _find_cache: dict[tuple, str | None] | None = None,
    _created_paths: list[str | None] | None = None,
) -> str | None:
    """Inspect command positions, including wrapper-owned nested commands."""
    if _depth > api["_MAX_WRAPPER_DEPTH"]:
        return api["_wrapper_depth_reason"]()
    if argument_variables is None:
        argument_variables = variables
    if _find_cache is None:
        _find_cache = {}
    if _created_paths is None:
        _created_paths = []
    while (
        position < len(words)
        and words[position].lower() in api["_SHELL_CONTROL_PREFIXES"]
    ):
        position += 1
    if position >= len(words):
        return None
    command_name = os.path.basename(words[position]).lower()

    if command_name in {"sudo", "command", "builtin", "nohup", "exec", "doas"}:
        option_values = {
            "-u", "--user", "-g", "--group", "-h", "--host",
            "-p", "--prompt", "-C", "--close-from", "-a",
        } if command_name in {"sudo", "doas"} else ({"-a"} if command_name == "exec" else set())
        nested = api["_skip_options"](words, position + 1, option_values)
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
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
                protected_cwd=protected_cwd,
                _depth=_depth + 1,
                _find_cache={}, _created_paths=_created_paths,
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
                value, complete = _expand_tilde(expanded, local_variables)
                local_variables[assignment.group(1)] = value if complete else None
            else:
                local_variables[assignment.group(1)] = None
            nested += 1
        return _rm_reason_in_words(
            api,
            words,
            nested,
            cwd,
            local_variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )

    if command_name in {"timeout", "gtimeout", "caffeinate", "arch", "stdbuf", "script", "flock"}:
        option_values = {
            "timeout": {"-s", "--signal", "-k", "--kill-after"},
            "gtimeout": {"-s", "--signal", "-k", "--kill-after"},
            "caffeinate": {"-t", "-w"}, "arch": {"-arch"},
            "stdbuf": {"-i", "-o", "-e", "--input", "--output", "--error"},
            "script": {"-t"}, "flock": {"-w", "--timeout", "-E", "--conflict-exit-code"},
        }[command_name]
        nested = api["_skip_options"](words, position + 1, option_values)
        if command_name in {"timeout", "gtimeout", "script", "flock"}:
            nested += 1  # duration, logfile, or lockfile operand
        return _rm_reason_in_words(
            api, words, nested, cwd, variables, dynamic_input=dynamic_input,
            argument_variables=argument_variables, protected_cwd=protected_cwd,
            _depth=_depth + 1, _find_cache=_find_cache, _created_paths=_created_paths,
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
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
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
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )

    if command_name in {"bash", "sh", "zsh", "dash", "ksh"}:
        for index in range(position + 1, len(words) - 1):
            option = words[index]
            if option == "--command" or (
                option.startswith("-") and not option.startswith("--") and "c" in option[1:]
            ):
                blocked, reason = is_dangerous_rm(
                    api, words[index + 1], cwd=cwd, env=variables, _depth=_depth + 1, protected_cwd=protected_cwd, _created_paths=_created_paths
                )
                return reason if blocked else None
        return None

    if command_name == "find":
        # Preserve the established cache-only prune cleanup. Exact grammar keeps
        # sibling actions, OR expressions and arbitrary dynamic roots conservative.
        args = words[position + 1:]
        if (len(args) == 11 and args[:7] == [".", "-name", "__pycache__", "-type", "d", "-prune", "-exec"]
                and os.path.basename(args[7]) == "rm" and args[8] in {"-r", "-R", "-rf", "-fr"}
                and args[9:] == ["{}", "+"] and api["_outermost_repo_root"](cwd)):
            return None
        if "-delete" in words[position + 1:]:
            start = position + 1
            while start < len(words) and words[start] in {"-H", "-L", "-P", "--"}:
                start += 1
            roots = []
            while start < len(words) and not words[start].startswith("-") and words[start] not in {"!", "("}:
                roots.append(words[start]); start += 1
            for target in roots or ["."]:
                reason = api["_rm_target_reason"](target, cwd, argument_variables, protected_cwd)
                if reason:
                    return reason
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
                        protected_cwd=protected_cwd,
                        _depth=_depth + 1,
                        _find_cache=_find_cache, _created_paths=_created_paths,
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
            protected_cwd=protected_cwd,
            _depth=_depth + 1,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )

    if command_name in {"mv", "ln", "cp"}:
        args = words[position + 1:]
        operands = []
        destination_option = None
        index = 0
        options = True
        while index < len(args):
            word = args[index]
            if options and word == "--":
                options = False
            elif options and word.startswith("--target-directory="):
                destination_option = word.split("=", 1)[1]
            elif options and word.startswith("-t") and not word.startswith("--") and len(word) > 2:
                destination_option = word[2:]
            elif options and word in {"-t", "--target-directory", "-S", "--suffix"}:
                if index + 1 >= len(args):
                    return "path creation option cannot be resolved safely"
                index += 1
                if word in {"-t", "--target-directory"}:
                    destination_option = args[index]
            elif not options or not word.startswith("-"):
                operands.append(word)
            index += 1
        creates_path = command_name in {"mv", "ln"} or any(
            word in {"--recursive", "-r", "-R"} or
            (word.startswith("-") and not word.startswith("--") and any(c in word[1:] for c in "rRa"))
            for word in args
        )
        if creates_path and operands:
            sources = operands if destination_option else operands[:-1]
            if command_name == "mv":
                for source in sources:
                    reason = api["_rm_target_reason"](source, cwd, argument_variables, protected_cwd, protected_only=True)
                    if reason:
                        return "protected root used by move or symbolic link"
            destination_operand = destination_option or operands[-1]
            if command_name == "ln" and not destination_option and len(operands) == 1:
                destination_operand = os.path.basename(operands[0].rstrip("/"))
            expanded, complete = api["_expand_known_vars"](destination_operand, argument_variables)
            expanded, tilde_complete = _expand_tilde(expanded, argument_variables)
            destination = os.path.abspath(os.path.join(cwd, expanded)) if complete and tilde_complete and cwd else None
            _created_paths.append(destination)
        return None

    if command_name == "rsync" and any(word.startswith("--delete") for word in words[position + 1:]):
        destination = words[-1]
        if re.match(r"^[^/]+:", destination):
            return None  # remote filesystems are outside this local boundary
        return api["_rm_target_reason"](destination, cwd, argument_variables, protected_cwd)

    if command_name != "rm":
        return None

    arguments = words[position + 1:]
    flags = [word for word in arguments if word.startswith("-") and word != "-"]
    recursive = any(word == "--recursive" or
                    (not word.startswith("--") and any(c in word[1:] for c in "rR"))
                    for word in flags)
    if not recursive:
        return None
    targets = [word for word in arguments if word not in flags and word != "--"]
    if dynamic_input:
        return "rm target supplied dynamically by xargs"
    for target in targets:
        expanded, complete = api["_expand_known_vars"](target, argument_variables)
        expanded, tilde_complete = _expand_tilde(expanded, argument_variables)
        resolved = os.path.abspath(os.path.join(cwd, expanded)) if complete and tilde_complete and cwd else None
        if _created_paths and (resolved is None or any(
            path is None or api["_within"](resolved, path) or api["_within"](path, resolved)
            for path in _created_paths
        )):
            return "rm target affected by earlier path creation cannot be evaluated safely"
        reason = api["_rm_target_reason"](target, cwd, argument_variables, protected_cwd)
        if reason:
            return reason
    return None


def is_dangerous_rm(
    api: dict, command: str, *, cwd: str | None = None, env=None, _depth: int = 0,
    _find_cache: dict[tuple, str | None] | None = None,
    protected_cwd: str | None = None,
    _created_paths: list[str | None] | None = None,
):
    """Return `(blocked, reason)` after resolving cwd and shell assignments."""
    if _depth > api["_MAX_WRAPPER_DEPTH"]:
        return True, api["_wrapper_depth_reason"]()
    if _find_cache is None:
        _find_cache = {}
    if _created_paths is None:
        _created_paths = []
    active = api["shell_text_without_heredoc_bodies"](command)
    lexer = shlex.shlex(
        _without_redirections(api["_shell_text_with_comments_blanked"](active)).replace("\n", " ; "),
        posix=True,
        punctuation_chars=";&|()",
    )
    lexer.whitespace_split = True
    lexer.commenters = ""
    try:
        tokens = list(lexer)
    except ValueError:
        direct_rm = re.search(
            r"(?:^|[;&|(\n]\s*)(?:[^\s;&|]*/)?rm\b"
            r"(?=[^;&|\n]*(?:--recursive\b|-[A-Za-z]*[rR][A-Za-z]*))",
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
    if protected_cwd is None:
        protected_cwd = current
    previous = variables.get("OLDPWD", "")
    assignment_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.DOTALL)

    for words, operator_before, operator_after in segments:
        variables.update(PWD=current, OLDPWD=previous)
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
                value, complete = _expand_tilde(expanded, local_variables)
                local_variables[assignment.group(1)] = value if complete else None
            else:
                local_variables[assignment.group(1)] = None
            assignments.append((assignment.group(1), local_variables[assignment.group(1)]))
            position += 1
        if position == len(words):
            if (
                control_prefix_seen
                or operator_before == "||"
                or (operator_before == "&&" and operator_after != "&&")
            ):
                # A condition may execute the assignment; retain its unknown
                # marker so later literal-tail resolution cannot treat it as
                # an untouched inherited scratch variable.
                for name, _value in assignments:
                    variables[name] = None
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
                    value, complete = _expand_tilde(expanded, argument_variables)
                else:
                    value = None
                variables[assignment.group(1)] = value if complete else None
                local_variables[assignment.group(1)] = value if complete else None
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
                expanded, complete = _expand_tilde(expanded, argument_variables)
            if complete:
                previous = current
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
            protected_cwd=protected_cwd,
            _depth=_depth,
            _find_cache=_find_cache, _created_paths=_created_paths,
        )
        if reason:
            return True, reason
    return False, None

"""Mechanical git-safety checks for git-guardian (gen-18 Track 6 D6).

git-guardian's rules lived only as SKILL.md prose + LLM-judged evals — the
"prose-doesn't-stick" shape gen-18 exists to replace. This module turns the three
highest-value, most-footgun-prone D6 rules into pure, importable, replayably-tested
functions:

  1. is_destructive_restore — `git checkout -- …` / `git restore …` that would discard
     UNOWNED in-session changes (the agent clobbering the user's or another agent's
     uncommitted work). Prefer `git stash`.
  2. pr_body_is_empty — post-create gh-pr-body-non-empty assert (a PR body that is blank
     or only template boilerplate should never ship).
  3. is_unauthorized_no_verify — `--no-verify` on commit/push bypasses safety hooks and
     must be authorized, not silently used.
  4. dangerous_shell_reason — F8's resolved rm-breadth check plus heredoc-aware
     destructive-command scanning.

Pure functions, no I/O, no deps. The active `~/.claude/hooks/pre_tool_use.py` enforcer
imports the F8 scanner from this module; tests pin the behavior against rule drift.
"""

from __future__ import annotations

import os
import posixpath
import re
import shlex


def _norm(path: str) -> str:
    """Normalize a repo-relative path for comparison (`./a`, `a/./b` → `a`, `a/b`).
    posixpath keeps `/` separators since git pathspecs are always POSIX-style."""
    return posixpath.normpath(path)


# ── F8. Safe rm breadth + heredoc-aware destructive scanning ────────────────────

_HEREDOC_RE = re.compile(r"(?<!<)<<(-?)\s*([^\s;|&<>]+)")
_FILE_REDIRECT_RE = re.compile(r"(?<![<>])(?:>>|>)(?![>&])")
_SHELL_VAR_RE = re.compile(r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))")
_ASSIGNMENT_RE = re.compile(
    r"(?:^|[;&\n]\s*)([A-Za-z_][A-Za-z0-9_]*)="
    r"(?:\"([^\"]*)\"|'([^']*)'|([^\s;&]+))"
)
_SHELL_CONTROL_PREFIXES = {
    "!", "if", "then", "elif", "else", "while", "until", "do", "fi", "done",
}


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
        if line.startswith("$(", i):
            depth = 1
            j = i + 2
            while j < len(line) and depth:
                if line.startswith("$(", j):
                    depth += 1
                    j += 2
                    continue
                if line[j] == ")":
                    depth -= 1
                j += 1
            found.append(line[i:j])
            i = j
            continue
        if line[i] == "`":
            j = i + 1
            while j < len(line):
                if line[j] == "`" and line[j - 1] != "\\":
                    j += 1
                    break
                j += 1
            found.append(line[i:j])
            i = j
            continue
        i += 1
    return " ".join(found)


def shell_text_without_heredoc_bodies(command: str) -> str:
    """Remove heredoc prose while retaining executable substitutions.

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
                output.append(ending if mask_body else source_line)
            else:
                if mask_body:
                    kept = "" if quoted else _executable_expansions(line)
                    output.append(kept + ending)
                else:
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
                file_write = _literal_file_heredoc_header(
                    header,
                    piped=segment_end < len(line)
                    and line[segment_end] == "|",
                )
                pending.append(
                    (delimiter, quoted, bool(match.group(1)), file_write)
                )
        output.append(source_line)
    return "".join(output)


def _expand_known_vars(value: str, variables: dict[str, str]) -> tuple[str, bool]:
    """Expand known simple variables; return (literal prefix, fully resolved)."""
    out = []
    cursor = 0
    while cursor < len(value):
        if value.startswith("$(", cursor) or value[cursor] in "`*?{[":
            return "".join(out), False
        if value[cursor] != "$":
            out.append(value[cursor])
            cursor += 1
            continue
        match = _SHELL_VAR_RE.match(value, cursor)
        if match is None:
            return "".join(out), False
        name = match.group(1) or match.group(2)
        replacement = variables.get(name)
        if replacement is None:
            return "".join(out), False
        out.append(replacement)
        cursor = match.end()
    return "".join(out), True


def _backtick_bodies(command: str) -> list[str]:
    """Extract executable legacy command substitutions, excluding single quotes."""
    bodies = []
    quote = None
    index = 0
    while index < len(command):
        char = command[index]
        if char == "\\":
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
        end = index + 1
        while end < len(command):
            if command[end] == "\\":
                end += 2
                continue
            if command[end] == "`":
                bodies.append(command[index + 1:end].replace("\\`", "`"))
                index = end + 1
                break
            end += 1
        else:
            break
    return bodies


def _nearest_repo_root(path: str) -> str | None:
    current = os.path.abspath(path)
    while True:
        if os.path.exists(os.path.join(current, ".git")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def _rm_target_reason(target: str, cwd: str, variables: dict[str, str]) -> str | None:
    literal_parts = [part for part in target.split(os.sep) if part]
    if ".." in literal_parts:
        return f"rm relative parent target too broad: {target}"
    prefix, complete = _expand_known_vars(target, variables)
    prefix = os.path.expanduser(prefix)
    if not prefix:
        return f"rm target cannot be resolved safely: {target}"
    if os.path.isabs(prefix):
        resolved = os.path.normpath(prefix)
    elif cwd:
        resolved = os.path.normpath(os.path.join(cwd, prefix))
    else:
        return f"rm target cannot be resolved safely: {target}"

    home = os.path.normpath(os.path.expanduser("~"))
    if resolved in ("", "/"):
        return "rm targeting root filesystem"
    if resolved == home:
        return "rm targeting home directory"

    repo = _nearest_repo_root(resolved)
    if repo is not None:
        relative = os.path.relpath(resolved, repo)
        repo_parts = [
            part
            for part in relative.split(os.sep)
            if part not in ("", ".")
        ]
        if len(repo_parts) < 2:
            return (
                f"rm target too broad within repo ({len(repo_parts)} path components): "
                f"{target}"
            )

    if not complete:
        if repo is None:
            return f"rm target cannot be resolved safely: {target}"
        probe = os.path.normpath(resolved + "__git_guardian_dynamic_suffix__")
        try:
            if os.path.commonpath((repo, probe)) != repo or probe == repo:
                return f"rm target cannot be resolved safely: {target}"
        except ValueError:
            return f"rm target cannot be resolved safely: {target}"
        return None

    parts = [part for part in resolved.split(os.sep) if part]
    if len(parts) < 3:
        return f"rm target too broad ({len(parts)} path components): {target}"
    return None


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
    words: list[str],
    position: int,
    cwd: str,
    variables: dict[str, str],
    *,
    dynamic_input: bool = False,
    argument_variables: dict[str, str] | None = None,
) -> str | None:
    """Inspect command positions, including wrapper-owned nested commands."""
    if argument_variables is None:
        argument_variables = variables
    while (
        position < len(words)
        and words[position].lower() in _SHELL_CONTROL_PREFIXES
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
        nested = _skip_options(words, position + 1, option_values)
        return _rm_reason_in_words(
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
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
                split_words + words[remainder:],
                0,
                cwd,
                variables,
                dynamic_input=dynamic_input,
                argument_variables=argument_variables,
            )
        nested = _skip_options(
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
            expanded, complete = _expand_known_vars(assignment.group(2), local_variables)
            if complete:
                local_variables[assignment.group(1)] = os.path.expanduser(expanded)
            nested += 1
        return _rm_reason_in_words(
            words,
            nested,
            cwd,
            local_variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
        )

    if command_name == "time":
        nested = _skip_options(
            words, position + 1, {"-o", "--output", "-f", "--format"}
        )
        return _rm_reason_in_words(
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
        )

    if command_name == "nice":
        nested = _skip_options(
            words, position + 1, {"-n", "--adjustment"}
        )
        return _rm_reason_in_words(
            words,
            nested,
            cwd,
            variables,
            dynamic_input=dynamic_input,
            argument_variables=argument_variables,
        )

    if command_name in {"bash", "sh", "zsh", "dash", "ksh"}:
        for index in range(position + 1, len(words) - 1):
            option = words[index]
            if option == "--command" or (
                option.startswith("-") and not option.startswith("--") and "c" in option[1:]
            ):
                blocked, reason = is_dangerous_rm(
                    words[index + 1], cwd=cwd, env=variables
                )
                return reason if blocked else None
        return None

    if command_name == "find":
        for index in range(position + 1, len(words)):
            if words[index] in {"-exec", "-execdir"}:
                reason = _rm_reason_in_words(
                    words,
                    index + 1,
                    cwd,
                    variables,
                    dynamic_input=dynamic_input,
                    argument_variables=argument_variables,
                )
                if reason:
                    return reason
        return None

    if command_name == "xargs":
        nested = _skip_options(
            words,
            position + 1,
            {
                "-a", "--arg-file", "-d", "--delimiter", "-E",
                "-I", "-L", "--max-lines", "-n",
                "--max-args", "-P", "--max-procs", "-s", "--max-chars",
            },
        )
        return _rm_reason_in_words(
            words,
            nested,
            cwd,
            variables,
            dynamic_input=True,
            argument_variables=argument_variables,
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
        reason = _rm_target_reason(target, cwd, argument_variables)
        if reason:
            return reason
    return None


def is_dangerous_rm(command: str, *, cwd: str | None = None, env=None):
    """Return `(blocked, reason)` after resolving cwd and shell assignments."""
    active = shell_text_without_heredoc_bodies(command)
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
            and words[position].lower() in _SHELL_CONTROL_PREFIXES
        ):
            control_prefix_seen = True
            position += 1
        assignments = []
        while position < len(words):
            assignment = assignment_re.match(words[position])
            if assignment is None:
                break
            expanded, complete = _expand_known_vars(
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
                expanded, complete = _expand_known_vars(
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
            expanded, complete = _expand_known_vars(
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
            words,
            position,
            current,
            local_variables,
            argument_variables=argument_variables,
        )
        if reason:
            return True, reason
    return False, None


def _dangerous_non_rm_in_words(words: list[str], position: int = 0) -> str | None:
    """Inspect git/railway only in executable command positions."""
    assignment_re = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=.*$", re.DOTALL)
    while (
        position < len(words)
        and words[position].lower() in _SHELL_CONTROL_PREFIXES
    ):
        position += 1
    while position < len(words) and assignment_re.match(words[position]):
        position += 1
    if position >= len(words):
        return None

    command_name = os.path.basename(words[position]).lower()
    if command_name in {"sudo", "command", "builtin", "nohup", "exec"}:
        option_values = {
            "-u", "--user", "-g", "--group", "-h", "--host",
            "-p", "--prompt", "-C", "--close-from", "-a",
        } if command_name == "sudo" else set()
        nested = _skip_options(words, position + 1, option_values)
        return _dangerous_non_rm_in_words(words, nested)

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
                return "Dangerous command: env split-string cannot be parsed safely"
            return _dangerous_non_rm_in_words(split_words + words[remainder:])
        nested = _skip_options(
            words,
            position + 1,
            {"-u", "--unset", "-C", "--chdir", "--argv0"},
        )
        while nested < len(words) and assignment_re.match(words[nested]):
            nested += 1
        return _dangerous_non_rm_in_words(words, nested)

    if command_name == "time":
        nested = _skip_options(
            words, position + 1, {"-o", "--output", "-f", "--format"}
        )
        return _dangerous_non_rm_in_words(words, nested)

    if command_name == "nice":
        nested = _skip_options(
            words, position + 1, {"-n", "--adjustment"}
        )
        return _dangerous_non_rm_in_words(words, nested)

    if command_name in {"bash", "sh", "zsh", "dash", "ksh"}:
        for index in range(position + 1, len(words) - 1):
            option = words[index]
            if option == "--command" or (
                option.startswith("-") and not option.startswith("--") and "c" in option[1:]
            ):
                return _dangerous_git_reason(words[index + 1])
        return None

    if command_name == "find":
        for index in range(position + 1, len(words)):
            if words[index] in {"-exec", "-execdir"}:
                reason = _dangerous_non_rm_in_words(words, index + 1)
                if reason:
                    return reason
        return None

    if command_name == "xargs":
        nested = _skip_options(
            words,
            position + 1,
            {
                "-a", "--arg-file", "-d", "--delimiter", "-E",
                "-I", "-L", "--max-lines", "-n",
                "--max-args", "-P", "--max-procs", "-s", "--max-chars",
            },
        )
        return _dangerous_non_rm_in_words(words, nested)

    if command_name == "railway":
        if words[position + 1:position + 2] == ["down"]:
            return "Dangerous command: railway down"
        return None
    if command_name != "git":
        return None

    parsed = split_git(shlex.join(["git", *words[position + 1:]]))
    if parsed is None:
        return None
    subcommand, arguments = parsed
    short_force = any(
        argument.startswith("-")
        and not argument.startswith("--")
        and "f" in argument[1:]
        for argument in arguments
    )
    if subcommand == "push" and ("--force" in arguments or short_force):
        return "Dangerous command: git push --force"
    if subcommand == "reset" and "--hard" in arguments:
        return "Dangerous command: git reset --hard"
    if subcommand == "clean" and ("--force" in arguments or short_force):
        return "Dangerous command: git clean -f"
    return None


def _dangerous_git_reason(command: str) -> str | None:
    """Find destructive git/railway commands with quote-aware shell segmentation."""
    def lex(shell_text: str) -> list[str]:
        lexer = shlex.shlex(shell_text, posix=True, punctuation_chars=";&|()\n")
        lexer.whitespace = " \t\r"
        lexer.whitespace_split = True
        lexer.commenters = "#"
        return list(lexer)

    try:
        tokens = lex(command)
    except ValueError:
        # Bash accepts ANSI-C strings that Python shlex rejects. Neutralize only
        # complete ANSI-C strings and retry so a valid suffix cannot hide an
        # earlier destructive command.
        neutralized = re.sub(
            r"\$'(?:\\.|[^'\\])*'",
            "''",
            command,
            flags=re.DOTALL,
        )
        try:
            tokens = lex(neutralized)
        except ValueError:
            # Keep malformed prose in a non-command position quiet, but fail
            # closed for a destructive command at the executable position.
            return _dangerous_non_rm_in_words(command.split())

    segment: list[str] = []
    for token in tokens + [";"]:
        if token and all(char in ";&|()\n" for char in token):
            reason = _dangerous_non_rm_in_words(segment)
            if reason:
                return reason
            segment = []
        else:
            segment.append(token)
    return None


def dangerous_shell_reason(command: str, *, cwd: str | None = None, env=None):
    """Return the tracked git-guardian block reason, or None."""
    active = shell_text_without_heredoc_bodies(command)
    for body in _backtick_bodies(active):
        nested_reason = dangerous_shell_reason(body, cwd=cwd, env=env)
        if nested_reason:
            return nested_reason
    blocked, reason = is_dangerous_rm(command, cwd=cwd, env=env)
    if blocked:
        return reason
    git_reason = _dangerous_git_reason(active)
    if git_reason:
        return git_reason
    return None


# ── 2. PR body non-empty ─────────────────────────────────────────────────────────
_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
# Markdown skeleton lines that carry no real content on their own.
_SKELETON_LINES = {"#", "##", "###", "-", "*", "—", "---", "<!-- -->"}


def pr_body_is_empty(body: str | None) -> bool:
    """True when a PR body is effectively empty: None, whitespace, or only template
    comments / bare markdown skeleton lines. Used to block `gh pr create` with no body."""
    if body is None:
        return True
    stripped = _HTML_COMMENT.sub("", body)
    meaningful = [
        line.strip()
        for line in stripped.splitlines()
        if line.strip() and line.strip() not in _SKELETON_LINES
    ]
    return len(meaningful) == 0


# ── shared git-command parser ─────────────────────────────────────────────────────
# Global options sit BETWEEN `git` and the subcommand (`git -C /repo restore …`,
# `git --no-pager checkout …`, `git -c k=v commit …`). Naively taking the token right
# after `git` as the subcommand misparses these, so split() skips global options (and
# their separate-value args) to find the real subcommand.
_GLOBAL_OPTS_WITH_SEPARATE_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}


def split_git(command: str):
    """Return (subcommand, args) for a git invocation, skipping global options, or None
    if `command` is not a git invocation."""
    try:
        tokens = shlex.split(command)
    except ValueError:
        tokens = command.split()
    # Match the git binary by basename, so `/usr/bin/git` and `$(brew --prefix)/bin/git`
    # are recognized too (not just the literal `git` token).
    git_idx = next((j for j, t in enumerate(tokens) if t == "git" or t.endswith("/git")), None)
    if git_idx is None:
        return None
    i = git_idx + 1
    while i < len(tokens):
        token = tokens[i]
        if not token.startswith("-"):
            return token, tokens[i + 1:]
        if token in _GLOBAL_OPTS_WITH_SEPARATE_VALUE:
            i += 2  # option takes a separate value token
        else:
            i += 1  # flag or inline --opt=value
    return None


# ── 3. --no-verify gate ───────────────────────────────────────────────────────────
_MESSAGE_FLAGS_WITH_VALUE = {"-m", "--message", "-F", "--file"}


def is_unauthorized_no_verify(command: str, authorized: bool = False) -> bool:
    """True when a git commit/push uses --no-verify without explicit authorization.

    Matches `--no-verify` as a standalone ARGUMENT token, skipping `-m`/`--message`/
    `-F`/`--file` values — so `--no-verify` inside a commit message is not a false hit.
    For `commit` the short `-n` (and bundled short clusters like `-nm`) is ALSO the
    --no-verify bypass; for `push`, `-n` is --dry-run (safe) so the short form is matched
    for commit only. Global git options are handled via split_git."""
    if authorized:
        return False
    split = split_git(command)
    if split is None:
        return False
    sub, args = split
    if sub not in ("commit", "push"):
        return False
    skip_next = False
    for token in args:
        if skip_next:
            skip_next = False
            continue
        if token in _MESSAGE_FLAGS_WITH_VALUE:
            skip_next = True
            continue
        if token.startswith("--message=") or token.startswith("--file="):
            continue
        if token == "--no-verify":
            return True
        # commit's `-n` (incl. bundled clusters `-nm`, `-an`) == --no-verify; push -n is
        # --dry-run, so short-flag detection is commit-only. A short cluster is a single
        # dash + letters (never a long `--…` flag).
        if sub == "commit" and re.fullmatch(r"-[A-Za-z]*n[A-Za-z]*", token):
            return True
    return False


# ── 1. Destructive restore of UNOWNED changes ─────────────────────────────────────

def restore_targets(command: str) -> list[str] | None:
    """Return the paths a discard-style restore would overwrite, or None if `command`
    is not a WORKING-TREE restore.

    Recognized destructive forms (these discard uncommitted working-tree changes):
      git restore <paths…> | git restore .            (default scope is --worktree)
      git restore --worktree <paths…>
      git checkout -- <paths…> | git checkout . | git checkout -- .
    NOT destructive (return None):
      git restore --staged <paths…>   — unstages only; working tree untouched
      git checkout <branch>           — a branch/ref switch, not a file discard
    Global git options (`git -C /repo restore …`) are handled via split_git."""
    split = split_git(command)
    if split is None:
        return None
    sub, args = split

    if sub == "restore":
        has_staged = "--staged" in args or "-S" in args
        has_worktree = "--worktree" in args or "-W" in args
        # `git restore --staged` (without --worktree) only touches the index — safe.
        if has_staged and not has_worktree:
            return None
        # Collect path args, skipping the VALUE of -s/--source (a tree-ish, not a path);
        # inline `--source=<ref>` is dropped as a flag.
        paths = []
        skip_next = False
        for arg in args:
            if skip_next:
                skip_next = False
                continue
            if arg in ("-s", "--source"):
                skip_next = True
                continue
            if arg.startswith("-"):
                continue
            paths.append(arg)
        return paths or None

    if sub == "checkout":
        # Branch creation/switch flags → never a working-tree discard (precision-bias:
        # a false "destructive" on `git checkout -b feature origin/main` would block a
        # safe op, which is worse than missing an exotic restore form).
        if any(a in ("-b", "-B", "--orphan") for a in args):
            return None
        if "--" in args:
            after = args[args.index("--") + 1:]
            paths = [a for a in after if not a.startswith("-")]
            return paths or None
        nonflag = [a for a in args if not a.startswith("-")]
        if nonflag == ["."]:
            return ["."]
        if len(nonflag) >= 2:
            # `git checkout <ref> <paths…>` restores those paths FROM the ref,
            # discarding working-tree changes — the ref is nonflag[0], paths follow.
            return nonflag[1:]
        # A single arg (or none) = branch/ref switch, not a working-tree discard.
        return None

    return None


def is_destructive_restore(command: str, owned_paths=None) -> dict:
    """Classify a restore by whether it discards UNOWNED in-session changes.

    owned_paths = paths this session created/modified (safe to discard). A restore is
    destructive when it would overwrite any path NOT in that set — including `.` which
    discards everything. Returns a verdict dict with a `git stash` suggestion."""
    targets = restore_targets(command)
    if targets is None:
        return {"destructive": False, "targets": None, "unowned": [], "suggestion": None}

    # Normalize both sides so `./src/app.py`, `src/./app.py` and `src/app.py` compare
    # equal — owned_paths is caller-provided and may use a different spelling.
    owned = {_norm(p) for p in (owned_paths or [])}
    if "." in targets:
        unowned = ["."]  # blanket discard always reaches unowned work
    else:
        unowned = [t for t in targets if _norm(t) not in owned]

    destructive = len(unowned) > 0
    suggestion = None
    if destructive:
        what = " ".join(unowned) if unowned != ["."] else "-- ."
        suggestion = f"git stash push {what}  # preserve unowned changes instead of discarding them"
    return {
        "destructive": destructive,
        "targets": targets,
        "unowned": unowned,
        "suggestion": suggestion,
    }

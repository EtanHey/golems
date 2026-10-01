"""Executed shell payload extraction moved from git_safety.py."""

from __future__ import annotations

import os
import re
import shlex

# GO-5 guard gaps: text that a command EXECUTES (r7 on #222; never checked on master).
_SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}
_MAX_EXECUTION_DEPTH = 8
_PIPED_INTERPRETER_HEREDOC_RE = re.compile(
    r"^[^\n]*\b(?:python3?|node|bun|deno|ruby|perl)\b[^\n]*<<-?\s*['\"]?([A-Za-z_]\w*)['\"]?"
    r"[^\n]*\|\s*(?:sh|bash|zsh|dash|ksh)\b[^\n]*\n(.*?)^\s*\1\s*$",
    re.MULTILINE | re.DOTALL,
)
_STRING_LITERAL_RE = re.compile(r"'([^'\n]*)'|\"([^\"\n]*)\"")
_FUNCTION_DEFINITION_RE = re.compile(
    r"(?:^|[;|&\n])\s*(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*"
    r"(?:\s*\(\s*\))?\s*\{",
    re.MULTILINE,
)


def _command_after_wrappers(words: list[str]) -> list[str]:
    """Return the command reached through simple, static launcher wrappers."""
    current = list(words)
    for _depth in range(_MAX_EXECUTION_DEPTH + 1):
        while current and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", current[0]):
            current = current[1:]
        if not current:
            return []
        name = os.path.basename(current[0]).lower()
        position = 1
        if name in {"command", "builtin"}:
            if position < len(current) and current[position] == "--":
                position += 1
            elif position < len(current) and current[position].startswith("-"):
                return []
        elif name in {"nohup", "exec"}:
            while position < len(current) and current[position].startswith("-"):
                if current[position] == "--":
                    position += 1
                    break
                if name == "exec" and current[position] in {"-a", "--argv0"}:
                    position += 2
                else:
                    position += 1
        elif name == "env":
            split_words: list[str] | None = None
            while position < len(current):
                word = current[position]
                option = word.split("=", 1)[0]
                if word == "--":
                    position += 1
                    break
                if option in {"-S", "--split-string"}:
                    if "=" in word:
                        split_value = word.split("=", 1)[1]
                        remainder = position + 1
                    elif position + 1 < len(current):
                        split_value = current[position + 1]
                        remainder = position + 2
                    else:
                        return []
                    try:
                        split_words = shlex.split(split_value) + current[remainder:]
                    except ValueError:
                        return []
                    break
                if option in {"-u", "--unset", "-C", "--chdir", "--argv0"}:
                    position += 1 if "=" in word else 2
                    continue
                if word.startswith("-"):
                    position += 1
                    continue
                if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", word):
                    position += 1
                    continue
                break
            if split_words is not None:
                current = split_words
                continue
        elif name == "sudo":
            options_with_values = {
                "-a", "--auth-type", "-C", "--close-from", "-D", "--chdir",
                "-g", "--group", "-h", "--host", "-p", "--prompt",
                "-R", "--chroot", "-r", "--role", "-T", "--command-timeout",
                "-t", "--type", "-u", "--user",
            }
            while position < len(current):
                word = current[position]
                option = word.split("=", 1)[0]
                if word == "--":
                    position += 1
                    break
                if not word.startswith("-") or word == "-":
                    break
                position += 1
                if option in options_with_values and "=" not in word:
                    position += 1
        elif name == "nice":
            while position < len(current):
                word = current[position]
                if word == "--":
                    position += 1
                    break
                if word in {"-n", "--adjustment"}:
                    position += 2
                    continue
                if word.startswith("--adjustment=") or re.fullmatch(r"-\d+", word):
                    position += 1
                    continue
                break
        elif name == "time":
            while position < len(current):
                word = current[position]
                if word == "--":
                    position += 1
                    break
                if word in {"-o", "--output", "-f", "--format"}:
                    position += 2
                    continue
                if word.startswith("-"):
                    position += 1
                    continue
                break
        else:
            return current
        current = current[position:]
    return []


def _printf_escape(value: str) -> str:
    """Decode the static escapes that can create shell token boundaries."""
    escapes = {
        "a": "\a", "b": "\b", "e": "\x1b", "f": "\f", "n": "\n",
        "r": "\r", "t": "\t", "v": "\v", "\\": "\\",
    }

    def decode(match: re.Match[str]) -> str:
        sequence = match.group(1)
        if sequence.startswith("x"):
            return chr(int(sequence[1:], 16))
        if sequence.startswith("0") or sequence.isdigit():
            return chr(int(sequence.lstrip("0") or "0", 8))
        return escapes[sequence]

    return re.sub(
        r"\\(x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|0[0-7]{1,3}|[0-7]{1,3}|[abefnrtv\\])",
        lambda match: (
            chr(int(match.group(1)[1:], 16))
            if match.group(1).startswith(("u", "U"))
            else decode(match)
        ),
        value,
    )


def _render_printf(words: list[str]) -> str | None:
    """Render static printf formats closely enough to rescan executable output."""
    if len(words) < 2:
        return None
    position = 2 if len(words) > 1 and words[1] == "--" else 1
    if position >= len(words):
        return None
    format_string = _printf_escape(words[position])
    arguments = words[position + 1:]
    output: list[str] = []
    argument_index = 0
    while True:
        conversion_count = 0
        index = 0
        while index < len(format_string):
            if format_string[index] != "%":
                output.append(format_string[index])
                index += 1
                continue
            if index + 1 < len(format_string) and format_string[index + 1] == "%":
                output.append("%")
                index += 2
                continue
            match = re.match(r"%[-+ #0']*(?:\d+|\*)?(?:\.(?:\d+|\*))?[hlLjzt]*([a-zA-Z])", format_string[index:])
            if match is None:
                return None
            conversion = match.group(1)
            if conversion not in "sbqdiouxXfFeEgGaAc":
                return None
            argument_index += match.group(0).count("*")
            argument = arguments[argument_index] if argument_index < len(arguments) else ""
            argument_index += 1
            conversion_count += 1
            if conversion == "b":
                output.append(_printf_escape(argument))
            elif conversion == "q":
                output.append(shlex.quote(argument))
            else:
                output.append(argument)
            index += match.end()
        if not conversion_count or argument_index >= len(arguments):
            break
    return "".join(output)


def _printed_text(words: list[str]) -> str | None:
    """What an `echo`/`printf` segment writes to stdout, as far as is static."""
    words = _command_after_wrappers(words)
    if not words:
        return None
    name = os.path.basename(words[0])
    if name == "echo":
        rest = words[1:]
        interprets_escapes = False
        while rest and rest[0] in {"-n", "-e", "-E", "-ne", "-en"}:
            if "e" in rest[0]:
                interprets_escapes = True
            if "E" in rest[0]:
                interprets_escapes = False
            rest = rest[1:]
        printed = " ".join(rest)
        return _printf_escape(printed) if interprets_escapes else printed
    if name == "printf":
        return _render_printf(words)
    return None


def _command_words_before_operator(
    segments: list[tuple[list[str], str]], index: int
) -> list[str]:
    """Recover command words across redirections that precede an operator."""
    start = index
    while start > 0:
        previous_operator = segments[start - 1][1]
        is_redirection = "<" in previous_operator or ">" in previous_operator
        if not is_redirection and any(ch in previous_operator for ch in ";&|()"):
            break
        start -= 1

    command_words: list[str] = []
    pending_redirect_target = False
    for words, operator in segments[start:index + 1]:
        current = list(words)
        if pending_redirect_target and current:
            current = current[1:]
            pending_redirect_target = False
        if "<" in operator or ">" in operator:
            if current and current[-1].isdigit():
                current.pop()
            pending_redirect_target = True
        command_words.extend(current)
    return [
        word for word in command_words
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", word)
    ]


def _shell_reads_commands_from_stdin(words: list[str], shells: set[str]) -> bool:
    """Whether a shell invocation treats a here-string as command input."""
    words = _command_after_wrappers(words)
    if not words or os.path.basename(words[0]) not in shells:
        return False
    reads_stdin = False
    index = 1
    while index < len(words):
        argument = words[index]
        if argument in {"-O", "+O", "--init-file", "--rcfile"}:
            index += 2
            continue
        if argument == "--":
            index += 1
            if index == len(words):
                return True
            return reads_stdin or words[index] in {
                "-", "/dev/stdin", "/dev/fd/0", "/proc/self/fd/0",
            }
        if argument in {"-", "/dev/stdin", "/dev/fd/0", "/proc/self/fd/0"}:
            return True
        if argument.startswith(("-", "+")) and argument not in {"-", "+"}:
            if argument.startswith("-") and "c" in argument[1:]:
                return False
            reads_stdin = reads_stdin or (argument.startswith("-") and "s" in argument[1:])
            index += 1
            continue
        return reads_stdin
    return True


def _executed_payloads(command: str, active: str, *, api: dict) -> list[str]:
    """Strings the shell will run as commands: $() bodies (also inside "…"),
    eval arguments, echo/printf output piped into a stdin shell or given to one
    as a <(…) script, git `!` aliases, and string literals of an interpreter
    heredoc piped into a shell."""
    payloads = list(api['dollar_paren_bodies'](active))
    if api['_FUNCTION_DEFINITION_RE'].search(active):
        payloads.extend(
            body for body, _segment, _index in api['_invoked_alias_bodies'](command)
        )
    for match in api['_PIPED_INTERPRETER_HEREDOC_RE'].finditer(command):
        payloads.extend(a or b for a, b in api['_STRING_LITERAL_RE'].findall(match.group(2)))
    executable = api['executable_shell_structure'](command)
    span_source = command
    if api['executable_shell_structure_has_open_state'](command):
        executable = active
        span_source = active
    for match in re.finditer(
        r"(?:\b(?:sh|bash|zsh|dash|ksh|source)|(?:^|[;&|]\s*)\.)\s+<\(",
        executable,
    ):
        inner, _end = api['process_substitution_at'](span_source, match.end() - 2)
        try:
            printed = api['_printed_text'](shlex.split(inner)) if inner.strip() else None
        except ValueError:
            printed = None
        if printed:
            payloads.append(printed)
    try:
        lexer = shlex.shlex(active.replace("\n", " ; "), posix=True, punctuation_chars=";&|()<>")
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return payloads
    segments: list[tuple[list[str], str]] = []
    words: list[str] = []
    for token in tokens:
        if token and all(ch in ";&|()<>" for ch in token):
            segments.append((words, token))
            words = []
        else:
            words.append(token)
    segments.append((words, ""))
    for index, (words, operator) in enumerate(segments):
        words = [w for w in words if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w)] if words else words
        if not words:
            continue
        name = os.path.basename(words[0])
        if name == "eval" and len(words) > 1:
            payloads.append(" ".join(words[1:]))
            for argument in words[1:]:
                for body in api['dollar_paren_bodies'](argument):
                    try:
                        output_lexer = shlex.shlex(
                            body,
                            posix=True,
                            punctuation_chars=";&|()<>\n",
                        )
                        output_lexer.whitespace_split = True
                        output_tokens = list(output_lexer)
                    except ValueError:
                        continue
                    output_words: list[str] = []
                    stdout_redirected = False
                    pending_redirect: tuple[str, bool] | None = None
                    for output_token in output_tokens + [";"]:
                        if output_token and all(ch in ";&|()<>\n" for ch in output_token):
                            is_redirection = "<" in output_token or ">" in output_token
                            if ">" in output_token:
                                descriptor = (
                                    output_words.pop()
                                    if output_words and output_words[-1].isdigit()
                                    else "1"
                                )
                                pending_redirect = (descriptor, output_token.endswith("&"))
                            if not is_redirection and any(ch in output_token for ch in ";&|()\n"):
                                printed = (
                                    api['_printed_text'](output_words)
                                    if output_words and not stdout_redirected and "|" not in output_token
                                    else None
                                )
                                if printed:
                                    payloads.append(printed)
                                output_words = []
                                stdout_redirected = False
                                pending_redirect = None
                        else:
                            if pending_redirect is not None:
                                descriptor, duplicates_descriptor = pending_redirect
                                if descriptor == "1":
                                    known_other_destination = (
                                        not duplicates_descriptor
                                        or output_token == "-"
                                        or (output_token.isdigit() and output_token != "1")
                                    )
                                    stdout_redirected = stdout_redirected or known_other_destination
                                pending_redirect = None
                            else:
                                output_words.append(output_token)
        if operator == "<<<" and index + 1 < len(segments):
            shell_words = _command_words_before_operator(segments, index)
            here_words = segments[index + 1][0]
            if here_words and _shell_reads_commands_from_stdin(shell_words, api['_SHELLS']):
                payloads.append(" ".join(here_words))
        if name == "git":
            for position, word in enumerate(words[1:], 1):
                value = words[position + 1] if word == "-c" and position + 1 < len(words) else (
                    word[2:] if word.startswith("-c") and len(word) > 2 else "")
                if value.startswith("alias.") and "=!" in value:
                    payloads.append(value.split("=!", 1)[1])
        if operator == "|" and index + 1 < len(segments):
            reader = segments[index + 1][0]
            reads_stdin = reader and os.path.basename(reader[0]) in api['_SHELLS'] and all(
                w.startswith("-") for w in reader[1:])
            printed = api['_printed_text'](words)
            if reads_stdin and printed:
                payloads.append(printed)
    return [payload for payload in payloads if payload.strip()]

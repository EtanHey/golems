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


def _printed_text(words: list[str]) -> str | None:
    """What an `echo`/`printf` segment writes to stdout, as far as is static."""
    name = os.path.basename(words[0])
    if name == "echo":
        rest = words[1:]
        while rest and rest[0] in {"-n", "-e", "-E", "-ne", "-en"}:
            rest = rest[1:]
        return " ".join(rest)
    if name == "printf" and len(words) > 1:
        return words[1].replace("\\n", "\n")
    return None


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
    for match in re.finditer(r"(?:\b(?:sh|bash|zsh|dash|ksh|source)|(?:^|[;&|]\s*)\.)\s+<\(", active):
        inner = next(iter(api['dollar_paren_bodies']("$(" + active[match.end():])), "")
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
                    pending_redirect_target = False
                    for output_token in output_tokens + [";"]:
                        if output_token and all(ch in ";&|()<>\n" for ch in output_token):
                            if ">" in output_token:
                                descriptor = (
                                    output_words.pop()
                                    if output_words and output_words[-1].isdigit()
                                    else "1"
                                )
                                stdout_redirected = stdout_redirected or descriptor == "1"
                                pending_redirect_target = True
                            if any(ch in output_token for ch in ";&|()\n"):
                                printed = (
                                    api['_printed_text'](output_words)
                                    if output_words and not stdout_redirected and "|" not in output_token
                                    else None
                                )
                                if printed:
                                    payloads.append(printed)
                                output_words = []
                                stdout_redirected = False
                                pending_redirect_target = False
                        else:
                            if pending_redirect_target:
                                pending_redirect_target = False
                            else:
                                output_words.append(output_token)
        if operator == "<<<" and name in api['_SHELLS'] and index + 1 < len(segments):
            here_words = segments[index + 1][0]
            if here_words:
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

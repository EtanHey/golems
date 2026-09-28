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

"""Which refs `git update-ref --stdin` moves, read from input the command shows.

The input counts as visible only when the command itself carries it: a heredoc
or here-string on the update-ref command, or an `echo`/`printf` (or a `cat` of a
heredoc) piped straight into it. Anything else (a `<` file, an unseen producer,
an inherited stdin) cannot be read here, so the caller fails closed.
"""

from __future__ import annotations

import contextvars
from functools import wraps
import os
import re
import shlex

from . import shell_parse
from .payloads import _printed_text, _printf_escape

# The raw command (heredoc bodies included) that the rm pass is reading now.
RAW_COMMAND = contextvars.ContextVar("git_guardian_update_ref_raw_command", default=None)

_MOVES = {"update", "create", "delete", "symref-update", "symref-create", "symref-delete"}
_READS = {"verify", "symref-verify"}
_SEPARATOR = set(";&|()")
NO_DEREF = "\0no-deref:"


def _heredocs(command: str):
    """(text with heredoc bodies removed, bodies in declaration order)."""
    active, bodies, pending = [], [], []
    for line in command.split("\n"):
        if pending:
            delimiter, strip_tabs, body = pending[0]
            candidate = line.lstrip("\t") if strip_tabs else line
            if candidate == delimiter:
                bodies.append("".join(part + "\n" for part in body))
                pending.pop(0)
            else:
                body.append(candidate)
            continue
        scan = shell_parse._blank_shell_comment(shell_parse._blank_quoted(line))
        for match in shell_parse._HEREDOC_START_RE.finditer(scan):
            parsed = shell_parse._heredoc_delimiter_word(line, match.end())
            if parsed is not None:
                pending.append((parsed[0], bool(match.group(1)), []))
        active.append(line)
    bodies.extend("".join(part + "\n" for part in body) for _d, _s, body in pending)
    return "\n".join(active), bodies


def _segments(command: str):
    """[(words, stdin sources, operator before)] or None when unreadable.

    A source is the visible text, or None for input this command does not show.
    """
    active, bodies = _heredocs(command)
    try:
        lexer = shlex.shlex(active.replace("\\\n", "").replace("\n", " ; "),
                            posix=True, punctuation_chars=";&|()<>")
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return None
    segments, words, sources, before = [], [], [], None
    heredoc, index = 0, 0
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if token and set(token) <= _SEPARATOR:
            if words or sources:
                segments.append((words, sources, before))
            words, sources, before = [], [], token
            continue
        if token and set(token) <= _SEPARATOR | set("<>"):
            # A descriptor other than 0 leaves stdin alone, so its input is not stdin's.
            descriptor = words.pop() if words and words[-1].isdigit() else "0"
            if token in ("<<", "<<-"):
                if index < len(tokens) and tokens[index] == "-":
                    index += 1
                index += 1
                body = bodies[heredoc] if heredoc < len(bodies) else None
                heredoc += 1
                sources.append(body if descriptor == "0" else None)
            elif token == "<<<":
                text = tokens[index] + "\n" if index < len(tokens) else None
                index += 1
                sources.append(text if descriptor == "0" else None)
            elif "<" in token:
                index += 1
                sources.append(None)
            else:
                index += 1  # output redirection target
            continue
        words.append(token)
    if words or sources:
        segments.append((words, sources, before))
    if heredoc != len(bodies):
        return None  # the two scans disagree on which body belongs where
    return segments


def _is_update_ref_stdin(words: list[str]) -> bool:
    return "--stdin" in words and (
        "update-ref" in words or any(os.path.basename(word) == "git-update-ref" for word in words))


def _producer_text(words: list[str], sources: list) -> str | None:
    """What a segment piped into update-ref writes, when the command shows it."""
    if not words:
        return None
    if os.path.basename(words[0]) == "cat" and all(word.startswith("-") for word in words[1:]):
        if sources and all(source is not None for source in sources):
            return "".join(sources)
        return None
    if os.path.basename(words[0]) == "echo":
        printed = _printed_text(words)
        return _printf_escape(printed) if printed is not None else None
    return _printed_text(words)


def visible_inputs(command: str | None) -> list | None:
    """The input of each `update-ref --stdin` in `command`; None marks an unseen one."""
    if command is None:
        return None
    segments = _segments(str(command))
    if segments is None:
        return None
    inputs = []
    for position, (words, sources, before) in enumerate(segments):
        if not _is_update_ref_stdin(words):
            continue
        if sources:
            inputs.append(None if None in sources else "".join(sources))
        elif before in ("|", "|&") and position > 0:
            inputs.append(_producer_text(*segments[position - 1][:2]))
        else:
            inputs.append(None)
    return inputs


ANY_REF = "*"


def stdin_targets(text: str, no_deref: bool) -> list[str]:
    """Branch refs and HEAD that the input moves; ANY_REF for a ref that is not literal.

    The text is also read with printf escapes decoded (`%b`, `echo` in zsh), so an
    escaped newline cannot hide a line.
    """
    # Quoting/expansion of heredocs is not represented in the input record.
    # Refuse continuations rather than treating split verbs/refs as inert data.
    if "\\\n" in text:
        return [ANY_REF]
    decoded = _printf_escape(text)
    return _line_targets(text, no_deref) + (_line_targets(decoded, no_deref) if decoded != text else [])


def _line_targets(text: str, no_deref: bool) -> list[str]:
    targets, next_no_deref = [], False
    for line in re.split(r"[\n\0]", text):
        fields = line.split()
        if not fields:
            continue
        verb = fields[0]
        if "$" in verb or "`" in verb:
            targets.append(ANY_REF)  # an expansion (or a $'…' quote) may spell any command
            continue
        if verb == "option":
            next_no_deref = next_no_deref or fields[1:2] == ["no-deref"]
            continue
        if verb not in _MOVES and verb not in _READS:
            continue  # transaction control, a -z value, or a line git refuses
        detached = no_deref or next_no_deref
        next_no_deref = False
        if verb in _READS or len(fields) < 2:
            continue
        if verb.startswith("symref-"):
            targets.append(ANY_REF)  # may change later dereferencing in this transaction
            continue
        ref = fields[1].strip('"').replace("\\", "")
        if "$" in ref or "`" in ref:
            targets.append(ANY_REF)
        if ref == "HEAD":
            if verb.startswith("symref-") or not detached:
                targets.append("HEAD")
        else:
            targets.append((NO_DEREF if detached else "") + ref)
    return targets


def visible_targets(no_deref: bool) -> list[str] | None:
    """Every ref the current command's update-ref --stdin inputs move, or None if any is unseen."""
    inputs = visible_inputs(RAW_COMMAND.get())
    if not inputs or None in inputs:
        return None
    return [target for text in inputs for target in stdin_targets(text, no_deref)]


def with_raw_command(function):
    """Keep each recursive shell evaluation bound to its own visible stdin."""
    @wraps(function)
    def evaluate(api, command, **options):
        token = RAW_COMMAND.set(command)
        try:
            return function(api, command, **options)
        finally:
            RAW_COMMAND.reset(token)
    return evaluate

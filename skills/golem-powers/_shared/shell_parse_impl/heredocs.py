"""General shell heredoc masking, retaining executable substitutions."""

from __future__ import annotations

import re

from .masks import _blank_quoted
from .quotes import ansi_c_quote


# AIDEV-NOTE: heredocs and substitutions depend on each other. The facade
# binds these scanners after both modules load; do not drop the binding.
_dollar_substitution = None
_backtick_substitution = None


# Heredoc start operator (not `<<<` herestring). The complete delimiter word
# is parsed separately because Bash permits partially quoted forms (`<<E'OF'`).
_HEREDOC_START_RE = re.compile(r"(?<!<)<<(?!<)(-?)\s*")


def _blank_shell_comment(line):
    """Blank a shell comment from its unquoted token boundary onward."""
    for i, char in enumerate(line):
        if char != "#":
            continue
        if i == 0 or line[i - 1].isspace() or line[i - 1] in ";|&()":
            return line[:i] + " " * (len(line) - i)
    return line


def _strip_heredoc_bodies(command):
    """Drop literal heredoc text but preserve executable expansions.

    Quoted delimiters make the whole body literal. Unquoted bodies execute
    command substitutions, so those expressions remain visible to the
    recursive scanner while prose-shaped redirects stay blanked.
    """
    lines = command.split("\n")
    out = []
    pending = []  # [delimiter, expansions_enabled, strip_tabs, body_lines]
    for line in lines:
        if pending:
            delim, expansions_enabled, strip_tabs, body_lines = pending[0]
            candidate = line.lstrip("\t") if strip_tabs else line
            if candidate == delim:
                if expansions_enabled:
                    out.append(
                        _heredoc_executable_text("\n".join(body_lines))
                    )
                else:
                    out.append("")
                pending.pop(0)
                continue
            body_lines.append(line)
            continue
        # Kept (active) lines are scanned for heredoc starts, outside quotes.
        scan = _blank_shell_comment(_blank_quoted(line))
        for m in _HEREDOC_START_RE.finditer(scan):
            parsed = _heredoc_delimiter_word(line, m.end())
            if parsed is None:
                continue
            delimiter, quoted = parsed
            pending.append([delimiter, not quoted, bool(m.group(1)), []])
        out.append(line)
    for _delim, expansions_enabled, _strip_tabs, body_lines in pending:
        if expansions_enabled:
            out.append(_heredoc_executable_text("\n".join(body_lines)))
        else:
            out.append("")
    return "\n".join(out)


def _mask_heredoc_body_lines_with_status(command):
    """Blank heredoc prose while preserving offsets and executable expansions."""
    out = []
    pending = []  # [delimiter, expansions_enabled, strip_tabs]
    for source_line in command.splitlines(keepends=True):
        line = source_line.rstrip("\r\n")
        ending = source_line[len(line):]
        if pending:
            delimiter, expansions_enabled, strip_tabs = pending[0]
            candidate = line.lstrip("\t") if strip_tabs else line
            if candidate == delimiter:
                pending.pop(0)
                out.append(" " * len(line) + ending)
                continue
            masked = [" "] * len(line)
            if expansions_enabled:
                i = 0
                while i < len(line):
                    found = None
                    if line.startswith("$(", i):
                        found = _dollar_substitution(line, i)
                    elif line[i] == "`":
                        found = _backtick_substitution(line, i)
                    if found is not None:
                        _body, end = found
                        masked[i:end] = line[i:end]
                        i = end
                    else:
                        i += 2 if line[i] == "\\" else 1
            out.append("".join(masked) + ending)
            continue
        scan = _blank_shell_comment(_blank_quoted(line))
        for match in _HEREDOC_START_RE.finditer(scan):
            parsed = _heredoc_delimiter_word(line, match.end())
            if parsed is not None:
                delimiter, quoted = parsed
                pending.append((delimiter, not quoted, bool(match.group(1))))
        out.append(source_line)
    return "".join(out), not pending


def _mask_heredoc_body_lines(command):
    return _mask_heredoc_body_lines_with_status(command)[0]


def _heredoc_delimiter_word(line, start):
    """Return Bash quote-removed heredoc delimiter and whether it was quoted."""
    parsed = _heredoc_delimiter_span(line, start)
    return parsed[:2] if parsed else None


def _heredoc_delimiter_span(line, start):
    """The same delimiter with its source end, including ANSI-C quote spans."""
    out = []
    quote = None
    quoted = False
    i = start
    while i < len(line):
        char = line[i]
        if quote is None and line.startswith("$'", i):
            value, i = ansi_c_quote(line, i)
            out.append(value)
            quoted = True
            continue
        if quote is not None:
            if char == quote:
                quote = None
                quoted = True
            elif quote == '"' and char == "\\" and i + 1 < len(line):
                quoted = True
                i += 1
                out.append(line[i])
            else:
                out.append(char)
            i += 1
            continue
        if char.isspace() or char in ";|&<>":
            break
        if char in "\"'":
            quote = char
            quoted = True
            i += 1
            continue
        if char == "\\" and i + 1 < len(line):
            quoted = True
            i += 1
            out.append(line[i])
            i += 1
            continue
        out.append(char)
        i += 1
    delimiter = "".join(out)
    return (delimiter, quoted, i) if delimiter else None


def _after_heredoc_bodies(command, start):
    """Return the offset after heredoc bodies declared from `start`'s line."""
    line_end = command.find("\n", start)
    if line_end < 0:
        return None
    fragment = command[start:line_end]
    scan = _blank_shell_comment(_blank_quoted(fragment))
    delimiters = []
    for match in _HEREDOC_START_RE.finditer(scan):
        parsed = _heredoc_delimiter_word(fragment, match.end())
        if parsed is not None:
            delimiters.append((parsed[0], bool(match.group(1))))
    if not delimiters:
        return None
    cursor = line_end + 1
    for delimiter, strip_tabs in delimiters:
        while cursor <= len(command):
            body_end = command.find("\n", cursor)
            if body_end < 0:
                body_end = len(command)
            body_line = command[cursor:body_end]
            cursor = body_end + (body_end < len(command))
            candidate = body_line.lstrip("\t") if strip_tabs else body_line
            if candidate == delimiter:
                break
            if body_end == len(command):
                return len(command)
        else:  # pragma: no cover - loop exits via cursor exhaustion
            return len(command)
    return cursor


def _heredoc_executable_text(line):
    """Keep only substitutions that Bash executes in an unquoted heredoc."""
    expansions = []
    i = 0
    while i < len(line):
        if line[i] == "\\":
            i += 2
            continue
        if line.startswith("$(", i):
            found = _dollar_substitution(line, i)
            if found is not None:
                _body, end = found
                expansions.append(line[i:end])
                i = end
                continue
        if line[i] == "`":
            found = _backtick_substitution(line, i)
            if found is not None:
                _body, end = found
                expansions.append(line[i:end])
                i = end
                continue
        i += 1
    return " ".join(expansions)

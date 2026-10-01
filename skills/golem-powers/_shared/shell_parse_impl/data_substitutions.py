"""Git safety command substitution body helpers."""

from __future__ import annotations


from .data_text import _data_backtick_end, _data_dollar_paren_end


def _backtick_bodies(command: str) -> list[str]:
    """Extract executable legacy command substitutions, excluding single quotes."""
    bodies = []
    quote = None
    index = 0
    while index < len(command):
        char = command[index]
        if char == "\\" and quote != "'":
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
        end = _data_backtick_end(command, index)
        bodies.append(command[index + 1:end - 1].replace("\\`", "`"))
        index = end
    return bodies


def _dollar_paren_spans(text: str) -> list[tuple[int, int]]:
    """(start, end) of each complete outermost `$()` outside single quotes."""
    spans = []
    quote = None
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and quote != "'":
            index += 2
            continue
        if quote == "'":
            if char == "'":
                quote = None
            index += 1
            continue
        if char == "'" and quote is None:
            quote = "'"
        elif char == '"':
            quote = None if quote == '"' else '"'
        elif char == "`":
            index = _data_backtick_end(text, index)
            continue
        elif text.startswith("$(", index):
            end = _data_dollar_paren_end(text, index)
            if text.startswith("$((", index):
                body = text[index + 2:end - 1]
                depth = 0
                quote_in_body = None
                escaped = False
                fallback = False
                for body_index, body_char in enumerate(body):
                    if escaped:
                        escaped = False
                        continue
                    if body_char == "\\" and quote_in_body != "'":
                        escaped = True
                        continue
                    if quote_in_body is not None:
                        if body_char == quote_in_body:
                            quote_in_body = None
                        continue
                    if body_char in "'\"":
                        quote_in_body = body_char
                    elif body_char == "(":
                        depth += 1
                    elif body_char == ")" and depth:
                        depth -= 1
                        if depth == 0:
                            # A newline is itself a shell command separator. Strip
                            # only horizontal whitespace so `$((group)\n cmd)` is
                            # recognized as command substitution, not arithmetic.
                            suffix = body[body_index + 1:].lstrip(" \t")
                            fallback = suffix.startswith((";", "&&", "||", "&", "|", "\n"))
                            break
                if not fallback:
                    index += 3
                    continue
            spans.append((index, end))
            index = end
            continue
        index += 1
    return spans


def dollar_paren_bodies(text: str) -> list[str]:
    """Bodies of `$( … )` command substitutions outside single quotes (GO-5).

    Double quotes do not stop Bash from running a `$()`, so `echo "x $(cmd)"`
    yields `cmd`. `$((` arithmetic is skipped. Nested substitutions come back
    as part of their outer body and are found again when that body is checked.
    """
    bodies = []
    for start, end in _dollar_paren_spans(text):
        bodies.append(text[start + 2:end - 1])
    return bodies


def without_dollar_paren_bodies(text: str) -> str:
    """`text` with every `$( … )` body blanked to `$()`. The bodies are checked
    on their own (where their quoted heredocs are stripped), so a caller scanning
    the outer text must not re-read what is inside them (GO-5, r7 on #233)."""
    out = []
    cursor = 0
    for start, end in _dollar_paren_spans(text):
        out.append(text[cursor:start] + "$()")
        cursor = end
    out.append(text[cursor:])
    return "".join(out)


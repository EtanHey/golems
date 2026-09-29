"""Raw function definitions and executable source-unit buffering."""

from __future__ import annotations

import re

from .structure import (
    function_name_pattern, function_open_re, structural_source,
    has_unclosed_function_definition, has_unclosed_compound_command,
)


def raw_function_definitions(source):
    """Return function names and body slices without discarding shell quoting."""
    structural = structural_source(source)
    definitions = []
    for match in function_open_re.finditer(structural):
        signature = source[match.start("signature"):match.end("signature")]
        names = re.findall(function_name_pattern, signature)
        if not names:
            continue
        name = names[-1]
        body_start = match.end("brace")
        depth = 1
        body_end = body_start
        while body_end < len(structural) and depth:
            if structural[body_end] == "{":
                depth += 1
            elif structural[body_end] == "}":
                depth -= 1
            body_end += 1
        if depth == 0:
            definitions.append((name, source[body_start:body_end - 1]))
    return definitions

def parse_units(source):
    def shell_line_continues(source_line):
        line = source_line.rstrip("\r\n")
        trailing = len(line) - len(line.rstrip("\\"))
        if trailing % 2 == 0:
            return False
        quote = None
        comment = False
        i = 0
        target = len(line) - 1
        while i < target:
            char = line[i]
            if comment:
                return False
            if quote == "'":
                if char == "'":
                    quote = None
                i += 1
                continue
            if quote == '"':
                if char == '"':
                    quote = None
                elif char == "\\" and i + 1 < target:
                    i += 1
                i += 1
                continue
            if char in "'\"":
                quote = char
            elif char == "#" and (
                i == 0 or line[i - 1].isspace() or line[i - 1] in ";|&()"
            ):
                comment = True
            elif char == "\\" and i + 1 < target:
                i += 1
            i += 1
        return not comment and quote != "'"

    buffered = ""
    for source_line in source.splitlines(keepends=True):
        buffered += source_line
        if shell_line_continues(source_line):
            continue
        if (
            has_unclosed_function_definition(buffered)
            or has_unclosed_compound_command(buffered)
        ):
            continue
        yield buffered
        buffered = ""
    if buffered:
        yield buffered

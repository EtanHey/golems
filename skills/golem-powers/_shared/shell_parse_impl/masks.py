"""Quoted and inert-body masks for shell source."""

from __future__ import annotations

import re


def _blank_quoted(line):
    """Length-preserving copy of `line` with quoted contents blanked, so regex
    scans don't fire on text inside string literals (spans still line up)."""
    out = []
    in_quote = None
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if in_quote is not None:
            if in_quote == '"' and c == "\\" and i + 1 < n:
                out.append("  ")
                i += 2
                continue
            if c == in_quote:
                in_quote = None
                out.append(c)
            else:
                out.append(" ")
            i += 1
            continue
        if c in "\"'":
            in_quote = c
        out.append(c)
        i += 1
    return "".join(out)


def _mask_quoted_operator_words(command):
    """Keep quoted shell operators from becoming redirect/separator tokens."""
    def mask(match):
        return f"{match.group('quote')}{'_' * len(match.group('body'))}{match.group('quote')}"

    return re.sub(
        r"(?P<quote>['\"])(?P<body>[<>|&;()]+)(?P=quote)",
        mask,
        command,
    )


def _mask_function_definition_bodies(command):
    """Blank non-executed function bodies while preserving offsets/newlines."""
    structural = _blank_quoted(command)
    masked = list(command)
    signature = re.compile(
        r"(?:^|[;|&\n])\s*(?:function\s+[A-Za-z_][A-Za-z0-9_]*"
        r"(?:\s*\(\s*\))?|[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\))\s*\{",
        re.MULTILINE,
    )
    for match in signature.finditer(structural):
        body_start = match.end()
        depth = 1
        body_end = body_start
        while body_end < len(structural) and depth:
            if structural[body_end] == "{":
                depth += 1
            elif structural[body_end] == "}":
                depth -= 1
            body_end += 1
        if depth:
            continue
        for index in range(body_start, body_end - 1):
            if masked[index] not in "\r\n":
                masked[index] = " "
    return "".join(masked)

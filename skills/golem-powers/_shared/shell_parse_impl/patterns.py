"""Raw-aware alias eligibility and shell case/for patterns."""

from __future__ import annotations

import re

from .substitutions import _backtick_substitution, _dollar_substitution
from .tokens import _RAW_FOR_WORD_RE, _RAW_SHELL_TOKEN_RE
from .quotes import ansi_c_quote


def builtin_alias_eligibility(source):
    """Return alias-eligibility flags for normalized `builtin` words."""
    flags = []
    word = []
    alias_eligible = True
    quote = None
    comment = False

    def flush():
        nonlocal word, alias_eligible
        if "".join(word) == "builtin":
            flags.append(alias_eligible)
        word = []
        alias_eligible = True

    i = 0
    while i < len(source):
        char = source[i]
        if comment:
            if char in "\r\n":
                comment = False
                flush()
            i += 1
            continue
        if quote is None and source.startswith("$'", i):
            value, i = ansi_c_quote(source, i)
            word.extend(value)
            alias_eligible = False
            continue
        if quote != "'" and source.startswith("$(", i):
            found = _dollar_substitution(source, i)
            if found is not None:
                body, i = found
                flags.extend(builtin_alias_eligibility(body))
                continue
        if quote != "'" and char == "`":
            found = _backtick_substitution(source, i)
            if found is not None:
                body, i = found
                flags.extend(builtin_alias_eligibility(body))
                continue
        if quote is not None:
            if char == quote:
                quote = None
            elif char == "\\" and quote == '"' and i + 1 < len(source):
                alias_eligible = False
                i += 1
                word.append(source[i])
            else:
                word.append(char)
            i += 1
            continue
        if char in "'\"":
            quote = char
            alias_eligible = False
            i += 1
            continue
        if char == "$" and i + 1 < len(source) and source[i + 1] in "'\"":
            quote = source[i + 1]
            alias_eligible = False
            i += 2
            continue
        if char == "\\" and i + 1 < len(source):
            alias_eligible = False
            i += 1
            word.append(source[i])
            i += 1
            continue
        if char == "#" and not word:
            comment = True
            i += 1
            continue
        if char.isspace() or char in ";|&(){}<>":
            flush()
        else:
            word.append(char)
        i += 1
    flush()
    return flags


def shell_case_pattern(raw_pattern):
    """Normalize one raw case pattern while preserving quoted metacharacters."""
    normalized = []
    quote = None
    escaped = False
    i = 0
    while i < len(raw_pattern):
        if quote is None and not escaped and raw_pattern.startswith("$'", i):
            value, i = ansi_c_quote(raw_pattern, i)
            normalized.extend(
                {"*": "[*]", "?": "[?]", "[": "[[]"}.get(char, char)
                for char in value
            )
            continue
        char = raw_pattern[i]
        i += 1
        if escaped:
            normalized.append({"*": "[*]", "?": "[?]", "[": "[[]"}.get(char, char))
            escaped = False
            continue
        if char == "\\" and quote != "'":
            escaped = True
            continue
        if quote is not None:
            if char == quote:
                quote = None
            else:
                normalized.append(
                    {"*": "[*]", "?": "[?]", "[": "[[]"}.get(char, char)
                )
            continue
        if char in "'\"":
            quote = char
        else:
            normalized.append(char)
    if escaped:
        normalized.append("\\")
    return "".join(normalized)


def case_pattern_groups(source):
    """Return raw-aware alternative patterns for each case arm in source."""
    raw_tokens = _RAW_SHELL_TOKEN_RE.findall(source)
    groups = []
    stack = []
    for token in raw_tokens:
        if not stack:
            if token == "case":
                stack.append({"state": "subject", "patterns": []})
            continue
        case_state = stack[-1]
        if case_state["state"] == "subject":
            case_state["state"] = "await-in"
            continue
        if case_state["state"] == "await-in":
            if token == "in":
                case_state["state"] = "pattern"
            continue
        if case_state["state"] == "pattern":
            if token == "|":
                continue
            if token == ")":
                groups.append(case_state["patterns"])
                case_state["patterns"] = []
                case_state["state"] = "body"
                continue
            case_state["patterns"].append(shell_case_pattern(token))
            continue
        if token == "case":
            stack.append({"state": "subject", "patterns": []})
        elif token in {";;", ";&", ";;&"}:
            case_state["state"] = "pattern"
        elif token == "esac":
            stack.pop()
    return groups


def literal_for_word_counts(source):
    """Return definite literal word counts for raw `for ... in ...` lists."""
    counts = []
    for match in re.finditer(
        r"(?:^|[;|&\n])\s*for\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+"
        r"(?P<words>.*?)(?=(?:[ \t]*;[ \t]*|[ \t]*\r?\n[ \t]*)do\b)",
        source,
        re.DOTALL,
    ):
        words = _RAW_FOR_WORD_RE.findall(match.group("words"))
        definite = 0
        dynamic = False
        for word in words:
            if word.startswith("$'") and ansi_c_quote(word, 0)[1] == len(word):
                definite += 1
            elif word.startswith("'") and word.endswith("'"):
                definite += 1
            elif word.startswith('"') and word.endswith('"'):
                if "$@" not in word:
                    definite += 1
                else:
                    dynamic = True
            elif not any(marker in word for marker in ("$", "`", "*", "?", "[")):
                definite += 1
            elif word in {"$(false)", "$(true)", "`false`", "`true`"}:
                continue
            else:
                dynamic = True
        counts.append("unknown" if dynamic and definite == 0 else definite)
    return counts

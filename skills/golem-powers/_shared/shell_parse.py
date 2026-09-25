"""Shared shell parser for golems PreToolUse hooks (GO-5 S13).

Moved verbatim from tmp-block/hooks/tmp-block-pretooluse.py (the tokenizer,
heredoc stripping, `$()`/backtick substitution, command-position flags and
alias/function body expansion) and from git-guardian/git_safety.py (its
file-write heredoc stripping and backtick bodies, in the last section).
Hooks keep POLICY; this module only answers "what does Bash execute here".
Importers: tmp-block, git-guardian (and, through git_safety, pre_tool_use.py).

AIDEV-NOTE: a pure move. Behaviour is pinned by the tmp-block and
git-guardian suites; change parsing here, never re-fork it into a hook.
"""

from __future__ import annotations

import ast
import os
import re
import shlex
from fnmatch import fnmatchcase


# Shell env-assignment token (`FOO=bar`) — used to find the assignment prefix
# of each simple command for the per-segment inline escape hatch.
_ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


# Raw-line tokenizers for case arms and `for ... in` word lists. A double-quoted
# token consumes a backslash only as an escape pair (\\[\s\S], which includes
# backslash-newline), so there is exactly one way to match it: no exponential
# backtracking on an unclosed quote (CodeQL py/redos #3/#4).
_RAW_SHELL_TOKEN_RE = re.compile(
    r"'[^']*'|\"(?:\\[\s\S]|[^\"\\])*\"|;;&|;&|;;|\|\||&&|[;|&()]|[^\s;|&()]+"
)


_RAW_FOR_WORD_RE = re.compile(r"'[^']*'|\"(?:\\[\s\S]|[^\"\\])*\"|\S+")


# Heredoc start operator (not `<<<` herestring). The complete delimiter word
# is parsed separately because Bash permits partially quoted forms (`<<E'OF'`).
_HEREDOC_START_RE = re.compile(r"(?<!<)<<(?!<)(-?)\s*")


# Preserve whether a brace was shell-quoted. Unquoted `{a,b}` is a bounded
# expansion; quoted braces are literal filename characters and retain the
# guard's conservative REFUSE behavior.
_QUOTED_LBRACE = "\ue000"


_QUOTED_RBRACE = "\ue001"


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


def _mask_heredoc_body_lines(command):
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
    return "".join(out)


def _heredoc_delimiter_word(line, start):
    """Return Bash quote-removed heredoc delimiter and whether it was quoted."""
    out = []
    quote = None
    quoted = False
    i = start
    while i < len(line):
        char = line[i]
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
    return (delimiter, quoted) if delimiter else None


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


def _is_command_sub_open(token):
    """True for the synthetic opener of `$()` or legacy backticks."""
    return token.endswith("$(") or token.endswith("`(")


def _is_command_sub_close(token):
    return token.startswith(")$") or token.startswith(")`")


def _command_sub_word_continues(token):
    return token in (")$+", ")`+")


def _dollar_substitution(command, start):
    """Return (`body`, index_after_close) for `$(` at `start`, or None."""
    depth = 1
    parameter_depth = 0
    case_states = []
    case_pattern_started = []
    case_pattern_depths = []
    at_command_start = True
    quote = None
    i = start + 2
    while i < len(command):
        char = command[i]
        if char == "\\":
            i += 2
            continue
        if quote == "'":
            if char == "'":
                quote = None
            i += 1
            continue
        if quote == '"':
            if char == '"':
                quote = None
                i += 1
                continue
            if command.startswith("$(", i) and not command.startswith("$((", i):
                nested = _dollar_substitution(command, i)
                if nested is None:
                    return None
                _body, i = nested
                continue
            i += 1
            continue
        if char.isspace():
            if char == "\n":
                at_command_start = True
            i += 1
            continue
        if char in "\"'":
            quote = char
            at_command_start = False
            i += 1
            continue
        if command.startswith("${", i):
            parameter_depth += 1
            i += 2
            continue
        if parameter_depth and char == "}":
            parameter_depth -= 1
            i += 1
            continue
        if command.startswith("$(", i):
            nested = _dollar_substitution(command, i)
            if nested is None:
                return None
            _body, i = nested
            continue
        if parameter_depth:
            i += 1
            continue
        if char == "#" and (
            i == 0
            or command[i - 1].isspace()
            or command[i - 1] in ";|&()"
        ):
            newline = command.find("\n", i)
            i = len(command) if newline < 0 else newline + 1
            at_command_start = True
            continue
        if command.startswith("<<", i) and not command.startswith("<<<", i):
            after_bodies = _after_heredoc_bodies(command, i)
            if after_bodies is not None:
                i = after_bodies
                continue
        if char.isalpha() or char == "_":
            end = i + 1
            while end < len(command) and (
                command[end].isalnum() or command[end] == "_"
            ):
                end += 1
            word = command[i:end]
            if word == "case" and at_command_start:
                case_states.append("await-in")
                case_pattern_started.append(False)
                case_pattern_depths.append(0)
            elif case_states and case_states[-1] == "await-in" and word == "in":
                case_states[-1] = "pattern"
                case_pattern_started[-1] = False
                case_pattern_depths[-1] = 0
            elif (
                case_states
                and word == "esac"
                and (
                    (case_states[-1] == "body" and at_command_start)
                    or (
                        case_states[-1] == "pattern"
                        and not case_pattern_started[-1]
                    )
                )
            ):
                case_states.pop()
                case_pattern_started.pop()
                case_pattern_depths.pop()
            elif case_states and case_states[-1] == "pattern":
                case_pattern_started[-1] = True
            if word in {
                "if",
                "then",
                "elif",
                "else",
                "while",
                "until",
                "do",
            }:
                at_command_start = True
            else:
                at_command_start = False
            i = end
            continue
        case_terminator = next(
            (
                marker
                for marker in (";;&", ";;", ";&")
                if command.startswith(marker, i)
            ),
            None,
        )
        if case_states and case_states[-1] == "body" and case_terminator:
            case_states[-1] = "pattern"
            case_pattern_started[-1] = False
            case_pattern_depths[-1] = 0
            at_command_start = False
            i += len(case_terminator)
            continue
        if char in ";|&":
            at_command_start = True
            i += 1
            continue
        if char == "(":
            if case_states and case_states[-1] == "pattern":
                if case_pattern_started[-1]:
                    case_pattern_depths[-1] += 1
                else:
                    case_pattern_started[-1] = True
                i += 1
                continue
            depth += 1
        elif char == ")":
            if case_states and case_states[-1] == "pattern":
                if case_pattern_depths[-1]:
                    case_pattern_depths[-1] -= 1
                    i += 1
                    continue
                case_states[-1] = "body"
                at_command_start = True
                i += 1
                continue
            depth -= 1
            if depth == 0:
                return command[start + 2:i], i + 1
        elif not char.isspace():
            if case_states and case_states[-1] == "pattern":
                case_pattern_started[-1] = True
            at_command_start = False
        i += 1
    return None


def _backtick_substitution(command, start):
    """Return (`body`, index_after_close) for a legacy backtick command."""
    i = start + 1
    while i < len(command):
        if command[i] == "\\" and i + 1 < len(command):
            i += 2
            continue
        if command[i] == "`":
            # Within a legacy backtick body, `\`` represents a nested
            # backtick delimiter. Normalize it before recursively scanning.
            body = command[start + 1:i].replace("\\`", "`")
            return body, i + 1
        i += 1
    return None


def _executable_subcommands(command):
    """Extract executable `$()`/backtick bodies, including quoted contexts.

    The primary tokenizer preserves parent-shell word/cwd semantics. This
    recursive view covers the contexts intentionally opaque to that tokenizer
    (double quotes and arithmetic) without treating ordinary arithmetic words
    as commands. Single quotes remain literal.
    """
    bodies = []
    in_double = False
    at_boundary = True
    parameter_quote_states = []
    substitution_index = 0
    arithmetic_depth = 0
    i = 0
    while i < len(command):
        char = command[i]
        if char == "\\":
            at_boundary = False
            i += 2
            continue
        if (
            not in_double
            and char == "#"
            and at_boundary
            and not parameter_quote_states
        ):
            while i < len(command) and command[i] != "\n":
                i += 1
            continue
        if not in_double and char == "'":
            end = command.find("'", i + 1)
            i = len(command) if end < 0 else end + 1
            at_boundary = False
            continue
        if char == '"':
            in_double = not in_double
            at_boundary = False
            i += 1
            continue
        if command.startswith("${", i):
            parameter_quote_states.append(in_double)
            at_boundary = False
            i += 2
            continue
        if (
            char == "}"
            and parameter_quote_states
            and in_double == parameter_quote_states[-1]
        ):
            parameter_quote_states.pop()
            at_boundary = False
            i += 1
            continue
        if command.startswith("$((", i):
            arithmetic_depth += 2
            at_boundary = False
            i += 3
            continue
        if command.startswith("$(", i) and not command.startswith("$((", i):
            start = i
            exposed_to_primary = not in_double and arithmetic_depth == 0
            found = _dollar_substitution(command, i)
            if found is None:
                i += 2
                continue
            body, i = found
            bodies.append(
                (
                    body,
                    _segment_for_offset(command, start),
                    substitution_index,
                    exposed_to_primary,
                )
            )
            substitution_index += 1
            at_boundary = False
            continue
        if char == "`":
            start = i
            exposed_to_primary = not in_double and arithmetic_depth == 0
            found = _backtick_substitution(command, i)
            if found is None:
                i += 1
                continue
            body, i = found
            bodies.append(
                (
                    body,
                    _segment_for_offset(command, start),
                    substitution_index,
                    exposed_to_primary,
                )
            )
            substitution_index += 1
            at_boundary = False
            continue
        if arithmetic_depth and char == "(":
            arithmetic_depth += 1
            at_boundary = False
            i += 1
            continue
        if arithmetic_depth and char == ")":
            arithmetic_depth -= 1
            at_boundary = False
            i += 1
            continue
        if not in_double and char in ";|&\n":
            at_boundary = True
        elif char.isspace():
            at_boundary = True
        else:
            at_boundary = False
        i += 1
    return bodies


def _shell_command_payloads(tokens, cmd_pos, seg_of):
    """Yield quoted command strings executed by shell `-c` wrappers."""
    shells = {"bash", "sh", "zsh", "dash", "ksh"}
    payloads = []
    payload_index = 0
    for index, token in enumerate(tokens):
        if not cmd_pos[index] or os.path.basename(token).lower() not in shells:
            continue
        segment = seg_of[index]
        cursor = index + 1
        while cursor < len(tokens) and seg_of[cursor] == segment:
            option = tokens[cursor]
            if option == "--":
                break
            carries_command = option == "--command" or (
                option.startswith("-")
                and not option.startswith("--")
                and "c" in option[1:]
            )
            if carries_command and cursor + 1 < len(tokens):
                payloads.append(
                    (tokens[cursor + 1], segment, payload_index)
                )
                payload_index += 1
                break
            cursor += 1
    return payloads


def _segment_for_offset(command, offset):
    """Parser-compatible outer simple-command segment at a source offset."""
    tokens = _shell_tokens(_strip_heredoc_bodies(command[:offset]))
    return sum(1 for i in range(len(tokens)) if _is_separator(tokens, i))


def _nested_segment(outer, substitution_index, child, exposed=True):
    """Compose a stable recursive simple-command segment path."""
    prefix = (outer, ("sub", substitution_index, exposed))
    if isinstance(child, tuple):
        return (*prefix, *child)
    return (*prefix, child)


def _nested_alias_segment(outer, alias_index, child):
    """Compose an alias-expansion identity distinct from `$()` identities."""
    prefix = (outer, ("alias", alias_index))
    if isinstance(child, tuple):
        return (*prefix, *child)
    return (*prefix, child)


def _segment_is_fully_exposed(segment):
    """True when every recursive boundary was visible to the primary lexer."""
    if not isinstance(segment, tuple):
        return True
    markers = [
        part
        for part in segment
        if isinstance(part, tuple) and part and part[0] == "sub"
    ]
    return all(len(marker) > 2 and marker[2] for marker in markers)


def _segment_is_prefix(prefix, segment):
    """True when `prefix` is an ancestor identity of `segment`."""
    prefix_parts = prefix if isinstance(prefix, tuple) else (prefix,)
    segment_parts = segment if isinstance(segment, tuple) else (segment,)
    return segment_parts[:len(prefix_parts)] == prefix_parts


def _shell_tokens(command):
    """Quote-aware tokenizer. Quoted content merges into the surrounding token
    (so `echo "x > /tmp/y"` carries no redirect), while >, >>, parens and
    statement separators become standalone tokens even when glued
    (`>/tmp/x`, `2>>f`, `>(tee ...)`). `#` at a token boundary starts a
    comment (dropped to end-of-line, Bugbot b5f80501)."""
    tokens = []
    cur = ""
    i = 0
    n = len(command)
    paren_stack = []

    def flush():
        nonlocal cur
        if cur:
            tokens.append(cur)
            cur = ""

    def suffix_emits_token(start):
        """Whether the rest of this shell word contributes a token.

        Empty quotes continue a word in Bash but add no characters. Treating
        them as a token-bearing suffix would make the scanner consume the next
        whitespace-separated argument as if it belonged to `$(...)''`.
        """
        j = start
        while j < n:
            char = command[j]
            if char.isspace() or char in ";|()<> &":
                return False
            if char == "$" and j + 1 < n and command[j + 1] in "\"'":
                # ANSI-C / locale quote prefix: `$''` and `$""` emit no
                # characters, just like their unprefixed empty forms.
                j += 1
                char = command[j]
            if char in "\"'":
                quote = char
                j += 1
                emitted = False
                while j < n and command[j] != quote:
                    emitted = True
                    if quote == '"' and command[j] == "\\" and j + 1 < n:
                        j += 2
                    else:
                        j += 1
                if emitted:
                    return True
                if j < n:
                    j += 1
                continue
            if char == "\\":
                return j + 1 < n
            return True
        return False

    while i < n:
        c = command[i]
        if command.startswith("$((", i):
            # Arithmetic expansion is data, not executable command scope.
            # Keep it opaque in the current word so dynamic-target handling
            # can REFUSE without misclassifying identifiers as commands.
            j = i + 3
            depth = 2
            while j < n and depth:
                if command[j] == "(":
                    depth += 1
                elif command[j] == ")":
                    depth -= 1
                j += 1
            cur += command[i:j]
            i = j
            continue
        if c == "$" and i + 1 < n and command[i + 1] == "(":
            # Command substitutions cannot change the parent shell's cwd.
            # Give their delimiters distinct tokens so anchor analysis can
            # ignore them without hiding executable inner writes from either
            # guard. Dynamic cd/worktree arguments still carry the literal
            # `$(` token and are rejected by resolve_target().
            cur += "$("
            flush()
            paren_stack.append("command-substitution")
            i += 2
            continue
        if c == "`":
            if paren_stack and paren_stack[-1] == "backtick":
                flush()
                paren_stack.pop()
                tokens.append(")`+" if suffix_emits_token(i + 1) else ")`")
            else:
                cur += "`("
                flush()
                paren_stack.append("backtick")
            i += 1
            continue
        if c in "\"'":
            # ANSI-C / locale quoting (`$'/tmp/x'`, `$"..."`) produces the
            # inner string — drop the `$` sigil so the target normalizes to
            # the path Bash actually writes (Codex P1 round 9).
            if cur.endswith("$"):
                cur = cur[:-1]
            quote = c
            i += 1
            buf = ""
            while i < n:
                if quote == '"' and command[i] == "\\" and i + 1 < n:
                    buf += command[i + 1]
                    i += 2
                    continue
                if command[i] == quote:
                    i += 1
                    break
                buf += command[i]
                i += 1
            if "{" in buf or "}" in buf:
                if quote == "'":
                    buf = buf.replace("{", _QUOTED_LBRACE).replace(
                        "}", _QUOTED_RBRACE
                    )
                else:
                    marked = []
                    quoted_index = 0
                    parameter_depth = 0
                    while quoted_index < len(buf):
                        if buf.startswith("${", quoted_index):
                            parameter_depth += 1
                            marked.append("${")
                            quoted_index += 2
                            continue
                        char = buf[quoted_index]
                        if char == "}" and parameter_depth:
                            parameter_depth -= 1
                            marked.append(char)
                        elif char == "{" and not parameter_depth:
                            marked.append(_QUOTED_LBRACE)
                        elif char == "}" and not parameter_depth:
                            marked.append(_QUOTED_RBRACE)
                        else:
                            marked.append(char)
                        quoted_index += 1
                    buf = "".join(marked)
            cur += buf
            continue
        if c == "\\":
            if i + 1 < n:
                cur += command[i + 1]
            i += 2
            continue
        if c == "\n":
            # A newline terminates the simple command like `;` (Codex P1
            # round 5) — segment-scoped hatch logic depends on this.
            flush()
            tokens.append(";")
            i += 1
            continue
        if c.isspace():
            flush()
            i += 1
            continue
        if c == "#" and cur == "":
            # Comment at a token boundary — drop to end of line.
            while i < n and command[i] != "\n":
                i += 1
            continue
        if c in ";|()":
            flush()
            if c == "(":
                paren_stack.append("group")
                tokens.append(c)
            elif c == ")" and paren_stack:
                kind = paren_stack.pop()
                if kind == "command-substitution":
                    continues_word = suffix_emits_token(i + 1)
                    tokens.append(")$+" if continues_word else ")$")
                else:
                    tokens.append(c)
            else:
                tokens.append(c)
            i += 1
            continue
        if c == "<":
            # Input redirect / heredoc operator — never a write target.
            flush()
            j = i
            while j < n and command[j] in "<-":
                j += 1
            tokens.append(command[i:j])
            i = j
            continue
        if c == ">":
            # `2>` / `1>` fd prefixes: drop a pure-digit cur (it is the fd).
            if cur.isdigit():
                cur = ""
            flush()
            op = ">"
            if i + 1 < n and command[i + 1] == ">":
                op = ">>"
                i += 1
            if i + 1 < n and command[i + 1] == "|":
                # `>|` noclobber-override (Codex P1) and the `>>|` shape
                # (Bugbot 4749534e — invalid bash, but bind the path, not `|`).
                i += 1
            tokens.append(op)
            i += 1
            continue
        if c == "&":
            if i + 1 < n and command[i + 1] == ">":
                # `&>` / `&>>` / `&>|` — redirect all output.
                flush()
                op = ">"
                j = i + 2
                if j < n and command[j] == ">":
                    op = ">>"
                    j += 1
                if j < n and command[j] == "|":
                    # `&>|` (Macroscope) / `&>>|` (Bugbot 4749534e) variants.
                    j += 1
                tokens.append(op)
                i = j
                continue
            flush()
            tokens.append("&")
            i += 1
            continue
        cur += c
        i += 1
    flush()
    return tokens


def _is_separator(tokens, i):
    """True if tokens[i] separates simple commands. `&` directly after a
    redirect op is an fd-dup marker (`2>&1`), not a separator."""
    tok = tokens[i]
    if tok in (";", "|"):
        return True
    if tok == "&":
        return i == 0 or tokens[i - 1] not in (">", ">>")
    return False


# Wrapper commands after which the next word is still the executed command —
# `sudo tee /tmp/x` must not demote tee to argument position.
_WRAPPER_CMDS = {
    "sudo", "command", "exec", "nohup", "env", "nice", "time",
    "xargs", "stdbuf", "caffeinate",
}


# These wrappers execute an external command without Bash function lookup.
_FUNCTION_LOOKUP_SUPPRESSORS = {
    "command", "exec", "env", "sudo", "nohup", "nice", "xargs",
    "stdbuf", "caffeinate",
}


_UNRESOLVED_EVAL_MARKER = "__TMP_BLOCK_UNRESOLVED_DYNAMIC_EVAL__"


def _shell_integer_arithmetic(expression):
    """Evaluate a restricted integer subset of Bash arithmetic syntax."""
    try:
        tree = ast.parse(expression.replace(" ", ""), mode="eval")
    except (SyntaxError, ValueError):
        return None

    def evaluate(node):
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if isinstance(node, ast.Constant) and type(node.value) is int:
            return node.value
        if isinstance(node, ast.UnaryOp):
            value = evaluate(node.operand)
            if isinstance(node.op, ast.UAdd):
                return value
            if isinstance(node.op, ast.USub):
                return -value
            if isinstance(node.op, ast.Invert):
                return ~value
        if isinstance(node, ast.BinOp):
            left = evaluate(node.left)
            right = evaluate(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, (ast.Div, ast.FloorDiv)):
                return int(left / right)
            if isinstance(node.op, ast.Mod):
                return left % right
            if isinstance(node.op, ast.LShift):
                return left << right
            if isinstance(node.op, ast.RShift):
                return left >> right
            if isinstance(node.op, ast.BitAnd):
                return left & right
            if isinstance(node.op, ast.BitOr):
                return left | right
            if isinstance(node.op, ast.BitXor):
                return left ^ right
        raise ValueError("unsupported arithmetic expression")

    try:
        return evaluate(tree)
    except (ArithmeticError, ValueError, TypeError):
        return None


# Wrapper options that consume the FOLLOWING token as a value (`env -u FOO
# tee`, `sudo -u root tee`, `nice -n 10 tee` — Codex P1 round 9): the value
# is not the command word.
_WRAPPER_VALUE_OPTS = {
    "-u", "--unset", "-C", "--chdir", "-g", "--group",
    "-S", "--split-string", "-n", "--adjustment", "-o", "-e", "--output",
}


def _command_position_flags(tokens):
    """flags[i] is True iff tokens[i] sits in COMMAND position (first word of
    a simple command, allowing assignment/wrapper prefixes). `echo tee
    /tmp/x` passes a word, it does not run tee (Codex P2 round 6)."""
    flags = [False] * len(tokens)
    expecting = True
    pending_redirect = False
    pending_value = False
    substitution_expectations = []
    case_states = []
    skip_case_separators = 0
    coproc_pending = False
    for i, tok in enumerate(tokens):
        if skip_case_separators:
            skip_case_separators -= 1
            continue
        if pending_redirect:
            pending_redirect = False
            if tok == "(":
                # `>(...)` process substitution — its body runs commands
                # (Macroscope round 9: `echo >(tee /tmp/x)`).
                expecting = True
            elif _is_command_sub_open(tok):
                # A command substitution can itself supply the redirect
                # target (`echo >$(tee /tmp/x)`). The opener is an operand,
                # but its child body is executable command scope.
                substitution_expectations.append(expecting)
                expecting = True
                pending_value = False
            # Otherwise: redirect target, never a command word.
            continue
        if tok in (">", ">>"):
            pending_redirect = True
            continue
        if _is_command_sub_open(tok):
            prefix = tok[:-2]
            outer_expecting = expecting
            if prefix:
                flags[i] = expecting
                if expecting:
                    base = prefix.rsplit("/", 1)[-1]
                    if not (
                        _ASSIGNMENT_RE.match(prefix)
                        or base in _WRAPPER_CMDS
                        or prefix.startswith("-")
                    ):
                        outer_expecting = False
            substitution_expectations.append(outer_expecting)
            expecting = True
            pending_value = False
            continue
        if _is_command_sub_close(tok):
            expecting = substitution_expectations.pop() if substitution_expectations else False
            pending_value = False
            continue
        if coproc_pending:
            coproc_pending = False
            if (
                re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tok)
                and i + 1 < len(tokens)
                and tokens[i + 1] == "{"
            ):
                expecting = True
                continue
            # Otherwise this token is the unnamed coprocess command; let it
            # fall through to normal command-position handling.
        if expecting and tok == "coproc":
            coproc_pending = True
            pending_value = False
            continue
        if expecting and tok in {
            "if",
            "then",
            "elif",
            "else",
            "while",
            "until",
            "do",
            "!",
            "{",
        }:
            # Reserved words introduce a condition/body command rather than
            # consuming command position themselves.
            pending_value = False
            continue
        if case_states and case_states[-1] == "await-in":
            if tok == "in":
                case_states[-1] = "pattern"
            expecting = False
            continue
        if case_states and case_states[-1] == "pattern":
            if tok == ")":
                case_states[-1] = "body"
                expecting = True
            elif tok == "esac":
                case_states.pop()
                expecting = False
            continue
        if (
            case_states
            and case_states[-1] == "body"
            and tok == ";"
        ):
            terminator_width = 0
            if tokens[i + 1:i + 3] in ([";", "&"],):
                terminator_width = 2
            elif tokens[i + 1:i + 2] in ([";"], ["&"]):
                terminator_width = 1
            if terminator_width:
                case_states[-1] = "pattern"
                expecting = False
                skip_case_separators = terminator_width
                continue
        if _is_separator(tokens, i) or tok == "(":
            expecting = True
            pending_value = False
            continue
        if tok == ")":
            expecting = False
            pending_value = False
            continue
        if expecting and pending_value:
            # Value of a wrapper option (`env -u FOO tee`) — not the command.
            pending_value = False
            continue
        flags[i] = expecting
        if expecting:
            base = tok.rsplit("/", 1)[-1]
            if tok == "case":
                case_states.append("await-in")
                expecting = False
                continue
            if _ASSIGNMENT_RE.match(tok) or base in _WRAPPER_CMDS:
                flags[i] = expecting
                continue  # prefix word — command position stays open
            if tok.startswith("-"):
                # Wrapper option (`env -i tee`, Codex P1 round 7); some
                # consume the next token as a value (round 9).
                if tok in _WRAPPER_VALUE_OPTS:
                    pending_value = True
                continue
        expecting = False
    # Function definitions are inert until invoked. Re-scan only the body of
    # the latest definition that exists at an invocation's execution point.
    definitions = []
    i = 0
    while i + 3 < len(tokens):
        name_idx = i
        body_open = None
        if (
            re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tokens[i])
            and tokens[i + 1:i + 4] == ["(", ")", "{"]
        ):
            body_open = i + 3
        elif tokens[i] == "function" and i + 2 < len(tokens):
            name_idx = i + 1
            if tokens[i + 2] == "{":
                body_open = i + 2
            elif tokens[i + 2:i + 5] == ["(", ")", "{"]:
                body_open = i + 4
        if body_open is None:
            i += 1
            continue
        depth = 1
        close = body_open + 1
        while close < len(tokens) and depth:
            if tokens[close] == "{":
                depth += 1
            elif tokens[close] == "}":
                depth -= 1
            close += 1
        if depth:
            i += 1
            continue
        definitions.append((tokens[name_idx], name_idx, body_open + 1, close - 1))
        i = close
    for _name, name_idx, body_start, body_end in definitions:
        flags[name_idx] = False
        for body_index in range(body_start, body_end):
            flags[body_index] = False
    definitions_by_name = {}
    for definition in definitions:
        definitions_by_name.setdefault(definition[0], []).append(definition)

    def definition_at(name, execution_index):
        eligible = [
            definition
            for definition in definitions_by_name.get(name, ())
            if definition[3] < execution_index
        ]
        return eligible[-1] if eligible else None

    queue = []
    for j, token in enumerate(tokens):
        if flags[j] and token in definitions_by_name:
            definition = definition_at(token, j)
            if definition is not None:
                queue.append((definition, j))
    activated = set()
    while queue:
        definition, execution_index = queue.pop()
        name, name_idx, body_start, body_end = definition
        activation = (name_idx, execution_index)
        if activation in activated:
            continue
        activated.add(activation)
        body_flags = _command_position_flags(tokens[body_start:body_end])
        for offset, active in enumerate(body_flags, start=body_start):
            if not active:
                continue
            flags[offset] = True
            callee = tokens[offset]
            callee_definition = definition_at(callee, execution_index)
            if callee_definition is not None:
                queue.append((callee_definition, execution_index))
    return flags


def _parse_bash(command):
    """Tokenize once and derive the position maps both rules need:
    command flags, simple-command segments, and command-substitution scopes.
    Heredoc BODIES are stripped and quoted text merges into its token, so
    neither rule can fire on prose (golems#676 second manifestation: the guard
    blocked the `gh issue create` that FILED the bug, because the title carried
    the pattern as text)."""
    tokens = _shell_tokens(_strip_heredoc_bodies(command))
    cmd_pos = _command_position_flags(tokens)
    seg_of = []
    seg = 0
    for i in range(len(tokens)):
        seg_of.append(seg)
        if _is_separator(tokens, i):
            seg += 1
    scope_of = []
    scope_stack = []
    next_scope = 0
    for tok in tokens:
        if _is_command_sub_open(tok):
            scope_of.append(tuple(scope_stack))
            next_scope += 1
            scope_stack.append(next_scope)
            continue
        scope_of.append(tuple(scope_stack))
        if _is_command_sub_close(tok) and scope_stack:
            scope_stack.pop()
    return tokens, cmd_pos, seg_of, scope_of


def _invoked_alias_bodies(command, _initial_state=None):
    """Return alias bodies expanded on later lines when Bash enables them."""
    if _initial_state is None:
        enabled = False
        nocasematch = False
        aliases = {}
        function_bodies = {}
        expanded_function_bodies = {}
    else:
        enabled, initial_aliases, initial_functions, initial_expanded = (
            _initial_state[:4]
        )
        nocasematch = _initial_state[4] if len(_initial_state) > 4 else False
        aliases = dict(initial_aliases)
        function_bodies = dict(initial_functions)
        expanded_function_bodies = dict(initial_expanded)
    invoked = []
    offset = 0
    invocation_index = 0
    unit_nocasematch = nocasematch
    command_vars = {}

    def expand_function(
        body,
        seen=None,
        bodies=None,
        expanded_bodies=None,
    ):
        seen = set() if seen is None else seen
        bodies = function_bodies if bodies is None else bodies
        expanded_bodies = (
            expanded_function_bodies
            if expanded_bodies is None
            else expanded_bodies
        )
        body_tokens, body_flags, body_segs, _body_scopes = _parse_bash(body)
        expanded = []
        changed = False
        consumed_arguments = set()
        for i, token in enumerate(body_tokens):
            if i in consumed_arguments:
                continue
            segment_commands = [
                body_tokens[j]
                for j in range(i)
                if body_segs[j] == body_segs[i] and body_flags[j]
            ]
            lookup_suppressed = (
                bool(segment_commands)
                and os.path.basename(segment_commands[0])
                in _FUNCTION_LOOKUP_SUPPRESSORS
            )
            if (
                body_flags[i]
                and token in bodies
                and token not in seen
                and not lookup_suppressed
            ):
                target_body = expanded_bodies.get(token, bodies[token])
                invocation_arguments = [
                    body_tokens[j]
                    for j in range(i + 1, len(body_tokens))
                    if body_segs[j] == body_segs[i]
                ]
                consumed_arguments.update(
                    j
                    for j in range(i + 1, len(body_tokens))
                    if body_segs[j] == body_segs[i]
                )
                target_body = expand_function_arguments(
                    target_body,
                    invocation_arguments,
                )
                expanded.append(
                    expand_function(
                        target_body,
                        seen | {token},
                        bodies,
                        expanded_bodies,
                    )
                )
                changed = True
            else:
                expanded.append(token)
        return " ".join(expanded) if changed else body

    def expand_function_arguments(body, arguments):
        """Substitute statically known invocation arguments in a body.

        This preserves forwarded eval payloads such as `eval "$@"` for the
        recursive scan. Ordinary positional write targets stay unresolved so
        they retain the guard's existing REFUSE behavior.
        """
        joined = " ".join(arguments)
        static_variables = {}

        def positional(match):
            index = int(match.group(1) or match.group(2))
            return arguments[index - 1] if index <= len(arguments) else ""

        def parameter_operator(value, is_set, operator, word):
            colon = operator.startswith(":")
            operation = operator[-1]
            missing = not is_set or (colon and value == "")
            if operation == "-":
                return word if missing else value
            if operation == "+":
                return "" if missing else word
            if operation == "?":
                return "" if missing else value
            return value

        def positional_operator(match):
            position = int(match.group(1))
            is_set = position <= len(arguments)
            value = arguments[position - 1] if is_set else ""
            return parameter_operator(
                value,
                is_set,
                match.group(2),
                match.group(3),
            )

        def indirect_positional(match):
            position = int(match.group(1))
            if position > len(arguments):
                return ""
            return os.environ.get(arguments[position - 1], "")

        def positional_slice(match):
            offset = _shell_integer_arithmetic(match.group(2))
            if offset is None:
                return joined
            start = offset - 1 if offset > 0 else len(arguments) + offset
            selected = arguments[max(0, start):]
            if match.group(3) is not None:
                length = _shell_integer_arithmetic(match.group(3))
                if length is None:
                    return joined
                if length < 0:
                    return ""
                selected = selected[:length]
            return " ".join(selected)

        parts = re.split(r"([;|&\n]+)", body)
        for index in range(0, len(parts), 2):
            segment_tokens, segment_cmd_pos, _segments, _scopes = _parse_bash(
                parts[index]
            )

            def resolved_word(word):
                variable = re.fullmatch(
                    r"\$([A-Za-z_][A-Za-z0-9_]*)",
                    word,
                )
                if variable:
                    return static_variables.get(variable.group(1), word)
                return word

            resolved_commands = [
                resolved_word(token)
                for token_index, token in enumerate(segment_tokens)
                if segment_cmd_pos[token_index]
            ]
            invokes_eval = "eval" in resolved_commands
            if invokes_eval:
                for variable_name, value in static_variables.items():
                    if value == "eval":
                        parts[index] = re.sub(
                            rf"\${re.escape(variable_name)}\b",
                            "eval",
                            parts[index],
                        )
                parts[index] = re.sub(
                    r"\$\{!([1-9][0-9]*)\}",
                    indirect_positional,
                    parts[index],
                )
                parts[index] = re.sub(
                    r"\$\{([1-9][0-9]*)(:?[-+?])([^}]*)\}",
                    positional_operator,
                    parts[index],
                )
                parts[index] = re.sub(
                    r"\$\{([@*]):([^}:]+)(?::([^}]+))?\}",
                    positional_slice,
                    parts[index],
                )
                parts[index] = re.sub(
                    r"\$(?:@|\*)|\$\{(?:@|\*)\}",
                    joined,
                    parts[index],
                )
                parts[index] = re.sub(
                    r"\$([1-9])|\$\{([1-9][0-9]*)\}",
                    positional,
                    parts[index],
                )
                parts[index] = re.sub(
                    r"\$\{(?:!?[1-9][0-9]*|[@*])[^}]*\}",
                    lambda match: f"{joined} {match.group(0)[2:-1]}",
                    parts[index],
                )
            assignments = []
            if segment_tokens and all(
                _ASSIGNMENT_RE.match(token) for token in segment_tokens
            ):
                assignments = segment_tokens
            elif (
                segment_tokens
                and os.path.basename(resolved_word(segment_tokens[0]))
                in {"local", "declare", "typeset", "export", "readonly"}
            ):
                assignments = [
                    token
                    for token in segment_tokens[1:]
                    if _ASSIGNMENT_RE.match(token)
                ]
            if assignments:
                for assignment in assignments:
                    name, value = assignment.split("=", 1)
                    if any(marker in value for marker in ("$", "`", "~")):
                        static_variables.pop(name, None)
                    else:
                        static_variables[name] = value
        return "".join(parts)

    def expand_alias(name, seen=None):
        seen = set() if seen is None else seen
        if name in seen:
            return aliases[name]
        seen.add(name)
        body = aliases[name]
        body_tokens, body_flags, _body_segs, _body_scopes = _parse_bash(body)
        expanded = []
        changed = False
        for i, token in enumerate(body_tokens):
            if body_flags[i] and token in aliases and token not in seen:
                expanded.append(expand_alias(token, seen.copy()))
                changed = True
            else:
                expanded.append(token)
        if not changed:
            return body
        result = " ".join(expanded)
        if body.endswith((" ", "\t")):
            result += body[-1]
        return result

    def expand_alias_commands(body):
        body_tokens, body_flags, _body_segs, _body_scopes = _parse_bash(body)
        expanded = [
            (
                expand_alias(token)
                if body_flags[i] and token in aliases
                else token
            )
            for i, token in enumerate(body_tokens)
        ]
        changed = any(
            body_flags[i] and token in aliases
            for i, token in enumerate(body_tokens)
        )
        return " ".join(expanded) if changed else body

    function_name_pattern = r"[A-Za-z_][A-Za-z0-9_]*"
    function_signature = (
        rf"(?:function\s+{function_name_pattern}(?:\s*\(\s*\))?"
        rf"|{function_name_pattern}\s*\(\s*\))"
    )
    function_open_re = re.compile(
        rf"(?:^|[;|&\n])\s*(?P<signature>{function_signature})"
        rf"(?P<gap>\s*)(?P<brace>\{{)",
        re.MULTILINE,
    )
    function_pending_re = re.compile(
        rf"(?:^|[;|&\n])\s*{function_signature}\s*\Z",
        re.MULTILINE,
    )

    def structural_source(source):
        structural = list(source)
        quote = None
        comment = False
        i = 0
        while i < len(source):
            char = source[i]
            if char in "\r\n":
                comment = False
                i += 1
                continue
            if comment:
                structural[i] = " "
                i += 1
                continue
            if quote != "'" and source.startswith("$(", i):
                found = _dollar_substitution(source, i)
                end = found[1] if found is not None else len(source)
                for nested_index in range(i, end):
                    if source[nested_index] not in "\r\n":
                        structural[nested_index] = " "
                i = end
                continue
            if quote != "'" and char == "`":
                found = _backtick_substitution(source, i)
                end = found[1] if found is not None else len(source)
                for nested_index in range(i, end):
                    if source[nested_index] not in "\r\n":
                        structural[nested_index] = " "
                i = end
                continue
            if quote is not None:
                if char == quote:
                    quote = None
                else:
                    structural[i] = " "
                    if char == "\\" and quote == '"' and i + 1 < len(source):
                        i += 1
                        if source[i] not in "\r\n":
                            structural[i] = " "
                i += 1
                continue
            if char in "'\"":
                quote = char
            elif char == "#" and (
                i == 0 or source[i - 1].isspace() or source[i - 1] in ";|&()"
            ):
                comment = True
                structural[i] = " "
            elif char == "\\" and i + 1 < len(source):
                structural[i] = " "
                i += 1
                if source[i] in "\r\n":
                    structural[i] = " "
                else:
                    structural[i] = "_"
            i += 1
        return "".join(structural)

    def has_unclosed_function_definition(source):
        structural = structural_source(source)
        for match in function_open_re.finditer(structural):
            depth = 1
            for char in structural[match.end("brace"):]:
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        break
            if depth:
                return True
        return function_pending_re.search(structural) is not None

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

    def has_unclosed_compound_command(source):
        """Track multiline reserved-word compounds at command boundaries."""
        structural = structural_source(source)
        compacted = []
        i = 0
        while i < len(source):
            if source[i] == "\\" and i + 1 < len(source):
                if source[i + 1] == "\n":
                    i += 2
                    continue
                if (
                    source[i + 1] == "\r"
                    and i + 2 < len(source)
                    and source[i + 2] == "\n"
                ):
                    i += 3
                    continue
            compacted.append(structural[i])
            i += 1
        tokens = re.findall(
            r"\n|&&|\|\||;;&|;&|;;|[<>]\(|&>>|<<<|<<-|>>|<>|>\||>&|<&|&>|"
            r"[;|&()<>]|"
            r"(?:^|(?<=[\s;|&()<>]))\{(?=$|[\s;|&()<>])|"
            r"(?:^|(?<=[\s;|&()<>]))\}(?=$|[\s;|&()<>])|"
            r"'[^']*'|\"[^\"]*\"|[^\s;|&()<>]+",
            "".join(compacted),
        )
        expected_closers = []
        group_closers = []
        case_states = []
        at_command_start = True
        pending_redirect = False
        time_prefix_state = None
        coproc_pending = False
        for index, token in enumerate(tokens):
            if token in {"<(", ">("}:
                group_closers.append((")", False))
                at_command_start = True
                continue
            if token in {
                "<",
                ">",
                "<<",
                ">>",
                "<<<",
                "<<-",
                "<>",
                ">|",
                ">&",
                "<&",
                "&>",
                "&>>",
            }:
                pending_redirect = True
                continue
            if pending_redirect:
                pending_redirect = False
                if token not in {"\n", ";", "&&", "||", "|", "&"}:
                    at_command_start = False
                    continue
            if case_states and case_states[-1]["state"] == "await-in":
                if token == "in":
                    case_states[-1]["state"] = "pattern"
                at_command_start = False
                continue
            if case_states and case_states[-1]["state"] == "pattern":
                case_state = case_states[-1]
                if token == "esac" and not case_state["started"]:
                    case_states.pop()
                    if expected_closers and expected_closers[-1] == "esac":
                        expected_closers.pop()
                    at_command_start = False
                elif token == "(":
                    if case_state["started"]:
                        case_state["depth"] += 1
                    else:
                        case_state["started"] = True
                elif token == ")":
                    if case_state["depth"]:
                        case_state["depth"] -= 1
                    else:
                        case_state["state"] = "body"
                        at_command_start = True
                elif token not in {"\n", "|"}:
                    case_state["started"] = True
                continue
            if (
                case_states
                and case_states[-1]["state"] == "body"
                and token in {";;", ";&", ";;&"}
            ):
                case_states[-1].update(
                    state="pattern",
                    started=False,
                    depth=0,
                )
                at_command_start = False
                continue
            if token == "{":
                if at_command_start:
                    group_closers.append(("}", None))
                    at_command_start = True
                continue
            if token == "}":
                if group_closers and group_closers[-1][0] == "}":
                    group_closers.pop()
                at_command_start = False
                continue
            if token == "(":
                function_signature_paren = (
                    index > 0
                    and index + 1 < len(tokens)
                    and re.match(r"^[A-Za-z_]", tokens[index - 1])
                    and tokens[index + 1] == ")"
                )
                if not function_signature_paren:
                    group_closers.append((")", None))
                at_command_start = True
                continue
            if token == ")":
                function_signature_paren = (
                    index > 1
                    and tokens[index - 1] == "("
                    and re.match(r"^[A-Za-z_]", tokens[index - 2])
                )
                if (
                    not function_signature_paren
                    and group_closers
                    and group_closers[-1][0] == ")"
                ):
                    _closer, restore_command_start = group_closers.pop()
                    at_command_start = (
                        False
                        if restore_command_start is None
                        else restore_command_start
                    )
                else:
                    at_command_start = False
                continue
            if token in {"\n", ";", "&&", "||", "|", "&"}:
                at_command_start = True
                time_prefix_state = None
                coproc_pending = False
                continue
            if coproc_pending:
                coproc_pending = False
                if (
                    re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", token)
                    and index + 1 < len(tokens)
                    and tokens[index + 1]
                    in {
                        "{",
                        "(",
                        "if",
                        "case",
                        "while",
                        "until",
                        "for",
                        "select",
                    }
                ):
                    continue
            if at_command_start and token == "coproc":
                coproc_pending = True
                continue
            if at_command_start and token == "time":
                time_prefix_state = "options"
                continue
            if (
                at_command_start
                and time_prefix_state == "options"
                and token == "-p"
            ):
                time_prefix_state = "post-p"
                continue
            if (
                at_command_start
                and time_prefix_state in {"options", "post-p"}
                and token == "--"
            ):
                time_prefix_state = "command"
                continue
            if at_command_start and token == "!":
                time_prefix_state = None
                continue
            time_prefix_state = None
            if not re.match(r"^[A-Za-z_]", token):
                if at_command_start:
                    at_command_start = False
                continue
            if not at_command_start:
                continue
            if token == "if":
                expected_closers.append("fi")
                at_command_start = True
            elif token == "case":
                expected_closers.append("esac")
                case_states.append(
                    {"state": "await-in", "started": False, "depth": 0}
                )
                at_command_start = False
            elif token in {"while", "until", "for", "select"}:
                expected_closers.append("done")
                at_command_start = token in {"while", "until"}
            elif token in {"then", "elif", "else", "do"}:
                at_command_start = True
            elif expected_closers and token == expected_closers[-1]:
                expected_closers.pop()
                if token == "esac" and case_states:
                    case_states.pop()
                at_command_start = False
            else:
                at_command_start = False
        return bool(expected_closers or group_closers)

    def normalize_function_signature_braces(source):
        """Turn signature/newline/brace into whitespace without moving offsets."""
        structural = structural_source(source)
        normalized = list(source)
        for match in function_open_re.finditer(structural):
            gap_start, gap_end = match.span("gap")
            for i in range(gap_start, gap_end):
                if normalized[i] in "\\\r\n":
                    normalized[i] = " "
        return "".join(normalized)

    def mask_quoted_braces(source):
        masked = list(source)
        quote = None
        i = 0
        while i < len(source):
            char = source[i]
            if quote != "'" and source.startswith("$(", i):
                found = _dollar_substitution(source, i)
                if found is not None:
                    _body, end = found
                    for nested_index in range(i, end):
                        if masked[nested_index] in "{}":
                            masked[nested_index] = "_"
                    i = end
                    continue
            if quote != "'" and char == "`":
                found = _backtick_substitution(source, i)
                if found is not None:
                    _body, end = found
                    for nested_index in range(i, end):
                        if masked[nested_index] in "{}":
                            masked[nested_index] = "_"
                    i = end
                    continue
            if quote is not None:
                if char == quote:
                    quote = None
                elif char in "{}":
                    masked[i] = "_"
                elif char == "\\" and quote == '"' and i + 1 < len(source):
                    i += 1
                i += 1
                continue
            if char in "'\"":
                quote = char
            elif char == "\\" and i + 1 < len(source):
                i += 1
            i += 1
        return "".join(masked)

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
        for char in raw_pattern:
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
                if word.startswith("'") and word.endswith("'"):
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

    def active_compounds_execute(
        prefix_tokens,
        raw_case_groups=None,
        raw_for_counts=None,
        require_definite=False,
    ):
        """True when every currently open compound branch definitely runs."""
        def short_circuit_execution(status, operator):
            if status == "unknown" or status is None:
                return "unknown"
            return status is (operator == "&&")

        normalized_tokens = []
        token_index = 0
        while token_index < len(prefix_tokens):
            token = prefix_tokens[token_index]
            if (
                token == ";"
                and token_index + 2 < len(prefix_tokens)
                and prefix_tokens[token_index + 1:token_index + 3] == [";", "&"]
            ):
                normalized_tokens.append(";;&")
                token_index += 3
                continue
            if (
                token == ";"
                and token_index + 1 < len(prefix_tokens)
                and prefix_tokens[token_index + 1] == "&"
            ):
                normalized_tokens.append(";&")
                token_index += 2
                continue
            if (
                token in {";", "|", "&"}
                and token_index + 1 < len(prefix_tokens)
                and prefix_tokens[token_index + 1] == token
            ):
                normalized_tokens.append(token * 2)
                token_index += 2
                continue
            normalized_tokens.append(token)
            token_index += 1

        stack = []
        at_command_start = True
        top_status = None
        top_execute_next = True
        top_negate_next = False
        case_group_index = 0
        for_loop_index = 0
        static_vars = {}
        for normalized_index, token in enumerate(normalized_tokens):
            if (
                token in {";;", ";&", ";;&"}
                and stack
                and stack[-1]["kind"] == "case"
                and stack[-1]["branch"] == "body"
            ):
                if token == ";;&" and stack[-1]["selected"] is True:
                    stack[-1]["any_taken"] = False
                stack[-1].update(
                    branch="pattern",
                    pattern=None,
                    fallthrough_next=(token == ";&" and stack[-1]["selected"]),
                    selected=False,
                    body_status=None,
                    body_execute_next=True,
                    body_negate_next=False,
                )
                at_command_start = False
                continue
            if (
                token == "|"
                and stack
                and stack[-1]["kind"] == "case"
                and stack[-1]["branch"] == "pattern"
            ):
                continue
            if token in {"\n", ";", "&&", "||", "|", "&"}:
                if (
                    stack
                    and stack[-1]["kind"] == "if"
                    and stack[-1]["branch"] == "condition"
                ):
                    current = stack[-1]["condition"]
                    if token in {"&&", "||"}:
                        stack[-1]["execute_next"] = short_circuit_execution(
                            current, token
                        )
                    else:
                        stack[-1]["execute_next"] = True
                    stack[-1]["negate_next"] = False
                elif (
                    stack
                    and stack[-1]["kind"] == "loop"
                    and stack[-1]["branch"] == "condition"
                ):
                    current = stack[-1]["condition"]
                    if token in {"&&", "||"}:
                        stack[-1]["execute_next"] = short_circuit_execution(
                            current, token
                        )
                    else:
                        stack[-1]["execute_next"] = True
                    stack[-1]["negate_next"] = False
                elif stack and stack[-1].get("branch") in {"then", "else", "body"}:
                    compound = stack[-1]
                    current = compound["body_status"]
                    if token in {"&&", "||"}:
                        compound["body_execute_next"] = short_circuit_execution(
                            current, token
                        )
                    else:
                        compound["body_execute_next"] = True
                    compound["body_negate_next"] = False
                elif not stack:
                    if token in {"&&", "||"}:
                        top_execute_next = short_circuit_execution(
                            top_status, token
                        )
                    else:
                        top_execute_next = True
                    top_negate_next = False
                at_command_start = True
                continue
            if token == "then" and stack and stack[-1]["kind"] == "if":
                compound = stack[-1]
                condition = compound["condition"]
                if compound["any_taken"] is False and condition is True:
                    compound["selected"] = True
                    compound["any_taken"] = True
                elif compound["any_taken"] is True or condition is False:
                    compound["selected"] = False
                else:
                    compound["selected"] = "unknown"
                    compound["any_taken"] = "unknown"
                compound["branch"] = "then"
                compound["body_status"] = None
                compound["body_execute_next"] = True
                compound["body_negate_next"] = False
                at_command_start = True
                continue
            if token == "elif" and stack and stack[-1]["kind"] == "if":
                compound = stack[-1]
                compound.update(
                    branch="condition",
                    condition=None,
                    execute_next=compound["any_taken"] is False,
                    negate_next=False,
                    selected=False,
                )
                at_command_start = True
                continue
            if token == "else" and stack and stack[-1]["kind"] == "if":
                compound = stack[-1]
                compound["branch"] = "else"
                if compound["any_taken"] is False:
                    compound["selected"] = True
                elif compound["any_taken"] is True:
                    compound["selected"] = False
                else:
                    compound["selected"] = "unknown"
                compound["body_status"] = None
                compound["body_execute_next"] = True
                compound["body_negate_next"] = False
                at_command_start = True
                continue
            if token == "fi" and stack and stack[-1]["kind"] == "if":
                completed = stack.pop()
                if completed["selected"] is True:
                    completed_status = completed["body_status"]
                elif (
                    completed["selected"] is False
                    and completed["any_taken"] is False
                    and completed["condition"] is False
                ):
                    completed_status = True
                else:
                    completed_status = "unknown"
                if stack and stack[-1].get("branch") in {"then", "else", "body"}:
                    stack[-1]["body_status"] = completed_status
                elif not stack:
                    top_status = completed_status
                at_command_start = False
                continue
            if token in {"done", "esac"} and stack:
                expected_kind = "case" if token == "esac" else "loop"
                if stack[-1]["kind"] == expected_kind:
                    completed = stack.pop()
                    completed_status = (
                        completed["body_status"]
                        if completed["selected"] is True
                        else "unknown"
                    )
                    if stack and stack[-1].get("branch") in {
                        "then",
                        "else",
                        "body",
                    }:
                        stack[-1]["body_status"] = completed_status
                    elif not stack:
                        top_status = completed_status
                at_command_start = False
                continue
            if token == "do" and stack and stack[-1]["kind"] == "loop":
                compound = stack[-1]
                compound["branch"] = "body"
                if compound["loop_type"] == "for":
                    compound["selected"] = (
                        "unknown"
                        if compound["literal_words"] == "unknown"
                        else compound["literal_words"] > 0
                    )
                elif compound["loop_type"] == "while":
                    compound["selected"] = (
                        "unknown"
                        if compound["condition"] == "unknown"
                        else compound["condition"] is True
                    )
                elif compound["loop_type"] == "until":
                    compound["selected"] = (
                        "unknown"
                        if compound["condition"] == "unknown"
                        else compound["condition"] is False
                    )
                elif compound["loop_type"] == "select":
                    compound["selected"] = "unknown"
                else:
                    compound["selected"] = False
                compound["body_status"] = None
                compound["body_execute_next"] = True
                compound["body_negate_next"] = False
                at_command_start = True
                continue
            if at_command_start and token == "if":
                stack.append(
                    {
                        "kind": "if",
                        "condition": None,
                        "branch": "condition",
                        "execute_next": True,
                        "negate_next": False,
                        "any_taken": False,
                        "selected": False,
                        "body_status": None,
                        "body_execute_next": True,
                        "body_negate_next": False,
                    }
                )
                at_command_start = True
                continue
            if at_command_start and token == "case":
                stack.append(
                    {
                        "kind": "case",
                        "branch": "subject",
                        "subject": None,
                        "pattern": None,
                        "selected": False,
                        "any_taken": False,
                        "fallthrough_next": False,
                        "body_status": None,
                        "body_execute_next": True,
                        "body_negate_next": False,
                    }
                )
                at_command_start = False
                continue
            if at_command_start and token in {"while", "until", "for", "select"}:
                literal_words = "unknown" if token == "for" else 0
                raw_literal_count_known = False
                if token == "for":
                    if raw_for_counts is not None and for_loop_index < len(raw_for_counts):
                        literal_words = raw_for_counts[for_loop_index]
                        raw_literal_count_known = True
                    for_loop_index += 1
                stack.append(
                    {
                        "kind": "loop",
                        "loop_type": token,
                        "branch": (
                            "condition" if token in {"while", "until"} else "header"
                        ),
                        "in_words": False,
                        "literal_words": literal_words,
                        "raw_literal_count_known": raw_literal_count_known,
                        "selected": False,
                        "condition": None,
                        "execute_next": True,
                        "negate_next": False,
                        "body_status": None,
                        "body_execute_next": True,
                        "body_negate_next": False,
                    }
                )
                at_command_start = token in {"while", "until"}
                continue
            if stack and stack[-1]["kind"] == "case":
                compound = stack[-1]
                if compound["branch"] == "subject":
                    if compound["subject"] is None:
                        variable = re.fullmatch(r"\$([A-Za-z_][A-Za-z0-9_]*)", token)
                        compound["subject"] = (
                            static_vars[variable.group(1)]
                            if variable and variable.group(1) in static_vars
                            else token
                        )
                    elif token == "in":
                        compound["branch"] = "pattern"
                elif compound["branch"] == "pattern":
                    if token == ")":
                        compound["branch"] = "body"
                        patterns = (
                            raw_case_groups[case_group_index]
                            if raw_case_groups is not None
                            and case_group_index < len(raw_case_groups)
                            else [compound["pattern"]]
                        )
                        case_group_index += 1
                        dynamic_case = unit_nocasematch or any(
                            marker in compound["subject"]
                            for marker in ("$", "`", "~")
                        ) or any(
                            any(marker in pattern for marker in ("$", "`", "~"))
                            for pattern in patterns
                        ) or any(
                            "[[:" in pattern or "[^" in pattern
                            for pattern in patterns
                        )
                        if compound["fallthrough_next"] is True:
                            compound["selected"] = True
                        elif (
                            compound["fallthrough_next"] == "unknown"
                            or dynamic_case
                            or compound["any_taken"] == "unknown"
                        ):
                            compound["selected"] = "unknown"
                            compound["any_taken"] = "unknown"
                        else:
                            compound["selected"] = (
                                not compound["any_taken"]
                                and any(
                                    fnmatchcase(compound["subject"], pattern)
                                    for pattern in patterns
                                )
                            )
                        compound["fallthrough_next"] = False
                        if compound["selected"] is True:
                            compound["any_taken"] = True
                        at_command_start = True
                        continue
                    if compound["pattern"] is None:
                        compound["pattern"] = token
                at_command_start = False
                continue
            if (
                stack
                and stack[-1]["kind"] == "loop"
                and stack[-1]["branch"] == "header"
            ):
                compound = stack[-1]
                if compound["loop_type"] == "for":
                    if token == "in":
                        compound["in_words"] = True
                    elif (
                        compound["in_words"]
                        and not compound["raw_literal_count_known"]
                        and compound["literal_words"] != "unknown"
                        and not any(
                        marker in token for marker in ("$", "`", "*", "?", "[")
                        )
                    ):
                        compound["literal_words"] += 1
                at_command_start = False
                continue
            if (
                stack
                and stack[-1]["kind"] == "loop"
                and stack[-1]["branch"] == "condition"
                and at_command_start
            ):
                compound = stack[-1]
                if _ASSIGNMENT_RE.match(token):
                    continue
                if token == "!":
                    compound["negate_next"] = not compound["negate_next"]
                    continue
                if compound["execute_next"]:
                    if token in {"true", "false", ":"}:
                        status = token in {"true", ":"}
                        if compound["negate_next"]:
                            status = not status
                        compound["condition"] = status
                    else:
                        compound["condition"] = "unknown"
                compound["negate_next"] = False
                at_command_start = False
                continue
            if (
                stack
                and stack[-1]["kind"] == "if"
                and stack[-1]["branch"] == "condition"
                and at_command_start
            ):
                if _ASSIGNMENT_RE.match(token):
                    continue
                if token == "!":
                    stack[-1]["negate_next"] = not stack[-1]["negate_next"]
                    continue
                if stack[-1]["execute_next"]:
                    if token in {"true", "false", ":"}:
                        status = token in {"true", ":"}
                        if stack[-1]["negate_next"]:
                            status = not status
                        stack[-1]["condition"] = status
                    else:
                        stack[-1]["condition"] = "unknown"
                stack[-1]["negate_next"] = False
                at_command_start = False
                continue
            if (
                stack
                and stack[-1].get("branch") in {"then", "else", "body"}
                and at_command_start
            ):
                compound = stack[-1]
                if _ASSIGNMENT_RE.match(token):
                    continue
                if token == "!":
                    compound["body_negate_next"] = not compound["body_negate_next"]
                    continue
                if compound["body_execute_next"]:
                    if token in {"true", "false", ":"}:
                        status = token in {"true", ":"}
                        if compound["body_negate_next"]:
                            status = not status
                        compound["body_status"] = status
                    else:
                        compound["body_status"] = "unknown"
                compound["body_negate_next"] = False
                at_command_start = False
                continue
            if at_command_start and not stack:
                if _ASSIGNMENT_RE.match(token):
                    name, value = token.split("=", 1)
                    lookahead = normalized_index + 1
                    while (
                        lookahead < len(normalized_tokens)
                        and _ASSIGNMENT_RE.match(normalized_tokens[lookahead])
                    ):
                        lookahead += 1
                    standalone = (
                        lookahead == len(normalized_tokens)
                        or normalized_tokens[lookahead]
                        in {"\n", ";", "&&", "||", "|", "&"}
                    )
                    if (
                        top_execute_next is True
                        and standalone
                    ):
                        if any(marker in value for marker in ("$", "`", "~")):
                            static_vars.pop(name, None)
                        else:
                            static_vars[name] = value
                    continue
                if token == "!":
                    top_negate_next = not top_negate_next
                    continue
                if top_execute_next:
                    if token in {"true", "false", ":"}:
                        top_status = token in {"true", ":"}
                        if top_negate_next:
                            top_status = not top_status
                    else:
                        top_status = "unknown"
                top_negate_next = False
            at_command_start = False

        if top_execute_next is False:
            return False
        if require_definite and top_execute_next is not True:
            return False
        for compound in stack:
            if compound["kind"] == "loop":
                if compound["branch"] == "condition":
                    if compound["execute_next"] is False:
                        return False
                    if require_definite and compound["execute_next"] is not True:
                        return False
                    continue
                if compound["branch"] != "body" or not compound["selected"]:
                    return False
                if compound["body_execute_next"] is False:
                    return False
                if require_definite and (
                    compound["selected"] is not True
                    or compound["body_execute_next"] is not True
                ):
                    return False
                continue
            if compound["kind"] == "case":
                if compound["branch"] != "body" or not compound["selected"]:
                    return False
                if compound["body_execute_next"] is False:
                    return False
                if require_definite and (
                    compound["selected"] is not True
                    or compound["body_execute_next"] is not True
                ):
                    return False
                continue
            if compound["kind"] != "if":
                return False
            if compound["branch"] == "condition":
                if compound["execute_next"] is False:
                    return False
                if require_definite and compound["execute_next"] is not True:
                    return False
                continue
            if compound["branch"] not in {"then", "else"}:
                return False
            if compound["selected"] is False:
                return False
            if compound["body_execute_next"] is False:
                return False
            if require_definite and (
                compound["selected"] is not True
                or compound["body_execute_next"] is not True
            ):
                return False
        return True

    executable_source = _mask_heredoc_body_lines(command)
    for source_unit in parse_units(executable_source):
        line = normalize_function_signature_braces(
            source_unit.rstrip("\r\n")
        )
        unit_nocasematch = nocasematch or bool(
            re.search(
                r"(?:^|[;|&])\s*(?:builtin\s+)?shopt\s+-s\b"
                r"[^\n;|&]*\bnocasematch\b",
                line,
            )
        )
        parse_line = mask_quoted_braces(line)
        tokens, cmd_pos, seg_of, _scope_of = _parse_bash(parse_line)
        literal_tokens = _shell_tokens(line)

        def standalone_separator_at(index, separators):
            if index < 0 or index >= len(tokens) or tokens[index] not in separators:
                return False
            token = tokens[index]
            return not (
                (index > 0 and tokens[index - 1] == token)
                or (index + 1 < len(tokens) and tokens[index + 1] == token)
            )

        def command_is_parent_local(command_index):
            prefix_tokens = tokens[:command_index]
            signature_parens = _function_signature_parens(prefix_tokens)
            subshell_depth = sum(
                1 if token == "(" else -1 if token == ")" else 0
                for index, token in enumerate(prefix_tokens)
                if index not in signature_parens
            )
            if subshell_depth > 0:
                return False
            if standalone_separator_at(command_index - 1, {"|"}):
                return False
            for index in range(command_index + 1, len(tokens)):
                if tokens[index] not in {";", "|", "&"}:
                    continue
                return not standalone_separator_at(index, {"|", "&"})
            return True

        builtin_token_indices = [
            i for i, token in enumerate(tokens) if token == "builtin"
        ]
        alias_ineligible_builtin_indices = {
            token_index
            for alias_eligible, token_index in zip(
                builtin_alias_eligibility(line),
                builtin_token_indices,
            )
            if not alias_eligible
        }
        raw_alias_bodies = {
            match.group(1): match.group(3)
            for match in re.finditer(
                r"(?:^|[;|&]\s*)(?:builtin\s+)?alias\s+"
                r"([A-Za-z_][A-Za-z0-9_]*)=(['\"])(.*?)\2"
                r"(?=\s*(?:[;|&]|$))",
                line,
            )
        }
        # Aliases enabled before this line are expanded while Bash parses a
        # function definition. Record definitions as ordered events: each one
        # becomes callable only after its closing brace executes.
        line_definitions = []
        source_definitions = raw_function_definitions(line)
        source_definition_index = 0
        line_pos = 0
        while line_pos + 3 < len(tokens):
            function_name = None
            body_open = None
            if (
                re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tokens[line_pos])
                and tokens[line_pos + 1:line_pos + 4] == ["(", ")", "{"]
            ):
                function_name = tokens[line_pos]
                body_open = line_pos + 3
            elif tokens[line_pos] == "function" and line_pos + 2 < len(tokens):
                function_name = tokens[line_pos + 1]
                if tokens[line_pos + 2] == "{":
                    body_open = line_pos + 2
                elif tokens[line_pos + 2:line_pos + 5] == ["(", ")", "{"]:
                    body_open = line_pos + 4
            if body_open is None:
                line_pos += 1
                continue
            depth = 1
            close = body_open + 1
            while close < len(tokens) and depth:
                if tokens[close] == "{":
                    depth += 1
                elif tokens[close] == "}":
                    depth -= 1
                close += 1
            if not depth:
                raw_body = " ".join(tokens[body_open + 1:close - 1])
                if source_definition_index < len(source_definitions):
                    source_name, source_body = source_definitions[
                        source_definition_index
                    ]
                    source_definition_index += 1
                    if source_name == function_name:
                        raw_body = source_body
                expanded_body = expand_alias_commands(raw_body)
                prefix_tokens = tokens[:line_pos]
                prefix = " ".join(tokens[:line_pos])
                signature_parens = _function_signature_parens(prefix_tokens)
                subshell_depth = sum(
                    1
                    if token == "("
                    else -1
                    if token == ")"
                    else 0
                    for index, token in enumerate(prefix_tokens)
                    if index not in signature_parens
                )
                pipeline_local = standalone_separator_at(
                    line_pos - 1, {"|"}
                ) or standalone_separator_at(close, {"|", "&"})
                inheritable = (
                    not has_unclosed_function_definition(prefix)
                    and subshell_depth <= 0
                    and not pipeline_local
                    and active_compounds_execute(
                        prefix_tokens,
                        case_pattern_groups(line),
                        literal_for_word_counts(line),
                    )
                )
                line_definitions.append(
                    (
                        close,
                        function_name,
                        raw_body,
                        expanded_body,
                        inheritable,
                    )
                )
                line_pos = close
                continue
            line_pos += 1

        function_events = [
            (close, "define", name, raw_body, expanded_body, inheritable)
            for close, name, raw_body, expanded_body, inheritable in line_definitions
        ]
        for i, token in enumerate(tokens):
            if token != "unset" or not cmd_pos[i]:
                continue
            same_segment = [
                tokens[j]
                for j in range(i + 1, len(tokens))
                if seg_of[j] == seg_of[i]
            ]
            if "-f" not in same_segment or not active_compounds_execute(
                tokens[:i],
                case_pattern_groups(line),
                literal_for_word_counts(line),
                require_definite=True,
            ):
                continue
            if not command_is_parent_local(i):
                continue
            for name in same_segment:
                if not name.startswith("-"):
                    function_events.append((i, "remove", name, None, None, True))
        function_events.sort(key=lambda event: event[0])

        def apply_function_event(bodies, expanded_bodies, event):
            _position, action, name, raw_body, expanded_body, inheritable = event
            if not inheritable:
                return
            if action == "remove":
                bodies.pop(name, None)
                expanded_bodies.pop(name, None)
                return
            bodies[name] = raw_body
            if expanded_body != raw_body:
                expanded_bodies[name] = expanded_body
            else:
                expanded_bodies.pop(name, None)

        def function_state_at(token_index):
            bodies = dict(function_bodies)
            expanded_bodies = dict(expanded_function_bodies)
            for event in function_events:
                if event[0] >= token_index:
                    break
                apply_function_event(bodies, expanded_bodies, event)
            return bodies, expanded_bodies

        def variable_state_at(token_index):
            variables = dict(command_vars)
            for index, candidate in enumerate(tokens[:token_index]):
                if cmd_pos[index]:
                    same_segment = [
                        tokens[j]
                        for j in range(index + 1, token_index)
                        if seg_of[j] == seg_of[index]
                    ]
                    def resolve_state_word(word):
                        variable = re.fullmatch(
                            r"\$([A-Za-z_][A-Za-z0-9_]*)",
                            word,
                        )
                        if not variable:
                            return word
                        name = variable.group(1)
                        if name in variables:
                            return variables[name] or word
                        return os.environ.get(name, word)

                    effective_command = resolve_state_word(candidate)
                    while effective_command == "builtin" and same_segment:
                        effective_command = resolve_state_word(
                            same_segment.pop(0)
                        )
                    definitely_executes = (
                        command_is_parent_local(index)
                        and active_compounds_execute(
                            tokens[:index],
                            case_pattern_groups(line),
                            literal_for_word_counts(line),
                            require_definite=True,
                        )
                    )
                    if effective_command == "unset" and definitely_executes:
                        if "-f" in same_segment:
                            continue
                        for unset_name in same_segment:
                            if re.fullmatch(
                                r"[A-Za-z_][A-Za-z0-9_]*",
                                unset_name,
                            ):
                                variables[unset_name] = None
                        continue
                    if effective_command == "set" and definitely_executes:
                        if "--" not in same_segment:
                            continue
                        for name in list(variables):
                            if name.isdigit():
                                variables.pop(name)
                        positional_words = same_segment[
                            same_segment.index("--") + 1:
                        ]
                        for position, value in enumerate(
                            positional_words,
                            start=1,
                        ):
                            if value in {"<", ">", ">>"}:
                                break
                            if any(marker in value for marker in ("$", "`")):
                                value = _UNRESOLVED_EVAL_MARKER
                            variables[str(position)] = value
                        continue
                    if (
                        effective_command == "printf"
                        and "-v" in same_segment
                        and definitely_executes
                    ):
                        value_index = same_segment.index("-v") + 1
                        if value_index < len(same_segment):
                            assigned_name = same_segment[value_index]
                            if re.fullmatch(
                                r"[A-Za-z_][A-Za-z0-9_]*",
                                assigned_name,
                            ):
                                variables[assigned_name] = (
                                    _UNRESOLVED_EVAL_MARKER
                                )
                        continue
                    if effective_command == "read" and definitely_executes:
                        found_destination = False
                        read_option_value = None
                        read_options_done = False
                        value_options = set("adinNptu")
                        for assigned_name in same_segment:
                            if assigned_name in {"<", ">", ">>"}:
                                break
                            if read_option_value is not None:
                                if (
                                    read_option_value == "a"
                                    and re.fullmatch(
                                        r"[A-Za-z_][A-Za-z0-9_]*",
                                        assigned_name,
                                    )
                                ):
                                    found_destination = True
                                    variables[assigned_name] = (
                                        _UNRESOLVED_EVAL_MARKER
                                    )
                                read_option_value = None
                                continue
                            if not read_options_done and assigned_name == "--":
                                read_options_done = True
                                continue
                            if (
                                not read_options_done
                                and assigned_name.startswith("-")
                                and assigned_name != "-"
                            ):
                                option_chars = assigned_name[1:]
                                for option_index, option in enumerate(option_chars):
                                    if option in value_options:
                                        attached_value = option_chars[
                                            option_index + 1:
                                        ]
                                        if attached_value:
                                            if (
                                                option == "a"
                                                and re.fullmatch(
                                                    r"[A-Za-z_][A-Za-z0-9_]*",
                                                    attached_value,
                                                )
                                            ):
                                                found_destination = True
                                                variables[attached_value] = (
                                                    _UNRESOLVED_EVAL_MARKER
                                                )
                                        else:
                                            read_option_value = option
                                        break
                                continue
                            if re.fullmatch(
                                r"[A-Za-z_][A-Za-z0-9_]*",
                                assigned_name,
                            ):
                                found_destination = True
                                variables[assigned_name] = (
                                    _UNRESOLVED_EVAL_MARKER
                                )
                        if not found_destination:
                            variables["REPLY"] = _UNRESOLVED_EVAL_MARKER
                        continue
                    if (
                        effective_command in {"mapfile", "readarray"}
                        and definitely_executes
                    ):
                        destination = None
                        option_value = False
                        options_done = False
                        value_options = set("dnOsuCc")
                        for word in same_segment:
                            if word in {"<", ">", ">>"}:
                                break
                            if option_value:
                                option_value = False
                                continue
                            if not options_done and word == "--":
                                options_done = True
                                continue
                            if (
                                not options_done
                                and word.startswith("-")
                                and word != "-"
                            ):
                                option_chars = word[1:]
                                for option_index, option in enumerate(
                                    option_chars
                                ):
                                    if option in value_options:
                                        option_value = (
                                            option_index
                                            == len(option_chars) - 1
                                        )
                                        break
                                continue
                            if re.fullmatch(
                                r"[A-Za-z_][A-Za-z0-9_]*",
                                word,
                            ):
                                destination = word
                                break
                        variables[destination or "MAPFILE"] = (
                            _UNRESOLVED_EVAL_MARKER
                        )
                        continue
                    if (
                        effective_command
                        in {"local", "declare", "typeset", "export", "readonly"}
                        and definitely_executes
                    ):
                        if "-f" in same_segment:
                            continue
                        declaration_snapshot = dict(variables)
                        pending_declarations = {}
                        for declaration in same_segment:
                            if not _ASSIGNMENT_RE.match(declaration):
                                continue
                            name, value = declaration.split("=", 1)
                            nameref_mode = any(
                                re.fullmatch(r"-[A-Za-z]+", option)
                                and "n" in option[1:]
                                for option in same_segment
                            )
                            if nameref_mode:
                                pending_declarations[name] = (
                                    _UNRESOLVED_EVAL_MARKER
                                )
                                continue
                            if "$(" in value or "`" in value:
                                pending_declarations[name] = (
                                    _UNRESOLVED_EVAL_MARKER
                                )
                                continue
                            def resolve_declaration_variable(match):
                                referenced = match.group(1) or match.group(2)
                                if referenced in declaration_snapshot:
                                    return declaration_snapshot[referenced] or ""
                                return os.environ.get(
                                    referenced,
                                    match.group(0),
                                )

                            pending_declarations[name] = re.sub(
                                r"\$([A-Za-z_][A-Za-z0-9_]*)"
                                r"|\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
                                resolve_declaration_variable,
                                value,
                            )
                        variables.update(pending_declarations)
                        continue
                if not cmd_pos[index] or not _ASSIGNMENT_RE.match(candidate):
                    continue
                assignment_name, assignment_value = candidate.split("=", 1)
                if "$(" in assignment_value and active_compounds_execute(
                    tokens[:index],
                    case_pattern_groups(line),
                    literal_for_word_counts(line),
                    require_definite=True,
                ):
                    close_index = next(
                        (
                            j
                            for j in range(index + 1, token_index)
                            if seg_of[j] == seg_of[index]
                            and _is_command_sub_close(tokens[j])
                        ),
                        None,
                    )
                    if close_index is not None:
                        variables[assignment_name] = _UNRESOLVED_EVAL_MARKER
                        continue
                lookahead = index + 1
                while (
                    lookahead < token_index
                    and _ASSIGNMENT_RE.match(tokens[lookahead])
                ):
                    lookahead += 1
                standalone = (
                    lookahead == token_index
                    or tokens[lookahead] in {"\n", ";", "|", "&"}
                )
                if not standalone or not active_compounds_execute(
                    tokens[:index],
                    case_pattern_groups(line),
                    literal_for_word_counts(line),
                    require_definite=True,
                ):
                    continue
                name, value = candidate.split("=", 1)
                def resolve_assignment_operator(match):
                    referenced, operator, word = match.groups()
                    if referenced in variables:
                        is_set = variables[referenced] is not None
                        current = variables[referenced] or ""
                    else:
                        is_set = referenced in os.environ
                        current = os.environ.get(referenced, "")
                    missing = not is_set or (
                        operator.startswith(":") and current == ""
                    )
                    operation = operator[-1]
                    if operation in {"-", "="}:
                        result = word if missing else current
                        if operation == "=" and missing:
                            variables[referenced] = word
                        return result
                    if operation == "+":
                        return "" if missing else word
                    if operation == "?":
                        return "" if missing else current
                    return current

                def resolve_assignment_variable(match):
                    referenced = match.group(1) or match.group(2)
                    if referenced in variables:
                        return variables[referenced] or ""
                    return os.environ.get(referenced, match.group(0))

                for _ in range(8):
                    previous = value
                    value = re.sub(
                        r"\$\{([A-Za-z_][A-Za-z0-9_]*)"
                        r"(:?[-+?=])([^{}]*)\}",
                        resolve_assignment_operator,
                        value,
                    )
                    value = re.sub(
                        r"\$([A-Za-z_][A-Za-z0-9_]*)"
                        r"|\$\{([A-Za-z_][A-Za-z0-9_]*)\}",
                        resolve_assignment_variable,
                        value,
                    )
                    if value == previous:
                        break
                variables[name] = value
            return variables

        for body, sub_outer_seg, _sub_index, exposed in _executable_subcommands(
            line
        ):
            if exposed:
                continue
            token_index = next(
                (
                    i
                    for i, segment in enumerate(seg_of)
                    if segment == sub_outer_seg
                ),
                len(tokens),
            )
            bodies, expanded_bodies = function_state_at(token_index)
            state = (enabled, aliases, bodies, expanded_bodies, nocasematch)
            for nested_body, _nested_seg, _nested_index in _invoked_alias_bodies(
                body,
                state,
            ):
                invoked.append(
                    (
                        nested_body,
                        _segment_for_offset(command, offset) + sub_outer_seg,
                        invocation_index,
                    )
                )
                invocation_index += 1

        for i, token in enumerate(tokens):
            if not cmd_pos[i]:
                continue
            if not active_compounds_execute(
                tokens[:i],
                case_pattern_groups(line),
                literal_for_word_counts(line),
            ):
                continue
            segment_commands = [
                tokens[j]
                for j in range(i)
                if seg_of[j] == seg_of[i] and cmd_pos[j]
            ]
            if (
                segment_commands
                and os.path.basename(segment_commands[0])
                in _FUNCTION_LOOKUP_SUPPRESSORS
            ):
                continue
            bodies, expanded_bodies = function_state_at(i)
            resolved_token = token
            variable = re.fullmatch(r"\$([A-Za-z_][A-Za-z0-9_]*)", token)
            if variable:
                resolved_token = variable_state_at(i).get(variable.group(1), token)
            if resolved_token not in bodies:
                continue
            outer_seg = _segment_for_offset(command, offset) + seg_of[i]
            invocation_arguments = [
                tokens[j]
                for j in range(i + 1, len(tokens))
                if seg_of[j] == seg_of[i]
            ]
            invoked.append(
                (
                    expand_function_arguments(
                        expand_function(
                            expanded_bodies.get(
                                resolved_token,
                                bodies[resolved_token],
                            ),
                            bodies=bodies,
                            expanded_bodies=expanded_bodies,
                        ),
                        invocation_arguments,
                    ),
                    outer_seg,
                    invocation_index,
                )
            )
            invocation_index += 1
        for i, token in enumerate(tokens):
            eval_variables = variable_state_at(i)
            resolved_eval_token = token
            eval_variable = re.fullmatch(
                r"\$([A-Za-z_][A-Za-z0-9_]*)",
                token,
            )
            if eval_variable:
                variable_name = eval_variable.group(1)
                if variable_name in eval_variables:
                    resolved_eval_token = eval_variables[variable_name]
                else:
                    resolved_eval_token = os.environ.get(
                        variable_name,
                        token,
                    )
            prior_words = [
                tokens[j]
                for j in range(i)
                if seg_of[j] == seg_of[i]
                and not _ASSIGNMENT_RE.match(tokens[j])
            ]

            def resolved_prior_word(word):
                variable = re.fullmatch(
                    r"\$([A-Za-z_][A-Za-z0-9_]*)",
                    word,
                )
                if variable:
                    return eval_variables.get(variable.group(1), word)
                return word

            resolved_prior_words = [
                resolved_prior_word(word) for word in prior_words
            ]

            def executable_builtin_wrapper_chain(words):
                index = 0
                while index < len(words):
                    wrapper = words[index]
                    if wrapper == "command":
                        index += 1
                        while index < len(words) and words[index] in {"-p", "--"}:
                            index += 1
                        if index < len(words) and words[index] in {"-v", "-V"}:
                            return False
                        continue
                    if wrapper == "builtin":
                        index += 1
                        if index < len(words) and words[index] == "--":
                            index += 1
                        continue
                    return False
                return bool(words)

            builtin_eval = (
                executable_builtin_wrapper_chain(resolved_prior_words)
                and next(
                    (
                        cmd_pos[j]
                        for j in range(i)
                        if seg_of[j] == seg_of[i]
                        and not _ASSIGNMENT_RE.match(tokens[j])
                    ),
                    False,
                )
            )
            eval_position = (
                builtin_eval if prior_words else cmd_pos[i]
            )
            if (
                resolved_eval_token != "eval"
                or not eval_position
                or not active_compounds_execute(
                    tokens[:i],
                    case_pattern_groups(line),
                    literal_for_word_counts(line),
                )
            ):
                continue
            bodies, expanded_bodies = function_state_at(i)
            payload_words = [
                (
                    literal_tokens[j]
                    if len(literal_tokens) == len(tokens)
                    else tokens[j]
                )
                for j in range(i + 1, len(tokens))
                if seg_of[j] == seg_of[i]
            ]
            # eval joins its arguments with spaces and parses the result as a
            # fresh shell program.  Re-tokenize that complete source so a
            # quoted outer-shell argument such as `eval 'f arg'` exposes `f`
            # as the inner command instead of the opaque token `f arg`.
            eval_source = " ".join(payload_words)

            def resolve_eval_variable(match):
                name = match.group(1) or match.group(2)
                if name in eval_variables:
                    return eval_variables[name] or ""
                return os.environ.get(name, match.group(0))

            def resolve_eval_parameter_operator(match):
                name, operator, word = match.groups()
                if name in eval_variables:
                    is_set = eval_variables[name] is not None
                    value = eval_variables[name] or ""
                else:
                    is_set = name in os.environ
                    value = os.environ.get(name, "")
                colon = operator.startswith(":")
                operation = operator[-1]
                missing = not is_set or (colon and value == "")
                if operation == "-":
                    return word if missing else value
                if operation == "+":
                    return "" if missing else word
                if operation == "?":
                    return "" if missing else value
                if operation == "=":
                    if missing:
                        eval_variables[name] = word
                        return word
                    return value
                return value

            def resolve_eval_indirect(match):
                reference_name = match.group(1)
                if reference_name in eval_variables:
                    target_name = eval_variables[reference_name] or ""
                else:
                    target_name = os.environ.get(reference_name, "")
                if target_name in eval_variables:
                    return eval_variables[target_name] or ""
                return os.environ.get(target_name, "")

            eval_source = re.sub(
                r"\$\{!([A-Za-z_][A-Za-z0-9_]*)\}",
                resolve_eval_indirect,
                eval_source,
            )

            eval_source = re.sub(
                r"\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-+?=])([^{}]*)\}",
                resolve_eval_parameter_operator,
                eval_source,
            )

            def resolve_eval_substring(match):
                name, offset_expression, length_expression = match.groups()
                if name in eval_variables:
                    value = eval_variables[name] or ""
                else:
                    value = os.environ.get(name, "")
                offset = _shell_integer_arithmetic(offset_expression)
                if offset is None:
                    return value
                start = offset if offset >= 0 else len(value) + offset
                start = max(0, start)
                if length_expression is None:
                    return value[start:]
                length = _shell_integer_arithmetic(length_expression)
                if length is None:
                    return value
                if length >= 0:
                    return value[start:start + length]
                return value[start:length]

            eval_source = re.sub(
                r"\$\{([A-Za-z_][A-Za-z0-9_]*):"
                r"(?![-+?=])([^}:]+)"
                r"(?::([^}]+))?\}",
                resolve_eval_substring,
                eval_source,
            )

            eval_source = re.sub(
                r"\$([A-Za-z_][A-Za-z0-9_]*|[0-9]+)"
                r"|\$\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+)\}",
                resolve_eval_variable,
                eval_source,
            )
            for _ in range(8):
                previous_eval_source = eval_source
                eval_source = re.sub(
                    r"\$\{!([A-Za-z_][A-Za-z0-9_]*)\}",
                    resolve_eval_indirect,
                    eval_source,
                )
                eval_source = re.sub(
                    r"\$\{([A-Za-z_][A-Za-z0-9_]*)"
                    r"(:?[-+?=])([^{}]*)\}",
                    resolve_eval_parameter_operator,
                    eval_source,
                )
                eval_source = re.sub(
                    r"\$\{([A-Za-z_][A-Za-z0-9_]*):"
                    r"(?![-+?=])([^}:]+)"
                    r"(?::([^}]+))?\}",
                    resolve_eval_substring,
                    eval_source,
                )
                eval_source = re.sub(
                    r"\$([A-Za-z_][A-Za-z0-9_]*|[0-9]+)"
                    r"|\$\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+)\}",
                    resolve_eval_variable,
                    eval_source,
                )
                if eval_source == previous_eval_source:
                    break
            def preserve_unresolved_named_modifier(match):
                name, modifier = match.groups()
                if name in eval_variables:
                    value = eval_variables[name] or ""
                else:
                    value = os.environ.get(
                        name,
                        _UNRESOLVED_EVAL_MARKER,
                    )
                return f"{value} {modifier}"

            eval_source = re.sub(
                r"\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}",
                preserve_unresolved_named_modifier,
                eval_source,
            )
            if "$(" in eval_source or "`" in eval_source:
                eval_source = _UNRESOLVED_EVAL_MARKER
            if enabled:
                eval_source = expand_alias_commands(eval_source)
            invoked.append(
                (
                    eval_source,
                    _segment_for_offset(command, offset) + seg_of[i],
                    invocation_index,
                )
            )
            invocation_index += 1
            if "$(" in eval_source or "`" in eval_source:
                invoked.append(
                    (
                        eval_source.replace("$(", " ")
                        .replace(")$", " ")
                        .replace("`", " "),
                        _segment_for_offset(command, offset) + seg_of[i],
                        invocation_index,
                    )
                )
                invocation_index += 1
            eval_tokens, eval_cmd_pos, eval_seg_of, _ = _parse_bash(eval_source)
            for eval_index, name in enumerate(eval_tokens):
                if not eval_cmd_pos[eval_index]:
                    continue
                segment_commands = [
                    eval_tokens[j]
                    for j in range(eval_index)
                    if eval_seg_of[j] == eval_seg_of[eval_index]
                    and eval_cmd_pos[j]
                ]
                if (
                    segment_commands
                    and os.path.basename(segment_commands[0])
                    in _FUNCTION_LOOKUP_SUPPRESSORS
                ):
                    continue
                if not active_compounds_execute(
                    eval_tokens[:eval_index],
                    case_pattern_groups(eval_source),
                    literal_for_word_counts(eval_source),
                ):
                    continue
                invoked_names = (
                    [name]
                    if name in bodies
                    else list(bodies)
                    if "$" in name or "`" in name
                    else []
                )
                for invoked_name in invoked_names:
                    invoked.append(
                        (
                            expand_function(
                                expanded_bodies.get(
                                    invoked_name,
                                    bodies[invoked_name],
                                ),
                                bodies=bodies,
                                expanded_bodies=expanded_bodies,
                            ),
                            _segment_for_offset(command, offset) + seg_of[i],
                            invocation_index,
                        )
                    )
                    invocation_index += 1
        if enabled:
            for i, token in enumerate(tokens):
                if (
                    cmd_pos[i]
                    and token in aliases
                    and active_compounds_execute(
                        tokens[:i],
                        case_pattern_groups(line),
                        literal_for_word_counts(line),
                    )
                ):
                    bodies, expanded_bodies = function_state_at(i)
                    outer_seg = _segment_for_offset(command, offset) + seg_of[i]
                    expanded = expand_alias(token)
                    tail = [
                        tokens[j]
                        for j in range(i + 1, len(tokens))
                        if seg_of[j] == seg_of[i]
                    ]
                    if (
                        aliases[token].endswith((" ", "\t"))
                        and tail
                        and tail[0] in aliases
                    ):
                        expanded = f"{expanded}{expand_alias(tail.pop(0))}"
                    if tail:
                        expanded = f"{expanded} {' '.join(tail)}"
                    invoked.append(
                        (
                            expand_function(
                                expanded,
                                bodies=bodies,
                                expanded_bodies=expanded_bodies,
                            ),
                            outer_seg,
                            invocation_index,
                        )
                    )
                    invocation_index += 1
        for event in function_events:
            apply_function_event(
                function_bodies,
                expanded_function_bodies,
                event,
            )
        # Shell parses a complete line before executing it, so shopt/alias
        # changes here affect only subsequent lines.
        for i, token in enumerate(tokens):
            if not cmd_pos[i]:
                continue
            if not active_compounds_execute(
                tokens[:i],
                case_pattern_groups(line),
                literal_for_word_counts(line),
            ):
                continue
            definitely_executes = active_compounds_execute(
                tokens[:i],
                case_pattern_groups(line),
                literal_for_word_counts(line),
                require_definite=True,
            )
            if not command_is_parent_local(i):
                continue
            same_segment = [
                tokens[j]
                for j in range(i + 1, len(tokens))
                if seg_of[j] == seg_of[i]
            ]
            effective_token = token
            if (
                token == "builtin"
                and same_segment
                and not (
                    enabled
                    and token in aliases
                    and i not in alias_ineligible_builtin_indices
                )
            ):
                effective_token = same_segment.pop(0)
            if effective_token == "shopt" and "expand_aliases" in same_segment:
                if "-s" in same_segment:
                    enabled = True
                elif "-u" in same_segment and definitely_executes:
                    enabled = False
            if effective_token == "shopt" and "nocasematch" in same_segment:
                if "-s" in same_segment:
                    nocasematch = True
                elif "-u" in same_segment and definitely_executes:
                    nocasematch = False
            if effective_token == "alias":
                for definition in same_segment:
                    if "=" not in definition:
                        continue
                    name, body = definition.split("=", 1)
                    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
                        aliases[name] = raw_alias_bodies.get(name, body)
            if effective_token == "unalias" and definitely_executes:
                if "-a" in same_segment:
                    aliases.clear()
                else:
                    for name in same_segment:
                        if not name.startswith("-"):
                            aliases.pop(name, None)
        command_vars = variable_state_at(len(tokens))
        offset += len(source_unit)
    return invoked


def _function_signature_parens(tokens):
    """Token indices for `name()`/`function name()` syntax, not subshells."""
    indices = set()
    for i in range(len(tokens) - 2):
        if (
            re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", tokens[i])
            and tokens[i + 1:i + 3] == ["(", ")"]
            and i + 3 < len(tokens)
            and tokens[i + 3] == "{"
        ):
            indices.update((i + 1, i + 2))
        if (
            tokens[i] == "function"
            and i + 4 < len(tokens)
            and tokens[i + 2:i + 5] == ["(", ")", "{"]
        ):
            indices.update((i + 2, i + 3))
    return indices

# ── git-guardian: file-write heredoc stripping (moved from git_safety.py) ──────
# A second, narrower heredoc model than _strip_heredoc_bodies above: it masks
# only bodies that `cat` writes to a file and keeps `$()`/backticks from
# unquoted ones. Both live here so they can converge in one place (GO-5 PR-4).


_HEREDOC_RE = re.compile(r"(?<!<)<<(-?)\s*([^\s;|&<>]+)")


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


# GO-5 PR-4: heredoc bodies a non-shell interpreter reads are its program text,
# and `tee`/`gh` read them as data (a file, a PR body). None of it is shell;
# Bash itself only runs an unquoted heredoc's `$()`/backticks.
_HEREDOC_INTERPRETERS = {"python", "python3", "node", "bun", "deno", "ruby", "perl", "tee", "gh"}

# Commands whose quoted arguments are data (messages, bodies, printed text).
# Anything else keeps its quoted text: `psql -c '…'`, `bash -c '…'`, `eval`.
_DATA_COMMANDS = {"echo", "printf", "gh"}
_GIT_DATA_SUBCOMMANDS = {"commit", "tag", "notes"}


def _interpreter_heredoc_header(header: str, *, piped: bool = False) -> bool:
    """True when a non-shell reader (_HEREDOC_INTERPRETERS) consumes the
    heredoc and its output is not piped on, e.g. into `sh`."""
    if piped:
        return False
    try:
        lexer = shlex.shlex(header, posix=True, punctuation_chars=";&|()<>")
        lexer.whitespace_split = True
        words = [w for w in lexer if "=" not in w]
    except ValueError:
        return False
    return bool(words) and os.path.basename(words[0]) in _HEREDOC_INTERPRETERS


def _is_data_command(words: list[str]) -> bool:
    words = [w for w in words if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w)]
    if not words:
        return False
    name = os.path.basename(words[0])
    if name in _DATA_COMMANDS:
        return True
    rest = [w for w in words[1:] if not w.startswith("-")]
    # A config override (`-c k=v`, `-ck=v`, `--config-env`) can name a program
    # git then runs (core.editor, alias.x=!…); any override makes git non-data.
    overrides = any(w.startswith(("-c", "--config-env")) for w in words[1:])
    return name == "git" and not overrides and bool(rest) and rest[0] in _GIT_DATA_SUBCOMMANDS


def _mask_data_argument_quotes(text: str) -> str:
    """Blank the quoted arguments of data-only commands (echo/printf/gh, git
    commit|tag|notes), keeping any `$()`/backticks Bash runs inside "…".

    A data command piped onward (`echo '…' | psql`) feeds an executor, so its
    segment is kept verbatim, mirroring the heredoc `piped` rule.
    """
    if "$'" in text:
        return text  # ANSI-C quoting is not modelled; never risk a desync
    out = []
    raw: list[str] = []      # the current segment, verbatim
    masked: list[str] = []   # the same segment with data prose blanked
    words: list[str] = []
    word = ""
    index = 0

    def close_segment(piped: bool) -> None:
        out.extend(raw if piped else masked)
        raw.clear()
        masked.clear()

    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text):
            raw.append(text[index:index + 2])
            masked.append(text[index:index + 2])
            word += text[index:index + 2]
            index += 2
            continue
        if char in "'\"":
            end = index + 1
            while end < len(text) and text[end] != char:
                end += 2 if char == '"' and text[end] == "\\" else 1
            quoted = text[index:end + 1]
            body = text[index + 1:end]
            if words and _is_data_command(words):
                body = "" if char == "'" else _executable_expansions(body)
            raw.append(quoted)
            masked.append(char + body + (char if end < len(text) else ""))
            word += char
            index = end + 1
            continue
        if char in ";|&()\n":
            pipe = char == "|" and text[index + 1:index + 2] != "|"  # `|` or `|&`, not `||`
            close_segment(pipe)
            words, word = [], ""
        elif char in " \t":
            if word:
                words.append(word)
            word = ""
        else:
            word += char
        raw.append(char)
        masked.append(char)
        index += 1
    close_segment(False)
    return "".join(out)


def shell_text_without_heredoc_bodies(command: str) -> str:
    """Remove heredoc prose while retaining executable substitutions.

    GO-5 PR-4: also drops heredoc bodies read by a non-shell interpreter and
    the quoted prose of data-only commands (see _DATA_COMMANDS), so callers'
    SQL/credential text scans see only what Bash would execute.

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
                piped = segment_end < len(line) and line[segment_end] == "|"
                file_write = _literal_file_heredoc_header(
                    header, piped=piped
                ) or _interpreter_heredoc_header(header, piped=piped)
                pending.append(
                    (delimiter, quoted, bool(match.group(1)), file_write)
                )
        output.append(source_line)
    return _mask_data_argument_quotes("".join(output))


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

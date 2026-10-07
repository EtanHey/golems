"""Shell tokenization and token constants."""

from __future__ import annotations

import re
from contextvars import ContextVar
from .quotes import ansi_c_quote, ansi_c_opens_at

# Policy consumers opt in without changing the shared parser's legacy view.
_preserve_empty_words = ContextVar('golems_preserve_empty_words', default=False)

# Shell assignment token (`FOO=bar`, `FOO+=bar`, `FOO[0]=bar`) — used to
# identify assignment words while preserving the base variable name. Array
# and append assignments are recognized even when callers cannot evaluate
# their result, so stale state can be invalidated instead of reused.
_ASSIGNMENT_RE = re.compile(
    r"^(?P<name>[A-Za-z_][A-Za-z0-9_]*)"
    r"(?P<subscript>\[[^\]]+\])?(?P<append>\+)?="
)


# Raw-line tokenizers for case arms and `for ... in` word lists. A double-quoted
# token consumes a backslash only as an escape pair (\\[\s\S], which includes
# backslash-newline), so there is exactly one way to match it: no exponential
# backtracking on an unclosed quote (CodeQL py/redos #3/#4).
_RAW_SHELL_TOKEN_RE = re.compile(
    r"\$'(?:\\[\s\S]|[^'\\])*'|'[^']*'|\"(?:\\[\s\S]|[^\"\\])*\"|;;&|;&|;;|\|\||&&|[;|&()]|[^\s;|&()]+"
)


_RAW_FOR_WORD_RE = re.compile(r"\$'(?:\\[\s\S]|[^'\\])*'|'[^']*'|\"(?:\\[\s\S]|[^\"\\])*\"|\S+")
# Preserve whether a brace was shell-quoted. Unquoted `{a,b}` is a bounded
# expansion; quoted braces are literal filename characters and retain the
# guard's conservative REFUSE behavior.
_QUOTED_LBRACE = "\ue000"


_QUOTED_RBRACE = "\ue001"


def _is_command_sub_open(token):
    """True for the synthetic opener of `$()` or legacy backticks."""
    return token.endswith("$(") or token.endswith("`(")


def _is_command_sub_close(token):
    return token.startswith(")$") or token.startswith(")`")


def _command_sub_word_continues(token):
    return token in (")$+", ")`+")


# AIDEV-TODO: Decompose the lexer in a follow-up with its own goldens.
class _ShellOperator(str):
    """Unforgeable lexical origin; input text alone cannot create this tag."""


def _shell_operator_words(command):
    """Words plus operator provenance for policy segmentation."""
    words = _shell_tokens(command, _operator_origin=True, _strict_quotes=True)
    result = []
    for word in words:
        operator = isinstance(word, _ShellOperator)
        value = str(word).replace(_QUOTED_LBRACE, '{').replace(_QUOTED_RBRACE, '}')
        if operator and result and result[-1][1] and value in {'&', '|', ';'} and result[-1][0] == value:
            result[-1] = (value * 2, True)
        else:
            result.append((value, operator))
    return result


def _shell_tokens(command, *, _operator_origin=False, _strict_quotes=False):
    """Quote-aware tokenizer. Quoted content merges into the surrounding token
    (so `echo "x > /tmp/y"` carries no redirect), while >, >>, parens and
    statement separators become standalone tokens even when glued
    (`>/tmp/x`, `2>>f`, `>(tee ...)`). `#` at a token boundary starts a
    comment (dropped to end-of-line, Bugbot b5f80501)."""
    tokens = []
    cur = ""
    quoted_word_started = False
    i = 0
    n = len(command)
    paren_stack = []
    operator = _ShellOperator if _operator_origin else str

    def flush():
        nonlocal cur, quoted_word_started
        if cur or (_preserve_empty_words.get() and quoted_word_started):
            tokens.append(cur)
        cur = ""
        quoted_word_started = False

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
            if ansi_c_opens_at(command, j):
                value, j = ansi_c_quote(command, j)
                if value:
                    return True
                continue
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
        if ansi_c_opens_at(command, i):
            quoted_word_started = True
            start = i
            buf, i = ansi_c_quote(command, i)
            if _strict_quotes and not re.fullmatch(r"\$'(?:\\[\s\S]|[^'\\])*'", command[start:i]):
                raise ValueError('unclosed ANSI-C quote')
            cur += buf.replace("{", _QUOTED_LBRACE).replace("}", _QUOTED_RBRACE)
            continue
        if command.startswith('$"', i):
            i += 1
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
            if _operator_origin:
                # Guardian previously inspected these executable bodies through
                # its punctuation lexer. Keep arithmetic identifiers opaque,
                # while retaining command-substitution execution boundaries.
                # Reuse the shared quote-aware views rather than fork their
                # arithmetic/command-substitution ambiguity rules here.
                from .data_text import _data_dollar_paren_end
                from .data_substitutions import _dollar_paren_spans
                from .substitutions import _executable_subcommands
                j = _data_dollar_paren_end(command, i)
                expression = command[i:j]
                spans = _dollar_paren_spans(expression)
                if spans and spans[0][0] == 0:
                    bodies = [expression[2:spans[0][1] - 1]]
                else:
                    bodies = [body for body, *_ in _executable_subcommands(expression)]
                cur += expression
                if bodies:
                    flush()
                    for body in bodies:
                        tokens.append(operator('('))
                        tokens.extend(_shell_tokens(body, _operator_origin=True,
                                                    _strict_quotes=_strict_quotes))
                        tokens.append(operator(')'))
            else:
                cur += command[i:j]
            i = j
            continue
        if c == "$" and i + 1 < n and command[i + 1] == "(":
            # Command substitutions cannot change the parent shell's cwd.
            # Give their delimiters distinct tokens so anchor analysis can
            # ignore them without hiding executable inner writes from either
            # guard. Dynamic cd/worktree arguments still carry the literal
            # `$(` token and are rejected by resolve_target().
            if _operator_origin:
                cur += '$'
                flush()
                tokens.append(operator('('))
            else:
                cur += "$("
                flush()
            paren_stack.append("command-substitution")
            i += 2
            continue
        if c == "`":
            if paren_stack and paren_stack[-1] == "backtick":
                flush()
                paren_stack.pop()
                tokens.append(operator(")`+" if suffix_emits_token(i + 1) else ")`"))
            else:
                if _operator_origin:
                    cur += '`'
                    flush()
                    tokens.append(operator('('))
                else:
                    cur += "`("
                    flush()
                paren_stack.append("backtick")
            i += 1
            continue
        if c in "\"'":
            quoted_word_started = True
            quote = c
            i += 1
            buf = ""
            closed = False
            while i < n:
                if quote == '"' and command[i] == "\\" and i + 1 < n:
                    buf += command[i + 1]
                    i += 2
                    continue
                if command[i] == quote:
                    i += 1
                    closed = True
                    break
                buf += command[i]
                i += 1
            if _strict_quotes and not closed:
                raise ValueError('unclosed shell quote')
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
            tokens.append(operator(";"))
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
                tokens.append(operator(c))
            elif c == ")" and paren_stack:
                kind = paren_stack.pop()
                if kind == "command-substitution":
                    continues_word = suffix_emits_token(i + 1)
                    tokens.append(operator(")$+" if continues_word else ")$"))
                else:
                    tokens.append(operator(c))
            else:
                tokens.append(operator(c))
            i += 1
            continue
        if c == "<":
            # Input redirect / heredoc operator — never a write target.
            if _preserve_empty_words.get() and cur.isdigit() and not quoted_word_started:
                cur = ""
            flush()
            j = i
            while j < n and command[j] in "<-":
                j += 1
            tokens.append(operator(command[i:j]))
            i = j
            continue
        if c == ">":
            # `2>` / `1>` fd prefixes: drop a pure-digit cur (it is the fd).
            if cur.isdigit() and not (_preserve_empty_words.get() and quoted_word_started):
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
            tokens.append(operator(op))
            i += 1
            continue
        if c == "&":
            if _operator_origin and i > 0 and command[i - 1] in '<>' and tokens and isinstance(tokens[-1], _ShellOperator):
                # Descriptor duplication belongs to the redirect, not to the
                # shell's command-separator grammar. Preserve lexical origin.
                tokens[-1] = operator(str(tokens[-1]) + '&')
                i += 1
                continue
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
                tokens.append(operator(op))
                i = j
                continue
            flush()
            tokens.append(operator("&"))
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

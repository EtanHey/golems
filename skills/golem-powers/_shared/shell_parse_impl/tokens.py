"""Shell tokenization and token constants."""

from __future__ import annotations

import re

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

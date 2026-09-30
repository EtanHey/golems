"""Git safety DATA heredoc and quoted argument model."""

from __future__ import annotations

import os
import re
import shlex


from .substitutions import _dollar_substitution


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
        if line[i] == "\\":
            i += 2
            continue
        if line.startswith("$(", i):
            j = _data_dollar_paren_end(line, i)
            body = shell_text_without_heredoc_bodies(
                line[i + 2:j - 1], _preserve_heredoc_delimiters=True
            )
            found.append("$(" + body + ")")
            i = j
            continue
        if line[i] == "`":
            j = _data_backtick_end(line, i)
            body = shell_text_without_heredoc_bodies(
                line[i + 1:j - 1], _preserve_heredoc_delimiters=True
            )
            found.append("`" + body + "`")
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
    command_index = next(
        (
            index
            for index, word in enumerate(words)
            if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", word)
        ),
        None,
    )
    if command_index is None:
        return False
    name = os.path.basename(words[command_index])
    if name in _DATA_COMMANDS:
        return True
    if name != "git":
        return False
    for word in words[command_index + 1:]:
        # A config override (`-c k=v`, `-ck=v`, `--config-env`) can name a
        # program git then runs (core.editor, alias.x=!…); never mask it.
        if word.startswith(("-c", "--config-env")):
            return False
        if not word.startswith("-"):
            return word in _GIT_DATA_SUBCOMMANDS
    return False


# Executors named anywhere in a command (as a word, or a path ending in one),
# plus `.` in command position. `ssh`, `shell`, `bash_profile` do not match.
_EXECUTOR_RE = re.compile(
    r"(?<![\w.-])(?:psql|sqlite3|mysql|sh|bash|zsh|eval|source)(?![\w-])"
    r"|(?:^|[;&|(\n])\s*\.\s"
)


def _has_unquoted_pipe(text: str) -> bool:
    """True when `text` has a single `|` (or `|&`) outside quotes; `||` is not one."""
    quote = None
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and quote != "'":
            index += 2
            continue
        if quote:
            if char == quote:
                quote = None
        elif char in "'\"":
            quote = char
        elif char == "|" and text[index + 1:index + 2] != "|" and text[index - 1:index] != "|":
            return True
        index += 1
    return False


def _mask_data_argument_quotes(text: str) -> str:
    """Blank the quoted arguments of data-only commands (echo/printf/gh, git
    commit|tag|notes), keeping any `$()`/backticks Bash runs inside "…".

    Fail-visible (GO-5 PR-4 round 3): nothing is masked when the command has
    an unquoted pipe or names an executor, since the data may reach it. A file
    written here and run by a LATER command is out of scope (never covered).
    """
    if "$'" in text:
        return text  # ANSI-C quoting is not modelled; never risk a desync
    if _has_unquoted_pipe(text) or _EXECUTOR_RE.search(text):
        return text
    out = []
    words: list[str] = []
    word = ""
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text):
            out.append(text[index:index + 2])
            word += text[index:index + 2]
            index += 2
            continue
        if char in "'\"":
            end = _data_argument_quote_end(text, index)
            body = text[index + 1:end]
            if words and _is_data_command(words):
                body = "" if char == "'" else _executable_expansions(body)
            out.append(char + body + (char if end < len(text) else ""))
            word += char
            index = end + 1
            continue
        if char in ";|&()\n":
            words, word = [], ""
        elif char in " \t":
            if word:
                words.append(word)
            word = ""
        else:
            word += char
        out.append(char)
        index += 1
    return "".join(out)


def _data_argument_quote_end(text: str, start: int) -> int:
    """Find a data-command argument's real closing quote.

    A double-quoted argument may contain complete `$()` or backtick regions
    with their own quotes.  Those inner delimiters cannot close the argument.
    The caller intentionally receives ``len(text)`` for an unclosed argument,
    preserving the established fail-visible behavior.
    """
    quote = text[start]
    index = start + 1
    while index < len(text):
        char = text[index]
        if quote == '"' and char == "\\":
            index += 2
            continue
        if quote == '"' and text.startswith("$(", index):
            index = _data_dollar_paren_end(text, index)
            continue
        if quote == '"' and char == "`":
            index = _data_backtick_end(text, index)
            continue
        if char == quote:
            return index
        index += 1
    return len(text)


def shell_text_without_heredoc_bodies(
    command: str, *, _preserve_heredoc_delimiters: bool = False
) -> str:
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
                output.append(
                    source_line
                    if mask_body and _preserve_heredoc_delimiters
                    else ending if mask_body else source_line
                )
            else:
                if mask_body:
                    kept = "" if quoted else _executable_expansions(line)
                    output.append(kept + ending)
                else:
                    # In an unquoted heredoc, quotes are literal to the parent
                    # shell while `$()`/backticks still execute.  Preserve
                    # those expansions before the raw body is later parsed as
                    # child-shell text, so a literal apostrophe cannot hide
                    # the parent-side command.
                    if not quoted:
                        kept = _executable_expansions(line)
                        if kept:
                            output.append(kept + ending)
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


def _data_backtick_end(text: str, start: int) -> int:
    """Index after a DATA-model legacy substitution, or fail closed.

    Backtick bodies keep the GENERAL parser's legacy rule: an escaped backtick
    is data for the recursive pass, while the first unescaped backtick closes
    the body. Quote state belongs to that recursive body, not this delimiter.
    """
    index = start + 1
    while index < len(text):
        if text[index] == "\\":
            index += 2
            continue
        if text[index] == "`":
            return index + 1
        index += 1
    raise ValueError("unterminated command substitution")


def _data_dollar_paren_end(text: str, start: int) -> int:
    """Index after a quote-aware DATA-model `$()` substitution.

    This deliberately stays separate from the GENERAL parser model. It mirrors
    its shell quote rules while skipping nested substitutions as complete
    regions so their delimiters cannot close the containing `$()`.
    """
    found = _dollar_substitution(text, start)
    if found is None:
        raise ValueError("unterminated command substitution")
    _body, end = found
    return end

"""Non-rm command and process-kill policy moved from git_safety.py."""

from __future__ import annotations

import os
import re
import shlex

# ── pkill/killall argument-order folding ────────────────────────────────────────
# BSD getopt stops at the first non-option operand, so `pkill -f 'x' -P 1` folds `-P`
# and `1` INTO the pattern — it is exactly `pkill -f 'x|-P|1'`, i.e. SIGTERM to every
# process whose full argv contains the character `1`. On 2026-09-05 that killed 20
# launchd jobs and every Claude seat whose argv held a `1` (verified read-only at the
# time: `pgrep -f 'inbox.jsonl' -P 1` and `pgrep -f 'inbox.jsonl|-P|1'` returned
# identical 92-pid sets, while `pgrep -f -P 1 'inbox.jsonl'` returned 1).
# See the fleet incident write-up docs.local/incidents/2026-09-05-mass-claude-kill.md.
#
# AIDEV-NOTE: scope limit — the hook sees ONE command string at a time, so the
# "assert a `pgrep` dry-run under 5 matches first" half of the prevention rule is only
# mechanically checkable when both appear on the same command line. This guard enforces
# the argument ORDER and the degenerate-pattern shape; the dry-run requirement is
# carried as GUIDANCE in the deny message. Do not claim it is enforced in general.
_KILL_MATCHER_COMMANDS = {"pkill", "killall"}

# Options that consume a SEPARATE following word. Knowing these is what keeps the
# CORRECT form (`pkill -u 501 -f 'x'`) from reading as pattern-then-flag and being
# false-blocked. Union of pkill(1) and killall(1) across BSD and Linux; `-s` is treated
# as value-taking (Linux `killall -s TERM`) because guessing that way can only cost a
# miss, never a false block.
_KILL_OPTIONS_WITH_VALUE = {
    "-c", "-d", "-g", "-G", "-j", "-P", "-s", "-t", "-u", "-U", "-z", "-Z",
    "--context", "--delimiter", "--euid", "--group", "--jail", "--ns",
    "--older-than", "--parent", "--pgroup", "--session", "--signal",
    "--terminal", "--uid", "--user", "--younger-than",
}
_KILL_FULL_MATCH_OPTIONS = {"--full"}

_KILL_GUIDANCE = (
    "Use `pkill -f -P 1 'pattern'`, and show `pgrep -f 'pattern'` with fewer than 5 "
    "matches first. Prefer a pidfile, `lsof`, or `launchctl kickstart -k`."
)


def _top_level_alternation(pattern: str) -> list[str]:
    """Split a regex on `|` at nesting depth 0, ignoring escapes, groups and classes."""
    branches: list[str] = []
    current = ""
    depth = 0
    in_class = False
    escaped = False
    for char in pattern:
        if escaped:
            current += char
            escaped = False
            continue
        if char == "\\":
            current += char
            escaped = True
            continue
        if in_class:
            current += char
            if char == "]":
                in_class = False
            continue
        if char == "[":
            in_class = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif char == "|" and depth == 0:
            branches.append(current)
            current = ""
            continue
        current += char
    branches.append(current)
    return branches


def _degenerate_kill_pattern(pattern: str, *, api: dict) -> bool:
    """True for the `-f` patterns that match nearly every process on the machine.

    Applied to the POST-FOLDING effective pattern (all operands joined with `|`, which
    is what BSD getopt actually hands the matcher). Deliberately narrow beyond that — a
    false block here costs more than a miss — so only the shapes folding produces are
    caught: three characters or fewer, all digits, or a top-level alternation carrying a
    one-character or bare `-`-prefixed branch. `pkill -f 'inbox.jsonl'` and
    `pkill -f 'foo|bar'` stay allowed.
    """
    if len(pattern) <= 3 or pattern.isdigit():
        return True
    branches = api['_top_level_alternation'](pattern)
    return len(branches) > 1 and any(
        len(branch) <= 1 or (branch.startswith("-") and len(branch) > 1)
        for branch in branches
    )


def _kill_matcher_reason(words: list[str], position: int, command_name: str, *, api: dict) -> str | None:
    """Block pattern-matching kills whose flags trail the pattern, or whose `-f`
    pattern is the degenerate shape that trailing flags fold into."""
    index = position + 1
    operands: list[str] = []
    full_match = False
    while index < len(words):
        word = words[index]
        if word == "--":
            # Everything after `--` is an operand, never an option.
            operands.extend(words[index + 1:])
            break
        if not word.startswith("-") or word == "-":
            operands.append(word)
            index += 1
            continue
        if operands:
            return (
                f"Dangerous command: `{command_name}` options must precede the pattern "
                f"(BSD getopt folds trailing flags into the pattern). {api['_KILL_GUIDANCE']}"
            )
        option = word.split("=", 1)[0]
        if option in api['_KILL_FULL_MATCH_OPTIONS'] or (
            not word.startswith("--") and "f" in word[1:]
        ):
            full_match = True
        index += 1
        if "=" not in word and option in api['_KILL_OPTIONS_WITH_VALUE']:
            index += 1
    if full_match and operands:
        # Extra operands are not extra patterns: BSD getopt joins them into ONE
        # alternation, so judge the effective pattern the matcher really sees.
        effective = "|".join(operands)
        if len(operands) > 1:
            # `pkill` takes exactly ONE pattern; a second operand is not a second
            # pattern, it is a folded alternation branch.
            return (
                f"Dangerous command: `{command_name} -f` was given {len(operands)} "
                f"operands, which BSD getopt folds into the single pattern "
                f"{effective!r} — it matches nearly every process. {api['_KILL_GUIDANCE']}"
            )
        if api['_degenerate_kill_pattern'](effective):
            return (
                f"Dangerous command: `{command_name} -f {effective!r}` matches nearly "
                f"every process — this is the shape argument folding produces. "
                f"{api['_KILL_GUIDANCE']}"
            )
    return None


def _dangerous_non_rm_in_words(words: list[str], position: int = 0, *, api: dict) -> str | None:
    """Inspect git/railway only in executable command positions."""
    assignment_re = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=.*$", re.DOTALL)
    while (
        position < len(words)
        and words[position].lower() in api['_SHELL_CONTROL_PREFIXES']
    ):
        position += 1
    while position < len(words) and assignment_re.match(words[position]):
        position += 1
    if position >= len(words):
        return None

    command_name = os.path.basename(words[position]).lower()
    if command_name in {"sudo", "command", "builtin", "nohup", "exec"}:
        option_values = {
            "-u", "--user", "-g", "--group", "-h", "--host",
            "-p", "--prompt", "-C", "--close-from", "-a",
        } if command_name == "sudo" else set()
        nested = api['_skip_options'](words, position + 1, option_values)
        return api['_dangerous_non_rm_in_words'](words, nested)

    if command_name == "env":
        for index in range(position + 1, len(words)):
            option = words[index]
            split_value = None
            remainder = index + 1
            if option in {"-S", "--split-string"} and remainder < len(words):
                split_value = words[remainder]
                remainder += 1
            elif option.startswith("--split-string="):
                split_value = option.split("=", 1)[1]
            if split_value is None:
                continue
            try:
                split_words = shlex.split(split_value)
            except ValueError:
                return "Dangerous command: env split-string cannot be parsed safely"
            return api['_dangerous_non_rm_in_words'](split_words + words[remainder:])
        nested = api['_skip_options'](
            words,
            position + 1,
            {"-u", "--unset", "-C", "--chdir", "--argv0"},
        )
        while nested < len(words) and assignment_re.match(words[nested]):
            nested += 1
        return api['_dangerous_non_rm_in_words'](words, nested)

    if command_name == "time":
        nested = api['_skip_options'](
            words, position + 1, {"-o", "--output", "-f", "--format"}
        )
        return api['_dangerous_non_rm_in_words'](words, nested)

    if command_name == "nice":
        nested = api['_skip_options'](
            words, position + 1, {"-n", "--adjustment"}
        )
        return api['_dangerous_non_rm_in_words'](words, nested)

    if command_name in {"bash", "sh", "zsh", "dash", "ksh"}:
        for index in range(position + 1, len(words) - 1):
            option = words[index]
            if option == "--command" or (
                option.startswith("-") and not option.startswith("--") and "c" in option[1:]
            ):
                return api['_dangerous_git_reason'](words[index + 1])
        return None

    if command_name == "find":
        for index in range(position + 1, len(words)):
            if words[index] in {"-exec", "-execdir"}:
                reason = api['_dangerous_non_rm_in_words'](words, index + 1)
                if reason:
                    return reason
        return None

    if command_name == "xargs":
        nested = api['_skip_options'](
            words,
            position + 1,
            {
                "-a", "--arg-file", "-d", "--delimiter", "-E",
                "-I", "-L", "--max-lines", "-n",
                "--max-args", "-P", "--max-procs", "-s", "--max-chars",
            },
        )
        return api['_dangerous_non_rm_in_words'](words, nested)

    if command_name in api['_KILL_MATCHER_COMMANDS']:
        return api['_kill_matcher_reason'](words, position, command_name)

    if command_name == "railway":
        if words[position + 1:position + 2] == ["down"]:
            return "Dangerous command: railway down"
        return None
    if command_name != "git":
        return None

    parsed = api['split_git'](shlex.join(["git", *words[position + 1:]]))
    if parsed is None:
        return None
    subcommand, arguments = parsed
    short_force = any(
        argument.startswith("-")
        and not argument.startswith("--")
        and "f" in argument[1:]
        for argument in arguments
    )
    if subcommand == "push" and ("--force" in arguments or short_force):
        return "Dangerous command: git push --force"
    if subcommand == "reset" and "--hard" in arguments:
        return "Dangerous command: git reset --hard"
    if subcommand == "clean" and ("--force" in arguments or short_force):
        return "Dangerous command: git clean -f"
    return None


def _dangerous_git_reason(command: str, *, api: dict) -> str | None:
    """Find destructive git/railway commands with quote-aware shell segmentation."""
    def lex(shell_text: str) -> list[str]:
        lexer = shlex.shlex(shell_text, posix=True, punctuation_chars=";&|()\n")
        lexer.whitespace = " \t\r"
        lexer.whitespace_split = True
        lexer.commenters = "#"
        return list(lexer)

    try:
        tokens = lex(command)
    except ValueError:
        # Bash accepts ANSI-C strings that Python shlex rejects. Neutralize only
        # complete ANSI-C strings and retry so a valid suffix cannot hide an
        # earlier destructive command.
        neutralized = re.sub(
            r"\$'(?:\\.|[^'\\])*'",
            "''",
            command,
            flags=re.DOTALL,
        )
        try:
            tokens = lex(neutralized)
        except ValueError:
            # Keep malformed prose in a non-command position quiet, but fail
            # closed for a destructive command at the executable position.
            return api['_dangerous_non_rm_in_words'](command.split())

    segment: list[str] = []
    for token in tokens + [";"]:
        if token and all(char in ";&|()\n" for char in token):
            reason = api['_dangerous_non_rm_in_words'](segment)
            if reason:
                return reason
            segment = []
        else:
            segment.append(token)
    return None



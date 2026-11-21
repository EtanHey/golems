#!/usr/bin/env python3
"""
PreToolUse hook: permission routing.

GREEN / YELLOW: allow. RED: block (dangerous rm, forced push, railway down,
destructive SQL, writes into secret files).

Historical retirement note (2026-09-25): GO-5 E2 removed the unrotated permissions_audit.jsonl (136.8 MB), the Telegram
`notify` call (never on PATH), the disabled P9 sleep gate, and the Task
tracker (E1: agent_states that nothing read).
"""

import os
import sys

# AIDEV-NOTE: no hook dir is ever FIRST on sys.path, even when this file runs
# without the launcher: the stdlib must win over anything planted beside it.
_HOOK_DIR = os.path.dirname(os.path.realpath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) != _HOOK_DIR] + [_HOOK_DIR]

import json
import sys
import os
import re
import subprocess
from pathlib import Path
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO


def _deny_policy_import_failure():
    """Fail closed before git_safety's normal policy boundary exists (#411)."""
    json.dump(
        {
            "decision": "block",
            "reason": "Blocked: a golems safety check couldn't run. Ask the lead to reinstall the hooks.",
        },
        sys.stdout,
    )
    sys.exit(2)

# GO-5 PR-2b: git_safety comes from THIS hook's tree (hooks-live when installed
# by scripts/hooks/install-hooks.sh), never the main checkout, so a pull or a
# branch switch there cannot change a live guard. realpath follows the
# ~/.claude/hooks/pre_tool_use.py symlink. GIT_GUARDIAN_LIB overrides (review sandboxes).
GIT_GUARDIAN_LIB = os.environ.get("GIT_GUARDIAN_LIB") or os.path.dirname(
    os.path.dirname(os.path.realpath(__file__))
)
if GIT_GUARDIAN_LIB not in sys.path:
    sys.path.append(GIT_GUARDIAN_LIB)  # after the stdlib: nothing in the tree may shadow it
try:
    # A corrupt module must not contaminate the one-JSON denial before raising.
    with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
        git_safety_path = os.path.realpath(
            os.path.join(GIT_GUARDIAN_LIB, "git_safety.py")
        )
        if not os.path.isfile(git_safety_path):
            raise ImportError("configured git_safety module is unavailable")
        import git_safety as _git_safety
        if os.path.realpath(_git_safety.__file__) != git_safety_path:
            raise ImportError("configured git_safety module was not loaded")
        dangerous_shell_reason = _git_safety.dangerous_shell_reason
        PolicyEvaluationDeadlineExceeded = (
            _git_safety.PolicyEvaluationDeadlineExceeded
        )
        cancel_policy_evaluation_deadline = (
            _git_safety.cancel_policy_evaluation_deadline
        )
        policy_evaluation_deadline = _git_safety.policy_evaluation_deadline
        policy_command_size_reason = _git_safety.policy_command_size_reason
        shell_text_without_heredoc_bodies = (
            _git_safety.shell_text_without_heredoc_bodies
        )
except BaseException:  # policy dependency uncertainty must never become allow
    _deny_policy_import_failure()


def archived_delete_shape(command):
    """Literal candidate shape, only for selecting the longer policy budget."""
    import shlex
    try:
        words = shlex.split(command)
        prefix = words[:3] + ['push'] if words[:2] == ['git', '-C'] else ['git', 'push']
        tail = words[len(prefix):]
        if words[:len(prefix)] != prefix or len(tail) != 3:
            return False
        match = re.fullmatch(r'--force-with-lease=(refs/heads/.+):[0-9a-f]{40}', tail[0])
        if not match or tail[2] != ':' + match[1]:
            return False
        return True
    except (ValueError, IndexError):
        return False


def archived_delete_allowed(command, cwd):
    """Validation only; the mandatory gate hook writes the allowed-attempt row."""
    import subprocess
    if not archived_delete_shape(command):
        return False
    try:
        gate = os.path.join(GIT_GUARDIAN_LIB, '..', 'human-confirm-gate', 'hooks', 'human-confirm-pretooluse.py')
        payload = dict(tool_name='Bash', cwd=cwd, session_id='guardian-archive-check',
                       tool_input=dict(command=command))
        result = subprocess.run([sys.executable, '-I', '-B', gate, '--archive-check-only'], input=json.dumps(payload),
                                capture_output=True, text=True, timeout=7)
        return result.returncode == 0 and json.loads(result.stdout) == {}
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


# --- Permission Classification ---

# GREEN: safe, read-only operations — no logging needed
GREEN_TOOLS = {"Read", "Grep", "Glob", "WebSearch", "WebFetch", "TaskList", "TaskGet"}

# Commands that are always GREEN
GREEN_COMMANDS = {
    "git status", "git log", "git diff", "git branch", "git show",
    "git fetch", "bun test", "bun --version", "node --version",
    "python3 --version", "ls", "pwd", "which", "notify",
}

# RED: destructive SQL DDL — matched as REAL SQL statements (word-boundaried +
# required object keyword), NOT bare substrings. This stops benign English like
# "truncated"/"dropped" and search/grep text from false-positiving, while still
# catching real `psql -c "TRUNCATE TABLE x"` / `sqlite3 db "DROP TABLE y"`.
RED_SQL_REGEXES = [
    (r"\bdrop\s+table\b", "DROP TABLE"),
    (r"\bdrop\s+database\b", "DROP DATABASE"),
    (r"\btruncate\s+table\b", "TRUNCATE TABLE"),
]


# RED: file access patterns — matched as file paths, not substrings.
# Uses regex to avoid false positives on inline code (e.g. process.env.API_KEY).
RED_FILE_REGEXES = [
    r'(?:^|\s|/|")\.env(?!\.example)',  # all dotenv prefixes, but NOT .env.example
    r'(?:^|\s|/)credentials\.\w+',              # credentials.json (not GOOGLE_CREDENTIALS)
    r'(?:^|\s|/)secrets?\.\w+',                 # secret.yaml, secrets.json
    r'\S+\.pem(?:\s|$|")',                       # *.pem files
    r'\S+\.key(?:\s|$|")',                       # *.key files
]

def sensitive_path(path):
    return any(re.search(p, os.path.basename(path)) for p in RED_FILE_REGEXES)


def schema_comment_safe(line):
    """Closed annotation grammar; comments never exempt credential shapes."""
    if (re.search(r'[A-Za-z0-9_+/-]{20,}={0,2}', line)
            or re.search(r'\b(?:sk[_-]|ghp_|github_pat_|sbp_|xox[baprs]-|AKIA)[A-Za-z0-9_./+-]+', line)
            or re.search(r'\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', line)
            or re.search(r'(?<![\w@])[A-Za-z_][A-Za-z0-9_-]*\s*:\s*\S+', line)
            or re.search(r'-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}', line)):
        return False
    values = {
        'type': {'string', 'number', 'boolean'},
        'sensitive': {'true', 'false'},
        'defaultSensitive': {'true', 'false'},
        'defaultRequired': {'true', 'false', 'infer'},
        'defaultDynamic': {'true', 'false'},
    }
    valued = set(values) | {'description', 'currentEnv'}
    for assignment in re.finditer(r'(?<!\w)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?=\S)', line):
        if line[assignment.start() - 1:assignment.start()] != '@' or assignment[1] not in valued:
            return False
    for decorator in re.finditer(r'@([A-Za-z_][A-Za-z0-9_]*)(?:=([^@]*))?', line):
        name, value = decorator.groups()
        if value is None:
            if name not in {'public', 'required', 'optional', 'sensitive'}:
                return False
            continue
        value = value.split('#', 1)[0].strip()
        if name in values:
            if value not in values[name]:
                return False
        elif name == 'description':
            if not (1 <= len(value) <= 96 and re.fullmatch(r"[A-Za-z0-9 .,()'!?/_-]+", value)):
                return False
        elif name == 'currentEnv':
            if not re.fullmatch(r'\$[A-Za-z_][A-Za-z0-9_]{0,31}', value):
                return False
        else:
            return False
    return True


def schema_content_safe(text):
    """Conservative Varlock subset: empty entries and typed scalar defaults.

    Varlock permits secrets in schemas too; neither the suffix nor @public is
    evidence of safety. Arbitrary strings, expressions and multiline values
    stay guarded. See https://varlock.dev/guides/schema/.
    """
    kind = None
    default_public = False
    public = False
    seen_item = False
    for line in text.splitlines():
        line = line.strip()
        if not line:
            kind = None
            public = default_public
            continue
        if line.startswith('#'):
            if not schema_comment_safe(line):
                return False
            root = re.search(r'@defaultSensitive=(true|false)\b', line)
            if not seen_item and root:
                default_public = public = root[1] == 'false'
            if re.search(r'@sensitive=false\b|@public\b', line):
                public = True
            match = re.search(r'@type=(number|boolean)\b', line)
            if match and kind != 'sensitive':
                kind = match[1]
            if re.search(r'@sensitive(?:\s|$|=true)', line):
                kind = 'sensitive'
                public = False
            continue
        match = re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*=(.*)', line)
        if not match:
            return False
        value = match[1].strip()
        if value and not (public and (kind == 'number' and re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?', value)
                                     and sum(char.isdigit() for char in value) <= 6
                                     or kind == 'boolean' and value in ('true', 'false'))):
            return False
        seen_item = True
        kind = None
        public = default_public
    return True


def safe_schema_edit(tool, inputs):
    path = Path(inputs.get('file_path', ''))
    if path.name != '.env.schema' or path.is_symlink():
        return False
    try:
        tracked = subprocess.run(['git', '-C', str(path.resolve().parent), 'ls-files',
                                  '--error-unmatch', '--', path.name],
                                 capture_output=True, timeout=1)
        if tracked.returncode:
            return False
        before = path.read_text()
        if not schema_content_safe(before):
            return False
        if tool == 'Write':
            after = inputs['content']
        elif tool == 'Edit':
            old, new = inputs['old_string'], inputs['new_string']
            if not old or old not in before:
                return False
            after = before.replace(old, new, -1 if inputs.get('replace_all') else 1)
        else:
            return False
        return schema_content_safe(after)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        return False


def secret_shell_write(command, depth=0, cwd=None, guarded_context=False):
    """Inspect literal write operands using the shared quote-aware tokenizer."""
    # Avoid a second recursive parse for commands with no guarded path at all.
    # Removing quote/escape characters here only widens the candidate check;
    # the shared tokenizer below still decides the actual operand boundaries.
    candidate = command.translate(str.maketrans('', '', "'\"\\"))
    guarded_context = guarded_context or bool(re.search(
        r'\.env|credentials\.|secrets?\.|\.pem\b|\.key\b', candidate))
    if not guarded_context and not any(char in candidate for char in '*?['):
        return False
    if depth > 16:
        return True
    parser = _git_safety._pkg.shell_parse
    def guarded_target(path):
        # A guarded literal elsewhere in this command may bind this variable.
        # Glob shapes here are write targets; syntax brackets elsewhere do not
        # make an unresolved destination part of a guarded-file operation.
        return (sensitive_path(path) or bool(re.search(r'[*?\[]', path))
                or guarded_context and bool(re.search(r'[$`]', path)))
    active = parser._strip_heredoc_bodies(command)
    tokens = parser._shell_tokens(active, _operator_origin=True)
    operator = parser._tokens._ShellOperator

    def operands_for(name, args):
        """Known option values are not operands; -- ends option processing."""
        options = {
            'cp': {'-t', '--target-directory', '-S', '--suffix'},
            'mv': {'-t', '--target-directory', '-S', '--suffix'},
            'install': {'-t', '--target-directory', '-S', '--suffix', '-m', '--mode', '-o', '--owner', '-g', '--group'},
            'ln': {'-t', '--target-directory', '-S', '--suffix'},
            'truncate': {'-s', '--size', '-r', '--reference'},
            'rsync': {'-e', '--rsh', '--exclude', '--include', '--filter', '--files-from', '--exclude-from', '--include-from', '--suffix', '--backup-dir'},
        }.get(name, set())
        operands, directory = [], None
        index, parsing_options = 0, True
        while index < len(args):
            arg = args[index]
            if isinstance(arg, operator) and arg.startswith(('<', '>')):
                if operands and operands[-1].isdigit():
                    operands.pop()
                index += 2
                continue
            if parsing_options and arg == '--':
                parsing_options = False
            elif parsing_options and arg.startswith('-') and arg != '-':
                option, separator, value = arg.partition('=')
                if option in options and not separator:
                    if index + 1 >= len(args):
                        return operands, directory
                    index += 1
                    value = args[index]
                if option in {'-t', '--target-directory'}:
                    directory = value
                elif '-t' in options and arg.startswith('-t') and not arg.startswith('--'):
                    directory = arg[2:]
            else:
                operands.append(arg)
            index += 1
        return operands, directory

    def inplace_files(name, args):
        """Separate sed/perl program arguments from the files they rewrite."""
        files, program_seen = [], False
        index, parsing_options = 0, True
        program_options = {'-e', '--expression'} | ({'-f', '--file'} if name == 'sed' else set())
        while index < len(args):
            arg = args[index]
            if isinstance(arg, operator) and arg.startswith(('<', '>')):
                index += 2
                continue
            if parsing_options and arg == '--':
                parsing_options = False
            elif parsing_options and arg in program_options:
                program_seen = True
                index += 2
                continue
            elif parsing_options and (arg.startswith('--expression=') or arg.startswith('-e') and len(arg) > 2
                                     or name == 'sed' and (arg.startswith('--file=') or arg.startswith('-f') and len(arg) > 2)):
                program_seen = True
            elif parsing_options and arg.startswith('-') and arg != '-':
                if name == 'sed' and arg == '-i' and index + 1 < len(args) and (not args[index + 1] or args[index + 1].startswith('.')):
                    index += 1  # BSD's separate backup suffix, including ''.
            elif not program_seen:
                program_seen = True
            else:
                files.append(arg)
            index += 1
        return files or args  # Uncertain/missing file argv remains fail-closed.

    for i, token in enumerate(tokens[:-1]):
        if isinstance(token, operator) and token.startswith('>') and guarded_target(tokens[i + 1]):
            return True
    segments, segment = [], []
    for token in tokens:
        if isinstance(token, operator) and token in (';', '|', '||', '&&', '&', '(', ')', '\n'):
            segments.append(segment)
            segment = []
        else:
            segment.append(token)
    segments.append(segment)
    for words in segments:
        positions = parser._command_position_flags(words)
        if any(secret_shell_write(body, depth + 1, cwd, guarded_context) for body, _, _ in
               parser._shell_command_payloads(words, positions, [0] * len(words))):
            return True
        for i, word in enumerate(words):
            name = os.path.basename(word)
            if re.fullmatch(r'g?(cp|mv|sed|tee|install|dd|ln|truncate|rsync|sponge)', name):
                name = name.removeprefix('g')
            if not positions[i] or name not in ('sed', 'perl', 'tee', 'cp', 'mv', 'rm', 'install', 'dd', 'ln', 'truncate', 'rsync', 'sponge'):
                continue
            args = words[i + 1:]
            inplace = (name == 'sed' and any(a == '--in-place' or a.startswith('--in-place=') or a.startswith('-i') for a in args)
                       or name == 'perl' and any(a.startswith('-') and not a.startswith('--') and 'i' in a[1:] for a in args))
            operands, directory = operands_for(name, args)
            if name in ('cp', 'mv', 'install', 'ln', 'rsync'):
                targets = operands[-1:]
                if directory is not None:
                    if guarded_target(directory):
                        return True
                    targets = [os.path.join(directory, os.path.basename(a)) for a in operands]
                elif operands and os.path.isdir(os.path.join(cwd or os.getcwd(), operands[-1])):
                    targets = [os.path.join(operands[-1], os.path.basename(a)) for a in operands[:-1]]
                if name == 'mv':
                    targets += operands[:-1]
            elif name == 'dd':
                targets = [arg[3:] for arg in args if arg.startswith('of=')]
            elif name in ('tee', 'rm', 'truncate', 'sponge'):
                targets = operands
            elif inplace:
                targets = inplace_files(name, args)
            else:
                targets = []
            if any(guarded_target(a) for a in targets):
                return True
            break
    outer = parser.without_dollar_paren_bodies(active)
    bodies = parser._backtick_bodies(outer) + _git_safety._executed_payloads(command, active)
    return any(secret_shell_write(body, depth + 1, cwd, guarded_context) for body in bodies)


def classify_tool(tool_name, tool_input):
    """Classify tool call as GREEN, YELLOW, or RED."""

    # GREEN tools
    if tool_name in GREEN_TOOLS:
        return "GREEN", None

    # Bash commands need deeper inspection
    if tool_name == "Bash":
        raw_command = tool_input.get("command", "")
        try:
            size_reason = policy_command_size_reason(raw_command)
            if size_reason:
                return "RED", size_reason
            guardian_reason = dangerous_shell_reason(raw_command, cwd=tool_input.get("cwd", os.getcwd()))
            command = shell_text_without_heredoc_bodies(raw_command)
        except PolicyEvaluationDeadlineExceeded:
            raise
        except Exception:  # policy uncertainty must never become fail-open allow
            return "RED", "security policy could not evaluate command safely"
        if (guardian_reason and 'remote reference deletion' in guardian_reason
                and archived_delete_allowed(raw_command, tool_input.get("cwd", os.getcwd()))):
            guardian_reason = None
        if guardian_reason:
            reason = (
                guardian_reason
                if guardian_reason.startswith("Dangerous command:")
                else f"Dangerous command: {guardian_reason}"
            )
            return "RED", reason
        # Check destructive SQL DDL (real-SQL-shaped match — avoids 'truncated' etc.)
        for sql_re, label in RED_SQL_REGEXES:
            if re.search(sql_re, command, re.IGNORECASE):
                return "RED", f"Dangerous command: {label}"

        # Redirects remain writes even on inline-code commands.
        try:
            if secret_shell_write(raw_command, cwd=tool_input.get('cwd', os.getcwd())):
                return "RED", "Sensitive file operation"
        except Exception:
            return "RED", "security policy could not evaluate command safely"

        # GREEN commands
        for green_cmd in GREEN_COMMANDS:
            if command.strip().startswith(green_cmd):
                return "GREEN", None

        # YELLOW: everything else in Bash
        return "YELLOW", None

    # Edit/Write are YELLOW
    if tool_name in ("Edit", "Write", "NotebookEdit"):
        file_path = tool_input.get("file_path", "")
        basename = os.path.basename(file_path)
        # RED if touching sensitive files
        if any(re.search(p, basename) for p in RED_FILE_REGEXES):
            if safe_schema_edit(tool_name, tool_input):
                return "YELLOW", None
            return "RED", f"Editing sensitive file: {file_path}"
        return "YELLOW", None

    # Default: YELLOW for unknown tools
    return "YELLOW", None


def block(reason):
    cancel_policy_evaluation_deadline()
    operation = 'a destructive operation'
    for needle, name in [('local branch', 'deleting a local branch'), ('push --force', 'force-push'), ('reset --hard', 'reset --hard'),
                         ('reference deletion', 'deleting a remote branch'),
                         ('clean', 'clean'), ('branch', 'deleting a branch'),
                         ('restore', 'discarding changes'), ('checkout', 'discarding changes'),
                         ('rm', 'deleting files'), ('find', 'deleting files'),
                         ('rsync', 'deleting files'), ('SQL', 'deleting database data'),
                         ('TABLE', 'deleting database data'), ('DATABASE', 'deleting database data'),
                         ('railway', 'stopping a service'), ('Sensitive', 'changing secret files'),
                         ('sensitive', 'changing secret files'), ('kill', 'stopping processes')]:
        if needle in (reason or ''):
            operation = name
            break
    result_reason = f"Blocked: this git command can destroy work ({operation}). Use a safe alternative, or ask the lead."
    if 'update-ref --stdin input is not in the command' in (reason or ''):
        result_reason += (' git update-ref --stdin reads its input from somewhere this command does not show, '
                          'so the guard cannot tell which branches it moves; put the lines in a heredoc or printf.')
    if 'remote reference deletion' in (reason or ''):
        result_reason += (' To delete a fleet branch: run scripts/fleet/archive-and-delete-branch.sh, '
                          'then the command it prints.')
    if reason == "security policy could not evaluate command safely":
        result_reason = (
            "Blocked: the golems safety check couldn't parse this command, so it can't confirm it's safe. "
            "Simplify it (for example, put the script in a file), or ask the lead."
        )
    json.dump({"decision": "block", "reason": result_reason}, sys.stdout)
    sys.exit(2)


def allow():
    cancel_policy_evaluation_deadline()
    json.dump({}, sys.stdout)
    sys.exit(0)


def _main_under_deadline():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError:
        allow()

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})
    if tool_name == "Bash" and isinstance(tool_input, dict):
        tool_input = {**tool_input, "cwd": hook_input.get("cwd", tool_input.get("cwd", os.getcwd()))}
        # Literal cleanup may perform bounded network reads. Leave ordinary
        # parsing at 3 s; the installed watchdog/host budgets are 9/10 s.
        try:
            candidate = _git_safety._pkg.branch_cleanup._plan(tool_input.get("command", ""), tool_input["cwd"])
        except (ValueError, TypeError, AttributeError):
            candidate = None
        if candidate or archived_delete_shape(tool_input.get("command", "")):
            import signal
            signal.setitimer(signal.ITIMER_REAL, 8)


    # Workers retain their historical policy exemption, but oversized input
    # must never skip the parser budget boundary that prevents hook timeout.
    if os.environ.get("CLAUDE_WORKER"):
        if tool_name == "Bash" and isinstance(tool_input, dict):
            try:
                size_reason = policy_command_size_reason(tool_input.get("command", ""))
            except (TypeError, UnicodeError):
                size_reason = None
            if size_reason:
                block(size_reason)
        allow()

    # Classify the tool call
    classification, reason = classify_tool(tool_name, tool_input)

    if classification != "RED":
        allow()
    block(reason)


def main():
    try:
        with policy_evaluation_deadline():
            _main_under_deadline()
    except PolicyEvaluationDeadlineExceeded as exc:
        block(str(exc))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Dispatch and local-seat guards. All maintenance evidence is read-only."""
import os
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) != HERE]
import json
import re
import stat
from pathlib import Path

# Work dispatch to the M1. A message to an M1 LEAD (a top-level thread) is allowed during a window so
# orc and leads can still talk to it. A send to a delegated child starts a fresh task and `restart`
# interrupts work, so those stay blocked as dispatch.
TOOLS = re.compile(r'mcp__t3[-_]code__(delegate_task|t3_thread_send|t3_thread_launch|create_threads|schedule_task|run_scheduled_task_now|t3_thread_send_attachments|t3_thread_configure)\Z')
SEND = re.compile(r'mcp__t3[-_]code__t3_thread_send\Z')
# Top-level (lead) thread id shapes only. Every `thread:...` id is a child or generated thread
# (delegated tasks, provider-native subagents, scheduled runs) and stays blocked: allowlist, not denylist.
LEAD_THREAD = re.compile(r'(mcp|import):[A-Za-z0-9:_%-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


def lead_message(name, ti):
    thread = ti.get('threadId') if isinstance(ti, dict) else None
    return bool(SEND.fullmatch(name or '') and isinstance(thread, str) and LEAD_THREAD.fullmatch(thread)
                and ti.get('mode', 'auto') != 'restart')
REMOTE = {'ssh', 'scp', 'rsync', 'sftp', 'mosh'}


def read_file(path, private=False):
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('not a regular file')
        if private and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise ValueError('config must be owner-only')
        return stream.read()


def strings(value):
    return [v for v in value if isinstance(v, str) and v] if isinstance(value, list) else []


def configuration():
    path = Path.home() / '.golems/m1-window-gate.json'
    if not os.path.lexists(path):
        return None, None
    raw, config, error = '', {}, None
    try:
        raw = read_file(path)
        config = json.loads(raw)
        if not isinstance(config, dict):
            config = {}
        read_file(path, private=True)
        if (config.get('schema') != 1 or not isinstance(config.get('registry'), str)
                or not os.path.isabs(config['registry']) or any(
                    not isinstance(config.get(k), list) or strings(config[k]) != config[k]
                    for k in ('m1_ssh_targets', 'm1_environment_ids'))):
            raise ValueError('invalid schema or fields')
    except (OSError, ValueError):
        error = 'config invalid or unreadable (require schema 1, absolute registry, target lists, owner-only regular file)'
        # Preserve identifiable targets even if the enclosing JSON is truncated.
        for key in ('m1_ssh_targets', 'm1_environment_ids'):
            match = re.search(r'"' + key + r'"\s*:\s*', raw)
            if match and key not in config:
                try:
                    config[key] = json.JSONDecoder().raw_decode(raw[match.end():])[0]
                except ValueError:
                    pass
    if error:
        config['m1_ssh_targets'] = strings(config.get('m1_ssh_targets')) + ['m1']
    return config, error


def host(value):
    value = re.sub(r'^(?:ssh|scp|sftp|rsync)://', '', value)
    return value.split('/', 1)[0].split(':', 1)[0].casefold()


def remote_args(base, args, targets):
    # Option arity matters: an identity filename or -o value is never a host.
    values = {'ssh': 'BbcDEeFIiJLlmOopQRSWw', 'scp': 'cDFiJloPSX',
              'sftp': 'BbcDFiJloPRS', 'mosh': 'p', 'rsync': 'efBMT'}[base]
    long_values = {'--rsh', '--exclude', '--include', '--filter', '--files-from',
                   '--exclude-from', '--include-from', '--rsync-path', '--port', '--ssh', '--server'}
    operands, i = [], 0
    while i < len(args):
        arg = args[i]; i += 1
        if arg == '--':
            operands.extend(args[i:i + 1] if base in ('ssh', 'mosh', 'sftp') else args[i:]); break
        if arg.startswith('--'):
            if arg.split('=', 1)[0] in long_values and '=' not in arg:
                i += 1
            continue
        if arg.startswith('-'):
            for j, letter in enumerate(arg[1:], 1):
                if letter in values:
                    i += int(j == len(arg) - 1)
                    break
            continue
        operands.append(arg)
        if base in ('ssh', 'mosh', 'sftp'):
            break  # the rest is remote command text, never another destination
    return any(host(arg) in targets or host(arg).rsplit('@', 1)[-1] in targets
               for arg in operands if base not in ('scp', 'rsync') or ':' in arg)


def bash_bound(command, targets, depth=0):
    if depth > 8:
        return False
    sys.path.append(str(Path(HERE).parents[1] / '_shared'))
    import shell_parse as shell
    with shell.policy_evaluation_deadline():
        tokens, positions, segments, scopes = shell._parse_bash(command)
        for i, word in enumerate(tokens):
            if not positions[i] or os.path.basename(word) not in REMOTE:
                continue
            args = []
            for j in range(i + 1, len(tokens)):
                if segments[j] != segments[i] or scopes[j] != scopes[i] or shell._is_separator(tokens, j):
                    break
                args.append(tokens[j])
            if remote_args(os.path.basename(word), args, targets):
                return True
        nested = [body for body, *_ in shell._executable_subcommands(shell._strip_heredoc_bodies(command))]
        nested += [body for body, *_ in shell._shell_command_payloads(tokens, positions, segments)]
        return any(bash_bound(body, targets, depth + 1) for body in nested)


def environment_ids(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key == 'environmentId' and isinstance(child, str):
                yield child
            yield from environment_ids(child)
    elif isinstance(value, list):
        for child in value:
            yield from environment_ids(child)


def registry_state(text):
    lanes, windows = {}, {}
    for line in text.splitlines():
        fields = [f.strip() for f in line.split('|')]
        if len(fields) < 4 or fields[0] != 'EVENT':
            continue
        values = {}
        for field in fields[3:]:
            key, sep, value = field.partition('=')
            if sep:
                values.setdefault(key.strip(), value.strip())
        if fields[2] == 'WINDOW':
            if fields[3] in ('OPEN', 'CLOSED') and values.get('stem'):
                windows[values['stem']] = (fields[3], fields[1])
        elif values.get('lane') and not values['lane'].startswith('<'):
            lanes[values['lane']] = fields[2].upper()
    return lanes, windows


def carries(text, token):
    return re.search(r'(?<![A-Za-z0-9._-])' + re.escape(token) + r'(?![A-Za-z0-9._:-])', text)


def deny(reason="Blocked: the M1 safety check couldn't read its settings. Ask the lead to fix the m1-window-gate config."):
    return {'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny',
                                  'permissionDecisionReason': reason}}


def read_only_words(words):
    if not words:
        return True
    name, *args = words
    base = os.path.basename(name)
    if name not in (base, '/bin/' + base, '/usr/bin/' + base):
        return False
    if base == 'git':
        return (bool(args) and args[0] in {'status', 'log', 'diff', 'show', 'rev-parse'}
                and not any(a.split('=', 1)[0] in {'--output', '--ext-diff', '--textconv'} for a in args))
    if base == 'find':
        return not any(a in {'-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint',
                             '-fprint0', '-fprintf', '-fls'} for a in args)
    if base == 'rg':
        return not any(a.split('=', 1)[0] in {'--pre', '--hostname-bin'} for a in args)
    if base == 'du':
        return args[:1] == ['-s']
    if base == 'date':
        return all(a == '-u' or a.startswith('+') for a in args)
    return base in {'ls', 'cat', 'head', 'tail', 'wc', 'stat', 'ps', 'pgrep',
                    'uptime', 'df', 'grep', 'echo', 'pwd', 'whoami'}


def read_only_bash(command):
    if not isinstance(command, str):
        return False
    sys.path.append(str(Path(HERE).parents[1] / '_shared'))
    import shell_parse as shell
    try:
        with shell.policy_evaluation_deadline():
            if (shell.policy_command_size_reason(command)
                    or shell.executable_shell_structure_has_open_state(command)
                    or list(shell._executable_subcommands(command))):
                return False
            words = []
            for word, operator in shell._shell_operator_words(command):
                if not operator:
                    if '$' in word or '`' in word:
                        return False
                    words.append(word)
                elif word in {';', '|', '||', '&&', '&'} and read_only_words(words):
                    words = []
                else:  # Redirections, substitutions, functions and groups are not plain reads.
                    return False
            return read_only_words(words)
    except (Exception, shell.PolicyEvaluationDeadlineExceeded):
        return False


def evaluate_seat(payload):
    lock = Path.home() / '.golems/m1-procedure.lock'
    stem = None
    try:
        info = lock.lstat()
    except FileNotFoundError:
        return {}  # The inactive path costs one lstat; no config, owner or parser reads.
    except OSError:
        info = None
    try:
        if info is None or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError('unsafe lock')
        owner = json.loads(read_file(lock / 'owner.json'))
        if (not isinstance(owner, dict) or set(owner) != {'stem', 'uid'}
                or type(owner['uid']) is not int or owner['uid'] != os.getuid()
                or not isinstance(owner['stem'], str)
                or not re.fullmatch(r'[a-f0-9]{40}-\d{8}T\d{12}', owner['stem'])):
            raise ValueError('invalid owner')
        stem = owner['stem']
    except (OSError, ValueError):
        pass
    ti = payload.get('tool_input', {})
    text = json.dumps(ti, ensure_ascii=False)
    # The run's own lane may carry any run label (run1, run2, ...) with this stem's timestamp.
    own_lane = stem and re.search(r'(?<![A-Za-z0-9._-])m1-golems-sync-[A-Za-z0-9._:-]+-'
                                  + re.escape(stem.rsplit('-', 1)[-1]) + r'(?![A-Za-z0-9._:-])', text)
    if stem and (carries(text, stem) or own_lane):
        return {}
    name = payload.get('tool_name')
    if name == 'Bash' and read_only_bash(ti.get('command', '')):
        return {}
    if name == 'Bash' or name in {'Write', 'Edit', 'MultiEdit', 'NotebookEdit'}:
        return deny('Blocked: a golems install is running on this Mac, so only read-only commands are allowed. Wait for it to finish.')
    return {}


def evaluate(payload):
    config, error = configuration()
    if config is None:
        return {}
    name, ti = payload.get('tool_name'), payload.get('tool_input', {})
    text = ti.get('command', '') if name == 'Bash' else json.dumps(ti, ensure_ascii=False)
    targets = {host(t).rsplit('@', 1)[-1] for t in strings(config.get('m1_ssh_targets'))}
    bound = (bash_bound(text, targets) if name == 'Bash' else bool(
        TOOLS.fullmatch(name or '') and set(environment_ids(ti)) & set(strings(config.get('m1_environment_ids')))))
    if not bound or (name != 'Bash' and lead_message(name, ti)):
        return {}
    if error:
        return deny()
    try:
        lanes, windows = registry_state(read_file(config['registry']))
    except (OSError, ValueError):
        return deny()
    for stem, (status, opened) in windows.items():
        if status != 'OPEN' or carries(text, stem):
            continue
        utc = stem.rsplit('-', 1)[-1]
        own = any(state == 'STARTED' and re.fullmatch(r'm1-golems-sync-[A-Za-z0-9._:-]+-' + re.escape(utc), lane)
                  and carries(text, lane) for lane, state in lanes.items())
        if not own:
            return deny('Blocked: the M1 is in the middle of an install, so other work there has to wait. Try again when it finishes.')
    return {}  # Silent unless a window is OPEN: no closed-window advisory.


if __name__ == '__main__':
    mode = sys.argv[1:]
    payload = json.load(sys.stdin)
    result = (evaluate_seat(payload) if mode == ['--mode', 'seat'] else evaluate(payload)
              if mode in ([], ['--mode', 'dispatch']) else deny())
    print(json.dumps(result))
    sys.exit(2 if result.get('hookSpecificOutput', {}).get('permissionDecision') == 'deny' else 0)

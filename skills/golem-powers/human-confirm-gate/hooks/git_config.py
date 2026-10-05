"""Effective push configuration and destructive push-config writes; never runs a push."""
import hashlib
import json
import os
import re
import subprocess

GIT = '/usr/bin/git'
CONFIG_KEYS = r'^(remote\..*\.(push|mirror|url|pushurl)|remote\.pushdefault|push\.default|branch\..*\.(remote|pushremote|merge))$'
VALUE_OPTIONS = {'--repo', '--receive-pack', '--exec', '--push-option', '-o'}
FALSE = ('false', 'no', 'off', '0')


def read(repo, *args):
    # Same environment as the shell that will run the push, so the same config is judged.
    result = subprocess.run([GIT, '-C', repo, *args], capture_output=True, text=True, timeout=1)
    if result.returncode not in (0, 1):
        raise ValueError('cannot inspect effective push configuration')
    return result.stdout


def destructive_refspec(value):
    value = value.strip().strip('"').strip()
    return value.startswith('+') or value.startswith(':') and value != ':'  # ':' alone is "matching"


def truthy(value):
    return value is None or value.strip().strip('"').strip().lower() not in FALSE


def effective_push(args, repo):
    """Rewrite `git push` argv to the refspecs/flags git would actually use, plus a route digest.

    Config-supplied refspecs (remote.<r>.push) and mirror mode apply when the
    command names no refspec, so a configured delete/force becomes explicit."""
    config = {}
    for item in read(repo, 'config', '--null', '--get-regexp', CONFIG_KEYS).split('\0'):
        if item:
            key, sep, value = item.partition('\n')
            if not sep:
                raise ValueError('unresolved push configuration')
            config.setdefault(key, []).append(value)

    def last(key, default=''):
        return config.get(key, [default])[-1]
    branch = read(repo, 'symbolic-ref', '--quiet', '--short', 'HEAD').strip()
    if last('push.default', 'simple') not in ('nothing', 'current', 'upstream', 'tracking', 'simple', 'matching'):
        raise ValueError('unknown push.default')
    positional, flags, remote, i = [], [], '', 0
    while i < len(args):
        word = args[i]
        if word == '--':
            positional.extend(args[i + 1:]); break
        if word in VALUE_OPTIONS:
            i += 1
            if i >= len(args):
                raise ValueError('missing push option value')
            if word == '--repo': remote = args[i]
            else: flags.append(('--push-option' if word == '-o' else word) + '=' + args[i])
        elif word.startswith('--repo='):
            remote = word.split('=', 1)[1]
        elif re.fullmatch(r'-[A-Za-z]+', word) and 'o' in word:
            # -o takes the rest of a short cluster (or the next word) as its value.
            prefix, _, value = word[1:].partition('o')
            if prefix: flags.append('-' + prefix)
            if not value:
                i += 1
                if i >= len(args):
                    raise ValueError('missing push option value')
                value = args[i]
            flags.append('--push-option=' + value)
        elif word.startswith('-'):
            flags.append(word)
        else:
            positional.append(word)
        i += 1
    if not remote and positional:
        remote = positional.pop(0)
    if not remote:
        remote = (last('branch.' + branch + '.pushremote') or last('remote.pushdefault')
                  or last('branch.' + branch + '.remote') or 'origin')
    prefix = 'remote.' + remote + '.'
    refs = [] if positional else [value.strip() for value in config.get(prefix + 'push', [])]
    if truthy(last(prefix + 'mirror', 'false')):
        flags.append('--mirror')
    # Bind authorization to the selected route (URLs included) without copying
    # credential-bearing values into tokens or logs: only a digest travels.
    selected = {key: value for key, value in config.items() if key.startswith(prefix)
                or key in ('push.default', 'remote.pushdefault') or key.startswith('branch.' + branch + '.')}
    digest = hashlib.sha256(json.dumps(selected, sort_keys=True).encode()).hexdigest()
    return flags + [remote, *positional, *refs], digest


def destructive_setter(args):
    """`git config` argv that would store a force/delete push refspec or enable mirror."""
    if any(a.startswith(('--get', '--list', '--show', '--unset', '--rename-section', '--remove-section')) or a == '-l'
           for a in args):
        return None
    for i, word in enumerate(args[:-1]):
        match = re.fullmatch(r'remote\.(.+)\.(push|mirror)', word, re.I)
        if not match:
            continue
        value = args[i + 1]
        if '$' in value or '`' in value:
            raise ValueError('opaque push configuration value')
        if match[2].lower() == 'push' and destructive_refspec(value):
            return dict(class_='delete' if value.strip().startswith(':') else 'force', refs=[value.strip()], remote=match[1])
        if match[2].lower() == 'mirror' and truthy(value):
            return dict(class_='force', refs=['*'], remote=match[1])
    return None


_SECTION = re.compile(r'\[\s*([A-Za-z0-9.-]+)(?:\s+"(?:[^"\\]|\\.)*")?\s*\]')


def destructive_config(text):
    """Does git-config text store a force/delete push refspec or a true mirror under a remote?"""
    section = ''
    for raw in text.splitlines():
        line = raw.strip()
        while True:
            header = _SECTION.match(line)
            if not header:
                break
            section = header[1].lower().split('.')[0]
            line = line[header.end():].strip()
        if section != 'remote' or not line or line[0] in '#;':
            continue
        key, sep, value = line.partition('=')
        key = key.strip().lower()
        value = re.split(r'\s[#;]', value, maxsplit=1)[0] if sep else None
        if key == 'push' and value is not None and destructive_refspec(value):
            return True
        if key == 'mirror' and truthy(value):
            return True
    return False


def _config_file(target, cwd):
    if os.path.basename(target).casefold() not in ('config', 'config.worktree'):
        return False
    if any(part == '.git' or part.endswith('.git') for part in target.casefold().split(os.sep)[:-1]):
        return True
    try:
        common = read(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir').strip()
        return bool(common) and os.path.samefile(os.path.dirname(target), common)
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def destructive_edit(tool, args, cwd):
    """Write/Edit/MultiEdit whose RESULTING git config stores a destructive push route."""
    raw = args.get('file_path')
    if not isinstance(raw, str) or not raw:
        return False
    target = os.path.realpath(os.path.join(cwd, raw))
    if not _config_file(target, cwd):
        return False
    if tool == 'Write':
        return destructive_config(str(args.get('content', '')))
    try:
        with open(target, encoding='utf-8', errors='replace') as stream:
            text = stream.read()
    except OSError:
        text = ''
    for edit in (args.get('edits') or []) if tool == 'MultiEdit' else [args]:
        old, new = str(edit.get('old_string', '')), str(edit.get('new_string', ''))
        if not old:
            text = new + text
        else:
            text = text.replace(old, new) if edit.get('replace_all') else text.replace(old, new, 1)
    return destructive_config(text)

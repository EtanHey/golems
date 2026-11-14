"""Effective push configuration and destructive push-config writes; never runs a push."""
import hashlib
import json
import os
import re
import shutil
import subprocess

CONFIG_KEYS = r'^(remote\..*|push\.default|branch\..*\.(remote|pushremote|merge)|core\.sshcommand|ssh\..*|protocol\..*|http\..*|url\..*)$'
VALUE_OPTIONS = {'--repo', '--receive-pack', '--exec', '--push-option', '-o'}
FALSE = ('false', 'no', 'off', '0')


def find_executable(repo, executable, path=None):
    """Shell lookup only: None means no executable command will run."""
    if os.sep in executable:
        binary = os.path.abspath(os.path.join(repo, executable))
    else:
        search = os.pathsep.join(os.path.abspath(os.path.join(repo, part)) for part in
                                 (path if path is not None else os.environ.get('PATH', os.defpath)).split(os.pathsep))
        binary = shutil.which(executable, path=search)
    return binary if binary and os.path.isfile(binary) and os.access(binary, os.X_OK) else None


def resolve_git(repo, executable='git', path=None, environment=None):
    """Resolve Git, or the verified Git provider of a dashed command."""
    search_dirs = [os.path.abspath(os.path.join(repo, part)) for part in
                   (path if path is not None else os.environ.get('PATH', os.defpath)).split(os.pathsep)]
    search = os.pathsep.join(search_dirs)
    binary = find_executable(repo, executable, search)
    name = os.path.basename(executable)
    if name.casefold().startswith('git-'):
        providers = [os.path.join(directory, 'git') for directory in search_dirs]
        if binary:
            # An explicit other-install libexec/git-core command need not have
            # its bin directory on PATH. Verify this sibling candidate using
            # --exec-path too; never infer ownership from the layout alone.
            providers.append(os.path.abspath(os.path.join(os.path.dirname(binary), '../../bin/git')))
        for provider in dict.fromkeys(providers):
            if not os.path.isfile(provider) or not os.access(provider, os.X_OK):
                continue
            result = subprocess.run([provider, '--exec-path'], capture_output=True, text=True,
                                    cwd=repo, timeout=1, env=dict(os.environ if environment is None else environment, PATH=search))
            exec_path = result.stdout.strip()
            if result.returncode or not os.path.isabs(exec_path) or '\n' in exec_path:
                continue
            dashed = os.path.join(exec_path, name)
            if not os.path.isfile(dashed) or not os.access(dashed, os.X_OK):
                continue
            if ((binary is None and os.sep not in executable)
                    or (binary and os.path.isfile(binary) and os.path.samefile(binary, dashed))):
                return provider
        raise ValueError('cannot resolve dashed Git provider')
    if name.casefold() != 'git':
        raise ValueError('cannot inspect Git executable')
    if not binary or not os.path.isfile(binary) or not os.access(binary, os.X_OK):
        raise ValueError('cannot resolve push Git executable')
    return binary


def read(repo, *args, git_binary=None, missing_remote=False, path=None, environment=None):
    result = subprocess.run([git_binary or resolve_git(repo), '-C', repo, *args],
                            capture_output=True, text=True, timeout=1,
                            env=(environment if path is None else dict(os.environ if environment is None else environment, PATH=path)))
    if missing_remote and result.returncode == 2:
        return ''  # get-url's documented "no such remote": may be a literal URL/path.
    if result.returncode not in (0, 1):
        raise ValueError('cannot inspect effective push configuration')
    return result.stdout


def destructive_refspec(value):
    value = value.strip().strip('"').strip()
    return value.startswith('+') or value.startswith(':') and value != ':'  # ':' alone is "matching"


def truthy(value):
    return value is None or value.strip().strip('"').strip().lower() not in FALSE


def has_refspec(args):
    """Does push argv explicitly supply refs, after option operands and remote?"""
    positional, remote, i = [], False, 0
    while i < len(args):
        word = args[i]
        if word == '--':
            positional.extend(args[i + 1:]); break
        if word in VALUE_OPTIONS:
            remote |= word == '--repo'
            i += 2; continue
        if word.startswith('--repo='):
            remote = True
        elif re.fullmatch(r'-[A-Za-z]+', word) and 'o' in word:
            if not word.partition('o')[2]: i += 1
        elif not word.startswith('-'):
            positional.append(word)
        i += 1
    return len(positional) >= (1 if remote else 2)


def effective_push(args, repo, executable='git', path=None, bind=True, environment=None):
    """Rewrite `git push` argv to the refspecs/flags git would actually use, plus a route digest.

    Config-supplied refspecs (remote.<r>.push) and mirror mode apply when the
    command names no refspec, so a configured delete/force becomes explicit."""
    # Classification needs configured push/mirror flags, but allowed pushes
    # must not depend on token-only provider or destination resolution.
    binary = resolve_git(repo, executable, path) if bind else executable
    def inspect(*args, **kwargs):
        return read(repo, *args, git_binary=binary, path=path, environment=environment, **kwargs)
    config = {}
    for item in inspect('config', '--null', '--get-regexp', CONFIG_KEYS).split('\0'):
        if item:
            key, sep, value = item.partition('\n')
            if not sep:
                raise ValueError('unresolved push configuration')
            config.setdefault(key, []).append(value)

    def last(key, default=''):
        return config.get(key, [default])[-1]
    branch = inspect('symbolic-ref', '--quiet', '--short', 'HEAD').strip()
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
    expanded = flags + [remote, *positional, *refs]
    if not bind:
        return expanded, None
    # Bind authorization to the selected route (URLs included) without copying
    # credential-bearing values into tokens or logs: only a digest travels.
    selected = {key: value for key, value in config.items() if key.startswith(prefix)
                or key in ('push.default', 'remote.pushdefault', 'core.sshcommand')
                or key.startswith(('branch.' + branch + '.', 'ssh.', 'protocol.', 'http.', 'url.'))}
    # Ask Git even without a config stanza: legacy remotes/branches files can
    # resolve a name too. Literal paths/URLs bind rewrite rules above.
    selected['effective_push_urls'] = inspect('remote', 'get-url', '--push', '--all', '--', remote,
                                               missing_remote=True).splitlines()
    selected['git_binary'] = binary
    selected['environment'] = {key: value for key, value in os.environ.items()
                               if key.startswith('GIT_CONFIG_') or key in (
                                   'GIT_CONFIG', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT',
                                   'GIT_PROXY_COMMAND', 'GIT_EXEC_PATH')}
    digest = hashlib.sha256(json.dumps(selected, sort_keys=True).encode()).hexdigest()
    return expanded, digest


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

"""Structural classification only; never execute the inspected command."""
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '_shared'))
import shell_parse as shell


def literal(word):
    if any(c in word for c in '$`*?[]{}'):
        raise ValueError('dynamic command scope; use literal arguments')
    return word


def configured_alias(repo, name):
    if name == 'push':
        config = subprocess.run(['/usr/bin/git', '-C', repo, 'config', '--get-regexp', r'^remote\..*\.(push|mirror)$'],
                                capture_output=True, text=True, timeout=1)
        if config.returncode not in (0, 1) or any(' +' in line or (line.split()[0].endswith('.mirror') and line.split()[-1].lower() not in ('false', 'no', 'off', '0')) for line in config.stdout.splitlines()):
            raise ValueError('implicit force/mirror configuration; make scope explicit')
        return None
    result = subprocess.run(['/usr/bin/git', '-C', repo, 'config', '--get', 'alias.' + name],
                            capture_output=True, text=True, timeout=1)
    if result.returncode not in (0, 1):
        raise ValueError('cannot resolve git alias')
    return result.stdout.strip() or None


def git_words(words, cwd):
    repo, aliases, i = cwd, {}, 0
    while i < len(words) and words[i].startswith('-'):
        option = words[i]
        if option in ('-C', '-c'):
            value = literal(words[i + 1]); i += 2
            if option == '-C':
                repo = os.path.realpath(os.path.join(repo, value))
            elif value.startswith('alias.'):
                key, value = value.split('=', 1); aliases[key[6:]] = value
            else:
                # Config can inject force refspecs / receive-pack executors.
                raise ValueError('git config override needs separate inspection')
        elif option in ('--no-pager', '--paginate'):
            i += 1
        else:
            raise ValueError('unsupported git global option')
    return repo, aliases, words[i:]


def push_operation(args, repo):
    for word in args:
        literal(word)
    destructive = any(any(flag.startswith(a.split('=', 1)[0]) for flag in ('--force', '--force-with-lease', '--force-if-includes', '--delete', '--mirror', '--prune'))
                      or re.fullmatch(r'-[A-Za-z]*[fd][A-Za-z]*', a)
                      or a.startswith(('+', ':')) for a in args)
    if not destructive:
        return []
    leases = [a for a in args if a.startswith('--force-with-lease=')]
    # Lead authorization deliberately accepts only this narrow grammar.
    positional = [a for a in args if not a.startswith('-')]
    allowed_flags = set(leases) | {'--atomic', '--verbose', '-v'}
    if len(leases) == 1 and all(a in allowed_flags or not a.startswith('-') for a in args) and len(positional) == 2:
        match = re.fullmatch(r'--force-with-lease=(refs/heads/[^:]+):([0-9a-f]{40}|[0-9a-f]{64})', leases[0])
        if match:
            remote, refspec = positional
            source, sep, dest = refspec.partition(':')
            dest = dest if sep else source
            dest = dest if dest.startswith('refs/') else 'refs/heads/' + dest
            if dest == match[1] and source and not source.startswith('+'):
                return [dict(class_='lease', repo=repo, remote=remote, ref=dest,
                             sha=match[2], source=source)]
    refs = [a for a in positional[1:]]
    return [dict(class_='delete' if any(a.startswith(':') for a in refs) or any(a.startswith('--delete') or a == '-d' for a in args) else 'force',
                 repo=repo, refs=refs, remote=positional[0] if positional else '')]


_VAR = re.compile(r'\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))')


def resolve_word(word, bindings):
    def replace(match):
        value = bindings.get(match[1] or match[2])
        return value if value is not None and not any(c.isspace() for c in value) else match[0]
    return _VAR.sub(replace, word)


def assigned_bindings(tokens, positions, limit, initial, scopes, target=()):
    values = dict(initial)
    if any(t in ('(', '&', '|', 'if', 'for', 'while', 'case') for t in tokens):
        return {}  # Parent bindings are uncertain across control/subshell scope.
    if any(positions[i] and t in ('eval', 'source', '.', 'read', 'unset', 'export', 'declare', 'typeset', 'local', 'let', 'trap') for i, t in enumerate(tokens[:limit])):
        return {}  # These builtins can invalidate earlier literal assignments.
    for i, word in enumerate(tokens[:limit]):
        match = shell._ASSIGNMENT_RE.match(word)
        if scopes[i] == target and positions[i] and match and not match['subscript'] and not match['append']:
            name, value = word.split('=', 1)
            value = resolve_word(value, values)
            values[name] = value if '$' not in value and '`' not in value else None
    return values


def operations(command, cwd, alias_lookup=configured_alias, depth=0, bindings=None):
    if depth > 8 or shell.policy_command_size_reason(command):
        raise ValueError('command inspection budget exceeded')
    if shell.executable_shell_structure_has_open_state(command):
        raise ValueError('unparseable shell input')
    tokens, positions, segments, scopes = shell._parse_bash(command)
    bindings = dict(bindings or {})
    if shell._UNRESOLVED_EVAL_MARKER in tokens:
        raise ValueError('unresolved eval payload')
    result = []
    nested = shell._shell_command_payloads(tokens, positions, segments)
    nested += [(body, seg, idx) for body, seg, idx, _ in shell._executable_subcommands(command)]
    nested += shell._invoked_alias_bodies(command)
    for body, segment, _ in nested:
        limit = max((i + 1 for i, seg in enumerate(segments) if seg <= segment), default=0)
        child_bindings = assigned_bindings(tokens, positions, limit, bindings, scopes)
        result += operations(body, cwd, alias_lookup, depth + 1, child_bindings)
    for i, word in enumerate(tokens):
        if not positions[i]:
            continue
        current = assigned_bindings(tokens, positions, i, bindings, scopes, scopes[i])
        word = resolve_word(word, current)
        base = os.path.basename(word)
        if '$' in word or '`' in word:
            raise ValueError('unresolved executable; use a literal command')
        args = []
        for j in range(i + 1, len(tokens)):
            if base in ('git', 'gh') and tokens[j] in ('>', '>>', '<', '<<', '<<<'):
                raise ValueError('interleaved redirection obscures command arguments; split the command')
            if segments[j] != segments[i] or scopes[j] != scopes[i] or tokens[j] in (';', '&', '|', ')', '}$'):
                break
            args.append(resolve_word(tokens[j], current))
        if base == 'eval' and any('$' in a or '`' in a for a in args):
            raise ValueError('unresolved eval payload; use a literal command')
        if base == 'xargs' and any(os.path.basename(a) in ('git', 'gh', 'sh', 'bash', 'zsh') for a in args):
            raise ValueError('xargs supplies unresolved arguments; use a literal command')
        if base == 'env' and any(a == '-S' or a.startswith('--split-string') for a in args):
            raise ValueError('env split-string is opaque; use an explicit command')
        if base == 'cd':
            if len(args) != 1:
                raise ValueError('unresolved working directory')
            cwd = os.path.realpath(os.path.join(cwd, literal(args[0])))
        if base == 'git':
            for prefix in tokens[:i]:
                if prefix.startswith(('GIT_CONFIG', 'GIT_DIR=', 'GIT_WORK_TREE=', 'HOME=')):
                    raise ValueError('Git environment changes obscure repository/config scope')
            repo, aliases, words = git_words(args, cwd)
            if not words:
                continue
            sub, *tail = words
            literal(sub)
            alias = aliases.get(sub) or alias_lookup(repo, sub)
            if alias:
                body = alias[1:] if alias.startswith('!') else 'git ' + alias
                result += operations('cd ' + shlex.quote(repo) + '; ' + body + ' ' + shlex.join(tail), repo, alias_lookup, depth + 1, current)
            elif sub == 'push':
                # Replacement refs can survive in a later tool call. Their push
                # requires confirmation even without an explicit force flag.
                if any('refs/replace/' in a for a in tail):
                    result.append(dict(class_='rewrite', repo=repo, refs=tail))
                result += push_operation(tail, repo)
            elif sub in ('filter-repo', 'filter-branch', 'replace'):
                result.append(dict(class_='rewrite', repo=repo, refs=tail))
        elif base == 'gh':
            while args and args[0] in ('-R', '--repo', '--hostname'):
                args = args[2:]
            if args[:1] == ['api'] or args[:2] in (['repo', 'delete'], ['repo', 'edit']):
                for arg in args:
                    literal(arg)
            if args[:2] in (['repo', 'delete'], ['repo', 'edit']) and (args[1] == 'delete' or any(a.startswith('--visibility') for a in args)):
                result.append(dict(class_='settings', repo=cwd, target=args[2:]))
            elif args[:1] == ['api']:
                method, endpoint = 'GET', ''
                for j, arg in enumerate(args[1:], 1):
                    if arg in ('-X', '--method'):
                        method = args[j + 1].upper()
                    elif arg.startswith('-X') and arg != '-X':
                        method = arg[2:].upper()
                    elif arg.startswith('--method='):
                        method = arg.split('=', 1)[1].upper()
                    elif arg in ('-f', '-F', '--field', '--raw-field', '--input') or arg.startswith(('--field=', '--raw-field=', '--input=', '-f', '-F')):
                        if method == 'GET': method = 'POST'
                    elif arg.startswith(('repos/', '/repos/', 'https://api.github.com/repos/')):
                        endpoint = arg
                if method not in ('GET', 'HEAD', 'OPTIONS') and endpoint:
                    result.append(dict(class_='settings', repo=cwd, target=endpoint, method=method))
    # Public JSON uses the class spelling; deterministic order is token scope.
    for op in result:
        if 'class_' in op:
            op['class'] = op.pop('class_')
    return result

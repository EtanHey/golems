"""Gate-local argv views over the shared shell parser (no shell execution)."""
import os
import shlex

SHELLS = {'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'}
DATA = {'echo', 'printf', 'cat', 'rg', 'grep', 'sed', 'awk', 'test', '[', '[[', 'git', 'gh', 'trap'}
WRAPPERS = {'timeout', 'gtimeout', 'builtin', 'arch', 'xcrun', 'script', 'watch',
            'parallel', 'nice', 'nohup', 'env', 'sudo', 'stdbuf', 'caffeinate', 'time', 'exec', 'command'}
VALUE_OPTIONS = {'-k', '--kill-after', '-s', '--signal', '-n', '--interval', '-d', '--differences',
                 '-o', '-e', '-i', '-u', '-g', '-C', '--chdir', '--unset', '--user', '--group',
                 '--sdk', '--toolchain'}


def argv_at(tokens, segments, scopes, i):
    args, redirects = [], []
    j = i + 1
    while j < len(tokens) and segments[j] == segments[i] and scopes[j] == scopes[i]:
        word = tokens[j]
        if word in ('>', '>>', '>|', '<', '<<', '<<<', '<>', '&>', '&>>'):
            operator = word
            j += 1
            if j < len(tokens) and tokens[j] == '&':
                j += 1  # descriptor duplication, not a pipeline boundary
            if j >= len(tokens) or segments[j] != segments[i]:
                raise ValueError('missing redirection target')
            redirects.append((operator, tokens[j])); j += 1
            continue
        if word in (';', '&', '|', ')', '}$'):
            break
        args.append(word); j += 1
    return args, redirects


def wrapper_payload(base, args):
    if base == 'find':
        for i, arg in enumerate(args):
            if arg in ('-exec', '-execdir', '-ok', '-okdir'):
                end = next((j for j in range(i + 1, len(args)) if args[j] in (';', '+')), len(args))
                yield args[i + 1:end]
        return
    if base not in WRAPPERS:
        return
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == '--':
            i += 1; break
        if '=' in arg and not arg.startswith('-') and base == 'env':
            i += 1; continue
        if not arg.startswith('-'):
            break
        i += 2 if arg in VALUE_OPTIONS else 1
    if base in ('timeout', 'gtimeout', 'script'):
        i += 1  # duration / output transcript file
    if i < len(args):
        yield args[i:]


def shell_payload(base, args):
    if base not in SHELLS:
        return None
    for i, arg in enumerate(args):
        if arg == '--':
            break
        if arg.startswith('-') and not arg.startswith('--') and 'c' in arg[1:]:
            j = i + 1
            if j < len(args) and args[j] == '--': j += 1
            if j >= len(args): raise ValueError('missing shell payload')
            return args[j]
    return None


def joined(words):
    return shlex.join(words)


def guarded_words(words):
    return any(w in ('push', 'send-pack', 'filter-repo', 'filter-branch', 'replace',
                     'api', 'delete', 'edit', 'sync', 'archive', 'rename') or
               w.startswith(('--force', '--delete', '--mirror', '+', ':')) or
               w == '-f' for w in words)


def heredoc_bodies(command, shell):
    # Reuse shared quote/comment masking and delimiter parsing. Body data is
    # inspected only when its receiving command is an executable shell.
    from shell_parse_impl.heredocs import _HEREDOC_START_RE, _heredoc_delimiter_word, _blank_shell_comment
    from shell_parse_impl.masks import _blank_quoted
    lines = command.splitlines(keepends=True)
    i = 0
    while i < len(lines):
        line = lines[i]; pending = []
        for match in _HEREDOC_START_RE.finditer(_blank_shell_comment(_blank_quoted(line))):
            delimiter, _ = _heredoc_delimiter_word(line, match.end())
            pending.append((delimiter, bool(match[1])))
        i += 1
        for delimiter, tabs in pending:
            body = []
            while i < len(lines):
                value = lines[i].lstrip('\t') if tabs else lines[i]
                i += 1
                if value.rstrip('\r\n') == delimiter: break
                body.append(value)
            else:
                raise ValueError('unterminated heredoc')
            yield delimiter, ''.join(body)


def policy_path(raw, cwd, home):
    word = raw.replace('${HOME}', str(home)).replace('$HOME', str(home))
    if word.startswith('~/'): word = str(home) + word[1:]
    target = os.path.realpath(os.path.join(cwd, word)).casefold()
    protected = os.path.realpath(str(home / '.config/golems')).casefold()
    return target == protected or target.startswith(protected + '/')


def write_targets(base, args, redirects):
    targets = [target for operator, target in redirects if operator in ('>', '>>', '>|', '<>', '&>', '&>>')]
    operands = [a for a in args if not a.startswith('-')]
    if base in ('rm', 'rmdir', 'unlink', 'touch', 'mkdir', 'tee', 'chmod', 'chown', 'truncate'):
        targets += operands
    elif base in ('cp', 'mv', 'install', 'ln'):
        targets += operands[-1:]
        if base == 'mv': targets += operands[:-1]
        for i, arg in enumerate(args[:-1]):
            if arg in ('-t', '--target-directory'): targets.append(args[i + 1])
        targets += [arg.split('=', 1)[1] for arg in args if arg.startswith('--target-directory=')]
    elif base in ('sed', 'perl') and any(a.startswith('-i') for a in args):
        targets += operands
    elif base == 'find' and '-delete' in args:
        targets += operands
    return targets


def policy_write(base, args, redirects, cwd, home):
    return any(policy_path(t, cwd, home) for t in write_targets(base, args, redirects))

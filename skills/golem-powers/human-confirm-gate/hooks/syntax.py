"""Gate-local argv views over the shared shell parser (no shell execution)."""
import os
import re
import shlex
from pathlib import Path

SHELLS = {'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'}
DATA = {'echo', 'printf', 'cat', 'rg', 'grep', 'sed', 'awk', 'test', '[', '[[', 'git', 'gh', 'trap'}
WRAPPERS = {'timeout', 'gtimeout', 'builtin', 'arch', 'xcrun', 'script', 'watch',
            'parallel', 'nice', 'nohup', 'env', 'sudo', 'stdbuf', 'caffeinate', 'time', 'exec', 'command'}
VALUE_OPTIONS = {
    'timeout': {'-k', '--kill-after', '-s', '--signal'},
    'gtimeout': {'-k', '--kill-after', '-s', '--signal'},
    'nice': {'-n', '--adjustment'}, 'env': {'-u', '--unset', '-C', '--chdir'},
    'sudo': {'-u', '--user', '-g', '--group', '-C', '-p', '--prompt', '-r', '-t'},
    'stdbuf': {'-i', '-o', '-e', '--input', '--output', '--error'},
    'watch': {'-n', '--interval'},
    'caffeinate': {'-t', '-w'}, 'time': {'-o', '--output', '-f', '--format'},
    'arch': {'-arch', '-e', '-u'}, 'xcrun': {'--sdk', '--toolchain', '-sdk', '-toolchain'},
    'exec': {'-a'}, 'parallel': {'-j', '--jobs', '-n', '-N', '-S', '--sshlogin'},
}


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
    if base == 'script' and any(a in ('-c', '--command') for a in args):
        index = next(i for i, a in enumerate(args) if a in ('-c', '--command'))
        yield ['sh', '-c', args[index + 1]]
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
        i += 2 if arg in VALUE_OPTIONS.get(base, set()) else 1
    if base in ('timeout', 'gtimeout', 'script'):
        i += 1  # duration / output transcript file
    if i < len(args):
        yield ['sh', '-c', ' '.join(args[i:])] if base in ('watch', 'parallel') and '-x' not in args[:i] else args[i:]


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


def expand_home(raw, home):
    word = raw.replace('${HOME}', str(home)).replace('$HOME', str(home))
    return str(home) + word[1:] if word == '~' or word.startswith('~/') else word


def unresolved(raw, home):
    """Glob, brace, variable, substitution or ~user: the hook cannot know the target."""
    word = expand_home(raw, home)
    return any(c in word for c in '$`*?[]{}') or word.startswith('~')


def anchor_roots(home):
    """Strict roots: the locked anchor dir plus the pinned tree this hook runs from."""
    gate = Path(__file__).resolve().parents[1]
    return [os.path.realpath(p).casefold() for p in
            (home / '.config/golems/human-confirm-anchor', gate, gate.parent / '_shared')]


def _resolved(raw, cwd, home):
    return os.path.realpath(os.path.join(cwd or '/', expand_home(raw, home))).casefold()


def _aliases(target, home):
    from tokens import ANCHOR, PINS
    for path in (home / ANCHOR, PINS):
        try:
            if os.path.samefile(target, path): return True
        except OSError:
            pass
    return False


def policy_path(raw, cwd, home):
    target = _resolved(raw, cwd, home)
    for root in [os.path.realpath(str(home / '.config/golems')).casefold()] + anchor_roots(home):
        if target == root or target.startswith(root + '/'):
            return True
    return _aliases(target, home)


def anchor_path(raw, cwd, home, ancestors=False):
    """raw names the anchor or pinned tree (or, with ancestors, a directory above the anchor dir).

    Flags only matter on the locked anchor, so only its ancestors count; the
    pinned tree is covered by the committed-blob check at token time."""
    target = _resolved(raw, cwd, home)
    roots = anchor_roots(home)
    if ancestors and roots[0].startswith(target.rstrip('/') + '/'):
        return True
    return any(target == root or target.startswith(root + '/') for root in roots) or _aliases(target, home)


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


# AIDEV-NOTE: anchor integrity is the tree pin + owner uchg, not this list.
# These rules only fail closed early: flag changes that could reach the
# anchor, and any non-reader argv naming the anchor dir or pinned tree.
FLAG_EXECUTORS = {'chflags', 'setfile'}
READERS = {'cat', 'ls', 'stat', 'head', 'tail', 'rg', 'grep', 'wc', 'shasum', 'sha256sum', 'md5', 'file',
           'test', '[', '[[', 'realpath', 'readlink', 'du', 'diff', 'cmp', 'xxd', 'od', 'hexdump', 'strings',
           'less', 'more', 'cd', 'pushd', 'echo', 'printf', 'which', 'type', 'man'}
# These supply the flag executor's targets at run time (stdin, {}, -execdir cwd).
INDIRECT = {'xargs', 'parallel', 'find'}
_CLEAR = re.compile(r'no[us](?:chg|change|immutable|appnd|append|unlnk|unlink)')


def _candidates(arg):
    yield arg
    if '=' in arg: yield arg.split('=', 1)[1]
    if arg.startswith('-') and not arg.startswith('--') and len(arg) > 2: yield arg[2:]


def flag_clear(word, numeric=False):
    return any(_CLEAR.fullmatch(part) for part in word.split(',')) or numeric and bool(re.fullmatch('[0-7]+', word))


def flag_write(base, args, cwd, home):
    """chflags/SetFile argv that could change flags on the anchor or pinned tree."""
    if any(unresolved(a, home) for a in args):
        return True
    recursive = base == 'chflags' and any(a.startswith('-') and not a.startswith('--') and 'R' in a for a in args)
    values = {'-a', '-c', '-d', '-m', '-t'} if base == 'setfile' else set()
    i = 0
    while i < len(args) and args[i].startswith('-') and args[i] != '--':
        i += 2 if args[i] in values else 1
    i += (i < len(args) and args[i] == '--') + (base == 'chflags')  # chflags: the flags word
    return any(cwd is None and not expand_home(t, home).startswith('/') or anchor_path(t, cwd, home, recursive)
               for t in args[i:])


def anchor_tamper(word, args, cwd, home):
    base = os.path.basename(word).casefold()
    if base in DATA:
        return False
    if base in FLAG_EXECUTORS:
        return flag_write(base, args, cwd, home)
    if '$' in word or '`' in word:
        operands = [a for a in args if not a.startswith('-')]
        if any(flag_clear(a) for a in args):
            return flag_write('chflags', ['-R', '--', '0'] + operands, cwd, home)
        # Numeric words are usually counts/timeouts: only a literal anchor operand counts.
        if any(flag_clear(a, numeric=True) for a in args) and any(
                not unresolved(a, home) and cwd is not None and anchor_path(a, cwd, home, ancestors=True) for a in operands):
            return True
    for j, arg in enumerate(args):
        executor = os.path.basename(arg).casefold()
        if executor in FLAG_EXECUTORS and args[j + 1:]:
            # Wrapped: targets must be absolute (wrappers may change cwd); indirect: unknowable.
            if base in INDIRECT or base not in WRAPPERS or flag_write(executor, args[j + 1:], None, home):
                return True
    if base in READERS or base == 'ssh-keygen' and ('verify' in args or any(
            a.startswith('-') and not a.startswith('--') and 'l' in a and 'Y' not in a for a in args)):
        return False
    if any(anchor_path(c, cwd, home, ancestors=base in ('ln', 'link')) for a in args for c in _candidates(a)):
        return True
    # Renamed/copied flag binaries: a symbolic clear keyword plus a reachable target.
    return any(flag_clear(a) for a in args) and any(
        unresolved(c, home) or anchor_path(c, cwd, home, ancestors=True)
        for a in args if not flag_clear(a) and not a.startswith('-') for c in _candidates(a))

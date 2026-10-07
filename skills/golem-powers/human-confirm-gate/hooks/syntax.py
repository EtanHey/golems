"""Gate-local argv views over the shared shell parser (no shell execution)."""
import os
import re
import shlex
import forwarding
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


def executable(word):
    """(casefolded basename, implied git subcommand): APFS is case-insensitive, and
    git's per-subcommand executables run that git subcommand directly."""
    base = os.path.basename(word).casefold()
    return ('git', base[4:]) if base.startswith('git-') and len(base) > 4 else (base, None)


def substitution_argv(command, shell):
    """Keep a substitution's unknown result in its parent argv.

    The shared lexer exposes its body separately. Collapse that view only
    here; operations() still inspects every executable body recursively.
    The marker cannot resolve through the literal-variable binding grammar.
    """
    _ShellOperator = shell._impl_module('tokens')._ShellOperator
    tokens = []
    for token in shell._shell_tokens(shell._strip_heredoc_bodies(command), _operator_origin=True):
        if isinstance(token, _ShellOperator) and token == '(' and tokens and tokens[-1].endswith(('$', '`')):
            tokens[-1] = _ShellOperator(tokens[-1] + '(')
        else:
            tokens.append(token)
    def opened(token):
        return isinstance(token, _ShellOperator) and shell._is_command_sub_open(token)
    def closed(token):
        return isinstance(token, _ShellOperator) and shell._is_command_sub_close(token)
    words, continuing, i = [], False, 0
    while i < len(tokens):
        word = tokens[i]
        suffix = False
        if opened(word):
            word = word[:-2] + '${command-substitution}'
            depth = 1
            i += 1
            while i < len(tokens) and depth:
                if opened(tokens[i]): depth += 1
                if closed(tokens[i]): depth -= 1
                if not depth: suffix = tokens[i].endswith('+')
                i += 1
            if depth: raise ValueError('unclosed command substitution')
        else:
            i += 1
            if not isinstance(word, _ShellOperator) and (
                    shell._is_command_sub_open(word) or shell._is_command_sub_close(word) or
                    word in (';', '&', '|', '(', ')', '<', '>', '>>', '>|', '<<', '<<<', '<>', '&>', '&>>', '}$')):
                word = '__literal_shell_delimiter__'
        if continuing:
            words[-1] += word
        else:
            words.append(word)
        continuing = suffix
    # Re-lexing quoted tokens would lose parameter/brace quote provenance.
    positions = shell._command_position_flags(words)
    segments, segment = [], 0
    for i, word in enumerate(words):
        segments.append(segment)
        if shell._is_separator(words, i): segment += 1
    return words, positions, segments, [()] * len(words)


def hide_function_bodies(tokens, positions):
    from shell_parse_impl.function_expansion import hide_function_bodies as hide
    hide(tokens, positions)


def argv_at(tokens, segments, scopes, i):
    args, redirects = [], []
    j = i + 1
    def process_end(k):
        level, k = 1, k + 2
        while k < len(tokens) and level:
            level += (tokens[k] == '(') - (tokens[k] == ')')
            k += 1
        if level: raise ValueError('unclosed process substitution')
        return k
    while j < len(tokens) and segments[j] == segments[i] and scopes[j] == scopes[i]:
        word = tokens[j]
        if forwarding.enabled() and word in ('<', '>') and j + 1 < len(tokens) and tokens[j+1] == '(':
            args.append('${process-substitution}'); j = process_end(j); continue
        if word in ('>', '>>', '>|', '<', '<<', '<<<', '<>', '&>', '&>>'):
            operator = word
            # Lexical fd prefixes were removed by the opted-in tokenizer.
            j += 1
            if j < len(tokens) and tokens[j] == '&': j += 1
            if j >= len(tokens) or segments[j] != segments[i]:
                raise ValueError('missing redirection target')
            if forwarding.enabled() and tokens[j] in ('<', '>') and j+1 < len(tokens) and tokens[j+1] == '(':
                redirects.append((operator, '${process-substitution}')); j = process_end(j)
            else:
                redirects.append((operator, tokens[j])); j += 1
            continue
        if word in (';', '&', '|', ')', '}$', ')$'): break
        args.append(word); j += 1
    return args, redirects


# GNU and BSD option arity. Optional operands must be attached; a required
# operand consumes the cluster suffix or the next argv word, even if '-...'.
_XARGS_REQUIRED = frozenset('a d E I J L n P R S s'.split())
_XARGS_OPTIONAL = {'e': '', 'i': '{}', 'l': '1'}
_XARGS_FLAGS = frozenset('0oprtx')
_XARGS_LONG = {
    'arg-file': ('a', 'required'), 'delimiter': ('d', 'required'),
    'eof': ('e', 'optional'), 'replace': ('i', 'optional'),
    'max-lines': ('l', 'optional'), 'max-args': ('n', 'required'),
    'max-procs': ('P', 'required'), 'max-chars': ('s', 'required'),
    'process-slot-var': ('slot', 'required'),
    'null': ('0', 'none'), 'open-tty': ('o', 'none'),
    'interactive': ('p', 'none'), 'no-run-if-empty': ('r', 'none'),
    'verbose': ('t', 'none'), 'exit': ('x', 'none'),
    'show-limits': ('limits', 'none'), 'help': ('help', 'none'),
    'version': ('version', 'none'),
}


def _stdin_command_slot(child, depth=0):
    """Appending unknown stdin can supply a missing wrapper executable."""
    if depth > 8: raise ValueError('wrapper inspection budget exceeded')
    if unresolved(child[0], Path.home()): return True
    base = executable(child[0])[0]
    if base not in WRAPPERS: return False
    # Name lookup remains data even when stdin supplies the names.
    if base == 'command' and any(a.startswith('-') and ('v' in a or 'V' in a)
                                 for a in child[1:]):
        return False
    children = list(wrapper_payload(base, child[1:]))
    return not children or any(_stdin_command_slot(c, depth + 1) for c in children if c)


class XargsArgv(list):
    unknown_tail = False

def xargs_payload(args):
    """Deny-only union of GNU replacement and BSD insertion semantics.

    Never promote an option operand to a child command. Preserve unknown
    replacement results in every child word so wrapper recursion sees them.
    Retain symbolic replacement/insertion for deny-only analysis. Track the
    effective modes separately: BSD uses the last -I/-J; GNU cancels -I after
    -L/-l or -n other than 1. Check the original command if either can append.
    """
    i, replacement, insertion = 0, None, None
    gnu_replacement, bsd_mode = None, None

    def unknown():
        if guarded_words(args) or any(executable(a)[0] in WRAPPERS for a in args):
            raise ValueError('unknown xargs option grammar with protected argv')

    while i < len(args):
        arg = args[i]
        if arg == '--':
            i += 1; break
        if arg == '-' or not arg.startswith('-'): break
        # Expansion may change option names, arity or the number of words.
        # Literal replacement braces (including {}) are not brace expansion.
        if (any(c in arg for c in '$`*?[]') or
                any(',' in part or '..' in part for part in re.findall(r'\{([^{}]*)\}', arg))):
            raise ValueError('unresolved xargs option word')
        options = []
        if arg.startswith('--'):
            name, eq, value = arg[2:].partition('=')
            matches = [name] if name in _XARGS_LONG else [n for n in _XARGS_LONG if n.startswith(name)]
            if len(matches) != 1:
                unknown(); return []
            key, arity = _XARGS_LONG[matches[0]]
            if arity == 'none' and eq:
                unknown(); return []
            if arity == 'required' and not eq:
                i += 1
                if i >= len(args): raise ValueError('missing xargs option operand')
                value = args[i]
            elif arity == 'optional' and not eq:
                value = _XARGS_OPTIONAL[key]
            options.append((key, value))
        else:
            j = 1
            while j < len(arg):
                key, value = arg[j], ''
                j += 1
                if key in _XARGS_REQUIRED or key in _XARGS_OPTIONAL:
                    value = arg[j:]
                    if not value and key in _XARGS_REQUIRED:
                        i += 1
                        if i >= len(args): raise ValueError('missing xargs option operand')
                        value = args[i]
                    elif not value:
                        value = _XARGS_OPTIONAL[key]
                    j = len(arg)
                elif key not in _XARGS_FLAGS:
                    unknown(); return []
                options.append((key, value))
        for key, value in options:
            if key in ('help', 'version'): return []
            if key in ('I', 'i', 'J'):
                if not value: raise ValueError('empty xargs replacement')
                if '$' in value or '`' in value:
                    unknown(); return []
                if key == 'J': insertion = value
                else:
                    replacement = gnu_replacement = value
                bsd_mode = 'J' if key == 'J' else 'I'
            elif key in ('L', 'l'):
                gnu_replacement = None
            elif key == 'n':
                try: single = int(value) == 1
                except ValueError: single = False
                if not single: gnu_replacement = None
        i += 1
    child = list(args[i:])
    if not child: return []  # default utility is echo
    # Match against the original argv: replacement must not hide a shared -J
    # token. BSD permits insertion at argv[0], including the utility itself.
    insert_at = next((j for j in range(len(child)) if child[j] == insertion), None)
    bsd_appends = bsd_mode != 'I' and insert_at is None
    gnu_appends = gnu_replacement is None
    if (bsd_appends or gnu_appends) and _stdin_command_slot(child):
        raise ValueError('xargs stdin supplies wrapper executable and argv')
    if replacement:
        child = [w.replace(replacement, '${stdin-command}') for w in child]
    if insert_at is not None:
        # Unknown arity can supply both an executable and its whole argv.
        child[insert_at:insert_at + 1] = ['${stdin-command}', '${@}']
    child = XargsArgv(child)
    child.unknown_tail = bsd_appends or gnu_appends
    return child


def wrapper_payload(base, args):
    if base == 'xargs':
        child = xargs_payload(args)
        if child: yield child
        return
    if base == 'find':
        for i, arg in enumerate(args):
            if arg in ('-exec', '-execdir', '-ok', '-okdir'):
                end = next((j for j in range(i + 1, len(args)) if args[j] in (';', '+')), len(args))
                yield args[i + 1:end]
        return
    if base not in WRAPPERS:
        return
    options = args[:next((i for i, a in enumerate(args) if not a.startswith('-') or a == '--'), len(args))]
    if base == 'command' and any('v' in a or 'V' in a for a in options):
        return  # `command -v/-V` only looks the name up
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


def looked_up(tokens, positions, i):
    """tokens[i] is the name operand of `command -v/-V`: looked up, never run."""
    j = i - 1
    while j >= 0 and tokens[j].startswith('-') and tokens[j] != '--':
        j -= 1
    options = tokens[j + 1:i]
    return (j >= 0 and positions[j] and os.path.basename(tokens[j]).casefold() == 'command'
            and any('v' in a or 'V' in a for a in options))


def shell_payload(base, args):
    """Code a shell runs from its argv: -c, and fish's -C/--command/--init-command."""
    if base not in SHELLS:
        return None
    if forwarding.enabled() and base != 'fish': return shell_program(base, args)[0]
    payloads = []
    for i, arg in enumerate(args):
        if arg == '--':
            break
        name, eq, value = arg.partition('=')
        if base == 'fish' and name in ('--command', '--init-command') and eq:
            payloads.append(value); continue
        if (arg.startswith('-') and not arg.startswith('--') and ('c' in arg[1:] or base == 'fish' and 'C' in arg[1:])
                or base == 'fish' and arg in ('--command', '--init-command')):
            j = i + 1
            if j < len(args) and args[j] == '--': j += 1
            if j >= len(args): raise ValueError('missing shell payload')
            payloads.append(args[j])
    return '\n'.join(payloads) if payloads else None


def shell_program(base, args):
    """Visible $0, $1… after POSIX -c; option operands are not switches."""
    if base == 'fish': return None, None
    short_values, long_values, long_switches = SHELL_OPTIONS.get(base, _BASH)
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ('--help', '--version'): return None, None
        if arg == '--' or not arg.startswith(('-', '+')): break
        i += 1
        if arg.startswith('--'):
            name, eq, _ = arg.partition('=')
            if name in long_values: i += not eq
            elif name not in long_switches: raise ValueError('unknown shell option')
            continue
        for k, char in enumerate(arg[1:], 1):
            if char == 'c':
                if i < len(args) and args[i] == '--': i += 1
                if i >= len(args): raise ValueError('missing shell payload')
                return args[i], args[i+1:]
            if char in short_values:
                i += k+1 == len(arg)
                break
    return None, None


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


def _line_heredoc_starts(command, shell):
    """The shared parser's line-based view: (line, delimiter, quoted, strip_tabs)."""
    starts, pending = [], []
    for number, line in enumerate(command.split('\n')):
        if pending:
            delimiter, tabs = pending[0]
            if (line.lstrip('\t') if tabs else line).rstrip('\r') == delimiter: pending.pop(0)
            continue
        for match in shell._HEREDOC_START_RE.finditer(shell._blank_shell_comment(shell._blank_quoted(line))):
            parsed = shell._heredoc_delimiter_word(line, match.end())
            if parsed is not None:
                starts.append((number, parsed[0], parsed[1], bool(match[1])))
                pending.append((parsed[0], bool(match[1])))
    return starts


def _shell_heredoc_starts(command, shell):
    """The same tuples as bash would see them: quotes, comments, `${...}`,
    arithmetic and substitutions are tracked across lines. None when unsure."""
    starts, pending, quote, depth = [], [], None, 0
    i, n, line = 0, len(command), 0
    while i < n:
        c = command[i]
        prev = command[i - 1] if i else '\n'
        if quote == "'":
            quote = None if c == "'" else quote
        elif c == '\\':
            if command.startswith('\\\n', i) and pending: return None  # continued heredoc line
            line += command.count('\n', i, i + 2); i += 2; continue
        elif quote is None and command.startswith("$'", i):
            j = i + 2
            while j < n and command[j] != "'":
                j += 2 if command[j] == '\\' else 1
            if pending and '\n' in command[i:j]: return None
            line += command.count('\n', i, j); i = j + 1; continue
        elif command.startswith('$(', i) and not command.startswith('$((', i) or c == '`':
            found = shell._dollar_substitution(command, i) if c == '$' else shell._backtick_substitution(command, i)
            if found is None or pending and '\n' in command[i:found[1]]: return None
            line += command.count('\n', i, found[1]); i = found[1]; continue
        elif c == '"':
            quote = None if quote == '"' else '"'
        elif quote == '"':
            pass
        elif c == "'":
            quote = "'"
        elif command.startswith(('${', '$((', '$[', '(('), i) and (c == '$' or prev in ' \t\n;|&('):
            step = 3 if command.startswith('$((', i) else 2
            depth += 1 if step == 2 and c == '$' and command[i + 1] == '{' else step - 1
            i += step; continue
        elif depth and c in '({[':
            depth += 1
        elif depth and c in ')}]':
            depth -= 1
        elif depth:
            pass
        elif c == '#' and prev in ' \t\n;|&()':
            while i < n and command[i] != '\n': i += 1
            continue
        elif command.startswith('<<', i) and not command.startswith('<<<', i):
            match = shell._HEREDOC_START_RE.match(command, i)
            parsed = match and shell._heredoc_delimiter_word(command, match.end())
            if not parsed or '\n' in command[i:match.end()]: return None
            starts.append((line, parsed[0], parsed[1], bool(match[1])))
            pending.append((parsed[0], bool(match[1])))
            i = match.end(); continue
        if c == '\n':
            if quote is not None or depth:
                if pending: return None  # the body would start after the closing quote/expansion
            else:
                for delimiter, tabs in pending:
                    while i < n:
                        end = command.find('\n', i + 1); end = n if end < 0 else end
                        body = command[i + 1:end]; line += 1; i = end
                        if (body.lstrip('\t') if tabs else body).rstrip('\r') == delimiter: break
                pending = []
                if i >= n: break
            line += 1
        i += 1
    return starts


def mask_heredoc_bodies(command, shell):
    """Blank the bodies of quoted-delimiter heredocs (literal text to bash),
    keeping offsets and every other line, so prose backticks/apostrophes are
    never read as substitutions. Unquoted bodies stay as they are: bash runs
    their substitutions. Only when the shared line view and the bash-faithful
    view agree on every heredoc; otherwise the command is returned unchanged."""
    starts = _line_heredoc_starts(command, shell)
    if not any(quoted for _, _, quoted, _ in starts) or _shell_heredoc_starts(command, shell) != starts:
        return command
    out, pending = [], []
    for source in command.splitlines(keepends=True):
        line = source.rstrip('\r\n')
        if pending:
            delimiter, quoted, tabs = pending[0]
            if (line.lstrip('\t') if tabs else line) == delimiter:
                pending.pop(0)
            elif quoted:
                source = ' ' * len(line) + source[len(line):]
            out.append(source)
            continue
        for match in shell._HEREDOC_START_RE.finditer(shell._blank_shell_comment(shell._blank_quoted(line))):
            parsed = shell._heredoc_delimiter_word(line, match.end())
            if parsed is not None:
                pending.append((parsed[0], parsed[1], bool(match[1])))
        out.append(source)
    return ''.join(out)


# Per shell: short options taking a value, long options taking a value, long
# switches. An unknown long option denies: its arity (and so the script
# operand) is unknown. -n (noexec) runs nothing.
_BASH = ('oO', {'--rcfile', '--init-file'},
         {'--login', '--noprofile', '--norc', '--posix', '--restricted', '--verbose', '--noediting',
          '--debugger', '--dump-strings', '--dump-po-strings', '--pretty-print'})
SHELL_OPTIONS = {
    'bash': _BASH, 'sh': _BASH, 'dash': ('o', set(), set()), 'ksh': ('o', set(), set()),
    'zsh': ('o', {'--emulate'}, {'--login', '--interactive', '--rcs', '--no-rcs', '--globalrcs', '--no-globalrcs'}),
    'fish': ('cCdopf', {'--command', '--init-command', '--debug', '--debug-output', '--profile',
                        '--profile-startup', '--features'},
             {'--login', '--interactive', '--no-execute', '--no-config', '--private',
              '--print-rusage-self', '--print-debug-categories'}),
}


def shell_reads_stdin(base, args):
    """No -c payload: does this shell take its script from stdin (no script
    operand, -s, `-`, or a stdin/fd path) rather than from a named file?"""
    short_values, long_values, long_switches = SHELL_OPTIONS.get(base, _BASH)
    i, stdin = 0, False
    while i < len(args):
        arg = args[i]
        if arg in ('--', '-'):
            i += 1; break
        if arg in ('--version', '--help', '--no-execute'):
            return False
        if not arg.startswith(('-', '+')):
            break
        if arg.startswith('--'):
            name, eq, _ = arg.partition('=')
            if name in long_values:
                i += 1 if eq else 2
            elif name in long_switches and not eq:
                i += 1
            else:
                raise ValueError('unknown shell option')
            continue
        i += 1
        for k, char in enumerate(arg[1:], 1):
            if char == 'n' and arg[0] == '-':
                return False  # noexec: commands are read, never run
            if base == 'fish' and char not in short_values + 'nilNPvh':
                raise ValueError('unknown shell option')
            stdin |= char == 's'
            if char in short_values:
                i += 0 if k + 1 < len(arg) else 1  # the rest of the cluster, or the next word
                break
    script = args[i] if i < len(args) else None
    return stdin or script is None or script in ('/dev/stdin', '/dev/fd/0') or forwarding.enabled() and script in ('${process-substitution}', '${positional-unknown}', '$\ue000positional-unknown\ue001') or script.startswith(('/dev/fd/', '/proc/'))


_NAME = re.compile(r'\{?([A-Za-z_][A-Za-z0-9_]*)')


def single_quoted_names(command, shell):
    """Names whose every `$name` in the command sits inside single quotes, so
    the shell never expands them. Any heredoc the two views disagree on, any
    unquoted heredoc (its body text is not quoting) or an open quote: none."""
    starts = _line_heredoc_starts(command, shell)
    if starts and (not all(quoted for _, _, quoted, _ in starts) or _shell_heredoc_starts(command, shell) != starts):
        return set()
    text, quoting, state, i = mask_heredoc_bodies(command, shell), {}, None, 0
    while i < len(text):
        char = text[i]
        if state in ("'", "$'"):
            if state == "$'" and char == '\\': i += 2; continue
            if char == "'": state = None
            elif char == '$' and state == "'" and _NAME.match(text, i + 1):
                name = _NAME.match(text, i + 1)[1]; quoting[name] = quoting.get(name, True)
            i += 1; continue
        if char == '\\':
            i += 2; continue
        if state is None and text.startswith("$'", i):
            state = "$'"; i += 2; continue
        if state is None and char == "'":
            state = "'"
        elif char == '"':
            state = None if state == '"' else '"'
        elif char == '$' and _NAME.match(text, i + 1):
            quoting[_NAME.match(text, i + 1)[1]] = False
        i += 1
    return set() if state else {name for name, literal in quoting.items() if literal}


def split_words(command, shell):
    """Shell words (quote-removed, as the parser yields them) mapped to whether any
    occurrence carries an unquoted expansion, which word-splitting can turn into
    several words (gh flags among them). A word not found here is assumed to split."""
    text, words, i = mask_heredoc_bodies(command, shell), {}, 0
    word, splits, quote, started = [], False, None, False

    def inner(body):  # a substitution body is lexed in its own quoting context
        for key, value in split_words(body, shell).items():
            words[key] = words.get(key, False) or value

    def flush():
        nonlocal word, splits, started
        if started:
            key = ''.join(word)
            words[key] = words.get(key, False) or splits
        word, splits, started = [], False, False
    while i < len(text):
        char = text[i]
        if quote == "'":
            if char == "'": quote = None
            else: word.append('\ue000' if char == '{' else '\ue001' if char == '}' else char)
            i += 1; continue
        if quote is None and (text.startswith('$(', i) or char == '`'):
            found = shell._dollar_substitution(text, i) if char == '$' else shell._backtick_substitution(text, i)
            if found is None: return {}
            inner(found[0]); word.append(text[i:found[1]]); splits, started, i = True, True, found[1]; continue
        if quote == '"' and (text.startswith('$(', i) or char == '`'):
            found = shell._dollar_substitution(text, i) if char == '$' else shell._backtick_substitution(text, i)
            if found is None: return {}
            inner(found[0]); word.append(text[i:found[1]]); i = found[1]; continue
        if char == '\\':
            nxt = text[i + 1:i + 2]
            if quote == '"' and nxt not in ('$', '`', '"', '\\', '\n'): word.append(char)
            if nxt != '\n': word.append(nxt)
            started, i = True, i + 2; continue
        if quote is None and text.startswith("$'", i):
            return {}  # ANSI-C words: no proof here
        if char == '"':
            quote, started = (None if quote == '"' else '"'), True; i += 1; continue
        if quote is None and char == "'":
            quote, started = "'", True; i += 1; continue
        if quote is None and (char.isspace() or char in ';|&()<>'):
            flush(); i += 1; continue
        if char == '$' and quote is None and re.match(r'[{A-Za-z0-9_@*#?!$-]', text[i + 1:i + 2]):
            splits = True
        if quote is None and char in '*?[{':
            splits = True
        if quote == '"' and char in '{}':
            char = '\ue000' if char == '{' else '\ue001'
        word.append(char); started = True; i += 1
    flush()
    return {} if quote else words


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

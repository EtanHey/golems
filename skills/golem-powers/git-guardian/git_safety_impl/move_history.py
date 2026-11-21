"""Conservative command-history admission for filesystem glob snapshots."""
from contextvars import ContextVar
from functools import wraps
import os
import re

from .paths import _expand_tilde, _contains_repo_root, _within

_CD_LITERAL_UNSAFE = frozenset('~*?[]{}()<>^#|!$`\\\'"=')

_QUOTED_TILDE = re.compile('[\'"]~')

_HISTORY = ContextVar('move_glob_history', default=None)


def with_history(function):
    @wraps(function)
    def inspect(api, command, **options):
        parent = _HISTORY.get()
        state = {
            'segments': list(parent['segments']) if parent else [],
            'unknown_cwd': parent['unknown_cwd'] if parent else False,
            # Redirections and substitutions can write outside the argv model.
            'uncertain_syntax': bool(parent and parent['uncertain_syntax'])
                or any(char in command for char in '<>`') or '$(' in command or '${' in command or '\\' in command or _QUOTED_TILDE.search(command) is not None,
        }
        token = _HISTORY.set(state)
        try:
            return function(api, command, **options)
        finally:
            _HISTORY.reset(token)
    return inspect


def note_segment(words, position, cwd, variables, operator_before, operator_after):
    state = _HISTORY.get()
    if state is None:
        return
    argv = words[position:]
    if (position > 0 or operator_before not in {None, ';', '&&'}
            or operator_after not in {None, ';', '&&'}):
        state['uncertain_syntax'] = True
    cd_args = argv[1:] if argv else []
    known_cd = (len(cd_args) == 1 and not cd_args[0].startswith('-')
                or len(cd_args) == 2 and cd_args[0] == '--' and cd_args[1] != '-')
    known_context = (operator_before in {None, ';'} and operator_after in {None, ';', '&&'}
                     and position == 0)
    if (not cwd or 'CDPATH' in variables or any(word == 'CDPATH' or word.startswith('CDPATH=') for word in words)
            or argv and argv[0] in {'cd', 'pushd', 'popd'} and
            (argv[0] != 'cd' or not known_cd or not known_context)):
        state['unknown_cwd'] = True
    state['segments'].append((argv, cwd, dict(variables)))


def _mkdir_elsewhere(api, args, cwd, variables, directory):
    operands, options = [], True
    for word in args:
        if options and word == '--':
            options = False
        elif options and word in {'-p', '--parents'}:
            continue
        elif options and word.startswith('-'):
            return False
        else:
            operands.append(word)
    if not cwd or not operands:
        return False
    for operand in operands:
        if any(char in operand for char in '$`\\'):
            return False
        expanded, complete = api['_expand_known_vars'](operand, variables)
        expanded, tilde_complete = _expand_tilde(expanded, variables)
        if (not complete or not tilde_complete or not expanded or expanded.startswith('-')
                or any(char.isspace() or char in '*?[]{}$`' for char in expanded)):
            return False
        target = os.path.realpath(os.path.join(cwd, expanded))
        if (_contains_repo_root(target, directory, _within)
                or _contains_repo_root(directory, target, _within)):
            return False
    return True


def snapshot_is_current(api, directory):
    state = _HISTORY.get()
    if state is None or state['unknown_cwd'] or state['uncertain_syntax']:
        return False
    directory = os.path.realpath(directory)
    # The last record is the command currently being inspected. Nested shell
    # scans inherit their outer command as an earlier, uncertain operation.
    for argv, cwd, variables in state['segments'][:-1]:
        if not argv:  # non-command control markers; assignments were refused above
            continue
        name, args = argv[0], argv[1:]
        if name == 'cd':
            operand = args[-1] if args else ''
            if not cwd or not operand or set(operand) & _CD_LITERAL_UNSAFE:
                return False
            target = os.path.abspath(os.path.join(cwd, operand))
            if not os.path.isdir(target) or not os.access(target, os.X_OK):
                return False
            continue
        if name in {'echo', 'pwd', ':', 'true', 'false'}:
            if any('$' in word or '`' in word for word in args):
                return False
            continue
        if name == 'mkdir' and _mkdir_elsewhere(api, args, cwd, variables, directory):
            continue
        return False
    return True

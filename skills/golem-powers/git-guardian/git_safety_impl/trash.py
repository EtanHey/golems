"""Narrow, read-only admission for a move to a fresh macOS Trash entry."""
import os
import re

from .paths import _expand_tilde, _within, _outermost_repo_root, _created_target_reason, _contains_repo_root


def literal_trash_syntax(command):
    """The new waiver needs expansion provenance the legacy lexer discards.

    Keep a conservative literal subset: HOME may expand in double quotes, but
    quoted tildes, single quotes and escapes never qualify for this waiver.
    Nested shell payloads get their own check after decoding.
    """
    return ("'" not in command and "\\" not in command
            and '$' not in re.sub(r'\$(?:HOME\b|\{HOME\})', '', command)
            and all('~' not in word for word in re.findall(r'"[^"]*"', command)))


def _active_paths(anchor):
    """Nearest checkout, including a linked checkout's external admin paths."""
    current = os.path.realpath(anchor)
    while True:
        metadata = os.path.join(current, '.git')
        if os.path.lexists(metadata):
            paths = [current, os.path.realpath(metadata)]
            if os.path.isfile(metadata):
                with open(metadata, encoding='utf-8') as handle:
                    line = handle.read(4096).strip()
                if not line.startswith('gitdir:'):
                    raise ValueError('unresolved gitfile')
                admin = os.path.realpath(os.path.join(current, line[7:].strip()))
                paths.append(admin)
                common = os.path.join(admin, 'commondir')
                if os.path.isfile(common):
                    with open(common, encoding='utf-8') as handle:
                        paths.append(os.path.realpath(os.path.join(admin, handle.read(4096).strip())))
            return paths
        parent = os.path.dirname(current)
        if parent == current:
            return []
        current = parent


def trash_move(api, args, sources, destination, cwd, variables, protected_cwd, created_paths, *, syntax_safe):
    """Return (admitted, refusal); other destinations retain existing policy."""
    expanded, complete = api['_expand_known_vars'](destination, variables)
    expanded, tilde_complete = _expand_tilde(expanded, variables)
    if not complete or not tilde_complete or not cwd:
        return False, None
    target = os.path.abspath(os.path.join(cwd, expanded))
    home = os.path.realpath(os.path.expanduser('~'))
    trash = os.path.join(home, '.Trash')
    # Identify by lexical parent first so a symlinked Trash cannot escape.
    if os.path.dirname(target) != trash:
        return False, None
    refusal = 'Trash move cannot be verified as a fresh reversible entry'
    try:
        if (not syntax_safe or not os.path.isdir(trash) or os.path.islink(trash)
                or os.path.realpath(trash) != trash or os.path.lexists(target)
                or '..' in expanded.split(os.sep)
                or len(sources) != 1
                or any(word.startswith('-') and word != '--' for word in args)):
            return False, refusal
        if _created_target_reason(api, target, cwd, variables, created_paths):
            return False, refusal
        source, known = api['_expand_known_vars'](sources[0], variables)
        source, tilde_known = _expand_tilde(source, variables)
        if not known or not tilde_known or '..' in source.split(os.sep):
            return False, refusal
        source = os.path.abspath(os.path.join(cwd, source))
        physical = os.path.realpath(source)
        # Existing source only. Never move a checkout containing either anchor,
        # including the initial anchor retained across cd and shell wrappers.
        if not os.path.lexists(source):
            return False, refusal
        for anchor in (protected_cwd, cwd):
            if not anchor:
                continue
            root = _outermost_repo_root(os.path.realpath(anchor))
            paths = _active_paths(anchor)
            for active in paths + ([root] if root else []):
                if _contains_repo_root(active, physical, _within):
                    return False, refusal
            if any(_within(physical, metadata) for metadata in paths[1:]):
                return False, refusal
        # Source metadata and global protected roots keep the old policy. The
        # sole waived reason is an unrelated repository's root, moved intact.
        reason = api['_rm_target_reason'](sources[0], cwd, variables,
            protected_cwd, protected_only=True)
        if reason and reason != 'rm targeting repo root':
            return False, refusal
        if '.git' in [part.casefold() for part in physical.split(os.sep)]:
            return False, refusal
        # A destination inside the source would move the Trash itself.
        if _within(target, physical):
            return False, refusal
        return True, None
    except (OSError, ValueError):
        return False, refusal

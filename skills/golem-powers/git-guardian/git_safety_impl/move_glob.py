"""Expand a plain `*`/`?` glob operand of `mv` the way the shell would.

An unexpanded glob used to make every `mv` source unresolvable, so
`mv .work/shot-*.png .work/old/` was refused as "protected root used by move"
although no match could be one. Expanding it lets each real match go through
the same protected-root check a literal source gets.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar

import fnmatch
import os

from .paths import _expand_tilde, _created_target_reason

_SECRET_INSPECTION = ContextVar('move_glob_secret_inspection', default=None)


@contextmanager
def inspect_secret_matches(sensitive_path):
    """Use the hook's secret-name rule with the scanner's tracked cwd."""
    admitted = set()
    token = _SECRET_INSPECTION.set((sensitive_path, admitted))
    try:
        yield admitted
    finally:
        _SECRET_INSPECTION.reset(token)


MOVE_GLOB_LIMIT = 1000
_SCAN_LIMIT = 20000
_GLOB_CHARS = frozenset("*?")
# Bracket, brace and extended (zsh/ksh) forms, quoting and expansions stay
# unresolved: the caller keeps today's refusal for them.
_UNSUPPORTED = frozenset("[]{}()<>^#|!$`\\'\"")
# A match whose own name holds one of these would be re-read as a pattern or a
# variable by the path checks, so it is not judged from its spelling.
_UNSAFE_NAME = frozenset("*?[]{}$`~\\")


def expand_move_glob(source: str, cwd: str, variables: dict[str, str]):
    """Return (matches, literal directory) for a `*`/`?` glob, or None if unsure.

    Matches are a superset of bash and zsh defaults: hidden names match too.
    `**`, more than MOVE_GLOB_LIMIT matches, or an unreadable listing is unsure.
    """
    if (not cwd or not os.path.isabs(cwd) or not (set(source) & _GLOB_CHARS)
            or set(source) & _UNSUPPORTED or "~" in source[1:]):
        return None
    expanded, complete = _expand_tilde(source, variables)
    if not complete:
        return None
    parts = [part for part in expanded.split("/") if part not in ("", ".")]
    if ".." in parts or "**" in "".join(parts):
        return None
    base = expanded if os.path.isabs(expanded) else os.path.join(cwd, expanded)
    components = [part for part in os.path.normpath(base).split(os.sep) if part]
    first = next(index for index, part in enumerate(components) if set(part) & _GLOB_CHARS)
    literal = os.sep + os.sep.join(components[:first])
    candidates = [literal]
    scanned = 0
    for part in components[first:]:
        following = []
        for directory in candidates:
            if not set(part) & _GLOB_CHARS:
                path = os.path.join(directory, part)
                if os.path.lexists(path):
                    following.append(path)
                continue
            try:
                with os.scandir(directory) as entries:
                    for entry in entries:
                        scanned += 1
                        if scanned > _SCAN_LIMIT:
                            return None
                        if fnmatch.fnmatchcase(entry.name, part):
                            if entry.name.startswith('-') or set(entry.name) & _UNSAFE_NAME:
                                return None
                            following.append(entry.path)
            except NotADirectoryError:
                continue
            except FileNotFoundError:
                continue
            except OSError:
                return None
            if len(following) > MOVE_GLOB_LIMIT:
                return None
        candidates = following
    # A trailing slash dereferences a matched symlink on macOS mv. Do not
    # normalize that traversal away before the protected-root check.
    return ([path + os.sep for path in candidates] if source.endswith('/') else candidates), literal


def move_sources_reason(api, args, sources, cwd, variables, protected_cwd,
                        created_paths, trash_admitted):
    # Before --, a variable can supply -t or another option and change which
    # words are sources. The bounded model cannot preserve that argv identity.
    # The Trash admission has already verified literal argv provenance.
    for word in args:
        if word == '--':
            break
        if not trash_admitted and ('$' in word or '`' in word):
            resolved, complete = api["_expand_known_vars"](word, variables)
            if (not complete or not resolved or resolved.startswith('-')
                    or any(char.isspace() or char in '*?[]{}' for char in resolved)):
                return "protected root move cannot be checked with unresolved option expansion"
    for operand in sources:
        glob = expand_move_glob(operand, cwd, variables)
        if glob is not None:
            reason = _created_target_reason(api, glob[1], cwd, variables, created_paths)
            if reason:
                return reason
        inspection = _SECRET_INSPECTION.get()
        if glob is not None and inspection is not None:
            if any(inspection[0](source.rstrip(os.sep)) for source in glob[0]):
                return "sensitive file matched by mv source glob"
            inspection[1].add(operand)
        for source in glob[0] if glob is not None else [operand]:
            reason = _created_target_reason(api, source, cwd, variables, created_paths)
            if reason:
                return reason
            reason = api["_rm_target_reason"](source, cwd, variables, protected_cwd, protected_only=True)
            if reason and not trash_admitted:
                return "protected root used by move or symbolic link"
    return None

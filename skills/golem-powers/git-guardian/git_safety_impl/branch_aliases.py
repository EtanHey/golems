"""Read alias definitions without executing them; retain invocation cwd in the caller."""
from __future__ import annotations

import contextvars
from functools import lru_cache
import re
import os
import shlex
import subprocess

from . import shell_parse
from .update_ref_stdin import RAW_COMMAND


_ALIAS_INPUT = contextvars.ContextVar("branch_alias_input_unseen", default=False)
_ALIAS_LISTING_LITERAL = contextvars.ContextVar("branch_alias_listing_literal", default=None)


class AliasUnknown(ValueError):
    """The alias expansion cannot be inspected safely."""


def _git(*arguments):
    environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    try:
        return subprocess.run(['/usr/bin/git', '-c', 'core.fsmonitor=false', *arguments],
                              env=environment, capture_output=True, timeout=1, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        raise AliasUnknown from error


@lru_cache(maxsize=1)
def _builtins():
    # Builtin names do not depend on repository discovery or the caller's gitdir.
    result = _git('-C', '/', '--list-cmds=builtins')
    if result.returncode:
        raise AliasUnknown
    return set(os.fsdecode(result.stdout).splitlines())


def git_alias(family, arguments, directory, configs, *, config_unknown=False):
    """Expanded builtin argv, or None for a builtin/nonalias; cycles/errors deny."""
    builtins = _builtins()
    if family in builtins:
        return None
    if not directory or config_unknown or any("$" in value or "`" in value for value in configs):
        raise AliasUnknown
    seen = set()
    options = [word for value in configs for word in ('-c', value)]
    for _ in range(16):
        if family in seen:
            raise AliasUnknown
        seen.add(family)
        result = _git('-C', directory, *options, 'config', '--get', 'alias.' + family)
        if result.returncode == 1:
            return None if len(seen) == 1 else [family, *arguments]
        if result.returncode:
            raise AliasUnknown
        definition = os.fsdecode(result.stdout).strip()
        if definition.startswith('!'):
            # Visible shell Git aliases are already inspected by the payload pass.
            # Configured shell programs are outside ordinary argv alias expansion.
            if any(value.startswith('alias.' + family + '=!') for value in configs):
                return None
            raise AliasUnknown
        try:
            words = shlex.split(definition)
        except ValueError as error:
            raise AliasUnknown from error
        if not words:
            raise AliasUnknown
        family, arguments = words[0], words[1:] + arguments
        if family in builtins:
            return [family, *arguments]
    raise AliasUnknown


def shell_alias_bodies(name):
    """Expanded bodies that can run at this command name, not inert definitions.

    The shared parser supplies invocation identities. Taking all possible bodies
    at a repeated name is conservative; the caller retains its tracked cwd/env.
    Recursive substitutions are inspected separately in their own command pass.
    """
    command = RAW_COMMAND.get()
    if not command or 'alias' not in command:
        return []
    tokens, positions, segments, _scopes = shell_parse._parse_bash(command)
    bodies = []
    for body, segment, _invocation in shell_parse._invoked_alias_bodies(command):
        if isinstance(segment, int) and any(
            token == name and active and owner == segment
            for token, active, owner in zip(tokens, positions, segments)
        ):
            bodies.append(body)
    return bodies


def alias_input_is_unseen():
    return _ALIAS_INPUT.get()


def shell_alias_context_uncertain():
    """Alias state effects are not applied to the outer scanner; fail closed."""
    command = RAW_COMMAND.get()
    if not command or 'alias' not in command:
        return False
    for body, _segment, _invocation in shell_parse._invoked_alias_bodies(command):
        tokens, positions, _segments, _scopes = shell_parse._parse_bash(body)
        if any((active and token in {'cd', 'pushd', 'popd', 'export', 'readonly',
                                     'declare', 'typeset', 'eval', 'source', '.'})
               or (active and re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', token))
               for token, active in zip(tokens, positions)):
            return True
    return False


def inspect_shell_alias(api, body, cwd, variables, depth):
    # The shared expansion reconstructs argv and may lose redirect quoting.
    # Treat alias-fed update-ref stdin as unseen rather than trusting that text.
    tokens, positions, _segments, _scopes = shell_parse._parse_bash(body)
    if any(active and (token in {'eval', 'source', '.'} or '$' in token or '`' in token)
           for token, active in zip(tokens, positions)):
        raise AliasUnknown
    literal = literal_listing_patterns(api)
    token = _ALIAS_INPUT.set(True)
    listing_token = _ALIAS_LISTING_LITERAL.set(None)
    try:
        if shell_alias_context_uncertain():
            variables = {**variables, '__GUARDIAN_ALIAS_CWD': None}
            body = 'cd "$__GUARDIAN_ALIAS_CWD"; ' + body
        _ALIAS_LISTING_LITERAL.set((body, literal))
        return api['_is_dangerous_rm_at_depth'](body, cwd=cwd, env=variables, _depth=depth + 1)
    finally:
        _ALIAS_LISTING_LITERAL.reset(listing_token)
        _ALIAS_INPUT.reset(token)


def literal_listing_patterns(api):
    """A listing waiver never admits an unquoted glob that can become options."""
    inherited = _ALIAS_LISTING_LITERAL.get()
    command = RAW_COMMAND.get()
    if inherited is not None and command is inherited[0]:
        return inherited[1]
    if command is None:
        return False
    active = api["_shell_text_with_comments_blanked"](shell_parse.shell_text_without_heredoc_bodies(command))
    if any(char in shell_parse._blank_quoted(active) for char in '*?['):
        return False
    # Alias definition quotes protect definition text, not its later execution.
    tokens, _positions, _segments, _scopes = shell_parse._parse_bash(active)
    return not any('=' in token and any(char in shell_parse._blank_quoted(token.split('=', 1)[1])
                                       for char in '*?[') for token in tokens)

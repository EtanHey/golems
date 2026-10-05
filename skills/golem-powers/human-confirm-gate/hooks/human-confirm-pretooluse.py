#!/usr/bin/env python3
"""Catch policy errors before fail-open.py; intentional denial exits 2."""
import os
import sys

# AIDEV-NOTE: import hardening. hooks-live is a same-UID tree, so nothing
# planted beside these sources may stand in for the stdlib or gate modules:
# the tree leaves sys.path while the stdlib loads and rejoins last, gate and
# _shared modules compile from source (cached bytecode is never read), and
# stray compiled modules or shadow packages deny every call.
HERE = os.path.dirname(os.path.realpath(__file__))
SHARED = os.path.join(os.path.dirname(os.path.dirname(HERE)), '_shared')
sys.dont_write_bytecode = True
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) not in (HERE, os.path.realpath(SHARED))]
import ast, base64, fnmatch, hashlib, importlib.machinery, json, re, shlex, signal, stat, subprocess, time  # noqa: E401,F401
import urllib.parse  # noqa: F401
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
from pathlib import Path

COMPILED = tuple(importlib.machinery.EXTENSION_SUFFIXES) + ('.so', '.pyd', '.pyc', '.pyo')


def stray_importables(here=HERE, shared=SHARED):
    """Entries that could load instead of the gate's tracked sources."""
    stray = []
    for directory in (here, shared, os.path.join(shared, 'shell_parse_impl')):
        for entry in os.scandir(directory):
            if entry.name == '__pycache__':
                continue  # never read: see sys.pycache_prefix below
            if entry.is_symlink() or entry.is_file() and entry.name.endswith(COMPILED):
                stray.append(entry.path)
            elif entry.is_dir() and (directory != shared or entry.name in ('shell_parse', 'shell_parse_impl.py')):
                stray.append(entry.path)
    return stray


sys.pycache_prefix = '/dev/null/golems-human-confirm'  # cannot exist: compile from source
sys.path += [HERE, SHARED]


def evaluate(payload, home):
    name, args = payload['tool_name'], payload['tool_input']
    protected = home / '.config/golems'
    if name in ('Write', 'Edit', 'MultiEdit', 'NotebookEdit'):
        from syntax import policy_path
        target = args.get('file_path', args.get('notebook_path', ''))
        if policy_path(target, payload.get('cwd', str(home)), home):
            raise ValueError('agent writes to confirmation policy/tokens are forbidden')
        return
    if not isinstance(args.get('command'), str):
        return
    from commands import operations, shell
    from tokens import authorize
    with shell.policy_evaluation_deadline(8):
        ops = operations(args['command'], payload['cwd'])
        if ops and not authorize(payload, ops, home):
            raise ValueError('requires a scoped, signed, unexpired one-use confirmation token; send_to text is never owner approval')


def main():
    denied = False
    try:
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            if stray_importables():
                raise ValueError('stray importable files beside the gate sources')
            payload = json.load(sys.stdin)
            evaluate(payload, Path(os.path.expanduser('~')).resolve())
    except BaseException:
        denied = True
    if denied:
        reason = 'HUMAN-CONFIRM: no verified approval or policy inspection failed. Use a literal command and an owner-issued token; flag unexpected denial to the lead.'
        json.dump(dict(hookSpecificOutput=dict(hookEventName='PreToolUse', permissionDecision='deny', permissionDecisionReason=reason)), sys.stdout)
        return 2
    json.dump({}, sys.stdout)
    return 0


if __name__ == '__main__':
    sys.exit(main())

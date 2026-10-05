#!/usr/bin/env python3
"""Catch policy errors before fail-open.py; intentional denial exits 2."""
import json
import os
import sys
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
from pathlib import Path


def evaluate(payload, home):
    name, args = payload['tool_name'], payload['tool_input']
    protected = home / '.config/golems'
    if name in ('Write', 'Edit', 'NotebookEdit'):
        target = Path(args.get('file_path', args.get('notebook_path', ''))).resolve()
        if target == protected or protected in target.parents:
            raise ValueError('agent writes to confirmation policy/tokens are forbidden')
        return
    if name != 'Bash':
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

#!/usr/bin/env python3
"""Launcher for golems Python hooks; policy gates opt into fail-closed.

Usage (as registered by scripts/hooks/install-hooks.mjs):
    python3 ~/.claude/hooks/golems-fail-open.py <hook.py> [args...]
    python3 ~/.claude/hooks/golems-fail-open.py --fail-closed <hook.py> [args...]

Claude Code treats exit 2 as a block, and `python3 missing.py` exits 2, so a
hook whose file vanished (hooks-live moved, a link dangles) would block every
matching tool call. This launcher turns every infrastructure or harness failure
that is not the hook's own decision into exit 0 plus ONE stderr line:
  - target missing            -> exit 0
  - import / syntax / runtime -> exit 0
  - the hook's own sys.exit() -> passed through unchanged (a deliberate block
    stays a block)

With --fail-closed, missing/unreadable/broken hooks and unexpected exit statuses
deny with a static recovery hint. Output from a failed hook is discarded so
partial JSON, target paths and exception values cannot leak into that denial.
Successful allow (0) and deliberate block (2) retain their output and status.
Only tmp-block and git-guardian pre_tool_use opt in via the host manifest (#488).

AIDEV-NOTE: this file is installed as a COPY on purpose (every other hook is a
symlink into hooks-live). It must still run when hooks-live is missing, and it
holds no command-classification policy. --status compares it byte-for-byte
with this source; a missing or broken launcher itself cannot enforce a gate.
"""

import json
import os
import runpy
import sys
from contextlib import nullcontext, redirect_stderr, redirect_stdout
from io import StringIO


def _warn(message):
    print(f"golems-fail-open: {message} (allowing)".replace("\n", " "), file=sys.stderr)


def _block():
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "BLOCKED: policy hook unavailable; reinstall: bash scripts/hooks/install-hooks.sh --host <host> --apply",
    }}, separators=(",", ":")))
    return 2


def main():
    args = sys.argv[1:]
    fail_closed = args[:1] == ["--fail-closed"]
    if fail_closed:
        args = args[1:]
    if not args:
        if fail_closed:
            return _block()
        _warn("no hook path given")
        return 0
    target = args[0]
    sys.argv = args
    output, errors = StringIO(), StringIO()
    try:
        if not os.path.isfile(target):
            if fail_closed:
                return _block()
            _warn(f"hook missing: {target}")
            return 0
        # Match python3 target.py, including sibling imports through a file link.
        sys.path[0] = os.path.dirname(os.path.realpath(target))
        with (redirect_stdout(output) if fail_closed else nullcontext()), \
             (redirect_stderr(errors) if fail_closed else nullcontext()):
            runpy.run_path(target, run_name="__main__")
    except SystemExit as exc:
        if fail_closed:
            if exc.code not in (None, 0, 2):
                return _block()
            sys.stdout.write(output.getvalue())
            sys.stderr.write(errors.getvalue())
        raise
    except BaseException as exc:  # noqa: BLE001 - mode is explicit in registration
        if fail_closed:
            return _block()
        _warn(f"{os.path.basename(target)} failed: {type(exc).__name__}: {exc}")
    else:
        if fail_closed:
            sys.stdout.write(output.getvalue())
            sys.stderr.write(errors.getvalue())
    return 0


if __name__ == "__main__":
    sys.exit(main())

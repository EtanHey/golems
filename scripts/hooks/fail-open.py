#!/usr/bin/env python3
"""Launcher for golems Python hooks; policy gates opt into fail-closed.

Usage (as registered by scripts/hooks/install-hooks.mjs):
    <pinned python3> -I -B ~/.claude/hooks/golems-fail-open.py <hook.py> [args...]
    <pinned python3> -I -B ~/.claude/hooks/golems-fail-open.py --fail-closed [--budget <s>] <hook.py> [args...]

Imports: hooks live in a same-UID tree, so nothing planted beside a hook may
stand in for the stdlib. The launcher preloads runpy's lazy imports, then adds
the hook's dir LAST on sys.path (never first). -I drops PYTHONPATH and user
site; -B keeps hooks from writing bytecode into the tree. The Codex adapter
(codex-policy-hook.py) runs each policy child through this launcher the same
way; there, the launcher's exit 0 + stderr line is a denial, never an allow.

Claude Code treats exit 2 as a block, and `python3 missing.py` exits 2, so a
hook whose file vanished (hooks-live moved, a link dangles) would block every
matching tool call. This launcher turns every infrastructure or harness failure
that is not the hook's own decision into exit 0 plus ONE stderr line:
  - target missing            -> exit 0
  - import / syntax / runtime -> exit 0
  - the hook's own sys.exit() -> passed through unchanged (a deliberate block
    stays a block)

With --fail-closed, missing/unreadable/broken hooks, unexpected exit statuses
and a crash of this launcher itself deny with a static recovery hint. Output
from a failed hook is discarded so partial JSON, target paths and exception
values cannot leak into that denial. Successful allow (0) and deliberate block
(2) retain their output and status. --budget <s> adds a watchdog: the hook
runs in a forked child in its own process group, and if it has not finished
within <s> seconds the whole group is SIGKILLed and the static denial is
emitted. A harness hook timeout does not block (Claude Code), so the installer
registers budget = manifest timeout - 1 s. The policy gates opt in via the
host manifest (#488): tmp-block, git-guardian pre_tool_use, human-confirm. A failure before this file
runs (interpreter missing, launcher unparseable) is the installer's /bin/sh
guard's to deny (install-hooks.mjs failClosedCommand).

AIDEV-NOTE: this file is installed as a COPY on purpose (every other hook is a
symlink into hooks-live). It must still run when hooks-live is missing, and it
holds no command-classification policy. --status compares it byte-for-byte
with this source; a missing or broken launcher itself cannot enforce a gate.
"""

import json
import os
import pkgutil  # noqa: F401  runpy imports these lazily; load them before a hook dir joins sys.path
import runpy
import signal
import sys
import time
import warnings  # noqa: F401
from contextlib import nullcontext, redirect_stderr, redirect_stdout
from io import StringIO

FAIL_CLOSED_PROTOCOL = 2  # 2: --budget watchdog
REPAIR_REASON = "BLOCKED: policy hook unavailable. FLAG THIS TO THE USER: reinstall hooks from the prompt: `! bash ~/Gits/golems/scripts/hooks/install-hooks.sh --host <host> --update --apply`."
# Read before main() rewrites sys.argv, so a launcher crash still knows its mode.
FAIL_CLOSED = sys.argv[1:2] == ["--fail-closed"]


def _warn(message):
    print(f"golems-fail-open: {message} (allowing)".replace("\n", " "), file=sys.stderr)


def _block():
    print(json.dumps({"decision": "block", "reason": REPAIR_REASON, "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": REPAIR_REASON,
    }}, separators=(",", ":")))
    return 2


def _scrub_path(hook_dir):
    """Put the hook's dir LAST on sys.path and drop the launcher's own dir.

    AIDEV-NOTE: no hook dir is ever FIRST on sys.path. Sibling imports still
    resolve from the real file's dir, but the stdlib always wins over anything
    planted beside a hook. Without -I, sys.path[0] is this launcher's own dir
    (the hooks dir of links). The scrub is by value, not by flag: the launcher
    must run on any Python >= 3.9 (legacy bare-python3 seats; the installer
    pins >= 3.11), and sys.flags.safe_path (-P) only exists on 3.11+. Under
    3.9 -I there is no script dir to drop, so popping sys.path[0] there would
    remove the stdlib zip instead.
    """
    here = os.path.abspath(__file__)
    drop = {hook_dir, os.path.dirname(here), os.path.dirname(os.path.realpath(here))}
    sys.path[:] = [p for p in sys.path
                   if os.path.abspath(p) not in drop and os.path.realpath(p) not in drop]
    sys.path.append(hook_dir)


def _budget(args):
    """Parse a leading `--budget <seconds>`; returns (seconds or None, rest)."""
    if args[:1] != ["--budget"]:
        return None, args
    try:
        seconds = float(args[1])
    except (IndexError, ValueError):
        raise ValueError("invalid --budget")
    if not 0 < seconds <= 120:
        raise ValueError("invalid --budget")
    return seconds, args[2:]


def _watch(seconds):
    """Fork: the child runs the hook in its own process group and returns None;
    the parent waits at most `seconds`, then kills the group and denies."""
    pid = os.fork()
    if pid == 0:
        # Both sides set the group; whichever loses the race gets EPERM/ESRCH,
        # which is harmless. Unguarded here, it turned ~0.6% of legitimate
        # calls into the crash deny (#656 R2 B1).
        try:
            os.setpgid(0, 0)
        except OSError:
            pass
        return None
    try:
        os.setpgid(pid, pid)
    except OSError:
        pass
    deadline = time.monotonic() + seconds
    while True:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            break
        if time.monotonic() >= deadline:
            try:
                os.killpg(pid, signal.SIGKILL)
            except OSError:  # no group after all: never wait on a live hung child
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass
            os.waitpid(pid, 0)
            return _block()
        time.sleep(0.01)
    code = os.waitstatus_to_exitcode(status)
    return code if code in (0, 2) else _block()


def main():
    args = sys.argv[1:]
    fail_closed = args[:1] == ["--fail-closed"]
    if fail_closed:
        budget, args = _budget(args[1:])
        if budget is not None:
            code = _watch(budget)
            if code is not None:
                return code
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
        _scrub_path(os.path.dirname(os.path.realpath(target)))
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
    try:
        code = main()
    except SystemExit:
        raise
    except BaseException:  # noqa: BLE001 - the launcher's own crash: a policy gate denies
        if not FAIL_CLOSED:
            raise
        code = _block()
    sys.exit(code)

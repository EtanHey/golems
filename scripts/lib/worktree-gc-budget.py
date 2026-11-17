#!/usr/bin/env python3
"""Bound a GC command and all of its descendants by the run deadline."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def expired():
    late = time.monotonic() >= float(os.environ['GC_RUN_DEADLINE'])
    if late:
        Path(os.environ['GC_BUDGET_MARKER']).touch()
    return late


def run(args):
    if expired():
        return 124
    child = None
    pending = None

    def kill_child():
        if child is not None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()

    def stop(signum, _frame):
        nonlocal pending
        pending = signum
        if child is not None:
            kill_child()
            raise SystemExit(128 + signum)

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, stop)
    if pending:
        return 128 + pending
    child = subprocess.Popen(args, start_new_session=True)
    if pending:
        kill_child()
        return 128 + pending
    remaining = max(0, float(os.environ['GC_RUN_DEADLINE']) - time.monotonic())
    # Network calls need not consume the whole sweep budget.
    network = args[0] == 'gh' or (args[0] == 'git' and any(a in ('fetch', 'ls-remote') for a in args[1:]))
    limit = min(60, remaining) if network else remaining
    try:
        code = child.wait(timeout=limit)
    except subprocess.TimeoutExpired:
        kill_child()
        expired()
        return 124
    if expired():
        return 124
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    if sys.argv[1] == 'check':
        sys.exit(124 if expired() else 0)
    sys.exit(run(sys.argv[2:]))

#!/usr/bin/env python3
"""Bound a list-only remote observation; never authorize removal on timeout."""
import math
import os
import signal
import subprocess
import sys


def stop(child):
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        child.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass
    finally:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()


def run(seconds, command):
    if not math.isfinite(seconds) or not 0 < seconds <= 300:
        raise ValueError('invalid remote observation deadline')
    child = None
    interrupted = 0

    def interrupt(signum, frame):
        nonlocal interrupted
        interrupted = signum
        if child is not None:
            raise SystemExit(128 + signum)

    previous = {sig: signal.signal(sig, interrupt)
                for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    try:
        child = subprocess.Popen(command, start_new_session=True)
        if interrupted:
            raise SystemExit(128 + interrupted)
        try:
            return child.wait(timeout=seconds)
        except subprocess.TimeoutExpired:
            print('remote-state-unproven: observation timed out', file=sys.stderr)
            return 124
    finally:
        if child is not None:
            stop(child)
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    try:
        sys.exit(run(float(sys.argv[1]), sys.argv[2:]))
    except (OSError, ValueError) as error:
        print('remote-state-unproven: ' + str(error), file=sys.stderr)
        sys.exit(1)

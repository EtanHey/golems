#!/usr/bin/env python3
"""Bound a list-only remote observation; never authorize removal on timeout."""
import math
import os
import signal
import subprocess
import sys


def run(seconds, command):
    if not math.isfinite(seconds) or not 0 < seconds <= 300:
        raise ValueError('invalid remote observation deadline')
    with subprocess.Popen(command, start_new_session=True) as child:
        try:
            return child.wait(timeout=seconds)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            print('remote-state-unproven: observation timed out', file=sys.stderr)
            return 124


if __name__ == '__main__':
    try:
        sys.exit(run(float(sys.argv[1]), sys.argv[2:]))
    except (OSError, ValueError) as error:
        print('remote-state-unproven: ' + str(error), file=sys.stderr)
        sys.exit(1)

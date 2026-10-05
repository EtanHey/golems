#!/usr/bin/env python3
"""Serialize opted-in heavy commands on this machine, then wait for safe load."""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def wait_for_load(max_load, poll_seconds):
    while True:
        load = os.getloadavg()[0]  # Same 1-minute load reported by uptime.
        if load <= max_load:
            return
        print(f"heavy-suite: WAIT load={load:.2f} max={max_load:g}", file=sys.stderr, flush=True)
        time.sleep(poll_seconds)


def write_record(fd, record):
    os.lseek(fd, 0, os.SEEK_SET)
    os.ftruncate(fd, 0)
    with os.fdopen(os.dup(fd), "w") as stream:
        json.dump(record, stream)
        stream.write("\n")
        stream.flush()


def run_command(command, lock_fd):
    # The child inherits the lock: killing this wrapper cannot release the slot
    # while the suite is still running. No shell interpolation of command args.
    child = subprocess.Popen(command, start_new_session=True, pass_fds=(lock_fd,))

    def forward(signum, _frame):
        try:
            os.killpg(child.pid, signum)
        except ProcessLookupError:
            pass

    previous = {sig: signal.signal(sig, forward) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        result = child.wait()
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    return result if result >= 0 else 128 - result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-load", type=float, default=os.environ.get("GOLEMS_HEAVY_MAX_LOAD", "20"))
    parser.add_argument("--poll-seconds", type=float, default=os.environ.get("GOLEMS_HEAVY_POLL_SECONDS", "5"))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("provide a command after --")
    if not math.isfinite(args.max_load) or args.max_load < 0:
        parser.error("max-load must be finite and nonnegative")
    if not math.isfinite(args.poll_seconds) or args.poll_seconds <= 0:
        parser.error("poll-seconds must be finite and positive")
    lock = Path.home() / ".local/state/golems/heavy-suite.lock"
    lock.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        print(f"heavy-suite: QUEUED pid={os.getpid()}", file=sys.stderr, flush=True)
        fcntl.flock(fd, fcntl.LOCK_EX)
        # Kernel ownership is authoritative, never the PID or age in this record.
        # A crashed owner's lock is released automatically; replace stale metadata.
        with os.fdopen(os.dup(fd)) as stream:
            try:
                old = json.load(stream)
            except (ValueError, TypeError):
                old = {}
        if isinstance(old, dict) and old.get("state") == "running":
            print("heavy-suite: RECLAIMED stale owner record", file=sys.stderr, flush=True)
        wait_for_load(args.max_load, args.poll_seconds)
        record = {"pid": os.getpid(), "state": "running", "started": time.time(), "executable": Path(command[0]).name}
        write_record(fd, record)
        print(f"heavy-suite: SUITE START pid={os.getpid()}", file=sys.stderr, flush=True)
        result = run_command(command, fd)
        write_record(fd, {**record, "state": "done", "exit_code": result})
        print(f"heavy-suite: SUITE DONE pid={os.getpid()} exit={result}", file=sys.stderr, flush=True)
        return result
    finally:
        # Never unlink the lock file: a new inode could let queued holders overlap.
        os.close(fd)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except OSError as error:
        print(f"heavy-suite: {error}", file=sys.stderr)
        raise SystemExit(2)

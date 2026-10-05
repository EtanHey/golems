#!/usr/bin/env python3
"""Serialize opted-in heavy commands; coordination failures never skip the suite."""
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


def notice(message):
    print(f"heavy-suite: {message}", file=sys.stderr, flush=True)


def wait_for_load(max_load, poll_seconds, deadline=float("inf")):
    next_notice = 0
    while True:
        load = os.getloadavg()[0]  # Same 1-minute load reported by uptime.
        if load <= max_load:
            return
        now = time.monotonic()
        if now >= deadline:
            notice(f"WARNING PROCEEDING under load={load:.2f} (max wait reached)")
            return
        if now >= next_notice:
            notice(f"WAIT load={load:.2f} max={max_load:g}")
            next_notice = now + 30
        time.sleep(min(poll_seconds, deadline - now))


def read_record(fd):
    try:
        record = json.loads(os.pread(fd, 4096, 0))
        return record if isinstance(record, dict) else {}
    except (ValueError, OSError):
        return {}


def acquire_lock(fd, poll_seconds, deadline):
    next_notice = 0
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            holder = read_record(fd)
            summary = f"pid={holder.get('pid', '?')} cmd={holder.get('executable', '?')} started={holder.get('started', '?')}"
            now = time.monotonic()
            if now >= deadline:
                notice(f"WARNING PROCEEDING unqueued after max wait; holder {summary}")
                return False
            if now >= next_notice:
                notice(f"WAIT waiting for holder {summary}")
                next_notice = now + 30
            time.sleep(min(poll_seconds, deadline - now))


def write_record(fd, record):
    try:
        os.lseek(fd, 0, os.SEEK_SET)
        os.ftruncate(fd, 0)
        os.write(fd, (json.dumps(record) + "\n").encode())
    except OSError as error:
        notice(f"WARNING holder record unavailable: {error}")


def run_command(command, lock_fd=None):
    child, pending = None, []
    def forward(signum, _frame):
        if child is None:
            pending.append(signum)
        else:
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass
    signals = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
    previous = {sig: signal.signal(sig, forward) for sig in signals}
    try:
        if pending:
            return 128 + pending[0]
        # Install handlers before spawning; forward signals received in Popen.
        child = subprocess.Popen(command, start_new_session=True,
            pass_fds=() if lock_fd is None else (lock_fd,),
            env={**os.environ, "GOLEMS_HEAVY_SUITE_HELD": str(os.getpid())})
        for sig in pending:
            forward(sig, None)
        result = child.wait()
        return result if result >= 0 else 128 - result
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag, env, default in (("max-load", "MAX_LOAD", "20"), ("poll-seconds", "POLL_SECONDS", "5"), ("max-wait-seconds", "MAX_WAIT_SECONDS", "1800")):
        parser.add_argument("--" + flag, type=float, default=os.environ.get("GOLEMS_HEAVY_" + env, default))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("provide a command after --")
    if os.environ.get("GOLEMS_HEAVY_SUITE_HELD"):
        return run_command(command)
    if os.environ.get("GOLEMS_HEAVY_FORCE") == "1":
        notice("WARNING FORCE=1: running unqueued, bypassing lock and load gate")
        return run_command(command)
    for value, name, minimum in ((args.max_load, "max-load", 0), (args.poll_seconds, "poll-seconds", 0), (args.max_wait_seconds, "max-wait-seconds", 0)):
        if not math.isfinite(value) or value < minimum or (name == "poll-seconds" and value == 0):
            notice(f"WARNING invalid {name}; running unqueued")
            return run_command(command)
    lock = Path(os.environ.get("GOLEMS_HEAVY_LOCK") or Path.home() / ".local/state/golems/heavy-suite.lock")
    deadline, fd, held = time.monotonic() + args.max_wait_seconds, None, False
    try:
        try:
            lock.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            notice(f"QUEUED pid={os.getpid()}")
            held = acquire_lock(fd, args.poll_seconds, deadline)
        except OSError as error:
            notice(f"WARNING lock unavailable ({error}); running unqueued")
        if not held:
            return run_command(command)
        if read_record(fd).get("state") in ("running", "waiting-load"):
            notice("RECLAIMED stale owner record")
        record = {"pid": os.getpid(), "state": "waiting-load", "started": time.time(), "executable": Path(command[0]).name}
        write_record(fd, record)
        try:
            wait_for_load(args.max_load, args.poll_seconds, deadline)
        except OSError as error:
            notice(f"WARNING load unavailable ({error}); proceeding")
        write_record(fd, {**record, "state": "running"})
        notice(f"SUITE START pid={os.getpid()}")
        result = run_command(command, fd)
        write_record(fd, {**record, "state": "done", "exit_code": result})
        notice(f"SUITE DONE pid={os.getpid()} exit={result}")
        return result
    finally:
        if fd is not None:
            # Unlock the shared OFD even if a daemon inherited a duplicate.
            # SIGKILL skips this, preserving the running child's slot.
            try:
                if held:
                    fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)  # Never unlink: separate inodes allow overlap.


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except OSError as error:
        notice(f"suite command failed: {error}")
        raise SystemExit(2)

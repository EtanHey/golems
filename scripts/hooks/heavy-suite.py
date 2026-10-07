#!/usr/bin/env python3
"""Bound concurrency of opted-in heavy commands with a RAM start guard."""
import argparse
import fcntl
import json
import math
import os
import re
from pathlib import Path
import signal
import subprocess
import sys
import time


def notice(message):
    print(f"heavy-suite: {message}", file=sys.stderr, flush=True)


def wait_for_load(max_load, poll_seconds, deadline=float("inf"), strict=False):
    next_notice = 0
    while True:
        load = os.getloadavg()[0]  # Same 1-minute load reported by uptime.
        if load <= max_load:
            return
        now = time.monotonic()
        if now >= deadline:
            if strict:
                raise ValueError("load gate timed out; refusing execution")
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


def slot_count():
    try:
        return max(1, min(8, int(os.environ.get("GOLEMS_HEAVY_SUITE_SLOTS", "3"))))
    except ValueError:
        notice("WARNING invalid slot count; using 3")
        return 3


def free_inactive_bytes():
    if sys.platform == "darwin":
        output = subprocess.check_output(["/usr/bin/vm_stat"], text=True, timeout=5)
        page_size = int(re.search(r"page size of (\d+) bytes", output)[1])
        pages = dict(re.findall(r"(Pages free|Pages inactive):\s+(\d+)", output))
        return (int(pages["Pages free"]) + int(pages["Pages inactive"])) * page_size
    fields = dict(re.findall(r"^(MemFree|Inactive):\s+(\d+) kB", Path("/proc/meminfo").read_text(), re.M))
    return (int(fields["MemFree"]) + int(fields["Inactive"])) * 1024


def wait_for_memory(min_free_gb, poll_seconds, deadline):
    next_notice = 0
    while min_free_gb > 0:
        try:
            free_gb = free_inactive_bytes() / 1024**3
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
            raise ValueError(f"memory unavailable; refusing START: {error}") from error
        if free_gb >= min_free_gb:
            return
        now = time.monotonic()
        if now >= deadline:
            raise ValueError(f"memory={free_gb:.2f}GiB floor={min_free_gb:g}GiB; max wait reached; refusing START")
        if now >= next_notice:
            notice(f"WAIT memory={free_gb:.2f}GiB floor={min_free_gb:g}GiB")
            next_notice = now + 30
        time.sleep(min(poll_seconds, deadline - now))


def acquire_slot(poll_seconds, deadline, min_free_gb, max_load=None, strict_load=False):
    base = Path(os.environ.get("GOLEMS_HEAVY_LOCK") or Path.home() / ".local/state/golems/heavy-suite.lock")
    base.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    next_notice = 0
    while True:
        wait_for_memory(min_free_gb, poll_seconds, deadline)
        if max_load is not None:
            try:
                if strict_load:
                    wait_for_load(max_load, poll_seconds, deadline, True)
                else:
                    wait_for_load(max_load, poll_seconds, deadline)
            except OSError as error:
                if strict_load:
                    raise
                notice(f"WARNING load unavailable ({error}); proceeding")
            wait_for_memory(min_free_gb, poll_seconds, deadline)
        holders, legacy_fd, selected = [], None, False
        try:
            legacy_fd = os.open(base, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            os.set_inheritable(legacy_fd, False)
            try:
                fcntl.flock(legacy_fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                holder = read_record(legacy_fd)
                holders.append(f"legacy pid={holder.get('pid', '?')} cmd={holder.get('executable', '?')}")
            else:
                for index in range(slot_count()):
                    path = base.with_name(f"{base.stem}.slot{index}{base.suffix}")
                    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
                    try:
                        os.set_inheritable(fd, False)
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        selected = True
                        return fd, index, legacy_fd
                    except BlockingIOError:
                        holder = read_record(fd)
                        holders.append(f"slot={index} pid={holder.get('pid', '?')} cmd={holder.get('executable', '?')} started={holder.get('started', '?')}")
                    finally:
                        if not selected:
                            os.close(fd)
        finally:
            if legacy_fd is not None and not selected:
                os.close(legacy_fd)
        now = time.monotonic()
        summary = "; ".join(holders)
        if now >= deadline:
            notice(f"WARNING PROCEEDING unqueued after max wait; holders {summary}")
            return None, None, None
        if now >= next_notice:
            notice(f"WAIT waiting for holders {summary}")
            next_notice = now + 30
        time.sleep(min(poll_seconds, deadline - now))


def write_record(fd, record):
    try:
        os.lseek(fd, 0, os.SEEK_SET)
        os.ftruncate(fd, 0)
        os.write(fd, (json.dumps(record) + "\n").encode())
    except OSError as error:
        notice(f"WARNING holder record unavailable: {error}")


def run_command(command):
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
            close_fds=True,
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
    for flag, env, default in (("max-load", "MAX_LOAD", str(2 * (os.cpu_count() or 1))), ("poll-seconds", "POLL_SECONDS", "5"), ("max-wait-seconds", "MAX_WAIT_SECONDS", "1800"), ("min-free-gb", "MIN_FREE_GB", "6")):
        parser.add_argument("--" + flag, type=float, default=os.environ.get("GOLEMS_HEAVY_" + env, default))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("provide a command after --")
    if os.environ.get("GOLEMS_HEAVY_SUITE_HELD"):
        return run_command(command)
    if os.environ.get("GOLEMS_HEAVY_FORCE") == "1":
        notice("WARNING FORCE=1: running unqueued, bypassing slots, memory and load gates")
        return run_command(command)
    if not math.isfinite(args.min_free_gb) or args.min_free_gb < 0:
        notice("invalid min-free-gb; refusing START")
        return 75
    for value, name, minimum in ((args.max_load, "max-load", 0), (args.poll_seconds, "poll-seconds", 0), (args.max_wait_seconds, "max-wait-seconds", 0)):
        if not math.isfinite(value) or value < minimum or (name == "poll-seconds" and value == 0):
            notice(f"WARNING invalid {name}; running unqueued")
            return run_command(command)
    deadline, fd, legacy_fd = time.monotonic() + args.max_wait_seconds, None, None
    try:
        try:
            notice(f"QUEUED pid={os.getpid()}")
            fd, index, legacy_fd = acquire_slot(args.poll_seconds, deadline, args.min_free_gb, args.max_load)
        except OSError as error:
            notice(f"WARNING lock unavailable ({error}); running unqueued")
            wait_for_memory(args.min_free_gb, args.poll_seconds, deadline)
        if fd is None:
            return run_command(command)
        if read_record(fd).get("state") in ("running", "waiting-load"):
            notice("RECLAIMED stale owner record")
        record = {"pid": os.getpid(), "slot": index, "state": "running", "started": time.time(), "executable": Path(command[0]).name}
        write_record(fd, record)
        notice(f"SUITE START pid={os.getpid()} slot={index}")
        result = run_command(command)
        write_record(fd, {**record, "state": "done", "exit_code": result})
        notice(f"SUITE DONE pid={os.getpid()} exit={result} slot={index}")
        return result
    except ValueError as error:
        notice(str(error))
        return 75
    finally:
        if fd is not None:
            os.close(fd)  # Parent-only ownership; SIGKILL also releases it. Never unlink.
        if legacy_fd is not None:
            os.close(legacy_fd)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except OSError as error:
        notice(f"suite command failed: {error}")
        raise SystemExit(2)

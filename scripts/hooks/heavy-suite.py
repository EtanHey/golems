#!/usr/bin/env python3
"""Bound concurrency of opted-in heavy commands with a RAM start guard."""
import argparse
import fcntl
import hashlib
import json
import math
import os
import re
from pathlib import Path
from threading import Event
import signal
import subprocess
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import proc_identity as proc

runtime_wait = Event().wait


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


def save_run(path, record):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(record, stream, default=lambda value: value.hex())
    os.replace(temporary, path)


class SuiteTree:
    def __init__(self, leader, suite_id, nested):
        self.leader, self.suite_id, self.nested = leader, suite_id.encode(), nested
        self.known = {} if leader is None else {(leader.pid, leader.start): leader}
        self.incomplete, self.signalled = set(), []

    def scan(self):
        snapshot = proc.children_snapshot()
        rows = {pid: proc.ProcIdentity(pid, *row[:2], row[3], row[4], row[2]) for pid, row in snapshot.items()}
        leader = rows.get(self.leader.pid) if self.leader else None
        group_live = leader is not None and leader.key == self.leader.key and proc.same_process(leader)
        for pid, error in snapshot.unavailable.items():
            if error.reason != "gone" and any(key[0] == pid for key in self.known):
                self.incomplete.add(f"identity-unavailable:{pid}")
        found = {}
        for _ in range(len(rows) + 1):
            changed = False
            for pid, row in rows.items():
                if pid <= 1 or pid in (os.getpid(), os.getppid()) or row.pgid == os.getpgrp():
                    continue
                key = (pid, row.start)
                parent = rows.get(row.ppid)
                lineage = parent is not None and (parent.pid, parent.start) in self.known and row.start >= parent.start
                proven = key in self.known or lineage or (group_live and row.pgid == leader.pgid and row.start >= leader.start)
                if not proven and not self.nested and self.leader and row.start > self.leader.start and row.uid == os.geteuid():
                    marker = proc.owned(pid, b"GOLEMS_HEAVY_SUITE_ID", self.suite_id)
                    proven = marker is True and proc.same_process(row)
                if proven:
                    if key not in self.known: self.known[key] = row; changed = True
                    if (row.uid, row.ruid) != (os.geteuid(), os.getuid()):
                        self.incomplete.add(f"uid-filtered:{pid}")
                    else: found[pid] = row
            if not changed: break
        return found

    def send(self, rows, signum):
        for row in rows.values():
            try:
                with proc.pinned_process(row) as fd:
                    if fd is None: os.kill(row.pid, signum)
                    else: signal.pidfd_send_signal(fd, signum)
                self.signalled.append({"pid": row.pid, "start": row.start, "signal": int(signum)})
            except ProcessLookupError: pass
            except (OSError, proc.ProcIdentityUnavailable):
                try:
                    current = proc.identity(row.pid)
                    if current is not None and current.start == row.start: self.incomplete.add(f"signal-unverified:{row.pid}")
                except proc.ProcIdentityUnavailable: self.incomplete.add(f"signal-unverified:{row.pid}")


def cleanup_tree(tree, child, grace, signum=None):
    start, empty = time.monotonic(), 0
    rows = {}
    while time.monotonic() <= start + grace + 2:
        try:
            rows = tree.scan()
            child.poll()
            empty = empty + 1 if not rows and child.returncode is not None else 0
            if empty >= 2: return not tree.incomplete, []
            if signum is not None: tree.send(rows, signum); signum = None
            tree.send(rows, signal.SIGKILL if time.monotonic() >= start + grace else signal.SIGTERM)
        except proc.ProcIdentityUnavailable: tree.incomplete.add("scan-unavailable")
        runtime_wait(.02)
    return False, list(rows)


def run_command(command, timeout=1800, grace=10, slot=None):
    child, pending, tree, path = None, [], None, None
    suite_id = os.environ.get("GOLEMS_HEAVY_SUITE_ID", "")
    nested = re.fullmatch(r"[0-9a-f]{32}", suite_id) is not None
    suite_id = suite_id if nested else uuid.uuid4().hex
    signals = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
    previous = {sig: signal.signal(sig, lambda sig, frame: pending.append(sig)) for sig in signals}
    result, reason, ok = 70, "supervision-unavailable", False
    try:
        owner, wrapper = proc.identity(os.getppid()), proc.identity(os.getpid())
        if owner is None or wrapper is None: raise proc.ProcIdentityUnavailable("owner unavailable")
        record = dict(suite_id=suite_id, owner_pid=owner.pid, owner_birth=owner.start, wrapper_pid=wrapper.pid,
            wrapper_birth=wrapper.start, leader_pid=None, leader_birth=None, pgid=None, wall_limit_s=timeout,
            cmd_sha256=hashlib.sha256(os.fsencode(" ".join(command))).hexdigest(), cwd=os.getcwd(), started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        if not nested:
            directory = Path.home() / ".local/state/golems/runs"
            directory.mkdir(parents=True, exist_ok=True, mode=0o700); directory.chmod(0o700)
            path = directory / (suite_id + ".json"); save_run(path, record)
            notice(f"SUITE START pid={os.getpid()} slot={slot} suite_id={suite_id} timeout={timeout:g}")
        if pending: raise InterruptedError()
        gate_read, gate_write = os.pipe()
        bootstrap = "import os,sys; fd=int(sys.argv[1]); ready=os.read(fd,1); os.close(fd)\ntry: os.execvpe(sys.argv[2],sys.argv[2:],os.environ) if ready else sys.exit(125)\nexcept OSError: sys.exit(2)"
        deadline = time.monotonic() + timeout
        child = subprocess.Popen([sys.executable, "-c", bootstrap, str(gate_read), *command], pass_fds=(gate_read,), start_new_session=True, close_fds=True, env={**os.environ,
            "GOLEMS_HEAVY_SUITE_HELD": str(os.getpid()), "GOLEMS_HEAVY_SUITE_ID": suite_id, "GOLEMS_HEAVY_RUN_ID": suite_id})
        os.close(gate_read)
        try:
            leader = proc.identity(child.pid)
            if leader is None: raise proc.ProcIdentityUnavailable("leader unavailable")
            tree = SuiteTree(leader, suite_id, nested)
            os.write(gate_write, b"1")
        finally: os.close(gate_write)
        record.update(leader_pid=child.pid, leader_birth=leader.start if leader else None, pgid=child.pid)
        if path: save_run(path, record)
        while True:
            status = child.poll()
            if pending: result, reason = 128 + pending[0], "cancelled"; break
            if status is not None: result, reason = status if status >= 0 else 128 - status, "child-exit"; break
            if time.monotonic() >= deadline:
                result, reason = 124, "timeout"
                if not nested: notice(f"TIMEOUT after {timeout:g}s; terminating suite process tree (suite_id={suite_id})")
                break
            tree.scan()
            runtime_wait(min(.02, max(0, deadline - time.monotonic())))
        ok, survivors = cleanup_tree(tree, child, grace, pending[0] if pending else None)
        if not ok:
            notice(f"CLEANUP FAILED; suite process tree remains or is unverifiable (suite_id={suite_id})")
            if result == 0: result = 70
        if pending and reason != "timeout": result, reason = 128 + pending[0], "cancelled"
        if path:
            record.update(reason=reason, cleanup="ok" if ok else "failed", members_seen=[vars(row) for row in tree.known.values()],
                signalled=tree.signalled, survivors=survivors, incomplete=sorted(tree.incomplete))
            save_run(path, record); save_run(path.with_suffix(".cleanup.json"), record)
            if ok: path.unlink()
        if not nested: notice(f"SUITE DONE pid={os.getpid()} slot={slot} suite_id={suite_id} exit={result} reason={reason} cleanup={'ok' if ok else 'failed'}")
    except (OSError, proc.ProcIdentityUnavailable):
        notice("supervision unavailable; refusing START" if child is None else "CLEANUP FAILED; supervision unavailable")
        if child is not None:
            tree = tree or SuiteTree(None, suite_id, nested)
            tree.incomplete.add("supervision-unavailable")
            ok, survivors = cleanup_tree(tree, child, grace)
            if path:
                record.update(reason=reason, cleanup="failed", members_seen=[vars(row) for row in tree.known.values()],
                    signalled=tree.signalled, survivors=survivors, incomplete=sorted(tree.incomplete))
                try: save_run(path, record)
                except OSError: pass
        elif path: path.unlink(missing_ok=True)
    finally:
        mask = signal.pthread_sigmask(signal.SIG_BLOCK, signals)
        for sig in signal.sigpending().intersection(signals).difference(mask):
            pending.append(sig); signal.sigwait({sig})
        for sig, handler in previous.items(): signal.signal(sig, handler)
        signal.pthread_sigmask(signal.SIG_SETMASK, mask)
    return result if reason == "timeout" or not pending else 128 + pending[0]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag, env, default in (("max-load", "MAX_LOAD", str(2 * (os.cpu_count() or 1))), ("poll-seconds", "POLL_SECONDS", "5"), ("max-wait-seconds", "MAX_WAIT_SECONDS", "1800"), ("min-free-gb", "MIN_FREE_GB", "6")):
        parser.add_argument("--" + flag, type=float, default=os.environ.get("GOLEMS_HEAVY_" + env, default))
    for flag, default in (("timeout-seconds", "1800"), ("kill-grace-seconds", "10")):
        parser.add_argument("--" + flag, default=os.environ.get("GOLEMS_HEAVY_" + flag.upper().replace("-", "_"), default))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("provide a command after --")
    for flag, positive in (("timeout_seconds", True), ("kill_grace_seconds", False)):
        try:
            value = float(getattr(args, flag))
            if not math.isfinite(value) or value < 0 or (positive and value == 0): raise ValueError()
        except ValueError:
            notice(f"invalid {flag.replace('_', '-')}; expected a finite number {'> 0' if positive else '>= 0'}; refusing START")
            return 2
        setattr(args, flag, value)
    def run(slot=None): return run_command(command, args.timeout_seconds, args.kill_grace_seconds, slot)
    if (os.environ.get("GOLEMS_HEAVY_PRE_PUSH") == "1"
            and sys.stdin is not None and not sys.stdin.isatty()):
        updates = [line.split() for line in sys.stdin.buffer]
        if updates and all(len(fields) == 4 and fields[1] in (b"0" * 40, b"0" * 64)
                           for fields in updates):
            notice("SKIP delete-only push: no code to test")
            return 0
    if os.environ.get("GOLEMS_HEAVY_SUITE_HELD"):
        return run()
    if os.environ.get("GOLEMS_HEAVY_FORCE") == "1":
        notice("WARNING FORCE=1: running unqueued, bypassing slots, memory and load gates")
        return run()
    if not math.isfinite(args.min_free_gb) or args.min_free_gb < 0:
        notice("invalid min-free-gb; refusing START")
        return 75
    for value, name, minimum in ((args.max_load, "max-load", 0), (args.poll_seconds, "poll-seconds", 0), (args.max_wait_seconds, "max-wait-seconds", 0)):
        if not math.isfinite(value) or value < minimum or (name == "poll-seconds" and value == 0):
            notice(f"WARNING invalid {name}; running unqueued")
            return run()
    deadline, fd, legacy_fd = time.monotonic() + args.max_wait_seconds, None, None
    try:
        try:
            notice(f"QUEUED pid={os.getpid()}")
            fd, index, legacy_fd = acquire_slot(args.poll_seconds, deadline, args.min_free_gb, args.max_load)
        except OSError as error:
            notice(f"WARNING lock unavailable ({error}); running unqueued")
            wait_for_memory(args.min_free_gb, args.poll_seconds, deadline)
        if fd is None:
            return run()
        if read_record(fd).get("state") in ("running", "waiting-load"):
            notice("RECLAIMED stale owner record")
        record = {"pid": os.getpid(), "slot": index, "state": "running", "started": time.time(), "executable": Path(command[0]).name}
        write_record(fd, record)
        result = run(index)
        write_record(fd, {**record, "state": "done", "exit_code": result})
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

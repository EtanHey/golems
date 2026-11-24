"""Interoperate with lane mkdir slots. Never reclaim a foreign directory."""
from datetime import datetime, timezone
import os
from pathlib import Path
import signal
import shlex
import subprocess
import time
import uuid

import heavy_watchdog as watchdog

SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)


class Cancelled(Exception):
    def __init__(self, signum):
        self.signum = signum


def interrupted(signum, frame):
    raise Cancelled(signum)


def write_owner(stream, record):
    for key, value in record.items():
        # Keep attribution one field per line even for multiline command arguments.
        value = str(value).replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '\\r')
        stream.write(f'{key}={value}\n')


def read_owner(stream):
    record = {}
    for line in stream:
        key, separator, value = line.rstrip('\n').partition('=')
        if not separator or key in record:
            raise ValueError('malformed lane owner')
        record[key] = value
    return record


class LaneSlot:
    def __init__(self, lane, command, notice):
        self.lane, self.command, self.notice = lane, command, notice
        self.path = self.fd = self.identity = self.owner_identity = None
        self.record_written = False
        self.token = uuid.uuid4().hex
        self.host = watchdog.lane_host()
        self.log = Path.home() / f'.{self.host}-heavy.log'

    def log_event(self, event):
        line = f'{self.lane} {event} {time.strftime("%H:%M")} pid={os.getpid()} slot={self.path.name}'
        line = line.replace('\n', '\\n').replace('\r', '\\r')
        try:
            with self.log.open('a') as stream: stream.write(line + '\n')
        except OSError as error:
            self.notice(f'WARNING lane log unavailable: {error}')
        self.notice(line)

    def acquire(self, poll, deadline):
        paths = [Path.home()/f'.{self.host}-heavy.lock']
        if self.host == 'm4': paths.append(Path.home()/'.m4-heavy-2.lock')
        gate = Path.home()/'.local/bin/m4-heavy-gate'
        next_notice = 0
        if self.host != 'm4' or not gate.exists():
            self.notice('pressure gate missing on this host; relying on lane slot alone')
        while True:
            go = True
            if self.host == 'm4' and gate.exists():
                try:
                    # Bound even a broken gate that never returns. No slot held here.
                    go = subprocess.run([str(gate), '--quiet'], timeout=max(.001, deadline-time.monotonic())).returncode == 0
                except (OSError, subprocess.TimeoutExpired) as error:
                    self.notice(f'WAIT pressure gate unavailable: {error}')
                    go = False
            if go:
                for path in paths:
                    mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
                    try:
                        try: path.mkdir(mode=0o700)
                        except FileExistsError: continue
                        self.path = path
                        stat = path.lstat()
                        self.identity = (stat.st_dev, stat.st_ino)
                        self.fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
                        stat = os.fstat(self.fd)
                        self.identity = (stat.st_dev, stat.st_ino)
                        record = dict(lane=self.lane, worker=os.environ.get("GOLEMS_HEAVY_WORKER") or f"heavy-run:{os.getpid()}",
                            start=datetime.now(timezone.utc).isoformat(), pid=os.getpid(), token=self.token, cmd=shlex.join(self.command))
                        fd = os.open('owner', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
                        stat = os.fstat(fd)
                        self.owner_identity = (stat.st_dev, stat.st_ino)
                        with os.fdopen(fd, 'w') as stream: write_owner(stream, record)
                        self.record_written = True
                        self.log_event('took')
                        return path.name
                    finally:
                        signal.pthread_sigmask(signal.SIG_SETMASK, mask)
            now = time.monotonic()
            if now >= deadline: raise ValueError('lane slot/pressure wait timed out; refusing START')
            if now >= next_notice:
                self.notice('WAIT lane slots occupied or pressure gate not GO')
                next_notice = now + 30
            time.sleep(min(poll, deadline-now))

    def release(self):
        if self.path is None: return
        mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
        try:
            stat = self.path.lstat()
            if (stat.st_dev, stat.st_ino) != self.identity:
                self.notice('WARNING lane directory replaced; refusing release'); return
            if self.owner_identity is not None:
                fd = os.open('owner', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.fd)
                with os.fdopen(fd) as stream:
                    stat = os.fstat(stream.fileno())
                    if (stat.st_dev, stat.st_ino) != self.owner_identity:
                        self.notice('WARNING lane owner replaced; refusing release'); return
                    record = read_owner(stream) if self.record_written else None
                if self.record_written and (not isinstance(record, dict) or record.get('token') != self.token or record.get('pid') != str(os.getpid())):
                    self.notice('WARNING foreign lane owner; refusing release'); return
                os.unlink('owner', dir_fd=self.fd)
            self.path.rmdir()  # Never recursive: unknown files keep the directory in place.
            self.log_event('released')
        except (OSError, ValueError) as error:
            self.notice(f'WARNING lane release refused: {error}')
        finally:
            if self.fd is not None: os.close(self.fd)
            self.fd = None; self.path = None
            signal.pthread_sigmask(signal.SIG_SETMASK, mask)


def run(lane, command, poll, deadline, execute, notice):
    slot = None
    previous = {sig: signal.signal(sig, interrupted) for sig in SIGNALS}
    try:
        try:
            slot = LaneSlot(lane, command, notice)
            notice(f"QUEUED pid={os.getpid()} lane-slots={slot.host}")
            return execute(slot.acquire(poll, deadline))
        finally:
            if slot is not None: slot.release()
    except Cancelled as error:
        return 128 + error.signum
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        notice(f'lane admission failed: {error}')
        return 75
    finally:
        for sig, handler in previous.items(): signal.signal(sig, handler)

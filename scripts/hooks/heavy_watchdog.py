"""Session-isolated watchdog helpers. Never signal tracked escapees."""
import ctypes
import sys
import os
import signal
import subprocess
import time
from pathlib import Path


class RusageInfoV2(ctypes.Structure):
    # Darwin SDK sys/resource.h: UUID, then 18 uint64_t fields (160 bytes).
    _fields_ = [('ri_uuid', ctypes.c_uint8 * 16)] + [(name, ctypes.c_uint64) for name in (
        'ri_user_time', 'ri_system_time', 'ri_pkg_idle_wkups', 'ri_interrupt_wkups',
        'ri_pageins', 'ri_wired_size', 'ri_resident_size', 'ri_phys_footprint',
        'ri_proc_start_abstime', 'ri_proc_exit_abstime', 'ri_child_user_time',
        'ri_child_system_time', 'ri_child_pkg_idle_wkups', 'ri_child_interrupt_wkups',
        'ri_child_pageins', 'ri_child_elapsed_abstime', 'ri_diskio_bytesread',
        'ri_diskio_byteswritten')]


def physical_footprint(pid):
    library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    call = library.proc_pid_rusage
    call.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    call.restype = ctypes.c_int
    info = RusageInfoV2()
    if call(pid, 2, ctypes.byref(info)) != 0:
        raise OSError(ctypes.get_errno(), 'proc_pid_rusage failed')
    return info.ri_phys_footprint


def memory_rows(pids=None):
    output = subprocess.check_output(['ps', '-axo', 'pid=,rss=,comm='], text=True, timeout=5)
    result = {}
    for line in output.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) >= 2:
            try:
                pid, size = int(fields[0]), int(fields[1]) * 1024
                if pids is not None and pid not in pids:
                    continue
                metric = 'rss'
                if sys.platform == 'darwin':
                    try:
                        size = physical_footprint(pid)
                        metric = 'phys_footprint'
                    except OSError:
                        metric = 'rss_fallback'
                result[pid] = (size, fields[2] if len(fields) == 3 else '', metric)
            except ValueError:
                continue  # ps can print continuation lines for unusual executable names.
    return result


def measure(tree):
    current = tree.scan(markers=False)
    memory = memory_rows(current)
    rows = [(row, *memory[row.pid]) for row in current.values() if row.pid in memory]
    return sum(size for _, size, _, _ in rows), rows


def log_limit(lane, total, rows, pgid):
    escapees = [(row, size, cmd, metric) for row, size, cmd, metric in rows if row.pgid != pgid]
    top = max(escapees or rows, key=lambda item: item[1], default=None)
    prefix = 'ALARM unkillable escapee' if escapees else 'MEMORY_LIMIT'
    detail = f'pid={top[0].pid} cmd={top[2]}' if top else 'pid=unknown'
    line = f'{time.strftime("%Y-%m-%dT%H:%M:%S%z")} {prefix} lane={lane} peak={total / 1024**3:.3f}GiB {detail} metric={",".join(sorted({item[3] for item in rows}))}'
    # One record even if command/lane contains newlines.
    line = line.replace('\n', '\\n').replace('\r', '\\r')
    host = 'm1' if os.uname().machine == 'arm64' and 'T6000' in os.uname().version else 'm4'
    filename = f'.{host}-heavy.log' if sys.platform == 'darwin' else '.heavy-run.log'
    try:
        with (Path.home() / filename).open('a') as stream:
            stream.write(line + '\n')
    except OSError as error:
        print(f'{line} log_error={error}', file=sys.stderr, flush=True)
    return 126 if escapees else 125


def cleanup_group(tree, child, grace, signum=None):
    """The Popen direct child stays unreaped until BOTH group signals finish.

    start_new_session prevents unrelated existing-session processes joining.
    No poll/wait, individual PID signals, or escapee signals are allowed here.
    """
    if child.returncode is not None:
        return False, []
    signal_ok = True
    scan_ok = True
    for sig in (signum or signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(child.pid, sig)
            tree.signalled.append({'pid': child.pid, 'signal': int(sig), 'group': True})
        except ProcessLookupError:
            pass
        except OSError:
            signal_ok = False
        if sig != signal.SIGKILL:
            deadline = time.monotonic() + grace
            while time.monotonic() < deadline:
                try:
                    members = tree.scan(markers=False)
                    if not tree.incomplete and all(pid == child.pid for pid in members):
                        break
                except Exception:
                    scan_ok = False  # Still deliver KILL; observation never grants signal authority.
                time.sleep(min(.05, max(0, deadline - time.monotonic())))
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        return False, [child.pid]
    try:
        escapees = [row.pid for row in tree.scan(markers=False).values() if row.pgid != child.pid]
    except Exception:
        return False, []
    return signal_ok and scan_ok and not escapees and not tree.incomplete, escapees

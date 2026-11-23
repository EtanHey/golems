"""Session-isolated watchdog helpers. Never signal tracked escapees."""
import os
import signal
import subprocess
import time
from pathlib import Path


def memory_rows():
    # RSS is portable across Darwin/Linux and requires no task-port entitlement.
    output = subprocess.check_output(['ps', '-axo', 'pid=,rss=,command='], text=True, timeout=5)
    result = {}
    for line in output.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) >= 2:
            result[int(fields[0])] = (int(fields[1]) * 1024, fields[2] if len(fields) == 3 else '')
    return result


def measure(tree):
    current = tree.scan(markers=False)
    memory = memory_rows()
    rows = [(row, *memory[row.pid]) for row in current.values() if row.pid in memory]
    return sum(size for _, size, _ in rows), rows


def log_limit(lane, total, rows, pgid):
    escapees = [(row, size, cmd) for row, size, cmd in rows if row.pgid != pgid]
    top = max(escapees or rows, key=lambda item: item[1], default=None)
    prefix = 'ALARM unkillable escapee' if escapees else 'MEMORY_LIMIT'
    detail = f'pid={top[0].pid} cmd={top[2]}' if top else 'pid=unknown'
    line = f'{time.strftime("%Y-%m-%dT%H:%M:%S%z")} {prefix} lane={lane} peak={total / 1024**3:.3f}GB {detail} metric=rss'
    # One record even if command/lane contains newlines.
    line = line.replace('\n', '\\n').replace('\r', '\\r')
    host = 'm1' if os.uname().machine == 'arm64' and 'T6000' in os.uname().version else 'm4'
    with (Path.home() / f'.{host}-heavy.log').open('a') as stream:
        stream.write(line + '\n')
    return 126 if escapees else 125


def cleanup_group(tree, child, grace, signum=None):
    """The Popen direct child stays unreaped until BOTH group signals finish.

    start_new_session prevents unrelated existing-session processes joining.
    No poll/wait, individual PID signals, or escapee signals are allowed here.
    """
    if child.returncode is not None:
        return False, []
    signal_ok = True
    for sig in (signum or signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(child.pid, sig)
            tree.signalled.append({'pid': child.pid, 'signal': int(sig), 'group': True})
        except ProcessLookupError:
            pass
        except OSError:
            signal_ok = False
        if sig != signal.SIGKILL:
            time.sleep(grace)
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        return False, [child.pid]
    escapees = [row.pid for row in tree.scan(markers=False).values() if row.pgid != child.pid]
    return signal_ok and not escapees and not tree.incomplete, escapees

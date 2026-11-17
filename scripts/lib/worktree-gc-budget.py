#!/usr/bin/env python3
"""Wall/monotonic deadlines, file-backed network calls and raw-entry supervision.

All logs and capture files are retained. Never waits for pipe EOF or waits
unboundedly for a killed process; network children own killable process groups.
"""
import importlib.util
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


def remaining():
    # Explicit shared epoch: older macOS Python time.monotonic is process-relative.
    return min(float(os.environ.get('GC_RUN_DEADLINE', 'inf')) - time.clock_gettime(time.CLOCK_MONOTONIC),
               float(os.environ.get('GC_RUN_WALL_DEADLINE', 'inf')) - time.time())


def elapsed():
    return max(0, time.clock_gettime(time.CLOCK_MONOTONIC) - float(os.environ.get('GC_RUN_STARTED', time.clock_gettime(time.CLOCK_MONOTONIC))),
               time.time() - float(os.environ.get('GC_RUN_WALL_STARTED', time.time())))


def expired():
    late = remaining() <= 0
    if late and os.environ.get('GC_BUDGET_MARKER'):
        Path(os.environ['GC_BUDGET_MARKER']).touch()
    return late


def cap_for(args):
    name = Path(args[0]).name
    if name == 'gh':
        value, maximum = os.environ.get('WORKTREE_GC_GH_TIMEOUT_SECONDS', '30'), 30
    elif name == 'git' and any(a in ('fetch', 'ls-remote') for a in args[1:]):
        value, maximum = os.environ.get('WORKTREE_GC_GIT_TIMEOUT_SECONDS', '60'), 60
    else:
        return None
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError('invalid network timeout')
    return min(value, maximum)


def stop_child(child, group, grace=0):
    """SIGKILL is final; reaping has a small wall-clock bound, even in kernel I/O."""
    if group:
        try:
            if grace:
                os.killpg(child.pid, signal.SIGTERM)
                end = time.time() + grace
                while child.poll() is None and time.time() < end:
                    time.sleep(.01)
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    elif child.poll() is None:
        if grace:
            child.terminate()
            end = time.time() + grace
            while child.poll() is None and time.time() < end:
                time.sleep(.01)
        if child.poll() is None:
            child.kill()
    end = time.time() + .15
    while child.poll() is None and time.time() < end:
        time.sleep(.01)
    # An unreaped child is not evidence that termination completed; never block here.
    if child.poll() is None:
        print('worktree-gc: killed child not yet reaped: ' + str(child.pid), file=sys.stderr)


def captured(args, directory=None):
    directory = Path(directory or os.environ.get('GC_CAPTURE_DIR', Path(__file__).resolve().parents[2] / 'docs.local/gc-captures'))
    directory.mkdir(parents=True, exist_ok=True)
    out_fd, out_name = tempfile.mkstemp(prefix='call-', suffix='.stdout', dir=directory)
    err_fd, err_name = tempfile.mkstemp(prefix='call-', suffix='.stderr', dir=directory)
    cap = cap_for(args)
    limit = min(remaining(), cap if cap is not None else 3000)
    if limit <= 0:
        expired()
        os.close(out_fd); os.close(err_fd)
        return subprocess.CompletedProcess(args, 124, '', 'run deadline reached')
    wall_end, mono_end = time.time() + limit, time.clock_gettime(time.CLOCK_MONOTONIC) + limit
    child, pending = None, None
    group = cap is not None  # Other children remain in the supervised GC group.
    previous = {}

    def stop(signum, _frame):
        nonlocal pending
        pending = signum
        if child is not None:
            stop_child(child, group, grace=.2 if not group else 0)
            raise SystemExit(128 + signum)

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        previous[sig] = signal.signal(sig, stop)
    try:
        with os.fdopen(out_fd, 'wb') as out, os.fdopen(err_fd, 'wb') as err:
            child = subprocess.Popen(args, stdout=out, stderr=err, start_new_session=group)
            if pending:
                stop_child(child, group, grace=.2 if not group else 0)
                raise SystemExit(128 + pending)
            while child.poll() is None:
                if time.time() >= wall_end or time.clock_gettime(time.CLOCK_MONOTONIC) >= mono_end or expired():
                    stop_child(child, group, grace=.2 if not group else 0)
                    expired()
                    code = 124
                    break
                time.sleep(.01)
            else:
                code = child.returncode
            if expired():
                code = 124
            if group:
                # A network tool may exit while descendants retain its output.
                # Stop the owned group even on normal parent exit; never drain EOF.
                stop_child(child, True)
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    # Regular files cannot be held open as a PIPE that communicate() must drain.
    stdout = Path(out_name).read_text(encoding='utf-8', errors='replace')
    stderr = Path(err_name).read_text(encoding='utf-8', errors='replace')
    if code == 124:
        stderr += '\nworktree-gc: hard timeout: ' + Path(args[0]).name + '\n'
    return subprocess.CompletedProcess(args, code if code >= 0 else 128-code, stdout, stderr)


def run(args):
    result = captured(args)
    sys.stdout.write(result.stdout); sys.stdout.flush()
    sys.stderr.write(result.stderr); sys.stderr.flush()
    return result.returncode


def stop_descendant_groups(root):
    # Snapshot live ancestry before stopping the GC shell, including network
    # command groups created by nested supervisors. ps output is file-backed.
    directory = Path(os.environ['GC_CAPTURE_DIR'])
    fd, name = tempfile.mkstemp(prefix='stop-tree-', dir=directory)
    with os.fdopen(fd, 'wb') as out:
        probe = subprocess.Popen(['/bin/ps', '-axo', 'pid=,ppid=,pgid='], stdout=out, stderr=out)
        end = time.time() + .3
        while probe.poll() is None and time.time() < end:
            time.sleep(.01)
        if probe.poll() is None:
            stop_child(probe, False)
            return
    table = []
    for row in Path(name).read_text(encoding='utf-8', errors='replace').splitlines():
        fields = row.split()
        if len(fields) == 3 and all(x.isdigit() for x in fields):
            table.append(tuple(map(int, fields)))
    owned = {root.pid}
    while True:
        descendants = owned | {pid for pid, parent, _group in table if parent in owned}
        if descendants == owned:
            break
        owned = descendants
    groups = {group for pid, _parent, group in table if pid in owned}
    for group in groups - {root.pid, os.getpgrp()}:
        try:
            os.killpg(group, signal.SIGKILL)
        except ProcessLookupError:
            pass


def supervise(main, args):
    requested = float(os.environ.get('WORKTREE_GC_BUDGET_SECONDS', '3000'))
    outer = float(os.environ.get('WORKTREE_GC_NIGHTLY_TIMEOUT', '3600'))
    if not all(math.isfinite(x) and x > 0 for x in (requested, outer)):
        raise ValueError('invalid run budget')
    budget = min(requested, 3000, outer-min(60, outer/2))
    started, wall = time.clock_gettime(time.CLOCK_MONOTONIC), time.time()
    script_dir = Path(main).resolve().parent.parent
    log_dir = script_dir.parent / 'docs.local'; log_dir.mkdir(parents=True, exist_ok=True)
    log = log_dir / ('worktree-gc-' + time.strftime('%Y%m%d-%H%M%S') + '-' + str(os.getpid()) + '.log')
    journal = Path(str(log) + '.rows.jsonl'); journal.write_text('')
    captures = Path(str(log) + '.captures'); captures.mkdir()
    report_dir = os.environ.get('WORKTREE_GC_REPORT_DIR', str(log_dir / 'worktree-gc'))
    os.environ.update(GC_RUN_STARTED=str(started), GC_RUN_WALL_STARTED=str(wall),
                      GC_RUN_DEADLINE=str(started+budget), GC_RUN_WALL_DEADLINE=str(wall+budget),
                      GC_RUN_BUDGET=str(budget), GC_BUDGET_MARKER=str(journal)+'.budget',
                      GC_CAPTURE_DIR=str(captures), GC_SUPERVISED_LOG=str(log),
                      GC_SUPERVISOR_PID=str(os.getpid()), GC_PYTHON=sys.executable)
    publish = not any(x in args for x in ('--repo', '--path', '--prune-plan'))
    console = Path(str(log) + '.console')
    child, pending = None, None
    def stop(signum, _frame):
        nonlocal pending
        pending = signum
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, stop)
    with console.open('wb') as writer, console.open('rb') as reader:
        child = subprocess.Popen(['/bin/bash', main, *args], stdout=writer, stderr=writer, start_new_session=True)
        while child.poll() is None and not expired() and pending is None:
            data = reader.read()
            if data:
                sys.stdout.buffer.write(data); sys.stdout.buffer.flush()
            time.sleep(.01)
        late = expired()
        if late or pending is not None:
            stop_descendant_groups(child)
            stop_child(child, True, grace=.25)
        data = reader.read()
        if data:
            sys.stdout.buffer.write(data); sys.stdout.buffer.flush()
    if late or pending is not None:
        code = 124 if late else 128 + pending
        spec = importlib.util.spec_from_file_location('gc_state_publisher', script_dir / 'lib/worktree-gc-state.py')
        state = importlib.util.module_from_spec(spec); spec.loader.exec_module(state)
        state.finish_report(str(journal), report_dir, code, int(publish))
        print('worktree-gc: PARTIAL; independent wall supervisor stopped run; elapsed_seconds=' + str(round(elapsed(), 3)))
        return code
    return child.returncode if child.returncode >= 0 else 128-child.returncode


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'check':
            sys.exit(124 if expired() else 0)
        if sys.argv[1] == 'supervise':
            sys.exit(supervise(sys.argv[2], sys.argv[3:]))
        sys.exit(run(sys.argv[2:]))
    except (OSError, ValueError) as error:
        print('worktree-gc: supervision failed: ' + str(error), file=sys.stderr)
        sys.exit(2)

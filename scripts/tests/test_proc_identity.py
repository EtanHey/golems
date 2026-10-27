"""Native process inspection; fixtures exit on stdin EOF and never share a group kill."""
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import time

import pytest


SPEC = importlib.util.spec_from_file_location(
    "proc_identity", Path(__file__).resolve().parents[1] / "hooks/proc_identity.py"
)
proc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proc)

MARKER = b"GOLEMS_HEAVY_SUITE_ID"
TOKEN = b"fixture-token"
ODD = b"equals=a=b spaces\nline\xe2\x80\xa8separator\xe2\x80\xa9paragraph\xff"
CHILD = r"""
import json, os, select, sys
if sys.platform == "linux":
    import ctypes
    ctypes.CDLL(None).prctl(15, b"odd) (\n\xff name", 0, 0, 0)
print(json.dumps(dict(pid=os.getpid(), ppid=os.getppid(), pgid=os.getpgrp(),
                     uid=os.geteuid(), ruid=os.getuid(),
                     argv=[os.fsencode(arg).hex() for arg in sys.orig_argv])), flush=True)
if select.select([sys.stdin], [], [], 60)[0]:
    os.read(sys.stdin.fileno(), 1)
"""


def finish(child, terminate=False):
    if not child.stdin.closed:
        child.stdin.close()
    if terminate and child.poll() is None:
        child.terminate()
    try:
        result = child.wait(timeout=5)
        assert result in ((0, -15) if terminate else (0,))
    finally:
        # Popen refers only to our unreaped child, never a discovered PID.
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        child.stdout.close()


@pytest.fixture
def spawn():
    children = []

    def launch(env=None, args=(), new_session=False, command=None):
        child = subprocess.Popen(
            command or [os.fsencode(sys.executable), b"-c", CHILD.encode(), *args],
            env={b"PATH": os.fsencode(os.defpath), **(env or {})},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            start_new_session=new_session,
        )
        children.append((child, command is not None))
        if command is not None:
            return child, None
        assert select.select([child.stdout], [], [], 5)[0], "fixture never ready"
        return child, json.loads(child.stdout.readline())

    yield launch
    for child, terminate in reversed(children):
        finish(child, terminate)


def test_fixture_identity_and_stable_distinct_birth_keys(spawn):
    first, expected = spawn()
    second, _ = spawn()
    observed = proc.identity(first.pid)
    assert observed is not None
    for name in ("pid", "ppid", "pgid", "uid", "ruid"):
        assert getattr(observed, name) == expected[name]
    assert observed.start == proc.identity(first.pid).start
    assert observed.start != proc.identity(second.pid).start


def test_exact_environment_and_raw_argv_round_trip(spawn):
    child, expected = spawn({MARKER: TOKEN, b"ODD": ODD}, args=(ODD, b"", b"x=y"))
    assert proc.has_env(child.pid, MARKER, TOKEN)
    assert not proc.has_env(child.pid, MARKER, TOKEN + b"x")
    assert proc.environ(child.pid)[b"ODD"] == ODD
    assert proc.has_env(child.pid, b"ODD", ODD)
    assert proc.argv(child.pid) == [bytes.fromhex(arg) for arg in expected["argv"]]


@pytest.mark.parametrize("env,args", [
    ({}, (MARKER + b"=" + TOKEN,)),
    ({b"NOTE": b"x " + MARKER + b"=" + TOKEN + b" y"}, ()),
    ({MARKER: TOKEN + b"x"}, ()),
])
def test_marker_lookalikes_are_not_owned(spawn, env, args):
    child, _ = spawn(env, args)
    assert not proc.has_env(child.pid, MARKER, TOKEN)


def test_new_session_keeps_its_own_pgid_and_inherited_env(spawn):
    child, expected = spawn({MARKER: TOKEN}, new_session=True)
    observed = proc.identity(child.pid)
    assert observed.pgid == expected["pgid"] == child.pid
    assert proc.has_env(child.pid, MARKER, TOKEN)


def test_reaped_fixture_is_absent(spawn):
    child, _ = spawn()
    finish(child)
    assert proc.identity(child.pid) is None
    assert proc.environ(child.pid) is None
    assert proc.argv(child.pid) is None
    assert not proc.has_env(child.pid, MARKER, TOKEN)


def test_other_uid_environment_is_explicitly_unavailable():
    try:
        init = proc.identity(1)
    except proc.ProcIdentityUnavailable:
        pass  # Some kernels deny even metadata; entry reads must still fail explicitly.
    else:
        if init is None or (init.uid == os.geteuid() and init.ruid == os.getuid()):
            pytest.skip("PID 1 is absent or has our UID; no foreign fixture privileges")
    for read in (proc.environ, proc.argv):
        with pytest.raises(proc.ProcIdentityUnavailable):
            read(1)


def test_list_pids_includes_fixtures_with_bounded_scan(spawn, capsys):
    first, _ = spawn()
    second, _ = spawn()
    started = time.monotonic()
    pids = proc.list_pids()
    elapsed = time.monotonic() - started
    with capsys.disabled():
        print(f"native PID scan: {len(pids)} PIDs, {elapsed:.6f}s")
    assert first.pid in pids and second.pid in pids
    assert all(isinstance(pid, int) and pid > 0 for pid in pids)
    assert len(pids) == len(set(pids))
    if elapsed >= 1 and os.environ.get("CI"):
        pytest.skip(f"soft scan budget exceeded on CI: {len(pids)} PIDs, {elapsed:.3f}s")
    assert elapsed < 1, f"{len(pids)} PIDs scanned in {elapsed:.3f}s"


def test_children_snapshot_captures_parent_edges_and_birth_keys(spawn, monkeypatch):
    child, expected = spawn(new_session=True)
    listed, reads = [], []
    original_list, original_identity = proc.list_pids, proc.identity
    def tracked_list():
        listed.append(original_list())
        return listed[-1]
    def tracked_identity(pid):
        reads.append(pid)
        return original_identity(pid)
    monkeypatch.setattr(proc, "list_pids", tracked_list)
    monkeypatch.setattr(proc, "identity", tracked_identity)
    snapshot = proc.children_snapshot()
    assert len(listed) == 1 and reads == listed[0]
    assert set(snapshot).isdisjoint(snapshot.unavailable)
    assert set(snapshot) | set(snapshot.unavailable) == set(listed[0])
    assert snapshot[child.pid] == (
        expected["ppid"], expected["pgid"], original_identity(child.pid).start
    )


def test_snapshot_distinguishes_gone_permission_and_other_with_uid(spawn, monkeypatch):
    children = [spawn()[0] for _ in range(3)]
    pids = [child.pid for child in children]
    monkeypatch.setattr(proc, "list_pids", lambda: pids)
    def observation(pid):
        if pid == pids[0]:
            return None
        reason = "permission" if pid == pids[1] else "other"
        raise proc.ProcIdentityUnavailable("fixture denial", reason=reason, uid=os.geteuid())
    monkeypatch.setattr(proc, "identity", observation)
    snapshot = proc.children_snapshot()
    assert not snapshot
    assert [snapshot.unavailable[pid].reason for pid in pids] == ["gone", "permission", "other"]
    assert snapshot.unavailable[pids[1]].uid == os.geteuid()


@pytest.mark.skipif(sys.platform != "darwin", reason="Darwin denies system PID metadata")
def test_snapshot_retains_real_system_pid_denial():
    snapshot = proc.children_snapshot()
    assert 1 not in snapshot
    assert snapshot.unavailable[1].reason == "permission"
    assert snapshot.unavailable[1].uid == 0


def test_entry_read_rejects_pid_reuse_and_uid_changes(spawn, monkeypatch):
    child, _ = spawn({MARKER: TOKEN})
    original = proc.identity(child.pid)
    for start, uid in ((original.start, original.uid + 1), ((0, 0), original.uid)):
        changed = proc.ProcIdentity(child.pid, original.ppid, original.pgid, uid, original.ruid, start)
        observations = iter((original, changed))
        monkeypatch.setattr(proc, "identity", lambda _: next(observations))
        with pytest.raises(proc.ProcIdentityUnavailable):
            proc.has_env(child.pid, MARKER, TOKEN)


@pytest.mark.skipif(sys.platform != "darwin", reason="Darwin native error handling")
def test_native_permission_and_short_reads_are_not_absence(spawn, monkeypatch):
    child, _ = spawn()
    def denied(pid, flavor, _, buffer, size):
        if flavor == 13:
            short = proc.ctypes.cast(buffer, proc.ctypes.POINTER(proc._ProcBsdShortInfo)).contents
            short.pbsi_pid, short.pbsi_uid, short.pbsi_ruid = pid, os.geteuid(), os.getuid()
            return size
        proc.ctypes.set_errno(1)
        return 0
    monkeypatch.setattr(proc._libproc, "proc_pidinfo", denied)
    with pytest.raises(proc.ProcIdentityUnavailable) as caught:
        proc.identity(child.pid)
    assert caught.value.reason == "permission" and caught.value.uid == os.geteuid()
    monkeypatch.setattr(proc._libproc, "proc_pidinfo", lambda *_: 12)
    with pytest.raises(proc.ProcIdentityUnavailable):
        proc.identity(child.pid)


@pytest.mark.skipif(sys.platform != "darwin", reason="Darwin list buffer growth")
def test_pid_list_retries_growth_and_preserves_1500_entries(monkeypatch):
    def growing_list(buffer, size):
        if buffer is None:
            return 1  # Enumeration grows between sizing and filling.
        count = min(1500, size // proc.ctypes.sizeof(proc.ctypes.c_int))
        for index in range(count):
            buffer[index] = index + 1
        return count
    monkeypatch.setattr(proc._libproc, "proc_listallpids", growing_list)
    assert proc.list_pids() == list(range(1, 1501))


@pytest.mark.skipif(sys.platform != "darwin", reason="Darwin platform environment hiding")
@pytest.mark.parametrize("command", [[b"/bin/sleep", b"30"], [b"/bin/sh", b"-c", b"read ignored; exit 0"]])
def test_hidden_platform_environment_is_not_an_empty_environment(spawn, command):
    child, _ = spawn({MARKER: TOKEN}, command=command)
    assert proc.argv(child.pid) == command
    # Newer Darwin hides platform-binary env; older systems may expose it.
    try:
        visible = proc.environ(child.pid)
    except proc.EnvHidden:
        with pytest.raises(proc.EnvHidden):
            proc.has_env(child.pid, MARKER, TOKEN)
    else:
        assert visible is not None and visible.get(MARKER) == TOKEN
        if int(os.uname().release.split(".")[0]) >= 26:
            pytest.fail("macOS 27 platform environment should report EnvHidden")


@pytest.mark.skipif(sys.platform != "darwin", reason="Darwin birth timestamps")
def test_darwin_birth_key_has_microsecond_resolution(spawn):
    child, _ = spawn()
    sec, usec = proc.identity(child.pid).start
    assert isinstance(sec, int) and sec > 0
    assert isinstance(usec, int) and 0 <= usec < 1_000_000
    assert proc._ProcBsdInfo.pbi_start_tvsec.offset == 120
    assert proc._ProcBsdInfo.pbi_start_tvusec.offset == 128


@pytest.mark.skipif(sys.platform != "linux", reason="Linux procfs birth key")
def test_linux_birth_key_preserves_boot_id_and_clock_ticks(spawn):
    child, _ = spawn()
    stat = Path(f"/proc/{child.pid}/stat").read_bytes()
    ticks = int(stat[stat.rfind(b")") + 2:].split()[19])
    boot_id = Path("/proc/sys/kernel/random/boot_id").read_bytes().strip()
    assert proc.identity(child.pid).start == (boot_id, ticks)


@pytest.mark.skipif(sys.platform != "linux", reason="Linux procfs errors")
def test_linux_permission_keeps_uid_and_missing_boot_id_is_not_gone(spawn, monkeypatch):
    child, _ = spawn()
    original = proc._read
    def denied_stat(path):
        if path == f"/proc/{child.pid}/stat":
            raise PermissionError(13, "fixture denied")
        return original(path)
    monkeypatch.setattr(proc, "_read", denied_stat)
    with pytest.raises(proc.ProcIdentityUnavailable) as caught:
        proc.identity(child.pid)
    assert caught.value.reason == "permission" and caught.value.uid == os.geteuid()
    def missing_boot(path):
        if path == "/proc/sys/kernel/random/boot_id":
            raise FileNotFoundError(2, "fixture missing boot identity")
        return original(path)
    monkeypatch.setattr(proc, "_read", missing_boot)
    with pytest.raises(proc.ProcIdentityUnavailable):
        proc.identity(child.pid)

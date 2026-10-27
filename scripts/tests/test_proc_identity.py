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
sys.modules[SPEC.name] = proc
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
    second_observed = proc.identity(second.pid)
    assert second_observed.start == proc.identity(second.pid).start
    assert (observed.pid, observed.start) != (second_observed.pid, second_observed.start)


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
        expected["ppid"], expected["pgid"], original_identity(child.pid).start,
        expected["uid"], expected["ruid"]
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
    with pytest.raises(TypeError, match="unavailable"):
        bool(snapshot)
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


@pytest.fixture
def raw_exec(spawn):
    """Use execve directly: dictionaries cannot represent duplicate/empty env entries."""
    def launch(arguments, environment):
        executable = Path(sys.executable).resolve()
        framework_binary = Path(sys.prefix) / 'Resources/Python.app/Contents/MacOS/Python'
        if sys.platform == 'darwin' and framework_binary.exists():
            executable = framework_binary
        launcher = r'''
import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
args, env = %r, %r
vector = lambda entries: (ctypes.c_char_p * (len(entries) + 1))(*entries, None)
libc.execve(os.fsencode(%r), vector(args), vector(env))
raise OSError(ctypes.get_errno(), 'fixture execve')
''' % (arguments, environment, str(executable))
        child, _ = spawn(command=[sys.executable, '-c', launcher])
        assert select.select([child.stdout], [], [], 5)[0], 'exec fixture never ready'
        assert child.stdout.readline() == b'ready\n'
        return child
    return launch


READY = b'import os; os.write(1,b"ready\\n"); os.read(0,1)'


@pytest.mark.skipif(sys.platform != 'darwin', reason='Darwin aligned exec-path layout')
def test_empty_argv0_preserves_arguments_and_first_env(raw_exec):
    args = [b'', b'-c', READY]
    child = raw_exec(args, [b'A=1', b'M=tok'])
    assert proc.argv(child.pid) == args
    assert proc.environ(child.pid) == {b'A': b'1', b'M': b'tok'}


def test_duplicate_env_names_keep_first(raw_exec):
    child = raw_exec([b'p', b'-c', READY], [b'M=other', b'M=tok'])
    assert not proc.has_env(child.pid, b'M', b'tok')
    assert proc.has_env(child.pid, b'M', b'other')
    assert proc.environ(child.pid)[b'M'] == b'other'


@pytest.mark.skipif(sys.platform != 'darwin', reason='Darwin empty env/padding ambiguity')
def test_empty_env_ends_scan_without_apple_strings(raw_exec):
    child = raw_exec([b'p', b'-c', READY], [b'A=1', b'', b'M=tok'])
    with pytest.raises(proc.ProcIdentityUnavailable, match='ambiguous'):
        proc.environ(child.pid)
    assert 'empty env string ends the scan' in proc.environ.__doc__


def test_macos_writable_region_contract():
    for text in (proc.__doc__, proc.environ.__doc__, proc.has_env.__doc__):
        assert 'process-writable' in text
        assert 'NOT sole kill authority' in text
        assert 'pgid' in text and 'ppid' in text and 'birth keys' in text


@pytest.mark.skipif(sys.platform != 'darwin', reason='Darwin writable argv witness')
def test_in_place_argv_nul_is_documented_evidence_only(raw_exec):
    code = rb'''
import ctypes, os
libc = ctypes.CDLL(None)
libc._NSGetArgv.restype = ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))
address = libc._NSGetArgv().contents[3]
ctypes.memset(address + 1, 0, 1)
os.write(1, b'ready\n'); os.read(0, 1)
'''
    child = raw_exec([b'p', b'-c', code, b'x:' + MARKER + b'=' + TOKEN], [b'A=1'])
    assert proc.has_env(child.pid, MARKER, TOKEN)  # Writable argv tail, not kernel authority.
    test_macos_writable_region_contract()


@pytest.mark.skipif(sys.platform != 'darwin', reason='Darwin response overhead')
@pytest.mark.parametrize('reserve', [256, 8192])
def test_near_argmax_native_response_is_complete(spawn, reserve):
    # A long executed path adds response bytes outside the argv/env ARG_MAX budget.
    import tempfile
    root = Path(__file__).resolve().parents[2] / 'docs.local'
    root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root, prefix='proc-identity-') as directory:
        target = Path(directory)
        for _ in range(8):
            target /= 'path-padding-' + 'x' * 100
            target.mkdir()
        executable = Path(sys.prefix) / 'Resources/Python.app/Contents/MacOS/Python'
        if not executable.exists():
            executable = Path(sys.executable).resolve()
        link = target / 'python'
        link.symlink_to(executable)
        args = [b'p', b'-c', READY, b'x' * (os.sysconf('SC_ARG_MAX') - len(READY) - reserve)]
        launcher = r'''
import ctypes, os
libc = ctypes.CDLL(None, use_errno=True)
args, env = %r, [b'M=tok', b'A=1']
vector = lambda entries: (ctypes.c_char_p * (len(entries) + 1))(*entries, None)
libc.execve(%r, vector(args), vector(env))
raise OSError(ctypes.get_errno(), 'near ARG_MAX fixture')
''' % (args, os.fsencode(link))
        # Keep the launcher itself small enough for exec's argument limit.
        script = Path(directory) / 'launch.py'
        script.write_text(launcher)
        child, _ = spawn(command=[sys.executable, str(script)])
        assert select.select([child.stdout], [], [], 5)[0]
        assert child.stdout.readline() == b'ready\n'
        if reserve == 256:
            with pytest.raises(proc.ProcIdentityUnavailable, match='complete'):
                proc.argv(child.pid)
            with pytest.raises(proc.ProcIdentityUnavailable, match='complete'):
                proc.environ(child.pid)
        else:
            assert proc.argv(child.pid) == args
            assert proc.environ(child.pid) == {b'M': b'tok', b'A': b'1'}


def test_entry_errors_recheck_incarnation(spawn, monkeypatch):
    child, _ = spawn()
    original = proc.identity(child.pid)
    replacement = proc.ProcIdentity(child.pid, original.ppid, original.pgid,
                                    original.uid, original.ruid, (0, 0))
    for failure in (OSError(22, 'exited during read'), ValueError('short read')):
        for after in (None, replacement, original):
            observations = iter((original, after))
            monkeypatch.setattr(proc, 'identity', lambda _: next(observations))
            def fail(*_):
                raise failure
            monkeypatch.setattr(proc, '_darwin_args' if sys.platform == 'darwin' else '_read', fail)
            if after is original:
                with pytest.raises(proc.ProcIdentityUnavailable) as caught:
                    proc.environ(child.pid)
                assert caught.value.reason and caught.value.uid == original.uid
            else:
                assert proc.environ(child.pid) is None


def test_other_uid_and_hidden_errors_retain_owner(spawn, monkeypatch):
    child, _ = spawn()
    original = proc.identity(child.pid)
    foreign = proc.ProcIdentity(child.pid, original.ppid, original.pgid,
                               original.uid + 1, original.ruid, original.start)
    monkeypatch.setattr(proc, 'identity', lambda _: foreign)
    with pytest.raises(proc.ProcIdentityUnavailable) as caught:
        proc.environ(child.pid)
    assert caught.value.reason == 'other-uid'
    assert caught.value.uid == foreign.uid and caught.value.ruid == foreign.ruid
    monkeypatch.setattr(proc, 'identity', lambda _: original)
    if sys.platform == 'darwin':
        monkeypatch.setattr(proc, '_darwin_args', lambda _: ([b'p'], []))
    else:
        monkeypatch.setattr(proc, '_linux_env_bounds', lambda _: (4096, 4110))
        monkeypatch.setattr(proc, '_read', lambda _: b'')
    with pytest.raises(proc.EnvHidden) as caught:
        proc.environ(child.pid)
    assert caught.value.reason == 'hidden'
    assert caught.value.uid == original.uid


def test_unreaped_zombie_is_gone(spawn):
    child, _ = spawn()
    child.stdin.close()
    # waitid WNOWAIT establishes zombie state without reaping our fixture.
    os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOWAIT)
    assert proc.identity(child.pid) is None
    assert proc.environ(child.pid) is None
    assert proc.argv(child.pid) is None
    assert not proc.has_env(child.pid, MARKER, TOKEN)


def test_linux_empty_or_partial_environ_is_unavailable(spawn, monkeypatch):
    child, _ = spawn()
    observed = proc.identity(child.pid)
    monkeypatch.setattr(proc.sys, 'platform', 'linux')
    monkeypatch.setattr(proc, 'identity', lambda _: observed)
    fields = [b'0'] * 49
    fields[0], fields[47], fields[48] = b'S', b'4096', b'4110'
    stat = str(child.pid).encode() + b' (fixture) ' + b' '.join(fields)
    for data in (b'', b'A=1\0', b'A=1'):
        monkeypatch.setattr(proc, '_read', lambda path: stat if path.endswith('/stat') else data)
        with pytest.raises(proc.ProcIdentityUnavailable) as caught:
            proc.has_env(child.pid, MARKER, TOKEN)
        assert caught.value.reason and caught.value.uid == observed.uid


@pytest.mark.skipif(sys.platform != 'linux', reason='Linux inaccessible remote memory')
def test_linux_inaccessible_environment_page_is_unavailable(spawn):
    code = rb'''
import ctypes, os
libc = ctypes.CDLL(None, use_errno=True)
libc.getenv.restype = ctypes.c_void_p
address = libc.getenv(b'PAD')
page = os.sysconf('SC_PAGE_SIZE')
assert libc.mprotect(ctypes.c_void_p((address // page + 2) * page), page, 0) == 0
os.write(1,b'ready\n'); os.read(0,1)
'''
    child, _ = spawn({b'PAD': b'x' * 65536, MARKER: TOKEN},
                     command=[sys.executable, '-c', code])
    assert select.select([child.stdout], [], [], 5)[0]
    assert child.stdout.readline() == b'ready\n'
    with pytest.raises(proc.ProcIdentityUnavailable):
        proc.has_env(child.pid, MARKER, TOKEN)



def test_system_python_import_compatibility():
    interpreter = Path('/usr/bin/python3')
    if not interpreter.exists():
        pytest.skip('system Python absent')
    code = "import runpy,sys; runpy.run_path(sys.argv[1], run_name='proc_identity_smoke')"
    result = subprocess.run([str(interpreter), '-I', '-c', code, str(SPEC.origin)],
                            capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr


@pytest.mark.skipif(sys.platform != 'darwin', reason='Darwin system Python Apple vector')
def test_system_python_marker_is_owned(spawn):
    interpreter = Path('/usr/bin/python3')
    if not interpreter.exists():
        pytest.skip('system Python absent')
    child, _ = spawn({MARKER: TOKEN}, command=[str(interpreter), '-I', '-c', READY])
    assert select.select([child.stdout], [], [], 5)[0], 'system Python never ready'
    assert child.stdout.readline() == b'ready\n'
    assert proc.owned(child.pid, MARKER, TOKEN) is True


def procargs_buffer(args, env, trailing=b'\0ptr_munge=0\0executable_boothash=fixture\0'):
    path = b'/fixture/python\0'
    path += b'\0' * (-len(path) % 8)
    return len(args).to_bytes(4, sys.byteorder, signed=True) + path + b'\0'.join(args + env) + b'\0' + trailing


def test_apple_named_env_after_empty_entry_is_unknown(spawn, monkeypatch):
    child, _ = spawn()
    data = procargs_buffer([b'p'], [b'A=1', b'', b'ptr_munge=tok'])
    monkeypatch.setattr(proc.sys, 'platform', 'darwin')
    monkeypatch.setattr(proc, '_darwin_args', lambda _: proc._parse_procargs2(data))
    assert proc.has_env(child.pid, b'A', b'1') is True
    assert proc.has_env(child.pid, b'A', b'wrong') is False
    result = proc.has_env(child.pid, b'ptr_munge', b'tok')
    assert isinstance(result, proc.Unknown)
    assert result.reason == 'reserved-name'


@pytest.mark.parametrize('name', [
    b'ptr_munge', b'main_stack', b'executable_file', b'dyld_file',
    b'executable_cdhash', b'executable_boothash', b'th_port',
    b'security_config', b'stack_guard', b'malloc_entropy',
    b'dyld_hw_tpro', b'dyld_hw_tpro_pagers', b'dyld_future_key', b'dyld_',
])
def test_reserved_name_queries_are_unknown_before_inspection(monkeypatch, name):
    def unexpected_inspection(*_):
        pytest.fail('reserved names must be rejected before process inspection')
    monkeypatch.setattr(proc, 'identity', unexpected_inspection)
    for query in (proc.has_env, proc.owned):
        for value in (b'tok', b''):
            result = query(os.getpid(), name, value)
            assert isinstance(result, proc.Unknown)
            assert result.reason == 'reserved-name'
            with pytest.raises(TypeError):
                bool(result)


def test_dyld_tail_family_is_reserved_and_other_tails_stay_ambiguous():
    for name in (b'dyld_hw_tpro', b'dyld_hw_tpro_pagers', b'dyld_future_key'):
        data = procargs_buffer([b'p'], [b'A=1'], trailing=b'\0' + name + b'=1\0')
        assert proc._parse_procargs2(data) == ([b'p'], [b'A=1'])
        with pytest.raises(proc.ProcIdentityUnavailable) as caught:
            proc._parse_procargs2(procargs_buffer([b'p'], [b'A=1', name + b'=1']))
        assert caught.value.reason == 'ambiguous'
    for tail in (b'dyldish=1\0', b'ptr_munge_suffix=1\0', b'dyld_hw_tpro\0'):
        with pytest.raises(proc.ProcIdentityUnavailable) as caught:
            proc._parse_procargs2(procargs_buffer([b'p'], [b'A=1'], trailing=b'\0' + tail))
        assert caught.value.reason == 'ambiguous'


def test_pure_parser_empty_argv_and_ambiguities():
    args = [b'', b'-c', b'code', b'']
    assert proc._parse_procargs2(procargs_buffer(args, [b'A=1', b'M=tok'])) == (args, [b'A=1', b'M=tok'])
    for data in (b'', procargs_buffer([b'p'], [b'A=1', b'', b'M=tok']),
                 procargs_buffer([b'p'], [b'A=1'])[:-16],
                 (100).to_bytes(4, sys.byteorder, signed=True) + b'/p\0' + b'\0' * 5 + b'p\0',
                 procargs_buffer([b'p'], [b'A=1']).replace(b'/fixture/python\0', b'/fixture/pythonX')):
        with pytest.raises(proc.ProcIdentityUnavailable):
            proc._parse_procargs2(data)
    # Use a path that actually has alignment padding.
    data = (1).to_bytes(4, sys.byteorder, signed=True) + b'/p\0X\0\0\0\0p\0A=1\0\0'
    with pytest.raises(proc.ProcIdentityUnavailable):
        proc._parse_procargs2(data)


@pytest.mark.skipif(sys.platform != 'darwin', reason='Darwin sysctl response retry')
@pytest.mark.parametrize('never_complete', [False, True])
def test_procargs_full_response_retries_or_fails(monkeypatch, never_complete):
    capacities = []
    data = procargs_buffer([b'p'], [b'A=1'])
    def sysctl(mib, count, buffer, size, *_):
        size = proc.ctypes.cast(size, proc.ctypes.POINTER(proc.ctypes.c_size_t))
        if count == 2:
            proc.ctypes.cast(buffer, proc.ctypes.POINTER(proc.ctypes.c_int))[0] = 16384
            return 0
        if buffer is None:
            size[0] = 128
            return 0
        capacity = size[0]
        capacities.append(capacity)
        if never_complete or len(capacities) == 1:
            size[0] = capacity - 1  # Near-full success is not a completeness guarantee.
        else:
            proc.ctypes.memmove(buffer, data, len(data))
            size[0] = len(data)
        return 0
    monkeypatch.setattr(proc._libc, 'sysctl', sysctl)
    if never_complete:
        with pytest.raises(proc.ProcIdentityUnavailable):
            proc._darwin_args(os.getpid())
    else:
        assert proc._darwin_args(os.getpid()) == ([b'p'], [b'A=1'])
    assert len(capacities) > 1 and capacities[1] > capacities[0]
    assert 128 + 4 < capacities[0] <= 16384 + 4


def test_identity_is_frozen_equal_and_same_process(spawn, monkeypatch):
    from dataclasses import FrozenInstanceError
    child, _ = spawn()
    observed = proc.identity(child.pid)
    assert observed == proc.identity(child.pid)
    with pytest.raises(FrozenInstanceError):
        observed.uid = -1
    assert proc.same_process(observed)
    changed = proc.ProcIdentity(observed.pid, observed.ppid, observed.pgid,
                                observed.uid, observed.ruid, (0, 0))
    monkeypatch.setattr(proc, 'identity', lambda _: changed)
    assert not proc.same_process(observed)
    monkeypatch.setattr(proc, 'identity', lambda _: None)
    assert not proc.same_process(observed)


def test_owned_rechecks_and_unknown_cannot_be_false(spawn, monkeypatch):
    child, _ = spawn({MARKER: TOKEN})
    assert proc.owned(child.pid, MARKER, TOKEN) is True
    assert proc.owned(child.pid, MARKER, TOKEN + b'x') is False
    original = proc.identity(child.pid)
    def hidden(_):
        raise proc.EnvHidden('fixture hidden', reason='hidden', uid=original.uid)
    monkeypatch.setattr(proc, 'environ', hidden)
    unknown = proc.owned(child.pid, MARKER, TOKEN)
    assert isinstance(unknown, proc.Unknown) and unknown.reason == 'hidden'
    with pytest.raises(TypeError):
        bool(unknown)
    replacement = proc.ProcIdentity(original.pid, original.ppid, original.pgid,
                                    original.uid, original.ruid, (0, 0))
    monkeypatch.setattr(proc, 'environ', lambda _: {MARKER: TOKEN})
    observations = iter((original, original, replacement))
    monkeypatch.setattr(proc, 'identity', lambda _: next(observations))
    assert isinstance(proc.owned(child.pid, MARKER, TOKEN), proc.Unknown)


def test_pinned_process_keeps_linux_handle_until_caller_finishes(spawn, monkeypatch):
    child, _ = spawn()
    original = proc.identity(child.pid)
    opened, closed = [], []
    monkeypatch.setattr(proc.sys, 'platform', 'linux')
    monkeypatch.setattr(proc.os, 'pidfd_open', lambda pid, flags: opened.append(pid) or 12345, raising=False)
    monkeypatch.setattr(proc.os, 'close', lambda fd: closed.append(fd))
    monkeypatch.setattr(proc, 'identity', lambda _: original)
    with proc.pinned_process(original) as handle:
        assert handle == 12345 and opened == [child.pid] and not closed
    assert closed == [12345]


def test_identity_rejects_boolean_pid():
    with pytest.raises(ValueError):
        proc.identity(True)


def test_unknown_contract_and_snapshot_truthiness():
    assert 'UNKNOWN' in proc.__doc__ and 'cleanup=ok' in proc.__doc__
    assert '338/762' in proc.__doc__ and 'ancestry first' in proc.__doc__
    assert 'pidfd' in proc.__doc__ and 'residual' in proc.__doc__
    for read in (proc.environ, proc.has_env):
        assert 'UNKNOWN' in read.__doc__
    with pytest.raises(TypeError, match='unavailable'):
        bool(proc.ChildrenSnapshot())



def test_snapshot_enriches_unavailable_with_known_uid(spawn, monkeypatch):
    child, _ = spawn()
    monkeypatch.setattr(proc, 'list_pids', lambda: [child.pid])
    def unavailable(_):
        raise proc.ProcIdentityUnavailable('fixture unavailable', reason='other')
    monkeypatch.setattr(proc, 'identity', unavailable)
    error = proc.children_snapshot().unavailable[child.pid]
    assert error.reason == 'other'
    assert (error.uid, error.ruid) == (os.geteuid(), os.getuid())


def test_mid_read_identity_failure_retains_known_uid(spawn, monkeypatch):
    child, _ = spawn()
    before = proc.identity(child.pid)
    observations = iter((before, None))
    def identity(_):
        item = next(observations)
        if item is None:
            raise proc.ProcIdentityUnavailable('fixture lost coverage')
        return item
    monkeypatch.setattr(proc, 'identity', identity)
    def short(*_):
        raise ValueError('short read')
    monkeypatch.setattr(proc, '_darwin_args' if sys.platform == 'darwin' else '_read', short)
    with pytest.raises(proc.ProcIdentityUnavailable) as caught:
        proc.environ(child.pid)
    assert caught.value.uid == before.uid and caught.value.ruid == before.ruid


def test_linux_complete_range_and_zombie_states(spawn, monkeypatch):
    child, _ = spawn()
    observed = proc.identity(child.pid)
    monkeypatch.setattr(proc.sys, 'platform', 'linux')
    fields = [b'0'] * 49
    data = b'A=1\0M=tok\0'
    fields[0], fields[1], fields[2], fields[19] = b'S', str(observed.ppid).encode(), str(observed.pgid).encode(), b'123'
    fields[47], fields[48] = b'4096', str(4096 + len(data)).encode()
    def read(path):
        if path.endswith('/stat'):
            return str(child.pid).encode() + b' (fixture) ' + b' '.join(fields)
        if path.endswith('/status'):
            return ('Uid: %s %s 0 0\n' % (observed.ruid, observed.uid)).encode()
        if path.endswith('boot_id'):
            return b'fixture-boot'
        return data
    monkeypatch.setattr(proc, '_read', read)
    assert proc.environ(child.pid) == {b'A': b'1', b'M': b'tok'}
    for state in (b'Z', b'X', b'x'):
        fields[0] = state
        assert proc.identity(child.pid) is None
        assert proc.environ(child.pid) is None
        assert not proc.has_env(child.pid, MARKER, TOKEN)


def test_pinned_process_closes_on_changed_identity(spawn, monkeypatch):
    child, _ = spawn()
    original = proc.identity(child.pid)
    closed = []
    monkeypatch.setattr(proc.sys, 'platform', 'linux')
    monkeypatch.setattr(proc.os, 'pidfd_open', lambda *_: 12345, raising=False)
    monkeypatch.setattr(proc.os, 'close', closed.append)
    monkeypatch.setattr(proc, 'identity', lambda _: None)
    with pytest.raises(proc.ProcIdentityUnavailable):
        with proc.pinned_process(original):
            pytest.fail('changed incarnation must never yield a handle')
    assert closed == [12345]

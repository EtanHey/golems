"""Synthetic HOME and child commands; never runs a real full suite."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import signal
import pytest
import sys
import time

SCRIPT = Path(__file__).resolve().parents[1] / "hooks/heavy-suite.py"


def env(home):
    return {**{k: v for k, v in os.environ.items() if not k.startswith("GOLEMS_HEAVY_")}, "HOME": str(home), "GOLEMS_HEAVY_SUITE_SLOTS": "1", "GOLEMS_HEAVY_MIN_FREE_GB": "0", "GOLEMS_HEAVY_MAX_LOAD": "99999", "GOLEMS_HEAVY_POLL_SECONDS": "0.02"}


@pytest.fixture(autouse=True)
def scheduling_defaults(monkeypatch):
    monkeypatch.setenv("GOLEMS_HEAVY_SUITE_SLOTS", "1")
    monkeypatch.setenv("GOLEMS_HEAVY_MIN_FREE_GB", "0")


def wait_for(path):
    deadline = time.monotonic() + 5
    while not path.exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert path.exists(), f"child never wrote {path}"


def launch(home, code):
    return subprocess.Popen([sys.executable, str(SCRIPT), "--", sys.executable, "-c", code], env=env(home), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def test_two_holders_serialize(tmp_path):
    first, second, release = [tmp_path / x for x in ("first", "second", "release")]
    a = launch(tmp_path, f"from pathlib import Path; import time; Path({str(first)!r}).touch();\nwhile not Path({str(release)!r}).exists(): time.sleep(.01)")
    b = None
    try:
        wait_for(first)
        b = launch(tmp_path, f"from pathlib import Path; Path({str(second)!r}).touch()")
        time.sleep(0.15)
        assert not second.exists(), "second suite entered while first held the lock"
        release.touch()
        assert a.wait(timeout=5) == 0
        assert b.wait(timeout=5) == 0
        assert second.exists()
    finally:
        release.touch()
        for proc in (a, b):
            if proc is not None:
                if proc.poll() is None: proc.kill()
                proc.communicate(timeout=5)


def test_stale_record_is_reclaimed_after_owner_death(tmp_path):
    lock = tmp_path / ".local/state/golems/heavy-suite.slot0.lock"
    lock.parent.mkdir(parents=True)
    ready = tmp_path / "ready"
    holder = subprocess.Popen([sys.executable, "-c", f"import fcntl,json,os,time; from pathlib import Path; f=open({str(lock)!r},'w'); fcntl.flock(f,fcntl.LOCK_EX); json.dump({{'pid':os.getpid(),'state':'running'}},f); f.flush(); Path({str(ready)!r}).touch(); time.sleep(30)"])
    try:
        wait_for(ready)
        holder.kill(); holder.wait(timeout=5)
        result = subprocess.run([sys.executable, str(SCRIPT), "--", sys.executable, "-c", "pass"], env=env(tmp_path), capture_output=True, text=True, timeout=5)
        assert result.returncode == 0, result.stderr
        assert "RECLAIMED" in result.stderr
        assert json.loads(lock.read_text())["state"] == "done"
    finally:
        if holder.poll() is None: holder.kill()
        holder.wait(timeout=5)


def test_child_exit_status_is_preserved(tmp_path):
    result = subprocess.run([sys.executable, str(SCRIPT), "--", sys.executable, "-c", "raise SystemExit(7)"], env=env(tmp_path), capture_output=True, text=True, timeout=5)
    assert result.returncode == 7


def test_killed_wrapper_releases_parent_only_slot(tmp_path):
    started, finished, release, child_pid = [tmp_path / x for x in ("started", "finished", "release", "child-pid")]
    code = f"from pathlib import Path; import os,time; Path({str(child_pid)!r}).write_text(str(os.getpid())); Path({str(started)!r}).touch();\nwhile not Path({str(release)!r}).exists(): time.sleep(.01)"
    wrapper = launch(tmp_path, code)
    next_holder = None
    try:
        wait_for(started)
        wrapper.kill(); wrapper.wait(timeout=5)
        next_holder = launch(tmp_path, f"from pathlib import Path; Path({str(finished)!r}).touch()")
        wait_for(finished)
        release.touch()
        assert next_holder.wait(timeout=5) == 0
        assert finished.exists()
    finally:
        release.touch()
        if next_holder is not None:
            if next_holder.poll() is None: next_holder.kill()
            next_holder.communicate(timeout=5)
        if wrapper.poll() is None: wrapper.kill()
        wrapper.communicate(timeout=5)


@pytest.mark.parametrize("signum", [signal.SIGTERM, signal.SIGHUP])
def test_termination_reaches_child_and_releases_slot(tmp_path, signum):
    ready, child_pid = tmp_path / "ready", tmp_path / "child-pid"
    proc = launch(tmp_path, f"from pathlib import Path; import time,os; Path({str(child_pid)!r}).write_text(str(os.getpid())); Path({str(ready)!r}).touch(); time.sleep(30)")
    try:
        wait_for(ready)
        proc.send_signal(signum)
        assert proc.wait(timeout=5) == 128 + signum
        result = subprocess.run([sys.executable, str(SCRIPT), "--", sys.executable, "-c", "pass"], env=env(tmp_path), capture_output=True, text=True, timeout=5)
        assert result.returncode == 0
    finally:
        if proc.poll() is None: proc.kill()
        if child_pid.exists():
            try: os.kill(int(child_pid.read_text()), signal.SIGTERM)
            except ProcessLookupError: pass
        proc.communicate(timeout=5)


def load_module():
    spec = importlib.util.spec_from_file_location("heavy_suite", SCRIPT)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def test_finished_suite_unlocks_while_background_daemon_survives(tmp_path):
    pid = tmp_path / "daemon.pid"
    code = f"import subprocess,sys; from pathlib import Path; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'],close_fds=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); Path({str(pid)!r}).write_text(str(p.pid))"
    try:
        assert launch(tmp_path, code).wait(timeout=5) == 0
        result = subprocess.run([sys.executable, str(SCRIPT), "--", sys.executable, "-c", "pass"], env=env(tmp_path), capture_output=True, text=True, timeout=1)
        assert result.returncode == 0
    finally:
        if pid.exists(): os.kill(int(pid.read_text()), signal.SIGTERM)


def test_force_skips_load_and_lock(tmp_path):
    forced = {**env(tmp_path), "GOLEMS_HEAVY_FORCE": "1", "GOLEMS_HEAVY_MAX_LOAD": "0"}
    result = subprocess.run([sys.executable, str(SCRIPT), "--", sys.executable, "-c", "pass"], env=forced, capture_output=True, text=True, timeout=1)
    assert result.returncode == 0
    assert "FORCE" in result.stderr
    assert not (tmp_path / ".local").exists()


def test_setup_failure_runs_suite_unlocked(tmp_path):
    (tmp_path / ".local").write_text("not a directory")
    result = subprocess.run([sys.executable, str(SCRIPT), "--", sys.executable, "-c", "raise SystemExit(7)"], env=env(tmp_path), capture_output=True, text=True, timeout=1)
    assert result.returncode == 7
    assert "unqueued" in result.stderr


def test_nested_wrapper_is_reentrant(monkeypatch, tmp_path):
    module = load_module(); monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("GOLEMS_HEAVY_SUITE_HELD", "fixture-holder")
    def unexpected_lock(*args):
        raise AssertionError("nested wrapper attempted a new lock")
    monkeypatch.setattr(module.fcntl, "flock", unexpected_lock)
    assert module.main(["--", sys.executable, "-c", "raise SystemExit(7)"]) == 7


def test_main_load_gate_precedes_launch_and_accepts_boundary(monkeypatch, tmp_path):
    module = load_module(); marker = tmp_path / "launched"; waits = []
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("GOLEMS_HEAVY_MAX_LOAD", "20")
    monkeypatch.setenv("GOLEMS_HEAVY_POLL_SECONDS", "0.01")
    loads = iter([21, 20])
    def load():
        import fcntl
        lock = tmp_path / ".local/state/golems/heavy-suite.lock"
        lock.parent.mkdir(parents=True, exist_ok=True)
        with lock.open("a+") as probe:
            try:
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise AssertionError("load wait holds the heavy-suite lock") from None
            fcntl.flock(probe, fcntl.LOCK_UN)
        assert not marker.exists(), "gate was moved after command launch"
        return (next(loads), 0, 0)
    def sleep(seconds):
        assert not marker.exists(); waits.append(seconds)
    monkeypatch.setattr(module.os, "getloadavg", load)
    monkeypatch.setattr(module.time, "sleep", sleep)
    assert module.main(["--", sys.executable, "-c", f"from pathlib import Path; Path({str(marker)!r}).touch()"]) == 0
    assert marker.exists() and waits == [0.01]


def test_load_max_wait_proceeds_loudly(monkeypatch, tmp_path, capsys):
    module = load_module(); monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("GOLEMS_HEAVY_MAX_WAIT_SECONDS", "0")
    monkeypatch.setattr(module.os, "getloadavg", lambda: (99, 0, 0))
    def unexpected_sleep(_seconds):
        raise AssertionError("zero wait budget slept instead of proceeding")
    monkeypatch.setattr(module.time, "sleep", unexpected_sleep)
    assert module.main(["--max-load", "20", "--", sys.executable, "-c", "pass"]) == 0
    assert "PROCEEDING" in capsys.readouterr().err


def test_lock_deadline_displays_holder_without_unlocking_it(monkeypatch, tmp_path, capsys):
    import fcntl
    monkeypatch.setenv("HOME", str(tmp_path))
    lock = tmp_path / "override.lock"
    with lock.with_name("override.slot0.lock").open('w+') as holder:
        fcntl.flock(holder, fcntl.LOCK_EX)
        json.dump({'pid':12345,'executable':'fixture-suite','started':1},holder);holder.flush()
        monkeypatch.setenv("GOLEMS_HEAVY_LOCK", str(lock)); monkeypatch.setenv("GOLEMS_HEAVY_MAX_WAIT_SECONDS", "0")
        assert load_module().main(["--", sys.executable, "-c", "pass"]) == 0
        output = capsys.readouterr().err
        assert "12345" in output and "fixture-suite" in output and "PROCEEDING" in output
        assert json.loads(lock.with_name("override.slot0.lock").read_text())["pid"] == 12345


def test_missing_helper_one_liner_runs_suite(tmp_path):
    doc = SCRIPT.with_suffix('.md').read_text()
    one_liner = doc.split('```sh\n',1)[1].split('\n```',1)[0]
    dev = tmp_path / 'Gits/golems/scripts/hooks/heavy-suite.py'
    dev.parent.mkdir(parents=True)
    dev.write_text("raise SystemExit('unexpected dev fallback')\n")
    fake_bin = tmp_path / 'bin'; fake_bin.mkdir()
    bun = fake_bin / 'bun'; bun.write_text('#!/bin/sh\nexit 7\n'); bun.chmod(0o755)
    result = subprocess.run(['sh','-c',one_liner],env={**env(tmp_path),'PATH':str(fake_bin)+os.pathsep+os.environ['PATH']},capture_output=True,text=True,timeout=1)
    assert result.returncode == 7 and 'helper missing' in result.stderr


def test_documented_one_liner_uses_installed_helper(tmp_path):
    one_liner = SCRIPT.with_suffix('.md').read_text().split('```sh\n', 1)[1].split('\n```', 1)[0]
    installed = tmp_path / 'Gits/golems/.worktrees/hooks-live/scripts/hooks/heavy-suite.py'
    installed.parent.mkdir(parents=True)
    installed.write_text("import sys; assert sys.argv[1:] == ['--', 'bun', 'run', 'test']; print('installed-helper'); raise SystemExit(7)\n")
    dev = tmp_path / 'Gits/golems/scripts/hooks/heavy-suite.py'
    dev.parent.mkdir(parents=True)
    dev.write_text("raise SystemExit('unexpected dev helper')\n")
    result = subprocess.run(['sh', '-c', one_liner], env=env(tmp_path), capture_output=True, text=True, timeout=5)
    assert result.returncode == 7 and result.stdout == 'installed-helper\n'
    assert 'unqueued' not in result.stderr


def test_default_load_limit_is_twice_cpu_count(monkeypatch, tmp_path):
    module = load_module(); limits = []; states = []
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("GOLEMS_HEAVY_MAX_LOAD", raising=False)
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    monkeypatch.setattr(module.os, "cpu_count", lambda: 14)
    monkeypatch.setattr(module, "wait_for_load", lambda max_load, *args: limits.append(max_load))
    write = module.write_record
    def record(fd, value):
        states.append(value["state"]); write(fd, value)
    monkeypatch.setattr(module, "write_record", record)
    assert module.main(["--", sys.executable, "-c", "pass"]) == 0
    assert limits == [28]
    assert "waiting-load" not in states


def test_default_three_holders_and_fourth_waits(tmp_path):
    release = tmp_path / "release"
    procs = []
    parallel_env = env(tmp_path); parallel_env.pop("GOLEMS_HEAVY_SUITE_SLOTS")
    try:
        for i in range(4):
            marker = tmp_path / str(i)
            code = f"from pathlib import Path; import time; Path({str(marker)!r}).touch();\nwhile not Path({str(release)!r}).exists(): time.sleep(.01)"
            procs.append(subprocess.Popen([sys.executable, str(SCRIPT), "--", sys.executable, "-c", code], env=parallel_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))
            if i < 3: wait_for(marker)
        time.sleep(.15)
        assert not (tmp_path / "3").exists(), "fourth suite exceeded N=3"
        release.touch()
        for proc in procs: assert proc.wait(timeout=5) == 0
        assert (tmp_path / "3").exists()
    finally:
        release.touch()
        for proc in procs:
            if proc.poll() is None: proc.kill()
            proc.communicate(timeout=5)


def test_slot_fd_is_not_in_child_or_detached_descendant(tmp_path):
    lock = tmp_path / ".local/state/golems/heavy-suite.slot0.lock"
    probe = f"import os; from pathlib import Path; targets=[os.stat(p) for p in Path({str(lock.parent)!r}).glob('*.lock')];\nfor fd in range(3,256):\n try: st=os.fstat(fd)\n except OSError: continue\n assert all((st.st_dev,st.st_ino)!=(target.st_dev,target.st_ino) for target in targets), 'slot fd inherited'"
    code = f"import subprocess,sys; exec({probe!r}); p=subprocess.Popen([sys.executable,'-c',{probe!r}],close_fds=False,start_new_session=True); raise SystemExit(p.wait())"
    result = launch(tmp_path, code); out, err = result.communicate(timeout=5)
    assert result.returncode == 0, out + err


def test_real_nested_wrapper_at_one_slot(tmp_path):
    code = f"import subprocess,sys; raise SystemExit(subprocess.call([sys.executable,{str(SCRIPT)!r},'--',sys.executable,'-c','raise SystemExit(7)']))"
    result = launch(tmp_path, code); _, err = result.communicate(timeout=5)
    assert result.returncode == 7, err
    assert err.count("SUITE START") == 1


def test_memory_floor_waits_before_slot_or_command(monkeypatch, tmp_path, capsys):
    module = load_module(); marker = tmp_path / "launched"; waits = []
    monkeypatch.setenv("HOME", str(tmp_path)); monkeypatch.setenv("GOLEMS_HEAVY_MIN_FREE_GB", "6")
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    readings = iter([5 * 1024**3, 6 * 1024**3, 6 * 1024**3])
    def memory():
        import fcntl
        root = tmp_path / ".local/state/golems"; root.mkdir(parents=True, exist_ok=True)
        for name in ("heavy-suite.lock", "heavy-suite.slot0.lock"):
            with (root / name).open("a+") as probe:
                try: fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError: raise AssertionError("RAM wait holds a slot or legacy lock") from None
                fcntl.flock(probe, fcntl.LOCK_UN)
        assert not marker.exists()
        return next(readings)
    monkeypatch.setattr(module, "free_inactive_bytes", memory)
    monkeypatch.setattr(module.time, "sleep", lambda seconds: waits.append(seconds))
    monkeypatch.setattr(module.os, "getloadavg", lambda: (0, 0, 0))
    assert module.main(["--poll-seconds", ".01", "--", sys.executable, "-c", f"from pathlib import Path; Path({str(marker)!r}).touch()"]) == 0
    assert marker.exists() and waits == [.01]
    assert "WAIT memory=" in capsys.readouterr().err


def test_memory_timeout_never_starts(monkeypatch, tmp_path):
    module = load_module(); marker = tmp_path / "launched"
    monkeypatch.setenv("HOME", str(tmp_path)); monkeypatch.setenv("GOLEMS_HEAVY_MIN_FREE_GB", "6")
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    monkeypatch.setattr(module, "free_inactive_bytes", lambda: 0)
    assert module.main(["--max-wait-seconds", "0", "--", sys.executable, "-c", f"from pathlib import Path; Path({str(marker)!r}).touch()"]) == 75
    assert not marker.exists()


@pytest.mark.parametrize("value,expected", [("0",1),("9",8),("3",3)])
def test_slot_count_clamped(monkeypatch, value, expected):
    monkeypatch.setenv("GOLEMS_HEAVY_SUITE_SLOTS", value)
    assert load_module().slot_count() == expected


@pytest.mark.parametrize("platform", ["darwin", "linux"])
def test_free_plus_inactive_parser(monkeypatch, platform):
    module = load_module(); monkeypatch.setattr(module.sys, "platform", platform)
    if platform == "darwin":
        monkeypatch.setattr(module.subprocess, "check_output", lambda *a, **k: 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 2.\nPages inactive: 3.\nPages active: 999.\n')
        assert module.free_inactive_bytes() == 5 * 16384
    else:
        monkeypatch.setattr(module.Path, "read_text", lambda *a: 'MemFree: 2 kB\nInactive: 3 kB\nMemAvailable: 999 kB\n')
        assert module.free_inactive_bytes() == 5 * 1024


def test_memory_is_rechecked_after_load_wait(monkeypatch, tmp_path):
    module = load_module(); marker = tmp_path / "launched"
    monkeypatch.setenv("HOME", str(tmp_path)); monkeypatch.setenv("GOLEMS_HEAVY_MIN_FREE_GB", "6")
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    memory = iter([6 * 1024**3, 0])
    monkeypatch.setattr(module, "free_inactive_bytes", lambda: next(memory))
    monkeypatch.setattr(module.os, "getloadavg", lambda: (0, 0, 0))
    assert module.main(["--max-wait-seconds", "0", "--", sys.executable, "-c", f"from pathlib import Path; Path({str(marker)!r}).touch()"]) == 75
    assert not marker.exists()


@pytest.mark.parametrize("floor", ["nan", "-1", "inf"])
def test_invalid_memory_floor_refuses(monkeypatch, tmp_path, floor):
    module = load_module(); marker = tmp_path / "launched"
    monkeypatch.setenv("HOME", str(tmp_path)); monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    assert module.main(["--min-free-gb", floor, "--", sys.executable, "-c", f"from pathlib import Path; Path({str(marker)!r}).touch()"]) == 75
    assert not marker.exists()


def test_old_exclusive_holder_blocks_new_suite(tmp_path):
    import fcntl
    legacy = tmp_path / ".local/state/golems/heavy-suite.lock"
    legacy.parent.mkdir(parents=True); marker = tmp_path / "started"
    proc = None
    with legacy.open("w+") as old:
        fcntl.flock(old, fcntl.LOCK_EX)
        try:
            proc = launch(tmp_path, f"from pathlib import Path; Path({str(marker)!r}).touch()")
            time.sleep(.15)
            assert not marker.exists(), "new suite overlapped old exclusive holder"
            fcntl.flock(old, fcntl.LOCK_UN)
            assert proc.wait(timeout=5) == 0
            assert marker.exists()
        finally:
            if proc is not None:
                if proc.poll() is None: proc.kill()
                proc.communicate(timeout=5)


def test_new_holder_blocks_old_exclusive_lock(tmp_path):
    import fcntl
    ready, release = tmp_path / "ready", tmp_path / "release"
    proc = launch(tmp_path, f"from pathlib import Path; import time; Path({str(ready)!r}).touch();\nwhile not Path({str(release)!r}).exists(): time.sleep(.01)")
    try:
        wait_for(ready)
        with (tmp_path / ".local/state/golems/heavy-suite.lock").open("a+") as old:
            with pytest.raises(BlockingIOError): fcntl.flock(old, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally:
        release.touch()
        if proc.poll() is None: proc.wait(timeout=5)
        proc.communicate(timeout=5)

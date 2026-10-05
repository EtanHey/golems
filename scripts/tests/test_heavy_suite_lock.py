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
    return {**{k: v for k, v in os.environ.items() if not k.startswith("GOLEMS_HEAVY_")}, "HOME": str(home), "GOLEMS_HEAVY_MAX_LOAD": "99999", "GOLEMS_HEAVY_POLL_SECONDS": "0.02"}


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
    lock = tmp_path / ".local/state/golems/heavy-suite.lock"
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


def test_killed_wrapper_does_not_unlock_its_running_child(tmp_path):
    started, finished, release, child_pid = [tmp_path / x for x in ("started", "finished", "release", "child-pid")]
    code = f"from pathlib import Path; import os,time; Path({str(child_pid)!r}).write_text(str(os.getpid())); Path({str(started)!r}).touch();\nwhile not Path({str(release)!r}).exists(): time.sleep(.01)"
    wrapper = launch(tmp_path, code)
    next_holder = None
    try:
        wait_for(started)
        wrapper.kill(); wrapper.wait(timeout=5)
        next_holder = launch(tmp_path, f"from pathlib import Path; Path({str(finished)!r}).touch()")
        time.sleep(.15)
        assert not finished.exists(), "wrapper death released its child's slot"
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
    with lock.open('w+') as holder:
        fcntl.flock(holder, fcntl.LOCK_EX)
        json.dump({'pid':12345,'executable':'fixture-suite','started':1},holder);holder.flush()
        monkeypatch.setenv("GOLEMS_HEAVY_LOCK", str(lock)); monkeypatch.setenv("GOLEMS_HEAVY_MAX_WAIT_SECONDS", "0")
        assert load_module().main(["--", sys.executable, "-c", "pass"]) == 0
        output = capsys.readouterr().err
        assert "12345" in output and "fixture-suite" in output and "PROCEEDING" in output
        assert json.loads(lock.read_text())["pid"] == 12345


def test_missing_helper_one_liner_runs_suite(tmp_path):
    doc = SCRIPT.with_suffix('.md').read_text()
    one_liner = doc.split('```sh\n',1)[1].split('\n```',1)[0]
    fake_bin = tmp_path / 'bin'; fake_bin.mkdir()
    bun = fake_bin / 'bun'; bun.write_text('#!/bin/sh\nexit 7\n'); bun.chmod(0o755)
    result = subprocess.run(['sh','-c',one_liner],env={**env(tmp_path),'PATH':str(fake_bin)+os.pathsep+os.environ['PATH']},capture_output=True,text=True,timeout=1)
    assert result.returncode == 7 and 'helper missing' in result.stderr

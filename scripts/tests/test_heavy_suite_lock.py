"""Synthetic HOME and child commands; never runs a real full suite."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

SCRIPT = Path(__file__).resolve().parents[1] / "hooks/heavy-suite.py"


def env(home):
    return {**os.environ, "HOME": str(home), "GOLEMS_HEAVY_MAX_LOAD": "99999", "GOLEMS_HEAVY_POLL_SECONDS": "0.02"}


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


def test_load_gate_waits_before_launch(monkeypatch, tmp_path):
    spec = importlib.util.spec_from_file_location("heavy_suite", SCRIPT)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    loads = iter([21.0, 19.0]); waits = []
    monkeypatch.setattr(module.os, "getloadavg", lambda: (next(loads), 0, 0))
    monkeypatch.setattr(module.time, "sleep", waits.append)
    module.wait_for_load(20, 0.25)
    assert waits == [0.25]


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


def test_termination_reaches_child_and_releases_slot(tmp_path):
    ready = tmp_path / "ready"
    proc = launch(tmp_path, f"from pathlib import Path; import time; Path({str(ready)!r}).touch(); time.sleep(30)")
    try:
        wait_for(ready)
        proc.terminate()
        assert proc.wait(timeout=5) == 143
        result = subprocess.run([sys.executable, str(SCRIPT), "--", sys.executable, "-c", "pass"], env=env(tmp_path), capture_output=True, text=True, timeout=5)
        assert result.returncode == 0
    finally:
        if proc.poll() is None: proc.kill()
        proc.communicate(timeout=5)

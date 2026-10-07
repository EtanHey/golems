"""Synthetic gate contract tests; private policy specimens stay off public CI."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

@pytest.fixture(autouse=True)
def scheduling_defaults(monkeypatch):
    monkeypatch.setenv("GOLEMS_HEAVY_MIN_FREE_GB", "0")
    monkeypatch.setenv("GOLEMS_HEAVY_SUITE_SLOTS", "1")


fixture = pytest.fixture
parametrize = pytest.mark.parametrize

spec = importlib.util.spec_from_file_location(
    "private_gate", Path(__file__).resolve().parents[1] / "hooks/private-regression-gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = "1" * 40


@fixture
def manifest(tmp_path):
    root = tmp_path / "docs.local/private-guard-suites"
    root.mkdir(parents=True)
    rows = []
    for i in range(5):
        p = root / f"test_guard_{i}.py"
        p.write_text("# synthetic private fixture\n")
        rows.append({"path": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()})
    helper = root / "helper.py"; helper.write_text("# synthetic helper\n")
    dependency = {"path": str(helper), "sha256": hashlib.sha256(helper.read_bytes()).hexdigest()}
    m = {"version": 2, "expectedCases": 96, "fixtures": rows, "dependencies": [dependency]}
    p = root / "manifest.json"; p.write_text(json.dumps(m))
    return tmp_path, p, m


def test_complete_hashed_manifest_accepts(manifest):
    repo, _, m = manifest
    assert gate.load_manifest(repo, SHA) == m


@parametrize("change", [
    lambda m: m.update(version=1), lambda m: m.update(dependencies="invalid"),
    lambda m: m.update(expectedCases=95), lambda m: m.update(expectedCases=True),
    lambda m: m.update(fixtures=[]), lambda m: m.update(dependencies=[{}]),
    lambda m: m["fixtures"][0].update(sha256="0" * 64),
    lambda m: m["fixtures"][0].update(path="relative.py"),
])
def test_manifest_refuses_drift_missing_suite_and_incomplete_counts(manifest, change):
    repo, p, original = manifest
    m = copy.deepcopy(original); change(m); p.write_text(json.dumps(m))
    with pytest.raises(ValueError):
        gate.load_manifest(repo, SHA)


def test_missing_private_file_refuses(manifest):
    repo, _, m = manifest
    Path(m["fixtures"][0]["path"]).unlink()
    with pytest.raises(ValueError):
        gate.load_manifest(repo, SHA)


def test_dependency_drift_refuses(manifest):
    repo, _, m = manifest
    Path(m["dependencies"][0]["path"]).write_text("# changed adapter\n")
    with pytest.raises(ValueError, match="hash mismatch"):
        gate.load_manifest(repo, SHA)


def report(tmp_path, count=96, attr="", body=""):
    p = tmp_path / "result.xml"
    p.write_text(f'<testsuites><testsuite tests="{count}" {attr}>'
                 + '<testcase name="synthetic" />' * count + body + '</testsuite></testsuites>')
    return p


def test_exact_complete_xml_receipt_accepts(tmp_path):
    gate.check_result(report(tmp_path), 96)


@parametrize("count,attr,body", [
    (95, "", ""), (0, "", ""), (96, 'skipped="1"', ""),
    (96, 'errors="1"', ""), (96, 'failures="1"', ""),
    (95, "", '<testcase><failure/></testcase>'),
    (95, "", '<testcase><skipped/></testcase>'),
])
def test_skipped_failed_and_subset_receipts_refuse(tmp_path, count, attr, body):
    with pytest.raises(ValueError):
        gate.check_result(report(tmp_path, count, attr, body), 96)


def test_empty_xml_cannot_spoof_total_count(tmp_path):
    p = tmp_path / "result.xml"; p.write_text('<testsuite tests="96"/>')
    with pytest.raises(ValueError):
        gate.check_result(p, 96)


def test_parser_environment_cannot_select_a_subset_or_redirect_source(monkeypatch):
    for k in ["PYTEST_ADDOPTS", "PYTHONPATH", "GIT_DIR", "WEAVE_ALLOW_TMP", "S616B_SOURCE",
              "GOLEMS_HEAVY_FORCE", "GOLEMS_HEAVY_LOCK"]:
        monkeypatch.setenv(k, "synthetic")
        assert k not in gate.clean_env()


def test_nested_suite_refuses_without_acquiring_another_slot(monkeypatch):
    monkeypatch.setenv("GOLEMS_HEAVY_SUITE_HELD", "123")
    with pytest.raises(ValueError, match="outside an existing heavy suite"):
        with gate.slot():
            pytest.fail("nested suite ran")


@parametrize("blocked", ["lock", "load"])
def test_queue_and_load_timeout_never_execute_unqueued(tmp_path, monkeypatch, blocked):
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    monkeypatch.setattr(gate.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("GOLEMS_HEAVY_MAX_LOAD", "20")
    monkeypatch.setattr(gate.os, "getloadavg", lambda: (0, 0, 0))
    ticks = iter([0, 1801])
    monkeypatch.setattr(gate.time, "monotonic", lambda: next(ticks))
    if blocked == "lock":
        def busy(*args):
            raise BlockingIOError("synthetic held slot")
        monkeypatch.setattr(gate.heavy_suite.fcntl, "flock", busy)
    else:
        monkeypatch.setattr(gate.os, "getloadavg", lambda: (21, 21, 21))
    with pytest.raises(ValueError, match="timed out"):
        with gate.slot():
            pytest.fail("timed-out gate executed")


def test_startup_environment_is_removed(monkeypatch):
    monkeypatch.setenv("PYTHONSTARTUP", "synthetic")
    assert "PYTHONSTARTUP" not in gate.clean_env()


def test_slot_honors_shared_lock_override(tmp_path, monkeypatch):
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    monkeypatch.setattr(gate.Path, "home", lambda: tmp_path)
    lock = tmp_path / "shared.lock"
    monkeypatch.setenv("GOLEMS_HEAVY_LOCK", str(lock))
    monkeypatch.setattr(gate.os, "getloadavg", lambda: (0, 0, 0))
    with gate.slot():
        assert lock.with_name("shared.slot0.lock").exists()


def test_fully_absent_private_root_warns(tmp_path, capsys):
    assert gate.load_manifest(tmp_path, SHA) is None
    assert "WARN" in capsys.readouterr().out


def test_candidate_cannot_shadow_the_real_test_runner(tmp_path, monkeypatch):
    import contextlib, subprocess
    repo = tmp_path / "candidate"
    repo.mkdir()
    def git(*args):
        return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()
    git("init", "-q")
    git("config", "user.name", "Fixture")
    git("config", "user.email", "fixture@localhost")
    (repo / "pytest.py").write_text(
        "import sys\np=sys.argv[sys.argv.index('--junitxml')+1]\n"
        "open(p,'w').write('<testsuite tests=\"96\">'+ '<testcase/>'*96 +'</testsuite>')\n")
    (repo / "conftest.py").write_text(
        "def pytest_collection_modifyitems(items):\n"
        "    for item in items: item._obj = lambda: None\n")
    adapter = repo / "scripts/hooks/codex-policy-hook.py"
    adapter.parent.mkdir(parents=True)
    adapter.write_text("# synthetic candidate adapter\n")
    git("add", "."); git("commit", "-qm", "synthetic runner shadow")
    sha = git("rev-parse", "HEAD")
    private = repo / "docs.local/private-guard-suites"
    private.mkdir(parents=True)
    suite = private / "test_trusted.py"
    suite.write_text("import pytest\nparametrize = pytest.mark.parametrize\n@parametrize('i', range(96))\n"
                     "def test_trusted(i):\n    assert i != 0\n")
    manifest = {"version": 2, "expectedCases": 96, "fixtures": [
        {"path": str(suite), "sha256": hashlib.sha256(suite.read_bytes()).hexdigest()}],
        "dependencies": []}
    monkeypatch.setattr(gate, "load_manifest", lambda *args: manifest)
    monkeypatch.setattr(gate, "slot", contextlib.nullcontext)
    with pytest.raises(ValueError, match="failed"):
        gate.run(repo, sha)
    assert not list((repo / ".worktrees").glob("hooks-private-gate-*"))


@parametrize("value", [[], "invalid", None, 7])
def test_manifest_type_refuses(manifest, value):
    repo, path, _ = manifest
    path.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="manifest type"):
        gate.load_manifest(repo, SHA)


def test_partial_private_root_refuses(tmp_path):
    (tmp_path / "docs.local/private-guard-suites").mkdir(parents=True)
    with pytest.raises(FileNotFoundError):
        gate.load_manifest(tmp_path, SHA)


def test_symlink_private_root_refuses(tmp_path):
    root = tmp_path / "docs.local/private-guard-suites"
    root.parent.mkdir()
    root.symlink_to(tmp_path / "missing")
    with pytest.raises(ValueError):
        gate.load_manifest(tmp_path, SHA)


def test_candidate_git_error_refuses(monkeypatch, tmp_path):
    import subprocess
    def bad_git(*args):
        raise subprocess.CalledProcessError(128, "git")
    monkeypatch.setattr(gate, "git", bad_git)
    with pytest.raises(subprocess.CalledProcessError):
        gate.public_suites(tmp_path)


def test_renamed_guard_refuses(monkeypatch, tmp_path):
    monkeypatch.setattr(gate, "git", lambda *args:
                        "skills/golem-powers/tmp-block/hooks/renamed.py")
    with pytest.raises(ValueError, match="missing or renamed"):
        gate.public_suites(tmp_path)


def test_timeout_cleans_candidate_worktree(tmp_path, monkeypatch):
    import contextlib, subprocess
    repo = tmp_path / "repo"; repo.mkdir()
    monkeypatch.setattr(gate, "load_manifest", lambda *args: None)
    monkeypatch.setattr(gate, "slot", contextlib.nullcontext)
    monkeypatch.setattr(gate, "public_suites", lambda *args: ["synthetic"] )
    calls = []
    def fake_git(repo, *args):
        calls.append(args)
        return ""
    monkeypatch.setattr(gate, "git", fake_git)
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("synthetic", 300)
    monkeypatch.setattr(gate, "execute_suite", timeout)
    with pytest.raises(subprocess.TimeoutExpired):
        gate.run(repo, SHA)
    assert calls[-1][:3] == ("worktree", "remove", "--force")


def test_symlink_manifest_refuses(manifest):
    repo, path, _ = manifest
    data = path.read_bytes(); path.unlink()
    outside = repo / "outside.json"; outside.write_bytes(data); path.symlink_to(outside)
    with pytest.raises(ValueError, match="real file"):
        gate.load_manifest(repo, SHA)


def test_private_fixture_outside_durable_root_refuses(manifest):
    repo, path, m = manifest
    outside = repo / "test_external.py"; outside.write_text("# synthetic\n")
    m["fixtures"][0] = {"path": str(outside), "sha256": hashlib.sha256(outside.read_bytes()).hexdigest()}
    path.write_text(json.dumps(m))
    with pytest.raises(ValueError, match="outside suite root"):
        gate.load_manifest(repo, SHA)


def test_installer_bearing_pin_cannot_remove_all_guards(monkeypatch, tmp_path):
    monkeypatch.setattr(gate, "git", lambda *args: "scripts/hooks/install-hooks.mjs")
    with pytest.raises(ValueError, match="missing or renamed"):
        gate.public_suites(tmp_path)


def test_public_receipt_accepts_passing_subtests_without_extra_case_rows(tmp_path):
    path = report(tmp_path)
    path.write_text(path.read_text().replace('tests="96"', 'tests="100"'))
    gate.check_result(path)
    with pytest.raises(ValueError):
        gate.check_result(path, 96)


@parametrize("expected", [None, 96])
def test_in_process_exit_cannot_forge_completion(tmp_path, monkeypatch, expected):
    monkeypatch.setattr(gate.Path, "home", lambda: tmp_path)
    out = tmp_path / "receipts"; out.mkdir()
    tree = tmp_path / "candidate"; tree.mkdir()
    suite = tree / "test_forged.py"
    count = expected or 1
    suite.write_text("import os, sys\nfrom pathlib import Path\n"
        "p=Path(sys.argv[sys.argv.index('--junitxml')+1])\n"
        f"p.write_text('<testsuite tests=\"{count}\">'+'<testcase/>'*{count}+'</testsuite>')\n"
        "os._exit(0)\n")
    with pytest.raises(ValueError, match="completion receipt"):
        gate.execute_suite([str(suite)], out, tree, "private" if expected else "public", expected)


def test_required_absent_suites_refuse(tmp_path):
    with pytest.raises(ValueError, match="required private suites unavailable"):
        gate.load_manifest(tmp_path, SHA, required=True)


def test_completed_fixture_retention_preserves_active_and_foreign_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(gate.Path, "home", lambda: tmp_path)
    root = tmp_path / "docs.local/golems-guard-fixtures"; root.mkdir(parents=True)
    import os
    names = [format(i, '032x') for i in range(8)]
    for i, name in enumerate(names):
        p = root / name; p.mkdir(); (p / 'data').write_text('fixture')
        os.utime(p, (i + 1, i + 1))
    active = root / names[0]; (active / '.active').write_text(json.dumps({'pid': os.getpid(), 'start': gate.process_start(os.getpid())})); os.utime(active, (1, 1))
    foreign = root / 'unrelated'; foreign.mkdir()
    external = tmp_path / 'external'; external.mkdir(); (external / 'keep').touch()
    (root / ('f' * 32)).symlink_to(external, target_is_directory=True)
    gate.prune_fixtures(keep=3)
    assert active.exists() and foreign.exists() and (external / 'keep').exists()
    assert all((root / name).exists() for name in names[-3:])
    assert all(not (root / name).exists() for name in names[1:-3])


def test_honest_completion_and_subtests_accept(tmp_path, monkeypatch):
    monkeypatch.setattr(gate.Path, "home", lambda: tmp_path)
    out = tmp_path / 'receipts'; out.mkdir()
    tree = tmp_path / 'candidate'; tree.mkdir()
    suite = tree / 'test_honest.py'
    suite.write_text('def test_honest(subtests):\n    for i in range(3):\n        with subtests.test(i=i):\n            assert i >= 0\n')
    gate.execute_suite([str(suite)], out, tree, 'public')
    assert (out / 'public-completion.json').is_file()


@parametrize("transport", ["disk", "pipe"])
def test_candidate_disk_receipt_cannot_spoof_trusted_completion(tmp_path, monkeypatch, transport):
    monkeypatch.setattr(gate.Path, "home", lambda: tmp_path)
    out = tmp_path / 'receipts'; out.mkdir()
    tree = tmp_path / 'candidate'; tree.mkdir()
    suite = tree / 'test_disk_forged.py'
    suite.write_text('transport='+repr(transport)+'\n'+'''import ast, hashlib, json, os, sys
from pathlib import Path
report = Path(sys.argv[sys.argv.index('--junitxml')+1])
nonce, receipt_fd = 'guess', None
for node in ast.parse((report.parent / '_golems_gate_isolation.py').read_text()).body:
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'NONCE':
        try: nonce = ast.literal_eval(node.value)
        except ValueError: pass
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'RECEIPT_FD':
        receipt_fd = ast.literal_eval(node.value)
report.write_text('<testsuite tests="1"><testcase/></testsuite>')
payload = json.dumps({
    'nonce': nonce, 'exit': 0, 'collected': 1, 'passed': 1, 'bad': False,
    'xmlSHA256': hashlib.sha256(report.read_bytes()).hexdigest()})
if transport == 'pipe' and receipt_fd is not None:
    os.write(receipt_fd, payload.encode())
else:
    (report.parent / (report.stem + '-completion.json')).write_text(payload)
os._exit(0)
''')
    with pytest.raises(ValueError, match="completion receipt"):
        gate.execute_suite([str(suite)], out, tree, 'public')


def test_xml_rewrite_after_sessionfinish_refuses(tmp_path, monkeypatch):
    monkeypatch.setattr(gate.Path, "home", lambda: tmp_path)
    out = tmp_path / "receipts"; out.mkdir()
    tree = tmp_path / "candidate"; tree.mkdir()
    suite = tree / "test_honest.py"; suite.write_text("def test_honest(): assert True\n")
    record = gate.record_completion
    def rewrite(report, receipt, nonce, payload):
        # Same passing count, different bytes after the child sends its valid receipt.
        report.write_bytes(report.read_bytes().replace(b"test_honest", b"test_changed"))
        record(report, receipt, nonce, payload)
    monkeypatch.setattr(gate, "record_completion", rewrite)
    with pytest.raises(ValueError, match="completion receipt"):
        gate.execute_suite([str(suite)], out, tree, "public")


def test_gate_run_prunes_completed_fixtures(tmp_path, monkeypatch):
    from contextlib import nullcontext
    monkeypatch.setattr(gate.Path, "home", lambda: tmp_path)
    root = tmp_path / "docs.local/golems-guard-fixtures"; root.mkdir(parents=True)
    for i in range(8): (root / format(i, '032x')).mkdir()
    monkeypatch.setattr(gate, "slot", nullcontext)
    monkeypatch.setattr(gate, "load_manifest", lambda *args: None)
    monkeypatch.setattr(gate, "public_suites", lambda *args: [])
    monkeypatch.setattr(gate, "git", lambda tree, *args: SHA if args[0] == "rev-parse" else "")
    gate.run(tmp_path, SHA)
    assert len(list(root.iterdir())) == 5


@parametrize("stale", ["dead", "reused"])
def test_stale_active_fixture_is_pruned(tmp_path, monkeypatch, stale):
    import os
    monkeypatch.setattr(gate.Path, "home", lambda: tmp_path)
    root = tmp_path / "docs.local/golems-guard-fixtures"; root.mkdir(parents=True)
    for i in range(8):
        p = root / format(i, '032x'); p.mkdir(); os.utime(p, (i+1, i+1))
    old = root / format(0, '032x')
    (old / '.active').write_text(json.dumps({'pid': 99999999 if stale == 'dead' else os.getpid(), 'start': 'different-start'}))
    os.utime(old, (1, 1))  # Writing the marker must not make the old fixture newest.
    gate.prune_fixtures()
    assert not old.exists() and len(list(root.iterdir())) == 5


def test_private_load_wait_does_not_hold_lock(tmp_path, monkeypatch):
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    lock = tmp_path / "shared.lock"
    monkeypatch.setenv("GOLEMS_HEAVY_LOCK", str(lock))
    monkeypatch.setenv("GOLEMS_HEAVY_MAX_LOAD", "20")
    readings = iter([21, 20]); waits = []
    def load():
        with lock.open("a+") as probe:
            try: gate.heavy_suite.fcntl.flock(probe, gate.heavy_suite.fcntl.LOCK_EX | gate.heavy_suite.fcntl.LOCK_NB)
            except BlockingIOError: raise AssertionError("private load wait holds lock") from None
            gate.heavy_suite.fcntl.flock(probe, gate.heavy_suite.fcntl.LOCK_UN)
        return (next(readings), 0, 0)
    monkeypatch.setattr(gate.os, "getloadavg", load)
    monkeypatch.setattr(gate.time, "sleep", lambda seconds: waits.append(seconds))
    with gate.slot(): pass
    assert waits == [1]


@parametrize("override,limit", [(None, 28), ("40", 40)])
def test_private_cpu_default_and_load_override_boundary(tmp_path, monkeypatch, override, limit):
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    monkeypatch.setenv("GOLEMS_HEAVY_LOCK", str(tmp_path / "shared.lock"))
    monkeypatch.setattr(gate.os, "cpu_count", lambda: 14)
    if override is None: monkeypatch.delenv("GOLEMS_HEAVY_MAX_LOAD", raising=False)
    else: monkeypatch.setenv("GOLEMS_HEAVY_MAX_LOAD", override)
    monkeypatch.setattr(gate.os, "getloadavg", lambda: (limit, 0, 0))
    def unexpected_sleep(seconds): raise AssertionError("waited at configured load boundary")
    monkeypatch.setattr(gate.time, "sleep", unexpected_sleep)
    with gate.slot(): pass


@parametrize("value", ["nan", "inf", "-1", "invalid"])
def test_private_invalid_load_limit_refuses(tmp_path, monkeypatch, value):
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    monkeypatch.setenv("GOLEMS_HEAVY_LOCK", str(tmp_path / "shared.lock"))
    monkeypatch.setenv("GOLEMS_HEAVY_MAX_LOAD", value)
    monkeypatch.setattr(gate.os, "getloadavg", lambda: (0, 0, 0))
    with pytest.raises(ValueError):
        with gate.slot(): pytest.fail("invalid load threshold ran")


def test_private_gate_uses_same_semaphore_as_wrapper(tmp_path, monkeypatch):
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    monkeypatch.setenv("GOLEMS_HEAVY_LOCK", str(tmp_path / "shared.lock"))
    monkeypatch.setattr(gate.os, "getloadavg", lambda: (0, 0, 0))
    with gate.slot():
        fd, index, legacy_fd = gate.heavy_suite.acquire_slot(.01, 0, 0)
        assert fd is None and index is None and legacy_fd is None, "private gate bypassed the shared semaphore"


def test_private_gate_memory_timeout_refuses(tmp_path, monkeypatch):
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    monkeypatch.setenv("GOLEMS_HEAVY_LOCK", str(tmp_path / "shared.lock"))
    monkeypatch.setenv("GOLEMS_HEAVY_MIN_FREE_GB", "6")
    monkeypatch.setattr(gate.heavy_suite, "free_inactive_bytes", lambda: 0)
    ticks = iter([0, 1801]); monkeypatch.setattr(gate.time, "monotonic", lambda: next(ticks))
    with pytest.raises(ValueError, match="refusing START"):
        with gate.slot(): pytest.fail("low-memory gate executed")


def test_private_slot_descriptors_do_not_survive_child_exec(tmp_path, monkeypatch):
    import subprocess, sys
    monkeypatch.delenv("GOLEMS_HEAVY_SUITE_HELD", raising=False)
    monkeypatch.setenv("GOLEMS_HEAVY_LOCK", str(tmp_path / "shared.lock"))
    monkeypatch.setattr(gate.os, "getloadavg", lambda: (0, 0, 0))
    probe = f"import os; from pathlib import Path; targets=[os.stat(p) for p in Path({str(tmp_path)!r}).glob('shared*.lock')];\nfor fd in os.listdir('/dev/fd'):\n try: st=os.fstat(int(fd))\n except OSError: continue\n assert all((st.st_dev,st.st_ino)!=(t.st_dev,t.st_ino) for t in targets), 'coordination fd inherited'"
    with gate.slot():
        result = subprocess.run([sys.executable, "-c", probe], close_fds=False,
                                capture_output=True, text=True, timeout=5)
        assert result.returncode == 0, result.stderr

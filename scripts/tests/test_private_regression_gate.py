"""Synthetic gate contract tests; private policy specimens stay off public CI."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

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
    ticks = iter([0, 1801])
    monkeypatch.setattr(gate.time, "monotonic", lambda: next(ticks))
    if blocked == "lock":
        def busy(*args):
            raise BlockingIOError("synthetic held slot")
        monkeypatch.setattr(gate.fcntl, "flock", busy)
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
        assert lock.exists()


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

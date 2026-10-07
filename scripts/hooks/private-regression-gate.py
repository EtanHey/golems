#!/usr/bin/env python3
"""Fail-closed, private source regression gate before a hooks-live install."""
import argparse
from contextlib import contextmanager, ExitStack
import importlib.util
import math
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import stat
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET

# Load the adjacent reviewed helper, without searching cwd/PYTHONPATH.
_spec = importlib.util.spec_from_file_location("heavy_suite", Path(__file__).with_name("heavy-suite.py"))
heavy_suite = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(heavy_suite)

GUARD_FILES = (
    "skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py",
    "skills/golem-powers/git-guardian/git_safety.py",
    "skills/golem-powers/_shared/shell_parse.py",
    "scripts/hooks/codex-policy-hook.py",
)
PUBLIC_SUITES = (
    "skills/golem-powers/_shared/tests",
    "skills/golem-powers/tmp-block/tests",
    "skills/golem-powers/tmp-block/hooks/tests",
    "skills/golem-powers/git-guardian/tests",
    "skills/golem-powers/git-guardian/hooks/tests",
    "scripts/tests/test_codex_policy_hook.py",
)


def clean_env():
    return {k: v for k, v in os.environ.items()
            if not k.startswith(("GIT_", "WEAVE_", "S616", "PYTEST_", "GOLEMS_HEAVY_"))
            and k not in {"PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP"}}


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args],
                                   env=clean_env(), text=True, timeout=60).strip()


def verify_files(rows, private_root):
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "sha256"}:
            raise ValueError("invalid private file declaration")
        p = Path(row["path"])
        if (not p.is_absolute() or p in seen or p.resolve() != p
                or not p.is_relative_to(private_root) or not p.is_file()):
            raise ValueError("private file missing, duplicated, symlinked or outside suite root")
        if not isinstance(row["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]):
            raise ValueError("invalid private content hash")
        seen.add(p)
        if hashlib.sha256(p.read_bytes()).hexdigest() != row["sha256"]:
            raise ValueError(f"private file hash mismatch: {p.name}")


def load_manifest(repo, sha, required=False, warn=True):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("selected source must be a full immutable commit SHA")
    root = repo / "docs.local/private-guard-suites"
    try:
        mode = root.lstat().st_mode
    except FileNotFoundError:
        if required:
            raise ValueError("required private suites unavailable")
        if warn:
            print("WARN private regression gate ABSENT — private suites unavailable; continuing with public guard verification", flush=True)
        return None
    if not stat.S_ISDIR(mode) or root.resolve() != root:
        raise ValueError("private suite root must be a real durable directory")
    path = root / "manifest.json"
    if path.resolve() != path or not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("private manifest must be a real file")
    m = json.loads(path.read_text())
    if not isinstance(m, dict) or set(m) != {"version", "expectedCases", "fixtures", "dependencies"}:
        raise ValueError("invalid private manifest type or fields")
    if m["version"] != 2:
        raise ValueError("unsupported private manifest version")
    count = m["expectedCases"]
    if type(count) is not int or count < 96:
        raise ValueError("private gate requires at least the complete 96-case suite")
    if (not isinstance(m["fixtures"], list) or not m["fixtures"]
            or not isinstance(m["dependencies"], list)):
        raise ValueError("private manifest requires a suite list")
    verify_files(m["fixtures"] + m["dependencies"], root)
    return m


def public_suites(tree):
    # Read the selected immutable tree, never infer no guards from a git failure.
    files = set(git(tree, "ls-tree", "-r", "--name-only", "HEAD").splitlines())
    guarded = "scripts/hooks/install-hooks.mjs" in files or any(
        p.startswith(("skills/golem-powers/tmp-block/", "skills/golem-powers/git-guardian/"))
        for p in files)
    if "scripts/hooks/manifest.json" in files:
        manifest = json.loads(git(tree, "show", "HEAD:scripts/hooks/manifest.json"))
        guarded |= any(e.get("id") in ("tmp-block", "git-guardian")
                       for entries in manifest.get("hosts", {}).values() for e in entries)
    if not guarded:
        return []
    if not all(p in files and (tree / p).is_file() and not (tree / p).is_symlink()
               and (tree / p).resolve().is_relative_to(tree) for p in GUARD_FILES):
        raise ValueError("selected source has a missing or renamed guard or adapter")
    for path in PUBLIC_SUITES:
        if not any(p == path or p.startswith(path + "/") and p.endswith(".py") for p in files):
            raise ValueError("selected source omits a public guard suite")
    return [str(tree / path) for path in PUBLIC_SUITES]


def check_result(report, expected=None):
    root = ET.parse(report).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
    cases = [c for s in suites for c in s.findall("testcase")]
    total = sum(int(s.get("tests", "0")) for s in suites)
    # Pytest includes passing subtests in totals without separate testcase rows.
    # Only the manifest-bound private suite requires an exact declared count.
    complete = (total >= len(cases) if expected is None
                else len(cases) == expected and total == expected)
    if (not suites or not cases or not complete
            or any(int(s.get(k, "0")) for s in suites for k in ("failures", "errors", "skipped"))
            or any(c.find(k) is not None for c in cases for k in ("failure", "error", "skipped"))):
        raise ValueError("private regression result is failed, skipped or incomplete")


def completion_plugin(nonce_fd, report, receipt_fd):
    return f"NONCE_FD={nonce_fd}\nREPORT={str(report)!r}\nRECEIPT_FD={receipt_fd}\n" + '''
import hashlib, json, os
from pathlib import Path
from pytest import fixture, hookimpl
NONCE = os.read(NONCE_FD, 64).decode('ascii')
os.close(NONCE_FD)
passed = set()
bad = False
@fixture(autouse=True)
def isolate_policy_ledger(tmp_path, monkeypatch):
    monkeypatch.setenv('TMP_BLOCK_LEDGER', str(tmp_path / 'bypass-ledger.jsonl'))
def pytest_runtest_logreport(report):
    global bad
    if report.failed or report.skipped:
        bad = True
    if report.when == 'call' and report.passed:
        passed.add(report.nodeid)
@hookimpl(hookwrapper=True, tryfirst=True)
def pytest_sessionfinish(session, exitstatus):
    yield
    os.write(RECEIPT_FD, json.dumps({'nonce': NONCE, 'exit': int(exitstatus),
        'collected': len(session.items), 'passed': len(passed), 'bad': bad,
        'xmlSHA256': hashlib.sha256(Path(REPORT).read_bytes()).hexdigest()}).encode())
    os.close(RECEIPT_FD)
'''


def check_completion(report, receipt, nonce):
    try:
        data = json.loads(receipt.read_text())
        root = ET.parse(report).getroot()
        suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
        cases = sum(len(s.findall("testcase")) for s in suites)
        if (not isinstance(data, dict) or data.get("nonce") != nonce
                or data.get("exit") != 0 or data.get("bad") is not False
                or data.get("collected") != cases or data.get("passed") != cases
                or data.get("xmlSHA256") != hashlib.sha256(report.read_bytes()).hexdigest()):
            raise ValueError("invalid trusted completion receipt")
    except (OSError, ValueError, ET.ParseError) as error:
        raise ValueError("trusted completion receipt missing or inconsistent") from error


def record_completion(report, receipt, nonce, payload):
    if not payload:
        raise ValueError("trusted completion receipt missing")
    try:
        fd = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
    except OSError as error:
        raise ValueError("unsafe completion receipt destination") from error
    check_completion(report, receipt, nonce)


def process_start(pid):
    # PID alone is unsafe after reuse. ps works on both installer platforms.
    result = subprocess.run(["ps", "-p", str(pid), "-o", "lstart="],
                            capture_output=True, text=True, timeout=5)
    return result.stdout.strip() if result.returncode == 0 else ""


def active_fixture(path):
    marker = path / ".active"
    if not marker.exists():
        return False
    try:
        data = json.loads(marker.read_text())
        pid, start = data["pid"], data["start"]
        return (type(pid) is int and pid > 0 and bool(start)
                and process_start(pid) == start)
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        return False


def prune_fixtures(keep=5):
    root = Path.home() / "docs.local/golems-guard-fixtures"
    if not root.exists():
        return
    if root.resolve() != root:
        raise ValueError("fixture retention root must not be symlinked")
    completed = [p for p in root.iterdir() if re.fullmatch(r"[0-9a-f]{32}", p.name)
                 and not p.is_symlink() and p.is_dir() and not active_fixture(p)]
    for p in sorted(completed, key=lambda p: p.stat().st_mtime, reverse=True)[keep:]:
        shutil.rmtree(p)


@contextmanager
def slot():
    # The install gate cannot nest inside a full suite that already owns this lock.
    if os.environ.get("GOLEMS_HEAVY_SUITE_HELD"):
        raise ValueError("run installer outside an existing heavy suite")
    max_load = float(os.environ.get("GOLEMS_HEAVY_MAX_LOAD", 2 * (os.cpu_count() or 1)))
    if not math.isfinite(max_load) or max_load < 0:
        raise ValueError("invalid heavy-suite max load")
    floor = float(os.environ.get("GOLEMS_HEAVY_MIN_FREE_GB", "6"))
    if not math.isfinite(floor) or floor < 0:
        raise ValueError("invalid heavy-suite memory floor")
    deadline, fd, legacy_fd = time.monotonic() + 1800, None, None
    try:
        print(f"private regression gate: QUEUED pid={os.getpid()}", flush=True)
        fd, index, legacy_fd = heavy_suite.acquire_slot(1, deadline, floor, max_load, strict_load=True)
        if fd is None:
            raise ValueError("heavy-suite slots timed out; refusing unqueued execution")
        record = {"pid": os.getpid(), "slot": index, "state": "running", "started": time.time(),
                  "executable": "private-regression-gate"}
        heavy_suite.write_record(fd, record)
        print(f"private regression gate: SUITE START pid={os.getpid()} slot={index}", flush=True)
        yield
    finally:
        if fd is not None:
            heavy_suite.write_record(fd, {"pid": os.getpid(), "slot": index, "state": "done"})
            os.close(fd)
            print(f"private regression gate: SUITE DONE pid={os.getpid()} slot={index}", flush=True)

        if legacy_fd is not None:
            os.close(legacy_fd)


def execute_suite(paths, out, tree, name, expected=None, timeout=900):
    env = {**clean_env(), "S616B_SOURCE": str(tree), "S616_R2_SOURCE": str(tree),
           "GOLEMS_GUARD_CANDIDATE": str(tree), "PYTHONDONTWRITEBYTECODE": "1",
           "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1", "TMP_BLOCK_LEDGER": str(out / "ledger.jsonl")}
    # Repository-boundary fixtures must not inherit the invoking checkout's .git.
    # Keep their ephemeral data in a durable docs.local area under fixture HOME.
    fixtures = Path.home() / "docs.local/golems-guard-fixtures" / out.name / name
    fixtures.mkdir(parents=True, mode=0o700)
    if fixtures.resolve() != fixtures:
        raise ValueError("fixture directory must not redirect through a symlink")
    start = process_start(os.getpid())
    if not start:
        raise ValueError("cannot identify fixture owner process")
    (fixtures.parent / ".active").write_text(json.dumps({"pid": os.getpid(), "start": start}))
    env["TMPDIR"] = str(fixtures) + os.sep
    # Restore the reviewed ledger fixture without importing candidate conftests.
    (out / "pytest.ini").write_text("[pytest]\n")
    report = out / (name + ".xml")
    receipt, nonce = out / (name + "-completion.json"), uuid.uuid4().hex
    receipt.unlink(missing_ok=True)
    command = [sys.executable, "-I", "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider",
               "--noconftest", "--import-mode=prepend", "-c", str(out / "pytest.ini"),
               "-o", "pythonpath=" + str(out), "-p", "_golems_gate_isolation",
               "--rootdir", str(out), "--basetemp", str(fixtures / "pytest"),
               "--junitxml", str(report), *paths]
    with ExitStack() as channels:
        nr, nw = os.pipe()
        nonce_source = channels.enter_context(os.fdopen(nr, "rb", buffering=0))
        nonce_sink = channels.enter_context(os.fdopen(nw, "wb", buffering=0))
        rr, rw = os.pipe()
        receipt_source = channels.enter_context(os.fdopen(rr, "rb", buffering=0))
        receipt_sink = channels.enter_context(os.fdopen(rw, "wb", buffering=0))
        nonce_sink.write(nonce.encode()); nonce_sink.close()
        os.set_blocking(rr, False)
        (out / "_golems_gate_isolation.py").write_text(completion_plugin(nr, report, rw))
        with (out / (name + ".log")).open("w") as log:
            child = subprocess.Popen(command, cwd=out, env=env, stdout=log,
                stderr=subprocess.STDOUT, start_new_session=True, pass_fds=(nr, rw))
            nonce_source.close(); receipt_sink.close()
            try:
                result = child.wait(timeout=timeout)
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
        payload = receipt_source.read(8192) or b""
    if result:
        raise ValueError(f"{name} regression suite failed; receipt: {out}")
    check_result(report, expected)
    record_completion(report, receipt, nonce, payload)


def run(repo, sha, required=False):
    manifest = load_manifest(repo, sha, required)
    with slot():
        if load_manifest(repo, sha, required, False) != manifest:
            raise ValueError("private manifest changed while queued")
        run_id = uuid.uuid4().hex
        out = repo / "docs.local/hooks-private-gate-runs" / run_id
        out.mkdir(parents=True, mode=0o700)
        (out / "pytest.ini").write_text("[pytest]\n")
        tree = repo / ".worktrees" / f"hooks-private-gate-{run_id}"
        subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "repogolem/worktree-disk-floor.py"), str(tree)], check=True)
        tree.parent.mkdir(exist_ok=True)
        git(repo, "worktree", "add", "--detach", str(tree), sha)
        try:
            suites = public_suites(tree)
            if manifest is not None:
                if load_manifest(repo, sha, required, False) != manifest:
                    raise ValueError("private manifest changed before private verification")
                adapter = tree / GUARD_FILES[-1]
                if not adapter.is_file() or adapter.is_symlink() or not adapter.resolve().is_relative_to(tree):
                    raise ValueError("selected candidate adapter missing")
                execute_suite([r["path"] for r in manifest["fixtures"]], out, tree,
                              "private", manifest["expectedCases"], timeout=300)
                verify_files(manifest["fixtures"] + manifest["dependencies"],
                             repo / "docs.local/private-guard-suites")
            if suites:
                execute_suite(suites, out, tree, "public")
            if load_manifest(repo, sha, required, False) != manifest:
                raise ValueError("private manifest changed during the gate")
            if git(tree, "rev-parse", "HEAD") != sha or git(tree, "status", "--porcelain"):
                raise ValueError("selected source changed during regression gate")
            count = manifest["expectedCases"] if manifest else 0
            (out / "candidate.json").write_text(json.dumps({"candidateRevision": sha,
                "sourceHashes": {p: hashlib.sha256((tree / p).read_bytes()).hexdigest()
                                 for p in GUARD_FILES if (tree / p).is_file()},
                "privateCases": count, "publicSuites": suites}, indent=2) + "\n")
            outcome = f"PASS {count} private cases" if manifest else "PASS (private ABSENT)"
            print(f"private regression gate: {outcome}; receipt: {out}")
        finally:
            try:
                git(repo, "worktree", "remove", "--force", str(tree))
            finally:
                fixtures = Path.home() / "docs.local/golems-guard-fixtures" / run_id
                (fixtures / ".active").unlink(missing_ok=True)
                prune_fixtures()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("repo", type=Path)
    p.add_argument("sha")
    p.add_argument("--require-private", action="store_true")
    args = p.parse_args()
    def interrupted(signum, frame):
        raise ValueError("regression gate interrupted; refusing installation")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        run(args.repo.resolve(), args.sha, args.require_private)
        return 0
    except (OSError, ValueError, KeyError, TypeError, ET.ParseError,
            subprocess.SubprocessError) as error:
        print(f"private regression gate: REFUSED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

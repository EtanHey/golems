#!/usr/bin/env python3
"""Fail-closed, private source regression gate before a hooks-live install."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET

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


def load_manifest(repo, sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("selected source must be a full immutable commit SHA")
    root = repo / "docs.local/private-guard-suites"
    try:
        mode = root.lstat().st_mode
    except FileNotFoundError:
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


@contextmanager
def slot():
    # The install gate cannot nest inside a full suite that already owns this lock.
    if os.environ.get("GOLEMS_HEAVY_SUITE_HELD"):
        raise ValueError("run installer outside an existing heavy suite")
    lock = Path(os.environ.get("GOLEMS_HEAVY_LOCK") or Path.home() / ".local/state/golems/heavy-suite.lock")
    lock.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    deadline, held = time.monotonic() + 1800, False
    try:
        print(f"private regression gate: QUEUED pid={os.getpid()}", flush=True)
        while not held:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                held = True
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise ValueError("heavy-suite lock timed out; refusing unqueued execution")
                time.sleep(1)
        while os.getloadavg()[0] > 20:
            if time.monotonic() >= deadline:
                raise ValueError("load gate timed out; refusing execution")
            time.sleep(1)
        record = {"pid": os.getpid(), "state": "running", "started": time.time(),
                  "executable": "private-regression-gate"}
        os.ftruncate(fd, 0)
        os.write(fd, (json.dumps(record) + "\n").encode())
        print(f"private regression gate: SUITE START pid={os.getpid()}", flush=True)
        yield
    finally:
        if held:
            os.lseek(fd, 0, os.SEEK_SET)
            os.ftruncate(fd, 0)
            os.write(fd, (json.dumps({"pid": os.getpid(), "state": "done"}) + "\n").encode())
            fcntl.flock(fd, fcntl.LOCK_UN)
            print(f"private regression gate: SUITE DONE pid={os.getpid()}", flush=True)
        os.close(fd)


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
    env["TMPDIR"] = str(fixtures) + os.sep
    # Restore the reviewed ledger fixture without importing candidate conftests.
    (out / "pytest.ini").write_text("[pytest]\n")
    (out / "_golems_gate_isolation.py").write_text(
        "from pytest import fixture\n@fixture(autouse=True)\n"
        "def isolate_policy_ledger(tmp_path, monkeypatch):\n"
        "    monkeypatch.setenv('TMP_BLOCK_LEDGER', str(tmp_path / 'bypass-ledger.jsonl'))\n")
    report = out / (name + ".xml")
    command = [sys.executable, "-I", "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider",
               "--noconftest", "--import-mode=prepend", "-c", str(out / "pytest.ini"),
               "-o", "pythonpath=" + str(out), "-p", "_golems_gate_isolation",
               "--rootdir", str(out), "--basetemp", str(fixtures / "pytest"),
               "--junitxml", str(report), *paths]
    with (out / (name + ".log")).open("w") as log:
        child = subprocess.Popen(command, cwd=out, env=env, stdout=log,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        try:
            result = child.wait(timeout=timeout)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
    if result:
        raise ValueError(f"{name} regression suite failed; receipt: {out}")
    check_result(report, expected)


def run(repo, sha):
    manifest = load_manifest(repo, sha)
    with slot():
        if load_manifest(repo, sha) != manifest:
            raise ValueError("private manifest changed while queued")
        run_id = uuid.uuid4().hex
        out = repo / "docs.local/hooks-private-gate-runs" / run_id
        out.mkdir(parents=True, mode=0o700)
        (out / "pytest.ini").write_text("[pytest]\n")
        tree = repo / ".worktrees" / f"hooks-private-gate-{run_id}"
        tree.parent.mkdir(exist_ok=True)
        git(repo, "worktree", "add", "--detach", str(tree), sha)
        try:
            suites = public_suites(tree)
            if manifest is not None:
                if load_manifest(repo, sha) != manifest:
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
            if load_manifest(repo, sha) != manifest:
                raise ValueError("private manifest changed during the gate")
            if git(tree, "rev-parse", "HEAD") != sha or git(tree, "status", "--porcelain"):
                raise ValueError("selected source changed during regression gate")
            count = manifest["expectedCases"] if manifest else 0
            (out / "candidate.json").write_text(json.dumps({"candidateRevision": sha,
                "sourceHashes": {p: hashlib.sha256((tree / p).read_bytes()).hexdigest()
                                 for p in GUARD_FILES if (tree / p).is_file()},
                "privateCases": count, "publicSuites": suites}, indent=2) + "\n")
            print(f"private regression gate: PASS {count} private cases; receipt: {out}")
        finally:
            git(repo, "worktree", "remove", "--force", str(tree))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("repo", type=Path)
    p.add_argument("sha")
    args = p.parse_args()
    def interrupted(signum, frame):
        raise ValueError("regression gate interrupted; refusing installation")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        run(args.repo.resolve(), args.sha)
        return 0
    except (OSError, ValueError, KeyError, TypeError, ET.ParseError,
            subprocess.SubprocessError) as error:
        print(f"private regression gate: REFUSED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

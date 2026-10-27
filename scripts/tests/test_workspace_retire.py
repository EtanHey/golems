"""Terminal receipts against real Git fixtures and bounded failure shims."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "workspace/retire.py"
REAL_GIT = shutil.which("git")


def git(repo, *args):
    return subprocess.check_output([REAL_GIT, "-C", str(repo), *args], text=True).strip()


@pytest.fixture
def tree(tmp_path, monkeypatch):
    # Resolve pytest's platform-specific temp root before testing symlink guards.
    root = tmp_path.resolve()
    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    repo = root / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.name", "Fixture")
    git(repo, "config", "user.email", "fixture@example.com")
    (repo / "tracked").write_text("original\n")
    (repo / ".gitignore").write_text("ignored\n")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "fixture")
    target = root / "work tree"
    git(repo, "worktree", "add", "-qb", "retire-me", str(target))
    return repo, target, root / "receipt.json"


def command(tree, *extra):
    repo, target, receipt = tree
    return [sys.executable, str(SCRIPT), "--repo", str(repo), "--path", str(target),
            "--receipt-out", str(receipt), *map(str, extra)]


def run(tree, *extra):
    result = subprocess.run(command(tree, *extra), capture_output=True, text=True)
    assert result.stdout.strip(), result.stderr
    receipt = json.loads(result.stdout)
    assert json.loads(tree[2].read_text()) == receipt
    assert receipt["schema"] == "workspace-lifecycle/receipt/v1"
    assert receipt["branch_retained"] is True
    assert receipt["observed_at"].endswith("Z")
    return result, receipt


def shim(tree, monkeypatch, mode):
    root = tree[2].parent
    bin_dir = root / "bin"
    bin_dir.mkdir()
    log = root / "git-calls.jsonl"
    wrapper = bin_dir / "git"
    wrapper.write_text(f"#!{sys.executable}\n" + '''import json, os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
log = Path(os.environ["RETIRE_CALLS"])
with log.open("a") as out: out.write(json.dumps(args) + "\\n")
mode = os.environ["RETIRE_MODE"]
remove = "worktree" in args and "remove" in args
listing = "worktree" in args and "list" in args
calls = [json.loads(line) for line in log.read_text().splitlines()]
if "status" in args and mode == "status-fail":
    sys.stderr.write("status evidence unavailable\\n"); sys.exit(9)
if "ls-files" in args and mode == "index-fail":
    sys.stderr.write("index evidence unavailable\\n"); sys.exit(9)
if listing and (mode == "list-before" or mode == "list-after" and
                sum("list" in row for row in calls) > 1):
    sys.stderr.write("list evidence unavailable\\n"); sys.exit(9)
if remove and mode in ("refuse", "crlf"):
    sys.stderr.buffer.write(b"fatal: Directory not empty" +
                            (b"\\r\\n" if mode == "crlf" else b"\\n")); sys.exit(7)
rc = subprocess.call([os.environ["RETIRE_REAL_GIT"], *args])
if (("status" in args and mode in ("ignored-race", "tracked-race") and sum("status" in row for row in calls) == 1)
        or ("ls-files" in args and mode == "index-race" and sum("ls-files" in row for row in calls) == 1)):
    target = Path(args[args.index("-C") + 1])
    if mode == "index-race":
        subprocess.check_call([os.environ["RETIRE_REAL_GIT"], "-C", str(target),
                               "update-index", "--assume-unchanged", "tracked"])
    else:
        (target / ("ignored" if mode == "ignored-race" else "tracked")).write_text("racing data\\n")
if remove and mode == "removed-but-error":
    sys.stderr.write("remove completed but reported failure\\n"); rc = 7
if remove and mode.startswith("residual"):
    Path(args[-1]).mkdir()
    if mode == "residual-fail":
        sys.stderr.write("fatal: Directory not empty\\n"); rc = 7
sys.exit(rc)
''')
    wrapper.chmod(0o755)
    monkeypatch.setenv("PATH", str(bin_dir) + os.pathsep + os.environ["PATH"])
    monkeypatch.setenv("RETIRE_CALLS", str(log))
    monkeypatch.setenv("RETIRE_MODE", mode)
    monkeypatch.setenv("RETIRE_REAL_GIT", REAL_GIT)
    return log


def test_happy_path_keeps_branch(tree):
    repo, target, _ = tree
    head = git(repo, "rev-parse", "HEAD")
    result, receipt = run(tree, "--expect-branch", "retire-me", "--expect-head", head)
    assert result.returncode == 0
    assert receipt["disposition"] == "REMOVED"
    assert receipt["registered_after"] is False and receipt["physical_after"] is False
    assert receipt["remove_rc"] == 0 and receipt["remove_stderr"] == ""
    assert receipt["branch"] == "retire-me" and receipt["head"] == head
    assert receipt["repo"] == str(repo / ".git") and receipt["path"] == str(target)
    assert git(repo, "rev-parse", "refs/heads/retire-me") == head


def test_dirty_tracked_content_is_retained_by_git(tree):
    _, target, _ = tree
    (target / "tracked").write_text("preserve me\n")
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert receipt["remove_rc"] != 0 and receipt["remove_stderr"]
    assert receipt["registered_after"] is True and receipt["physical_after"] is True
    assert (target / "tracked").read_text() == "preserve me\n"


@pytest.mark.parametrize("content,count", [("ignored", 1), ("untracked", 1),
                                          ("ignored", 25), ("untracked", 25)])
def test_local_files_retained_before_remove(tree, monkeypatch, content, count):
    repo, target, _ = tree
    paths = [f"{content}-{i:02d}\nfile" for i in range(count)]
    if content == "ignored":
        (target / ".gitignore").write_text("ignored*\n")
        git(target, "add", ".gitignore")
        git(target, "commit", "-qm", "ignore fixture files")
    for name in paths:
        (target / name).write_text("preserve me\n")
    log = shim(tree, monkeypatch, "pass")
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert receipt["reason"] == f"local files present (ignored/untracked): {count}"
    assert receipt["local_files_count"] == count
    assert len(receipt["local_files"]) == min(count, 20)
    assert set(receipt["local_files"]) <= set(paths)
    assert receipt["remove_rc"] is None
    assert receipt["registered_after"] is True and receipt["physical_after"] is True
    assert all((target / name).read_text() == "preserve me\n" for name in paths)
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    assert any("status" in row and str(target) in row for row in calls)
    assert not any("remove" in row for row in calls)


def test_status_read_failure_retained_before_remove(tree, monkeypatch):
    log = shim(tree, monkeypatch, "status-fail")
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert "evidence incomplete" in receipt["reason"]
    assert "status evidence unavailable" in receipt["reason"]
    assert receipt["remove_rc"] is None
    assert receipt["registered_after"] is True and receipt["physical_after"] is True
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    assert not any("remove" in row for row in calls)


@pytest.mark.parametrize("mode", ["residual-fail", "residual-success"])
def test_registration_absence_cannot_hide_remaining_directory(tree, monkeypatch, mode):
    shim(tree, monkeypatch, mode)
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert receipt["registered_after"] is False and receipt["physical_after"] is True
    assert receipt["remove_rc"] == (7 if mode == "residual-fail" else 0)
    if mode == "residual-fail":
        assert receipt["remove_stderr"] == "fatal: Directory not empty\n"


def test_later_shell_success_does_not_mask_terminal_receipt(tree, monkeypatch):
    shim(tree, monkeypatch, "refuse")
    own, receipt = run(tree)
    assert own.returncode != 0 and receipt["disposition"] == "RETAINED"
    tree[2].unlink()
    chain = subprocess.run(shlex.join(command(tree)) + "; true", shell=True,
                           capture_output=True, text=True)
    assert chain.returncode == 0
    receipt = json.loads(tree[2].read_text())
    assert receipt["disposition"] == "RETAINED" and receipt["remove_rc"] == 7
    assert receipt["remove_stderr"] == "fatal: Directory not empty\n"


def test_remove_stderr_is_verbatim(tree, monkeypatch):
    shim(tree, monkeypatch, "crlf")
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert receipt["remove_stderr"] == "fatal: Directory not empty\r\n"


@pytest.mark.parametrize("refusal", ["main", "symlink", "parent-symlink", "branch", "head",
                                     "unregistered", "other-repo", "receipt-inside"])
def test_identity_refused_before_remove(tree, monkeypatch, refusal):
    repo, target, receipt_path = tree
    extra = []
    if refusal == "main":
        target = repo
    elif refusal in ("symlink", "parent-symlink"):
        alias = target.with_name("alias")
        alias.symlink_to(target if refusal == "symlink" else target.parent,
                         target_is_directory=True)
        target = alias if refusal == "symlink" else alias / target.name
    elif refusal == "branch":
        extra = ["--expect-branch", "wrong"]
    elif refusal == "head":
        extra = ["--expect-head", "0" * 40]
    elif refusal == "unregistered":
        target = target.with_name("unregistered")
        target.mkdir()
    elif refusal == "other-repo":
        repo = target.with_name("other-repo")
        repo.mkdir()
        git(repo, "init", "-q")
    elif refusal == "receipt-inside":
        extra = ["--receipt-out", str(target / "receipt.json")]
    log = shim(tree, monkeypatch, "pass")
    result = subprocess.run(command((repo, target, receipt_path), *extra),
                            capture_output=True, text=True)
    receipt = json.loads(result.stdout)
    assert result.returncode == 2 and receipt["disposition"] == "RETAINED"
    assert receipt["reason"] and receipt["remove_rc"] is None
    calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    assert not any("remove" in row for row in calls)
    assert tree[1].is_dir()


@pytest.mark.parametrize("mode", ["list-before", "list-after"])
def test_missing_list_evidence_is_retained(tree, monkeypatch, mode):
    shim(tree, monkeypatch, mode)
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert receipt["registered_after"] is None
    assert "list evidence unavailable" in receipt["reason"]
    assert receipt["physical_after"] is (mode == "list-before")


def test_canonical_common_dir_is_accepted(tree):
    result, receipt = run(tree, "--repo", str(tree[0] / ".git"))
    assert result.returncode == 0 and receipt["disposition"] == "REMOVED"


def test_newline_path_is_observed_without_porcelain_quoting(tree):
    repo, target, receipt_path = tree
    renamed = target.with_name("quoted\nworktree")
    git(repo, "worktree", "move", str(target), str(renamed))
    result, receipt = run((repo, renamed, receipt_path))
    assert result.returncode == 0 and receipt["path"] == str(renamed)


@pytest.mark.parametrize("flag,count", [("assume-unchanged", 1), ("skip-worktree", 1),
                                       ("both", 1), ("assume-unchanged", 25)])
def test_hidden_index_changes_are_retained(tree, monkeypatch, flag, count):
    _, target, _ = tree
    names = [f"hidden-{i:02d}\nfile" for i in range(count)]
    for name in names:
        (target / name).write_text("original\n")
    git(target, "add", ".")
    git(target, "commit", "-qm", "hidden fixture")
    flags = ["assume-unchanged", "skip-worktree"] if flag == "both" else [flag]
    for value in flags:
        git(target, "update-index", "--" + value, "--", *names)
    for name in names:
        (target / name).write_text("valuable hidden changes\n")
    assert git(target, "status", "--porcelain=v1") == ""
    log = shim(tree, monkeypatch, "pass")
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert receipt["reason"] == f"index flags hide tracked changes: {count}"
    assert len(receipt["index_flag_paths"]) == min(count, 20)
    assert set(receipt["index_flag_paths"]) <= set(names)
    assert all((target / name).read_text() == "valuable hidden changes\n" for name in names)
    assert not any("remove" in json.loads(row) for row in log.read_text().splitlines())


def test_failed_index_read_is_retained(tree, monkeypatch):
    log = shim(tree, monkeypatch, "index-fail")
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert "index evidence unavailable" in receipt["reason"]
    assert receipt["remove_rc"] is None
    assert not any("remove" in json.loads(row) for row in log.read_text().splitlines())


def test_child_cwd_is_retained(tree, monkeypatch):
    log = shim(tree, monkeypatch, "pass")
    child = subprocess.Popen([sys.executable, "-c", "import sys; print('ready', flush=True); sys.stdin.read()"],
                             cwd=tree[1], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline().strip() == "ready"
        result, receipt = run(tree)
        assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
        assert receipt["reason"].startswith("open handles: ")
        assert str(child.pid) in receipt["reason"]
        assert tree[1].is_dir() and receipt["remove_rc"] is None
        assert not any("remove" in json.loads(row) for row in log.read_text().splitlines())
    finally:
        child.communicate("", timeout=5)


@pytest.mark.parametrize("mode", ["failure", "malformed", "missing", "timeout"])
def test_lsof_incomplete_evidence_retains(tree, monkeypatch, mode):
    log = shim(tree, monkeypatch, "pass")
    executable = log.parent / "bin/lsof"
    if mode != "missing":
        body = {"failure": "import sys; sys.stderr.write('scan failed'); sys.exit(2)",
                "malformed": "print('unparseable output')",
                "timeout": "import time; time.sleep(30)"}[mode]
        executable.write_text(f"#!{sys.executable}\n" + body + "\n")
        executable.chmod(0o755)
    else:
        monkeypatch.setenv("PATH", str(executable.parent))
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert "evidence incomplete" in receipt["reason"]
    assert tree[1].is_dir() and receipt["remove_rc"] is None
    assert not any("remove" in json.loads(row) for row in log.read_text().splitlines())


@pytest.mark.parametrize("mode", ["ignored-race", "index-race", "tracked-race"])
def test_changed_inventory_between_checks_retains(tree, monkeypatch, mode):
    log = shim(tree, monkeypatch, mode)
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert tree[1].is_dir() and receipt["remove_rc"] is None
    calls = [json.loads(row) for row in log.read_text().splitlines()]
    assert sum("status" in row for row in calls) >= 2
    assert not any("remove" in row for row in calls)


def test_nonzero_remove_even_with_both_absence_proofs_is_retained(tree, monkeypatch):
    shim(tree, monkeypatch, "removed-but-error")
    result, receipt = run(tree)
    assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
    assert receipt["registered_after"] is False and receipt["physical_after"] is False
    assert receipt["remove_rc"] == 7
    assert receipt["remove_stderr"] == "remove completed but reported failure\n"

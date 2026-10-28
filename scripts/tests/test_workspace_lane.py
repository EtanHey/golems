"""W4a caller sequence against real Git worktrees and a durable test ledger."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace

import pytest

from test_workspace_retire import git, load_retire, tree as worktree_fixture
from test_workspace_regenerable_walk import at_move, bare_repository, nested

tree = worktree_fixture


CLI = Path(__file__).resolve().parents[1] / "workspace/lane.py"
LEASE = CLI.with_name("lease.py")
W2B_AVAILABLE = "begin-close" in subprocess.check_output(
    [sys.executable, str(LEASE), "--help"], text=True)
requires_w2b = pytest.mark.skipif(not W2B_AVAILABLE,
    reason="PENDING W2b on master: begin-close / close-token / abort-close integration")


@pytest.fixture
def lane(tree, monkeypatch):
    repo = tree[0]
    (repo / ".gitignore").write_text(".worktrees/\nnode_modules/\n__pycache__/\ndocs.local/\n")
    git(repo, "add", ".gitignore")
    git(repo, "commit", "-qm", "fixture ignores")
    common = Path(git(CLI.parents[2], "rev-parse", "--path-format=absolute", "--git-common-dir"))
    scratch = common.parent / "docs.local"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workspace-lane-test-", dir=scratch) as directory:
        root = Path(directory).resolve()
        monkeypatch.setenv("GOLEMS_WORKSPACE_LEASES", str(root / "ledger"))

        class Lane:
            archive = root / "archive"
            ledger = root / "ledger"

            def run(self, *args, ok=True, script=CLI):
                result = subprocess.run([sys.executable, str(script), *map(str, args)],
                                        capture_output=True, text=True)
                assert (result.returncode == 0) is ok, result.stdout + result.stderr
                return result

            def open(self, *args, ok=True):
                return self.run("open", "--repo", repo, "--name", "sample",
                                "--owner", "parent-task", *args, ok=ok)

            def close(self, opened, *args, ok=True):
                return self.run("close", "--lease-id", opened["lease_id"],
                                "--archive-root", self.archive, *args, ok=ok)

            def record(self, opened):
                return json.loads((self.ledger / (opened["lease_id"] + ".json")).read_text())

        yield Lane()


@pytest.mark.parametrize("detached", [False, True])
@requires_w2b
def test_open_close_caches_keeps_branch(lane, tree, detached):
    opened = json.loads(lane.open(*(["--detach"] if detached else ["--branch", "task/sample"])).stdout)
    path = Path(opened["path"])
    assert path == tree[0] / ".worktrees/sample"
    assert opened["head"] == git(path, "rev-parse", "HEAD")
    for name in ("node_modules/pkg/file", "pkg/__pycache__/module.pyc"):
        file = path / name
        file.parent.mkdir(parents=True)
        file.write_bytes(b"cache")
    summary = json.loads(lane.close(opened).stdout)
    assert summary["disposition"] == "REMOVED" and not path.exists()
    assert lane.record(opened)["state"] == "closed"
    assert lane.record(opened)["disposition"] == "REMOVED"
    if not detached:
        assert git(tree[0], "rev-parse", "task/sample") == opened["head"]
    receipt = json.loads(Path(summary["receipt"]).read_text())
    assert receipt["remove_rc"] == 0 and receipt["branch_retained"] is True


@requires_w2b
def test_ignored_report_archived_and_manifest_verified(lane):
    opened = json.loads(lane.open().stdout)
    report = Path(opened["path"]) / "docs.local/report.md"
    report.parent.mkdir()
    report.write_bytes(b"valuable evidence\x00\n")
    summary = json.loads(lane.close(opened).stdout)
    manifest = json.loads(Path(summary["archive_manifest"]).read_text())
    entry, = manifest["entries"]
    assert entry["path"] == "docs.local/report.md"
    assert entry["sha256"] == hashlib.sha256(b"valuable evidence\x00\n").hexdigest()
    assert entry["size"] == len(b"valuable evidence\x00\n")
    assert (Path(manifest["archive_root"]) / entry["archived_to"]).read_bytes() == b"valuable evidence\x00\n"
    receipt = json.loads(Path(summary["receipt"]).read_text())
    assert receipt["archive_verified_count"] == 1


@pytest.mark.parametrize("name", ["untracked.txt", "tracked"])
@requires_w2b
def test_uncommitted_work_retained_without_archive(lane, name):
    opened = json.loads(lane.open().stdout)
    path = Path(opened["path"])
    (path / name).write_text("uncommitted work\n")
    (path / "docs.local").mkdir()
    (path / "docs.local/report").write_text("ignored work\n")
    summary = json.loads(lane.close(opened, ok=False).stdout)
    assert summary["disposition"] == "RETAINED"
    assert (path / name).read_text() == "uncommitted work\n"
    assert lane.record(opened)["state"] == "bound"
    assert not lane.record(opened).get("close_token")
    lane.run("consumer", "add", "--lease-id", opened["lease_id"], "--who", "retry-reviewer", script=LEASE)
    assert not lane.archive.exists()


@requires_w2b
def test_consumer_refuses_close_without_touching_contents(lane):
    opened = json.loads(lane.open().stdout)
    lane.run("consumer", "add", "--lease-id", opened["lease_id"], "--who", "reviewer", script=LEASE)
    result = lane.close(opened, ok=False)
    assert "outstanding consumers" in result.stderr
    assert Path(opened["path"]).is_dir() and not lane.archive.exists()
    assert lane.record(opened)["state"] == "bound"


def test_reserve_failure_creates_nothing(lane, tree):
    lane.ledger.mkdir(mode=0o500)
    try:
        assert "not writable" in lane.open(ok=False).stderr
        assert not (tree[0] / ".worktrees").exists()
        assert not list(lane.ledger.glob("*.json"))
    finally:
        lane.ledger.chmod(0o700)


def test_add_failure_keeps_reservation_in_audit(lane, tree):
    target = tree[0] / ".worktrees/sample"
    target.mkdir(parents=True)
    (target / "existing").write_text("keep\n")
    result = lane.open(ok=False)
    records = json.loads(lane.run("audit", "--json", script=LEASE).stdout)
    record, = records
    assert record["state"] == "reserved" and record["lease_id"] in result.stderr
    assert (target / "existing").read_text() == "keep\n"


def test_t3_managed_path_refused(lane, tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    target = tmp_path / ".t3/worktrees/repo/managed"
    target.mkdir(parents=True)
    lane.run("reserve", "--lease-id", "managed", "--allocator", "direct-git", "--owner", "parent",
             "--repo", target, "--kind", "worktree", "--ownership", "created", script=LEASE)
    lane.run("bind", "--lease-id", "managed", "--path", target, "--head", "abc", script=LEASE)
    before = lane.record({"lease_id": "managed"})
    result = lane.close({"lease_id": "managed"}, ok=False)
    assert "settle" in result.stderr and "T3" in result.stderr
    assert target.is_dir() and not lane.archive.exists()
    assert lane.record({"lease_id": "managed"}) == before
    alias = tmp_path / "managed-alias"
    alias.symlink_to(target, target_is_directory=True)
    before["path"] = str(alias)
    (lane.ledger / "managed.json").write_text(json.dumps(before))
    assert "T3" in lane.close({"lease_id": "managed"}, ok=False).stderr
    assert lane.record({"lease_id": "managed"}) == before and target.is_dir()


@pytest.mark.parametrize("location", ["inside", "tmp", "alias"])
def test_unsafe_archive_root_refused(lane, location):
    opened = json.loads(lane.open().stdout)
    target = Path(opened["path"])
    root = target / "archive" if location == "inside" else Path("/tmp")
    if location == "alias":
        root = lane.archive.parent / "alias"
        root.symlink_to("/tmp", target_is_directory=True)
    result = lane.close(opened, "--archive-root", root, ok=False)
    assert "archive" in result.stderr
    assert target.is_dir() and lane.record(opened)["state"] == "bound"


@requires_w2b
def test_default_archive_root_uses_main_checkout(lane):
    repo = lane.archive.parent / "persistent-repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.name", "Fixture")
    git(repo, "config", "user.email", "fixture@example.com")
    (repo / ".gitignore").write_text(".worktrees/\ndocs.local/\n")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "fixture")
    opened = json.loads(lane.open("--repo", repo).stdout)
    summary = json.loads(lane.run("close", "--lease-id", opened["lease_id"]).stdout)
    assert Path(summary["receipt"]).is_relative_to(repo / "docs.local/worktree-archive")


@pytest.mark.parametrize("marker", ["directory", "gitfile", "bare"])
@requires_w2b
def test_ignored_nested_repository_never_archived(lane, tree, marker):
    opened = json.loads(lane.open().stdout)
    root = Path(opened["path"]) / "docs.local"
    if marker == "bare":
        head = bare_repository(root, tree[0])
    else:
        head = nested(root, lane.archive.parent / "separate.git", marker)
    summary = json.loads(lane.close(opened, ok=False).stdout)
    assert summary["disposition"] == "RETAINED" and "nested repository" in summary["reason"]
    assert git(root / "src/somepkg", "rev-parse", "HEAD") == head
    assert lane.record(opened)["state"] == "bound" and not lane.record(opened).get("close_token")
    assert not lane.archive.exists(), "nested repository must be detected before any archive copy"


@pytest.mark.parametrize("violation", ["outside", "allocator"])
def test_close_requires_direct_git_repo_worktree_boundary(lane, tree, violation):
    opened = json.loads(lane.open().stdout)
    target = Path(opened["path"])
    outside = tree[0].parent / "outside-lane"
    git(tree[0], "worktree", "move", str(target), str(outside))
    target.symlink_to(outside, target_is_directory=True)
    before = lane.record(opened)
    assert "symlink" in lane.close(opened, ok=False).stderr
    assert lane.record(opened) == before and not lane.archive.exists()
    target.unlink()
    if violation == "allocator":
        git(tree[0], "worktree", "move", str(outside), str(target))
    else:
        target = outside
    record_path = lane.ledger / (opened["lease_id"] + ".json")
    record = lane.record(opened)
    record["path"] = str(target)
    record["allocator"] = "cmux" if violation == "allocator" else "direct-git"
    record_path.write_text(json.dumps(record))
    result = lane.close(opened, ok=False)
    assert "direct-git" in result.stderr or ".worktrees" in result.stderr
    assert lane.record(opened) == record and target.is_dir() and not lane.archive.exists()


def crash_close(lane, opened, point):
    script = '''import os, sys
sys.path.insert(0, sys.argv.pop(1))
import lane
point = sys.argv.pop(1)
if point == "archive":
    original = lane.archive_files
    def crash(*args, **kwargs):
        original(*args, **kwargs)
        os._exit(77)
    lane.archive_files = crash
elif point == "retire":
    original = lane.subprocess.run
    def crash(*args, **kwargs):
        result = original(*args, **kwargs)
        if str(lane.Path(lane.retire.__file__)) in args[0]:
            os._exit(77)
        return result
    lane.subprocess.run = crash
else:
    original = lane.lease_command
    def crash(*args):
        result = original(*args)
        if args[0] == "close":
            os._exit(77)
        return result
    lane.lease_command = crash
sys.exit(lane.main())
'''
    result = subprocess.run([sys.executable, "-c", script, str(CLI.parent), point,
                             "close", "--lease-id", opened["lease_id"],
                             "--archive-root", str(lane.archive)], capture_output=True, text=True)
    assert result.returncode == 77, result.stdout + result.stderr


@pytest.mark.parametrize("point", ["archive", "retire", "persist"])
@requires_w2b
def test_interrupted_close_resumes_without_rearchiving(lane, point):
    opened = json.loads(lane.open().stdout)
    report = Path(opened["path"]) / "docs.local/report.md"
    report.parent.mkdir()
    report.write_bytes(b"preserve across crash\n")
    crash_close(lane, opened, point)
    destination = lane.archive / opened["lease_id"]
    manifest_path = destination / "manifest.json"
    before = manifest_path.read_bytes()
    entry, = json.loads(before)["entries"]
    archived = Path(entry["archived_to"])
    identity = archived.stat().st_ino
    summary = json.loads(lane.close(opened).stdout)
    assert summary["disposition"] == "REMOVED" and not report.parent.exists()
    assert manifest_path.read_bytes() == before and archived.stat().st_ino == identity
    assert archived.read_bytes() == b"preserve across crash\n"
    assert lane.record(opened)["disposition"] == "REMOVED"
    assert json.loads(lane.close(opened).stdout) == summary
    assert json.loads((destination / "close-state.json").read_text())["stage"] == "closed"


@requires_w2b
def test_interrupted_close_rejects_tampered_archive(lane):
    opened = json.loads(lane.open().stdout)
    report = Path(opened["path"]) / "docs.local/report.md"
    report.parent.mkdir()
    report.write_text("original evidence\n")
    crash_close(lane, opened, "archive")
    destination = lane.archive / opened["lease_id"]
    manifest = (destination / "manifest.json").read_bytes()
    entry, = json.loads(manifest)["entries"]
    archived = Path(entry["archived_to"])
    archived.write_text("tampered\n")
    summary = json.loads(lane.close(opened, ok=False).stdout)
    assert summary["disposition"] == "RETAINED" and "hash/size mismatch" in summary["reason"]
    assert report.read_text() == "original evidence\n" and archived.read_text() == "tampered\n"
    assert (destination / "manifest.json").read_bytes() == manifest


@pytest.mark.parametrize("phase", ["before", "after"])
def test_manifest_covered_subtrees_checked_at_retirement(lane, tree, monkeypatch, phase):
    opened = json.loads(lane.open().stdout)
    path = Path(opened["path"])
    content = path / "docs.local"
    content.mkdir()
    (content / "report").write_text("preserved\n")
    if phase == "before":
        nested(content, lane.archive.parent / "unused.git", "directory")
    lane.archive.mkdir()
    entries = []
    for source in content.rglob("*"):
        if source.is_file():
            relative = source.relative_to(path)
            archived = lane.archive / relative
            archived.parent.mkdir(parents=True, exist_ok=True)
            data = source.read_bytes()
            archived.write_bytes(data)
            entries.append(dict(path=relative.as_posix(), archived_to=str(archived),
                                size=len(data), sha256=hashlib.sha256(data).hexdigest()))
    manifest = lane.archive / "manifest.json"
    manifest.write_text(json.dumps(dict(archive_root=str(lane.archive), entries=entries)))
    module = load_retire()
    if phase == "after":
        at_move(module, (tree[0], path, None), monkeypatch,
                lambda moved: (moved / "docs.local/nested/.git").mkdir(parents=True))
    receipt, code = module.retire(SimpleNamespace(repo=str(tree[0]), path=str(path),
        expect_head=opened["head"], expect_branch=None, receipt_out=None, archive_manifest=str(manifest)))
    assert code != 0 and receipt["disposition"] == "RETAINED"
    assert "nested repository" in receipt["reason"] and path.is_dir()
    assert receipt["ignored_walks"][-1]["phase"] == ("after_move" if phase == "after" else "before_move")


@pytest.mark.skipif(W2B_AVAILABLE, reason="only exercises absence of the W2b dependency")
def test_missing_w2b_refuses_before_archive_or_retire(lane):
    opened = json.loads(lane.open().stdout)
    before = lane.record(opened)
    result = lane.close(opened, ok=False)
    assert "W2b" in result.stderr and Path(opened["path"]).is_dir()
    assert lane.record(opened) == before and not lane.archive.exists()


@requires_w2b
def test_consumer_interleaving_is_refused_before_retire(lane):
    opened = json.loads(lane.open().stdout)
    script = '''import subprocess, sys
sys.path.insert(0, sys.argv.pop(1))
import lane
original = lane.archive_files
def interleave(path, entries, destination, record):
    assert record["state"] == "closing"
    result = subprocess.run([sys.executable, str(lane.Path(lane.lease.__file__)),
        "consumer", "add", "--lease-id", record["lease_id"], "--who", "late-reviewer"],
        capture_output=True, text=True, timeout=5)
    assert result.returncode != 0 and "lease is closing" in result.stderr, result.stderr
    assert lane.lease.read_json(lane.lease.lease_file(lane.lease.ledger_directory(),
        record["lease_id"]))["consumers"] == []
    return original(path, entries, destination, record)
lane.archive_files = interleave
sys.exit(lane.main())
'''
    result = subprocess.run([sys.executable, "-c", script, str(CLI.parent), "close",
        "--lease-id", opened["lease_id"], "--archive-root", str(lane.archive)],
        capture_output=True, text=True, timeout=40)
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout)["disposition"] == "REMOVED"
    assert lane.record(opened)["consumers"] == [] and not Path(opened["path"]).exists()

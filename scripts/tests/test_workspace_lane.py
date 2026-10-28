"""W4a caller sequence against real Git worktrees and a durable test ledger."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

from test_workspace_retire import git, tree as worktree_fixture

tree = worktree_fixture


CLI = Path(__file__).resolve().parents[1] / "workspace/lane.py"
LEASE = CLI.with_name("lease.py")


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
def test_uncommitted_work_retained_without_archive(lane, name):
    opened = json.loads(lane.open().stdout)
    path = Path(opened["path"])
    (path / name).write_text("uncommitted work\n")
    (path / "docs.local").mkdir()
    (path / "docs.local/report").write_text("ignored work\n")
    summary = json.loads(lane.close(opened, ok=False).stdout)
    assert summary["disposition"] == "RETAINED"
    assert (path / name).read_text() == "uncommitted work\n"
    assert lane.record(opened)["state"] == "closed"
    assert lane.record(opened)["disposition"] == "RETAINED"
    assert not lane.archive.exists()


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
    result = lane.close({"lease_id": "managed"}, ok=False)
    assert "settle" in result.stderr and "T3" in result.stderr
    assert target.is_dir() and not lane.archive.exists()


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

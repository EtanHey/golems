"""W7a bind-time generation guards against same-path, same-HEAD replacement."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

from test_workspace_lane import CLI, LEASE, lane
from test_workspace_retire import git, load_retire, retire_args, tree


@pytest.fixture
def tmp_path():
    common = Path(git(CLI.parents[2], "rev-parse", "--path-format=absolute", "--git-common-dir"))
    scratch = common.parent / "docs.local"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workspace-generation-test-", dir=scratch) as directory:
        yield Path(directory).resolve()


def test_replacement_at_same_path_and_head_is_retained(lane, tree):
    opened = json.loads(lane.open().stdout)
    path = Path(opened["path"])
    original_identity = path.stat().st_ino
    original = tree[0].parent / "original-generation"
    git(tree[0], "worktree", "move", str(path), str(original))
    git(tree[0], "worktree", "add", "-qb", "other-owner", str(path), opened["head"])
    precious = path / "node_modules/precious"
    precious.parent.mkdir()
    precious.write_bytes(b"replacement owner's bytes\x00\n")
    assert path.stat().st_ino != original_identity
    summary = json.loads(lane.close(opened, ok=False).stdout)
    assert summary["disposition"] == "RETAINED"
    assert "resource replaced since bind" in summary["reason"]
    assert summary["generation_check"] == "mismatch"
    assert precious.read_bytes() == b"replacement owner's bytes\x00\n"
    assert git(path, "branch", "--show-current") == "other-owner"
    assert git(path, "rev-parse", "HEAD") == opened["head"]
    assert original.exists() and not list(path.parent.glob(".retiring-*"))


@pytest.mark.parametrize("field", ["root_identity", "git_dir", "git_dir_identity", "branch"])
def test_each_generation_component_checked_before_quarantine(lane, tree, field):
    opened = json.loads(lane.open().stdout)
    record = lane.record(opened)
    generation = record["resource_generation"]
    path = Path(opened["path"])
    assert generation["root_identity"] == [path.stat().st_dev, path.stat().st_ino]
    admin = Path(git(path, "rev-parse", "--absolute-git-dir"))
    assert generation["git_dir"] == str(admin)
    assert generation["git_dir_identity"] == [admin.stat().st_dev, admin.stat().st_ino]
    assert generation["branch"] == "refs/heads/sample"
    generation[field] = [0, 0] if field.endswith("identity") else "different-generation"
    result = subprocess.run([sys.executable, str(CLI.with_name("retire.py")),
        "--repo", str(tree[0]), "--path", str(path),
        "--expect-generation", json.dumps(generation)], capture_output=True, text=True)
    receipt = json.loads(result.stdout)
    assert result.returncode and receipt["disposition"] == "RETAINED"
    assert "resource replaced since bind" in receipt["reason"]
    assert receipt["move_rc"] is None and receipt["quarantine_path"] is None
    assert (path / "tracked").read_text() == "original\n"


@pytest.mark.parametrize("legacy", [False, True])
def test_happy_and_legacy_close_receipts(lane, legacy):
    opened = json.loads(lane.open().stdout)
    if legacy:
        record = lane.record(opened)
        del record["resource_generation"]
        (lane.ledger / (opened["lease_id"] + ".json")).write_text(json.dumps(record))
        # A bind retry must not silently upgrade a legacy allocation.
        lane.run("bind", "--lease-id", opened["lease_id"], "--path", opened["path"], script=LEASE)
        assert "resource_generation" not in lane.record(opened)
    summary = json.loads(lane.close(opened).stdout)
    receipt = json.loads(Path(summary["receipt"]).read_text())
    assert receipt["disposition"] == "REMOVED" and not Path(opened["path"]).exists()
    assert receipt["generation_check"] == ("legacy: no generation recorded at bind" if legacy else "verified")


def test_bind_retry_refuses_to_replace_recorded_generation(lane, tree):
    opened = json.loads(lane.open().stdout)
    before = lane.record(opened)["resource_generation"]
    git(opened["path"], "checkout", "-qb", "other-owner")
    result = lane.run("bind", "--lease-id", opened["lease_id"], "--path", opened["path"],
                      script=LEASE, ok=False)
    assert "resource replaced since bind" in result.stderr
    assert lane.record(opened)["resource_generation"] == before


def test_swap_after_last_check_names_stranded_quarantine(lane, tree, monkeypatch):
    opened = json.loads(lane.open().stdout)
    path = Path(opened["path"])
    original = tree[0].parent / "original-generation"
    module = load_retire()
    real_git = module.git

    def swap(repo, *args):
        if args[:3] == ("worktree", "move", str(path)):
            git(tree[0], "worktree", "move", str(path), str(original))
            git(tree[0], "worktree", "add", "-qb", "other-owner", str(path), opened["head"])
        return real_git(repo, *args)

    monkeypatch.setattr(module, "git", swap)
    args = retire_args((tree[0], path, tree[2]))
    args.expect_generation = lane.record(opened)["resource_generation"]
    receipt, code = module.retire(args)
    quarantine = Path(receipt["quarantine_path"])
    assert code and receipt["disposition"] == "RETAINED"
    assert receipt["quarantine_generation_check"] == "mismatch"
    assert receipt["quarantine_resource_generation"] != args.expect_generation
    assert "stranded quarantine" in receipt["reason"] and str(quarantine) in receipt["reason"]
    assert "different generation" in receipt["reason"]
    assert (quarantine / "tracked").read_text() == "original\n"
    assert git(quarantine, "branch", "--show-current") == "other-owner"
    assert original.exists() and receipt["remove_rc"] is None

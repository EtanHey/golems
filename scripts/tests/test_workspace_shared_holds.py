"""W7b: path ownership joins every live lease, with real isolated Git fixtures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

ROOT = Path(__file__).resolve().parents[2]
LEASE = ROOT / "scripts/workspace/lease.py"
LANE = LEASE.with_name("lane.py")


@pytest.fixture
def shared_holds():
    # Archives and ledgers must persist outside system temp; fixture repos must
    # also stay outside T3-managed checkouts so direct-Git lanes are allowed.
    scratch = Path.home() / ".cache/golems/workspace-test-fixtures"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="w7b-", dir=scratch) as directory:
        root = Path(directory).resolve()
        repo, ledger = root / "repo", root / "ledger"
        env = {**os.environ, "GOLEMS_WORKSPACE_LEASES": str(ledger),
               "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}

        def run(script, *args):
            return subprocess.run([sys.executable, str(script), *map(str, args)],
                                  env=env, capture_output=True, text=True, timeout=30)

        def git(*args):
            return subprocess.run(["git", "-C", str(repo), *map(str, args)], env=env,
                                  check=True, capture_output=True, text=True).stdout.strip()

        repo.mkdir()
        git("init", "-q")
        git("config", "user.name", "Fixture")
        git("config", "user.email", "fixture@example.com")
        (repo / ".gitignore").write_text(".worktrees/\ndocs.local/\n")
        git("add", ".gitignore")
        git("commit", "-qm", "fixture")
        opened = run(LANE, "open", "--repo", repo, "--name", "subject", "--owner", "lead")
        assert opened.returncode == 0, opened.stderr
        subject = json.loads(opened.stdout)
        path = Path(subject["path"])

        def other(lease_id, held_path, consumer=True):
            held_path.mkdir(parents=True, exist_ok=True)
            for args in [
                ("reserve", "--lease-id", lease_id, "--allocator", "direct-git",
                 "--owner", "review", "--repo", repo / ".git", "--kind", "lane-directory",
                 "--ownership", "created"),
                ("bind", "--lease-id", lease_id, "--path", held_path),
            ]:
                result = run(LEASE, *args)
                assert result.returncode == 0, result.stderr
            if consumer:
                result = run(LEASE, "consumer", "add", "--lease-id", lease_id, "--who", "reviewer")
                assert result.returncode == 0, result.stderr

        yield root, ledger, subject, path, run, other


@pytest.mark.parametrize("relation", ["same", "parent", "child", "unrelated"])
def test_shared_path_consumer_gates_lane_close(shared_holds, relation):
    root, ledger, subject, path, run, other = shared_holds
    held = {"same": path, "parent": path.parent, "child": path / "docs.local/child",
            "unrelated": path.with_name(path.name + "-unrelated")}[relation]
    other("holding-lease", held)
    before = (ledger / "holding-lease.json").read_bytes()
    result = run(LANE, "close", "--lease-id", subject["lease_id"], "--archive-root", root / "archive")
    assert result.returncode == (0 if relation == "unrelated" else 2), result.stdout + result.stderr
    receipt = json.loads(result.stdout)
    assert receipt["disposition"] == ("REMOVED" if relation == "unrelated" else "RETAINED")
    assert path.exists() is (relation != "unrelated")
    assert (ledger / "holding-lease.json").read_bytes() == before
    if relation != "unrelated":
        assert receipt["blocking_leases"] == [{"lease_id": "holding-lease", "state": "bound", "consumers": ["reviewer"]}]
        assert "holding-lease" in receipt["reason"] and "reviewer" in receipt["reason"]
        record = json.loads((ledger / (subject["lease_id"] + ".json")).read_text())
        assert record["state"] == "bound" and not record.get("close_token")
        assert record["history"][-1]["receipt"] == receipt
        assert not (root / "archive").exists()


def test_other_closing_lease_blocks_begin_close(shared_holds):
    _, ledger, subject, path, run, other = shared_holds
    other("closing-lease", path, consumer=False)
    assert run(LEASE, "begin-close", "--lease-id", "closing-lease").returncode == 0
    result = run(LEASE, "begin-close", "--lease-id", subject["lease_id"])
    assert result.returncode == 2, result.stdout + result.stderr
    receipt = json.loads(result.stdout)
    assert receipt["disposition"] == "RETAINED"
    assert receipt["blocking_leases"] == [{"lease_id": "closing-lease", "state": "closing", "consumers": []}]
    assert json.loads((ledger / (subject["lease_id"] + ".json")).read_text())["state"] == "bound"


@pytest.mark.parametrize("action", ["consumer", "bind"])
def test_closing_path_excludes_new_holds_through_other_lease(shared_holds, action):
    _, _, subject, path, run, other = shared_holds
    other("late-lease", path, consumer=False)
    assert run(LEASE, "begin-close", "--lease-id", subject["lease_id"]).returncode == 0
    args = ("consumer", "add", "--who", "late-reviewer") if action == "consumer" else ("bind", "--path", path)
    result = run(LEASE, *args, "--lease-id", "late-lease")
    assert result.returncode != 0 and "closing" in result.stderr


def test_closed_lease_does_not_block_and_canonical_alias_does(shared_holds):
    root, _, subject, path, run, other = shared_holds
    other("finished", path, consumer=False)
    assert run(LEASE, "close", "--lease-id", "finished", "--retained", "handoff done").returncode == 0
    alias = root / "alias"
    alias.symlink_to(path, target_is_directory=True)
    other("alias-review", alias)
    result = run(LEASE, "begin-close", "--lease-id", subject["lease_id"])
    assert result.returncode == 2, result.stdout + result.stderr
    assert [item["lease_id"] for item in json.loads(result.stdout)["blocking_leases"]] == ["alias-review"]


def test_all_blockers_reported_and_release_allows_retry(shared_holds):
    root, _, subject, path, run, other = shared_holds
    other("review-a", path)
    other("review-b", path.parent)
    refused = run(LEASE, "begin-close", "--lease-id", subject["lease_id"])
    assert refused.returncode == 2
    assert {item["lease_id"] for item in json.loads(refused.stdout)["blocking_leases"]} == {"review-a", "review-b"}
    for lease_id in ("review-a", "review-b"):
        assert run(LEASE, "consumer", "release", "--lease-id", lease_id, "--who", "reviewer").returncode == 0
    result = run(LANE, "close", "--lease-id", subject["lease_id"], "--archive-root", root / "archive")
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout)["disposition"] == "REMOVED"


@pytest.mark.parametrize("operation", ["check-close", "close"])
def test_existing_closing_lease_rechecks_legacy_overlapping_hold(shared_holds, operation):
    _, ledger, subject, path, run, other = shared_holds
    other("legacy-review", path, consumer=False)
    begun = run(LEASE, "begin-close", "--lease-id", subject["lease_id"])
    assert begun.returncode == 0
    token = json.loads(begun.stdout)["close_token"]
    # Model a second hold persisted before the path-wide exclusion was deployed.
    target = ledger / "legacy-review.json"
    record = json.loads(target.read_text())
    record["consumers"] = ["reviewer"]
    target.write_text(json.dumps(record))
    args = ("--retained", "interrupted") if operation == "close" else ()
    result = run(LEASE, operation, "--lease-id", subject["lease_id"], "--close-token", token, *args)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "legacy-review" in json.loads(result.stdout)["reason"]
    assert json.loads((ledger / (subject["lease_id"] + ".json")).read_text())["state"] == "closing"

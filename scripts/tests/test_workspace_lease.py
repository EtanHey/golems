"""Exercise the real lease CLI; only fixtures may opt into ephemeral ledgers."""

import json
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest


CLI = Path(__file__).resolve().parents[1] / "workspace" / "lease.py"


@pytest.fixture
def lease(tmp_path, monkeypatch):
    monkeypatch.setenv("GOLEMS_WORKSPACE_LEASES", str(tmp_path / "ledger"))
    monkeypatch.setenv("GOLEMS_WORKSPACE_LEASES_TEST_ALLOW_TMP", "1")
    repo = tmp_path / "repo.git"
    repo.mkdir()
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    class Lease:
        ledger = tmp_path / "ledger"
        path = workspace
        common_dir = repo

        def run(self, *args, ok=True, env=None):
            result = subprocess.run(
                [sys.executable, str(CLI), *map(str, args)],
                text=True, capture_output=True, env=env,
            )
            assert (result.returncode == 0) is ok, result.stderr
            return result

        def reserve(self, ownership="created", lease_id="sample"):
            return self.run(
                "reserve", "--lease-id", lease_id, "--allocator", "direct-git",
                "--owner", "parent-task", "--repo", repo, "--kind", "worktree",
                "--ownership", ownership,
            )

        def bind(self):
            return self.run("bind", "--lease-id", "sample", "--path", workspace,
                            "--branch", "task/sample", "--head", "abc123",
                            "--task-id", "task-1", "--thread-id", "thread-1")

        def read(self):
            return json.loads((self.ledger / "sample.json").read_text())

        def receipt(self, **changes):
            value = {
                "schema": "workspace-lifecycle/receipt/v1", "path": str(workspace),
                "repo_common_dir": str(repo), "disposition": "REMOVED",
                "registered_after": False, "physical_after": False,
                "remove_rc": 0, "reason": "retirement completed",
            }
            value.update(changes)
            target = tmp_path / "receipt.json"
            target.write_text(json.dumps(value))
            return target

        def close(self, *args, ok=True):
            return self.run("close", "--lease-id", "sample", *args, ok=ok)

    return Lease()


def test_reserved_crash_is_visible_in_audit(lease):
    lease.reserve()
    record = lease.read()
    assert record["schema"] == "workspace-lifecycle/v1"
    assert record["path"] is None
    assert record["host_environment"]
    assert record["created_at"].endswith("Z")
    audit = json.loads(lease.run("audit", "--json").stdout)
    assert len(audit) == 1
    assert audit[0]["lease_id"] == "sample"
    assert audit[0]["state"] == "reserved"
    assert audit[0]["age_seconds"] >= 0


def test_unwritable_ledger_does_not_allocate(lease):
    lease.ledger.mkdir(mode=0o500)
    try:
        result = lease.run(
            "reserve", "--lease-id", "sample", "--allocator", "cmux",
            "--owner", "owner", "--repo", lease.common_dir, "--kind", "clone",
            "--ownership", "created", ok=False,
        )
        assert "do not allocate" in result.stderr
        assert not list(lease.ledger.glob("*.json"))
    finally:
        lease.ledger.chmod(0o700)


@pytest.mark.parametrize("root", ["/tmp", "/private/tmp", "/var/folders"])
def test_ephemeral_ledger_refused_without_test_override(lease, root):
    env = os.environ.copy()
    env.pop("GOLEMS_WORKSPACE_LEASES_TEST_ALLOW_TMP")
    env["GOLEMS_WORKSPACE_LEASES"] = root + "/workspace-lease-test-never-create"
    result = lease.run("audit", "--json", env=env, ok=False)
    assert "ephemeral" in result.stderr


def test_tmpdir_and_symlink_cannot_bypass_guard(lease, tmp_path):
    env = os.environ.copy()
    env.pop("GOLEMS_WORKSPACE_LEASES_TEST_ALLOW_TMP")
    env["TMPDIR"] = str(tmp_path)
    alias = tmp_path / "alias"
    alias.symlink_to(tmp_path, target_is_directory=True)
    env["GOLEMS_WORKSPACE_LEASES"] = str(alias / "ledger")
    assert "ephemeral" in lease.run("audit", env=env, ok=False).stderr


def test_duplicate_reserve_and_different_rebind_refused(lease, tmp_path):
    lease.reserve()
    before = (lease.ledger / "sample.json").read_bytes()
    lease.run("reserve", "--lease-id", "sample", "--allocator", "cmux",
              "--owner", "other", "--repo", lease.common_dir, "--kind", "clone",
              "--ownership", "created", ok=False)
    assert (lease.ledger / "sample.json").read_bytes() == before
    lease.bind()
    other = tmp_path / "other"
    other.mkdir()
    lease.run("bind", "--lease-id", "sample", "--path", other, ok=False)
    assert lease.read()["path"] == str(lease.path)
    lease.bind()  # Same path is retry-safe.
    assert lease.read()["task_id"] == "task-1"


def test_bind_missing_path_refused(lease, tmp_path):
    lease.reserve()
    lease.run("bind", "--lease-id", "sample", "--path", tmp_path / "missing", ok=False)
    assert lease.read()["state"] == "reserved"


def test_consumers_gate_close_and_unknown_release_refused(lease):
    lease.reserve()
    lease.bind()
    for _ in range(2):
        lease.run("consumer", "--lease-id", "sample", "add", "--who", "reviewer")
    assert lease.read()["consumers"] == ["reviewer"]
    lease.close("--retained", "pending review", ok=False)
    lease.run("consumer", "--lease-id", "sample", "release", "--who", "unknown", ok=False)
    lease.run("consumer", "--lease-id", "sample", "release", "--who", "reviewer")
    lease.close("--retained", "shared resource")
    assert lease.read()["disposition"] == "RETAINED"
    assert json.loads(lease.run("audit", "--json").stdout) == []


def test_retained_receipt_can_close(lease):
    lease.reserve()
    lease.bind()
    receipt = lease.receipt(disposition="RETAINED", registered_after=True, physical_after=True,
                            reason="local-only artifacts")
    lease.close("--receipt", receipt)
    assert lease.read()["terminal_receipt"]["reason"] == "local-only artifacts"


@pytest.mark.parametrize("change", [
    {"path": "/different-workspace"}, {"repo_common_dir": "/different-repo"},
    {"registered_after": True}, {"physical_after": True},
    {"registered_after": 0}, {"physical_after": None}, {"remove_rc": 1},
    {"schema": "other/v1"}, {"disposition": "TRANSFERRED"},
])
def test_invalid_removal_receipts_refused(lease, change):
    lease.reserve()
    lease.bind()
    lease.close("--receipt", lease.receipt(**change), ok=False)
    assert lease.read()["state"] == "bound"


@pytest.mark.parametrize("ownership", ["reused", "unknown"])
def test_borrowed_resource_cannot_close_removed(lease, ownership):
    lease.reserve(ownership)
    lease.bind()
    lease.close("--receipt", lease.receipt(), ok=False)
    lease.close("--retained", "borrowed")


def test_removed_receipt_closes_created_lease(lease):
    lease.reserve()
    lease.bind()
    lease.close("--receipt", lease.receipt())
    record = lease.read()
    assert record["state"] == "closed"
    assert record["disposition"] == "REMOVED"
    assert lease.path.exists()  # Ledger validation never removes resources itself.
    lease.run("consumer", "--lease-id", "sample", "add", "--who", "late", ok=False)
    lease.close("--retained", "rewrite", ok=False)
    assert lease.read()["disposition"] == "REMOVED"


def test_transfer_requires_matching_acknowledgment(lease, tmp_path):
    lease.reserve()
    lease.bind()
    lease.close("--transferred-to", "successor", ok=False)
    ack = tmp_path / "ack.json"
    for value in [{"path": "/wrong", "owner": "successor"},
                  {"path": str(lease.path), "owner": "different"}]:
        ack.write_text(json.dumps(value))
        lease.close("--transferred-to", "successor", "--ack-file", ack, ok=False)
    ack.write_text(json.dumps({"path": str(lease.path), "owner": "successor"}))
    lease.close("--transferred-to", "successor", "--ack-file", ack)
    assert lease.read()["disposition"] == "TRANSFERRED"
    assert lease.read()["owner"] == "successor"


def test_close_failure_history_survives_later_success(lease):
    lease.reserve()
    lease.bind()
    lease.close("--receipt", lease.receipt(physical_after=True), ok=False)
    failed = lease.read()["history"][0]
    assert failed["success"] is False
    assert failed["error"]
    assert failed["receipt"]["physical_after"] is True
    lease.close("--retained", "directory remains")
    history = lease.read()["history"]
    assert len(history) == 2
    assert history[0] == failed
    assert history[1]["success"] is True


def test_audit_is_read_only_even_for_missing_ledger(lease):
    assert json.loads(lease.run("audit", "--json").stdout) == []
    assert not lease.ledger.exists()
    lease.reserve()
    before = {p: (p.stat().st_mtime_ns, p.read_bytes() if p.is_file() else None)
              for p in [lease.ledger, *lease.ledger.iterdir()]}
    lease.run("audit", "--json")
    lease.run("audit")
    after = {p: (p.stat().st_mtime_ns, p.read_bytes() if p.is_file() else None)
             for p in [lease.ledger, *lease.ledger.iterdir()]}
    assert after == before


@pytest.mark.parametrize("lease_id", ["../escape", "/absolute", ".", ""])
def test_lease_id_cannot_escape_ledger(lease, lease_id):
    lease.run("reserve", "--lease-id", lease_id, "--allocator", "cmux",
              "--owner", "owner", "--repo", lease.common_dir, "--kind", "worktree",
              "--ownership", "created", ok=False)


def test_concurrent_reservation_has_exactly_one_winner(lease):
    command = [sys.executable, str(CLI), "reserve", "--lease-id", "sample",
               "--allocator", "t3-delegate", "--owner", "parent-task",
               "--repo", str(lease.common_dir), "--kind", "worktree",
               "--ownership", "created", "--branch", "task/sample", "--base-sha", "abc123"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(
            lambda _: subprocess.run(command, capture_output=True, text=True), range(4)))
    assert sorted(result.returncode for result in results) == [0, 1, 1, 1]
    record = lease.read()
    assert record["requested_branch"] == "task/sample"
    assert record["requested_base_sha"] == "abc123"
    assert not list(lease.ledger.glob("*.tmp"))


def test_concurrent_consumers_do_not_lose_updates(lease):
    lease.reserve()
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda who: lease.run("consumer", "--lease-id", "sample", "add",
                                           "--who", who), ["creator", "reviewer", "test", "handoff"]))
    assert set(lease.read()["consumers"]) == {"creator", "reviewer", "test", "handoff"}


@pytest.mark.parametrize("failure", ["fsync", "replace"])
def test_interrupted_write_preserves_previous_bytes(lease, monkeypatch, failure):
    lease.reserve()
    target = lease.ledger / "sample.json"
    previous = target.read_bytes()
    spec = importlib.util.spec_from_file_location("workspace_lease", CLI)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def refuse(*args):
        raise OSError("injected persistence failure")

    monkeypatch.setattr(module.os, failure, refuse)
    monkeypatch.setattr(sys, "argv", [str(CLI), "consumer", "--lease-id", "sample",
                                     "add", "--who", "reviewer"])
    assert module.main() == 1
    assert target.read_bytes() == previous
    assert not list(lease.ledger.glob("*.tmp"))


@pytest.mark.parametrize("contents", ["{", "[]", None])
def test_unreadable_receipt_attempt_is_preserved(lease, tmp_path, contents):
    lease.reserve()
    lease.bind()
    receipt = tmp_path / "bad-receipt.json"
    if contents is not None:
        receipt.write_text(contents)
    lease.close("--receipt", receipt, ok=False)
    failed = lease.read()["history"][0]
    assert failed["success"] is False
    assert failed["error"]
    lease.close("--retained", "receipt unavailable")
    assert lease.read()["history"][0] == failed

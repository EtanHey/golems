"""Exercise the real lease CLI with self-cleaning, durable ledger fixtures."""

import json
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import stat
import tempfile
from concurrent.futures import ThreadPoolExecutor

import pytest


CLI = Path(__file__).resolve().parents[1] / "workspace" / "lease.py"


@pytest.fixture
def durable_ledger():
    scratch = CLI.parents[2] / "docs.local"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="workspace-lease-test-", dir=scratch) as directory:
        yield Path(directory).resolve() / "ledger"


@pytest.fixture
def lease(tmp_path, monkeypatch, durable_ledger):
    monkeypatch.setenv("GOLEMS_WORKSPACE_LEASES", str(durable_ledger))
    monkeypatch.delenv("GOLEMS_WORKSPACE_LEASES_TEST_ALLOW_TMP", raising=False)
    source = tmp_path / "repo"
    def git(*args):
        subprocess.run(["git", "-C", str(source), *map(str, args)], check=True,
                       capture_output=True, text=True)
    source.mkdir()
    git("init", "-q")
    git("config", "user.name", "Fixture")
    git("config", "user.email", "fixture@example.com")
    git("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", "fixture")
    repo = source / ".git"
    workspace = tmp_path / "workspace"
    git("worktree", "add", "-qb", "task/sample", str(workspace))

    class Lease:
        ledger = durable_ledger
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

        def begin_close(self):
            result = self.run("begin-close", "--lease-id", "sample")
            return json.loads(result.stdout)["close_token"]

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
    env.pop("GOLEMS_WORKSPACE_LEASES_TEST_ALLOW_TMP", None)
    env["GOLEMS_WORKSPACE_LEASES"] = root + "/workspace-lease-test-never-create"
    result = lease.run("audit", "--json", env=env, ok=False)
    assert "ephemeral" in result.stderr


def test_tmpdir_and_symlink_cannot_bypass_guard(lease, tmp_path):
    env = os.environ.copy()
    env.pop("GOLEMS_WORKSPACE_LEASES_TEST_ALLOW_TMP", None)
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


@pytest.mark.parametrize("failure", ["directory-open", "directory-fsync"])
def test_reserve_postrename_failure_rolls_back_and_allows_retry(lease, monkeypatch, capsys, failure):
    spec = importlib.util.spec_from_file_location("workspace_lease", CLI)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original_open = module.os.open
    original_fsync = module.os.fsync

    def open_directory(path, *args, **kwargs):
        if Path(path) == lease.ledger:
            raise OSError("injected directory open failure")
        return original_open(path, *args, **kwargs)

    def fsync_directory(fd):
        if stat.S_ISDIR(module.os.fstat(fd).st_mode):
            raise OSError("injected directory fsync failure")
        return original_fsync(fd)

    with monkeypatch.context() as injection:
        injection.setattr(module.os, "open" if failure == "directory-open" else "fsync",
                          open_directory if failure == "directory-open" else fsync_directory)
        injection.setattr(sys, "argv", [str(CLI), "reserve", "--lease-id", "sample",
                                        "--allocator", "direct-git", "--owner", "parent-task",
                                        "--repo", str(lease.common_dir), "--kind", "worktree",
                                        "--ownership", "created"])
        assert module.main() == 1
    assert "do not allocate: injected directory" in capsys.readouterr().err
    assert not (lease.ledger / "sample.json").exists()
    assert not list(lease.ledger.glob("*.tmp"))
    lease.reserve()
    assert lease.read()["state"] == "reserved"


def test_missing_remove_rc_is_refused_and_recorded(lease):
    lease.reserve()
    lease.bind()
    receipt = lease.receipt()
    value = json.loads(receipt.read_text())
    del value["remove_rc"]
    receipt.write_text(json.dumps(value))
    result = lease.close("--receipt", receipt, ok=False)
    assert "remove_rc" in result.stderr
    record = lease.read()
    assert record["state"] == "bound"
    assert record["history"][0]["success"] is False
    assert record["history"][0]["receipt"] == value
    assert "remove_rc" in record["history"][0]["error"]
    for invalid in (None, False, 0.0, "0"):
        lease.close("--receipt", lease.receipt(remove_rc=invalid), ok=False)
    assert len(lease.read()["history"]) == 5
    lease.close("--retained", "removal exit evidence unavailable")
    assert lease.read()["history"][0] == record["history"][0]


def test_inherited_old_override_cannot_enable_ephemeral_cli_ledger(lease):
    with tempfile.TemporaryDirectory(prefix="workspace-lease-guard-", dir="/tmp") as directory:
        target = Path(directory) / "ledger"
        env = os.environ.copy()
        env.pop("PYTEST_CURRENT_TEST", None)
        env["GOLEMS_WORKSPACE_LEASES_TEST_ALLOW_TMP"] = "1"
        env["GOLEMS_WORKSPACE_LEASES"] = str(target)
        result = lease.run("reserve", "--lease-id", "sample", "--allocator", "direct-git",
                           "--owner", "parent-task", "--repo", lease.common_dir,
                           "--kind", "worktree", "--ownership", "created", env=env, ok=False)
        assert "do not allocate: ephemeral ledger directory refused" in result.stderr
        assert not target.exists()


def test_begin_close_blocks_concurrent_consumers_and_bind(lease):
    lease.reserve()
    lease.bind()
    token = lease.begin_close()
    record = lease.read()
    assert record["state"] == "closing"
    assert record["close_token"] == token and len(token) >= 32
    assert record["closing_since"].endswith("Z")
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda who: lease.run(
            "consumer", "--lease-id", "sample", "add", "--who", who, ok=False,
        ), ["reviewer", "test", "handoff", "creator"]))
    assert all("lease is closing" in result.stderr for result in results)
    result = lease.run("bind", "--lease-id", "sample", "--path", lease.path, ok=False)
    assert "lease is closing" in result.stderr
    lease.run("begin-close", "--lease-id", "sample", ok=False)
    assert lease.read() == record


def test_begin_close_refuses_registered_consumer(lease):
    lease.reserve()
    lease.bind()
    lease.run("consumer", "--lease-id", "sample", "add", "--who", "reviewer")
    before = lease.read()
    result = lease.run("begin-close", "--lease-id", "sample", ok=False)
    assert "outstanding consumers" in result.stderr
    assert lease.read() == before


@pytest.mark.parametrize("state", ["reserved", "closed"])
def test_begin_close_refuses_other_states(lease, state):
    lease.reserve()
    if state == "closed":
        lease.close("--retained", "allocation cancelled")
    before = lease.read()
    lease.run("begin-close", "--lease-id", "sample", ok=False)
    assert lease.read() == before


@pytest.mark.parametrize("disposition", ["removed", "retained", "transferred"])
def test_closing_requires_token_and_preserves_each_refusal(lease, disposition, tmp_path):
    lease.reserve()
    lease.bind()
    token = lease.begin_close()
    if disposition == "removed":
        args = ["--receipt", lease.receipt()]
    elif disposition == "retained":
        args = ["--retained", "dirty workspace"]
    else:
        ack = tmp_path / "ack.json"
        ack.write_text(json.dumps({"path": str(lease.path), "owner": "successor"}))
        args = ["--transferred-to", "successor", "--ack-file", ack]
    for flags in [[], ["--close-token", "wrong"]]:
        result = lease.close(*args, *flags, ok=False)
        assert "close token" in result.stderr.lower()
        assert lease.read()["state"] == "closing"
    history = lease.read()["history"]
    assert len(history) == 2 and all(not attempt["success"] for attempt in history)
    lease.close(*args, "--close-token", token)
    assert lease.read()["state"] == "closed"
    assert lease.read()["history"][:2] == history


@pytest.mark.parametrize("failure", ["unwritable", "postrename-fsync"])
def test_closing_recovers_after_terminal_write_failure(lease, monkeypatch, capsys, failure):
    lease.reserve()
    lease.bind()
    token = lease.begin_close()
    receipt = lease.receipt()
    spec = importlib.util.spec_from_file_location("workspace_lease", CLI)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original_persist = module.persist

    def fail_terminal_write(target, record, **kwargs):
        if record["state"] == "closed":
            if failure == "unwritable":
                lease.ledger.chmod(0o500)
            else:
                def fail_directory_fsync(fd):
                    if stat.S_ISDIR(module.os.fstat(fd).st_mode):
                        raise OSError("injected terminal directory fsync failure")
                    return original_fsync(fd)
                injection.setattr(module.os, "fsync", fail_directory_fsync)
        return original_persist(target, record, **kwargs)

    original_fsync = module.os.fsync
    with monkeypatch.context() as injection:
        injection.setattr(module, "persist", fail_terminal_write)
        injection.setattr(sys, "argv", [str(CLI), "close", "--lease-id", "sample",
                                        "--close-token", token, "--receipt", str(receipt)])
        try:
            assert module.main() == 1
        finally:
            lease.ledger.chmod(0o700)
    assert capsys.readouterr().err
    before = lease.read()
    assert len(before["history"]) == 1  # Failure/interruption evidence survives retry.
    if failure == "unwritable":
        assert before["state"] == "closing"
        assert before["history"][0]["success"] is False
    else:
        assert before["history"][0]["success"] is False
        assert "fsync failure" in before["history"][0]["error"]
    lease.close("--receipt", receipt, "--close-token", token)
    record = lease.read()
    assert record["state"] == "closed"
    assert record["history"][:-1] == before["history"]
    assert record["history"][-1]["success"] is True


def test_close_retry_after_ledger_was_unwritable(lease):
    lease.reserve()
    lease.bind()
    token = lease.begin_close()
    receipt = lease.receipt()
    lease.ledger.chmod(0o500)
    try:
        result = lease.close("--receipt", receipt, "--close-token", token, ok=False)
        assert "not writable" in result.stderr
    finally:
        lease.ledger.chmod(0o700)
    assert lease.read()["state"] == "closing"
    lease.close("--receipt", receipt, "--close-token", token)
    assert lease.read()["state"] == "closed"


def test_same_receipt_is_idempotent_but_different_receipt_is_refused(lease, tmp_path):
    lease.reserve()
    lease.bind()
    token = lease.begin_close()
    receipt = lease.receipt()
    lease.close("--receipt", receipt, "--close-token", token)
    closed_at = lease.read()["closed_at"]
    copy = tmp_path / "receipt-copy.json"
    copy.write_bytes(receipt.read_bytes())
    result = lease.close("--receipt", copy, "--close-token", token)
    assert "already closed" in result.stdout
    assert lease.read()["closed_at"] == closed_at
    lease.close("--receipt", lease.receipt(reason="different receipt"),
                "--close-token", token, ok=False)
    record = lease.read()
    assert record["terminal_receipt"]["reason"] == "retirement completed"
    assert [attempt["success"] for attempt in record["history"]] == [True, True, False]


@pytest.mark.parametrize("prior_state", ["bound", "retained"])
def test_abort_close_restores_state_and_reopens_consumers(lease, prior_state):
    lease.reserve()
    lease.bind()
    if prior_state == "retained":
        target = lease.ledger / "sample.json"
        record = lease.read()
        record["state"] = prior_state
        target.write_text(json.dumps(record))
    token = lease.begin_close()
    for flags in [[], ["--close-token", "wrong"]]:
        lease.run("abort-close", "--lease-id", "sample", *flags, ok=False)
        assert lease.read()["state"] == "closing"
    lease.run("abort-close", "--lease-id", "sample", "--close-token", token)
    record = lease.read()
    assert record["state"] == prior_state
    assert not {"close_token", "closing_since", "closing_previous_state"} & record.keys()
    lease.run("consumer", "--lease-id", "sample", "add", "--who", "reviewer")
    assert lease.read()["consumers"] == ["reviewer"]


def test_audit_reports_stale_closing_without_releasing_it(lease):
    lease.reserve()
    lease.bind()
    lease.begin_close()
    target = lease.ledger / "sample.json"
    record = lease.read()
    record["closing_since"] = "2000-01-01T00:00:00Z"
    target.write_text(json.dumps(record))
    before = target.read_bytes()
    audit = json.loads(lease.run("audit", "--json").stdout)
    assert audit[0]["state"] == "closing"
    assert audit[0]["closing_age_seconds"] > 86400
    assert "closing_age=" in lease.run("audit").stdout
    assert target.read_bytes() == before


def test_aborted_token_cannot_close_a_new_closing_generation(lease):
    lease.reserve()
    lease.bind()
    old_token = lease.begin_close()
    lease.run("abort-close", "--lease-id", "sample", "--close-token", old_token)
    token = lease.begin_close()
    assert token != old_token
    receipt = lease.receipt()
    lease.close("--receipt", receipt, "--close-token", old_token, ok=False)
    assert lease.read()["state"] == "closing"
    lease.close("--receipt", receipt, "--close-token", token)


def test_invalid_receipt_does_not_release_closing_lease(lease):
    lease.reserve()
    lease.bind()
    token = lease.begin_close()
    lease.close("--receipt", lease.receipt(physical_after=True),
                "--close-token", token, ok=False)
    assert lease.read()["state"] == "closing"
    result = lease.run("consumer", "--lease-id", "sample", "add", "--who", "late", ok=False)
    assert "lease is closing" in result.stderr
    lease.close("--receipt", lease.receipt(), "--close-token", token)


@pytest.mark.parametrize("as_json", [False, True])
def test_audit_never_discloses_close_token(lease, as_json):
    lease.reserve()
    lease.bind()
    token = lease.begin_close()
    before = lease.read()
    result = lease.run("audit", *(["--json"] if as_json else []))
    assert token not in result.stdout + result.stderr
    assert "close_token" not in result.stdout
    if as_json:
        observation = json.loads(result.stdout)[0]
        assert observation["closing"] is True
        assert observation["closing_since"] == before["closing_since"]
        assert observation["closing_age_seconds"] >= 0
    else:
        assert "closing: true" in result.stdout
        assert before["closing_since"] in result.stdout
        assert "closing_age=" in result.stdout
    assert lease.read() == before


def test_close_token_not_echoed_in_errors_history_or_abort_output(lease):
    lease.reserve()
    lease.bind()
    token = lease.begin_close()
    missing = lease.path / (token + ".json")
    failed = lease.close("--receipt", missing, "--close-token", token, ok=False)
    assert token not in failed.stdout + failed.stderr
    assert token not in json.dumps(lease.read()["history"])
    aborted = lease.run("abort-close", "--lease-id", "sample", "--close-token", token)
    assert token not in aborted.stdout + aborted.stderr
    assert json.loads(aborted.stdout)["state"] == "bound"


def test_only_begin_close_returns_token_even_when_receipt_echoes_it(lease):
    lease.reserve()
    lease.bind()
    begun = lease.run("begin-close", "--lease-id", "sample")
    token = json.loads(begun.stdout)["close_token"]
    assert json.loads(begun.stdout) == {"close_token": token}
    receipt = lease.receipt(close_token=token, reason="receipt for " + token,
                            notes=[{token: "caller correlation"}])
    for _ in range(2):
        closed = lease.close("--receipt", receipt, "--close-token", token)
        assert token not in closed.stdout + closed.stderr
        assert "close_token" not in closed.stdout
        assert json.loads(closed.stdout)["state"] == "closed"
        assert token not in json.dumps(lease.read()["history"])
    # Internal receipt identity stays intact for exact retry validation.
    assert lease.read()["terminal_receipt"] == json.loads(receipt.read_text())


def test_help_describes_close_token_guard_and_same_user_limit(lease):
    help_text = lease.run("--help").stdout
    assert "cross-caller" in help_text
    assert "accidental closes" in help_text
    assert "not a secret from the same OS user" in help_text
    assert "ledger file is readable" in help_text

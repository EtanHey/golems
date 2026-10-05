"""Ledger tests use synthetic homes, including the home present at import."""
import builtins
import importlib.util
import json
import os
from pathlib import Path

from test_tmp_block import bash_payload, run_hook


BYPASS = Path(__file__).resolve().parents[1] / "tmp_block_impl/bypass.py"


def test_default_ledger_uses_home_at_call_time(tmp_path, monkeypatch):
    import_home = tmp_path / "import-home"
    sentinel = import_home / ".claude/logs/tmp-block-ledger.jsonl"
    sentinel.parent.mkdir(parents=True)
    sentinel.write_text("sentinel: do not append\n")
    monkeypatch.setenv("HOME", str(import_home))
    monkeypatch.delenv("TMP_BLOCK_LEDGER", raising=False)
    spec = importlib.util.spec_from_file_location("ledger_isolation_bypass", BYPASS)
    bypass = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bypass)
    call_home = tmp_path / "call-home"
    monkeypatch.setenv("HOME", str(call_home))
    original_open = builtins.open

    def protected_open(path, *args, **kwargs):
        assert Path(path) != sentinel, "opened the import-time HOME ledger"
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", protected_open)
    bypass.log_bypass("Bash", {"command": "echo isolated"}, [], "ledger-isolation")
    assert sentinel.read_text() == "sentinel: do not append\n"
    ledger = call_home / ".claude/logs/tmp-block-ledger.jsonl"
    assert json.loads(ledger.read_text())["session_id"] == "ledger-isolation"


def test_subprocess_helper_preserves_per_test_ledger(tmp_path, monkeypatch):
    # Fail before launching an unsafe subprocess if the helper loses isolation.
    import subprocess

    original_run = subprocess.run

    def isolated_run(*args, **kwargs):
        ledger = kwargs["env"].get("TMP_BLOCK_LEDGER")
        assert ledger and Path(ledger).is_relative_to(tmp_path)
        return original_run(*args, **kwargs)

    monkeypatch.setattr(subprocess, "run", isolated_run)
    result = run_hook(bash_payload("WEAVE_ALLOW_TMP=1 echo x > /tmp/isolation-probe"))
    assert result.returncode == 0, result.stdout
    ledger = Path(os.environ["TMP_BLOCK_LEDGER"])
    assert json.loads(ledger.read_text())["session_id"] == "tmp-block-test"

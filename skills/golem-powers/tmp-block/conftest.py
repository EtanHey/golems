"""Isolate both imported-hook and subprocess tests from the host audit log."""
import pytest


@pytest.fixture(autouse=True)
def isolate_bypass_ledger(tmp_path, monkeypatch):
    monkeypatch.setenv("TMP_BLOCK_LEDGER", str(tmp_path / "bypass-ledger.jsonl"))

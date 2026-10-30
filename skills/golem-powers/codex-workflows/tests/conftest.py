"""Keep workflow test leases separate from the user's live ledger."""
import tempfile
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_workspace_ledger(monkeypatch):
    scratch = Path(__file__).resolve().parents[4] / 'docs.local'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='codex-workflows-ledger-', dir=scratch) as directory:
        monkeypatch.setenv('GOLEMS_WORKSPACE_LEASES', str(Path(directory) / 'ledger'))
        yield

"""Keep legacy /tmp assumptions while fixtures stay in authorized repo scratch.
Only hide ancestor .git entries outside pytest's basetemp. Fixture .git markers
and all other filesystem queries remain real. Never installed with the hook.
"""
import os
import pytest

@pytest.fixture(autouse=True)
def isolate_fixture_ancestors(request, monkeypatch):
    base = str(request.config._tmp_path_factory.getbasetemp())
    real_exists = os.path.exists
    def exists(path):
        value = os.fsdecode(path)
        if os.path.basename(value) == '.git' and not value.startswith(base + os.sep):
            return False
        return real_exists(path)
    monkeypatch.setattr(os.path, 'exists', exists)

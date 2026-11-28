"""Shipped hook entrypoints must leave their immutable source tree unchanged."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("entrypoint,flags", [
    ("heavy-run", []),
    ("heavy-suite.py", []),
    ("private-regression-gate.py", ["-I"]),
    ("private-regression-gate.py", []),
])
def test_shipped_hook_imports_do_not_write_bytecode(tmp_path, entrypoint, flags):
    payload = tmp_path / "release"
    payload.mkdir()
    for name in ("heavy-run", "heavy-suite.py", "private-regression-gate.py", "proc_identity.py"):
        shutil.copyfile(ROOT / "scripts/hooks" / name, payload / name)
    before = {p.name: p.read_bytes() for p in payload.iterdir()}
    env = {k: v for k, v in os.environ.items() if not k.startswith("PYTHON")}
    # --help imports the real adjacent modules without queueing a heavy command
    # or running the private gate. Deliberately omit -B to cover bare callers.
    result = subprocess.run([sys.executable, *flags, str(payload / entrypoint), "--help"],
                            env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "usage:" in result.stdout
    caches = sorted(str(p.relative_to(payload)) for p in payload.rglob("*")
                    if p.name == "__pycache__" or p.suffix == ".pyc")
    assert caches == [], f"release payload mutated: {caches}"
    assert {p.name: p.read_bytes() for p in payload.iterdir()} == before

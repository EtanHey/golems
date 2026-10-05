"""Current M23 witness; #490 owns changes to export/declare interpretation."""
import subprocess
import sys
from pathlib import Path

import pytest


HOOK = Path(__file__).resolve().parents[1] / "tmp-block-pretooluse.py"


@pytest.mark.parametrize("assigner,debit", [("export", 118), ("declare", 120)])
def test_primary_path_is_retained_over_child_path(tmp_path, assigner, debit):
    probe = tmp_path / "m23.py"
    probe.write_text("""import importlib.util, sys
spec = importlib.util.spec_from_file_location('unregistered', sys.argv[1])
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
command = 'X=/tmp/w; echo $(' + sys.argv[2] + ' X=/var/folders/w;git worktree add "$X" HEAD)'
budget = [1000000]
hits = hook._bash_temp_targets(command, budget, '/durable')
assert type(hits) is list and type(hits[0]) is tuple
assert hits == [('git worktree add', '/tmp/w', (1, ('sub', 0, True), 1))], hits
assert budget == [1000000 - int(sys.argv[3])], budget
""")
    result = subprocess.run([sys.executable, "-B", str(probe), str(HOOK), assigner, str(debit)],
                            capture_output=True, text=True, timeout=20)
    assert (result.returncode, result.stdout, result.stderr) == (0, "", "")

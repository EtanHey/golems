"""The issuers run from hooks-live with a bare `#!/usr/bin/env python3` (no -B).
Their gate-module imports must never write bytecode there: a __pycache__ in
hooks-live turns `install-hooks --status` red, and agents cannot clean it."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
ISSUERS = ('golems-lead-confirm', 'golems-confirm', 'golems-confirm-pin')


def bytecode(tree):
    return sorted(str(p.relative_to(tree)) for p in tree.rglob('*')
                  if p.name == '__pycache__' or p.suffix in ('.pyc', '.pyo'))


class IssuerBytecode(unittest.TestCase):
    def tree(self):
        scratch = REPO / 'docs.local' / 'issuer-bytecode-fixtures'
        scratch.mkdir(parents=True, exist_ok=True)
        root = Path(tempfile.mkdtemp(dir=scratch))
        self.addCleanup(shutil.rmtree, root, True)
        ignore = shutil.ignore_patterns('__pycache__', '*.pyc', 'tests')
        for rel in ('skills/golem-powers/human-confirm-gate', 'skills/golem-powers/_shared'):
            shutil.copytree(REPO / rel, root / rel, ignore=ignore)
        (root / 'scripts').mkdir()
        for name in ISSUERS:
            shutil.copy2(REPO / 'scripts' / name, root / 'scripts' / name)
        return root

    def test_each_issuer_leaves_no_bytecode_in_its_tree(self):
        env = {k: v for k, v in os.environ.items() if k not in ('PYTHONDONTWRITEBYTECODE', 'PYTHONPYCACHEPREFIX')}
        for name in ISSUERS:
            with self.subTest(issuer=name):
                root = self.tree()  # a fresh tree each: no issuer inherits another's bytecode
                env['HOME'] = str(root / 'home')
                # As the shebang runs it: no -B. --help (or the non-tty refusal) exits after the imports.
                subprocess.run([str(root / 'scripts' / name), '--help'], cwd=root, env=env,
                               stdin=subprocess.DEVNULL, capture_output=True, timeout=30)
                self.assertEqual(bytecode(root), [])

if __name__ == '__main__':
    unittest.main()

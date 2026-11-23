import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]

class Retention(unittest.TestCase):
    def test_fake_gh_policy(self):
        spec = importlib.util.spec_from_file_location('retention', ROOT / 'scripts/ratchet/retain-runs.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        scratch = ROOT / 'docs.local/storage-tools'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as tmp:
            root = Path(tmp) / 'runs'
            root.mkdir()
            pinned = 'pr1-abcdef123456-20260101T000000'
            for pr in range(1, 6):
                for day in range(1, 6):
                    (root / f'pr{pr}-abcdef123456-2026010{day}T000000').mkdir()
            binary = Path(tmp) / 'gh'
            binary.write_text('''#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
if args[0] == 'api':
    print(json.dumps([[{'body': 'pr1-abcdef123456-20260101T000000'}]]))
else:
    pr = int(args[2])
    if pr == 4: sys.exit(1)
    print(json.dumps({'state': {1:'OPEN',2:'MERGED',3:'CLOSED',5:'ALIEN'}[pr], 'closedAt': '2026-01-15T00:00:00Z' if pr == 2 else '2025-12-01T00:00:00Z'}))
''')
            binary.chmod(0o755)
            with patch.dict(os.environ, PATH=str(binary.parent) + os.pathsep + os.environ['PATH']):
                rows = module.plan(root, 'EtanHey/golems', dt.datetime(2026,1,20,tzinfo=dt.timezone.utc))
            kept = lambda pr: [r for r in rows if r['pr'] == pr and r['keep']]
            self.assertEqual(len(kept(1)), 4)
            self.assertEqual(len(kept(2)), 1)
            self.assertEqual(len(kept(3)), 0)
            self.assertEqual(len(kept(4)), 5)
            self.assertEqual(len(kept(5)), 5)
            self.assertEqual(len(list(root.iterdir())), 25)
            (root / 'link').symlink_to(binary)
            with self.assertRaises(ValueError):
                module.plan(root, 'EtanHey/golems', dt.datetime.now(dt.timezone.utc))

if __name__ == '__main__': unittest.main()

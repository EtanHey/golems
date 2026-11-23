"""Archive real git-ignored fixtures, without deleting a worktree."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('archive', ROOT / 'scripts/lib/worktree-archive.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class ArchiveCaches(unittest.TestCase):
    def test_cache_roots_keep_only_nested_note(self):
        scratch = ROOT / 'docs.local/storage-tools'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as tmp:
            repo = Path(tmp) / 'repo'
            repo.mkdir()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            names = ['.build.noindex', 'node_modules', '__pycache__', '.pytest_cache', 'dist']
            (repo / '.gitignore').write_text('\n'.join(names + ['docs.local']) + '\n')
            for prefix in ['', 'ui/', 'packages/app/']:
                for name in names:
                    path = repo / prefix / name / 'output'
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('regenerable')
            note = repo / 'packages/app/docs.local/deep/note.md'
            note.parent.mkdir(parents=True)
            note.write_text('keep')
            dest = Path(tmp) / 'archive'
            self.assertEqual(archive.archive(str(repo), [str(dest)]), 0)
            rows = (dest / 'RECEIPT.tsv').read_text().splitlines()
            self.assertEqual(len(rows), 1)
            self.assertTrue(rows[0].startswith('packages/app/docs.local/deep/note.md\t'))
            self.assertEqual((dest / note.relative_to(repo)).read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()

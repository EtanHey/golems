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
                    path = repo / prefix / name / ('arm64-apple-macosx/debug/output' if name == '.build.noindex' else 'output')
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('regenerable')
                    if name == '.build.noindex':
                        for marker in ['workspace-state.json', '.lock']:
                            (repo / prefix / name / marker).write_text('marker')
            note = repo / 'packages/app/docs.local/deep/note.md'
            note.parent.mkdir(parents=True)
            note.write_text('keep')
            dest = Path(tmp) / 'archive'
            self.assertEqual(archive.archive(str(repo), [str(dest)]), 0)
            rows = (dest / 'RECEIPT.tsv').read_text().splitlines()
            self.assertEqual(len(rows), 1)
            self.assertTrue(rows[0].startswith('packages/app/docs.local/deep/note.md\t'))
            self.assertEqual((dest / note.relative_to(repo)).read_text(), 'keep')

    def test_proofs_swift_output_and_case_aliases_survive_in_plan_and_archive(self):
        import csv
        import json
        scratch = ROOT / 'docs.local/storage-tools'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as tmp:
            repo = Path(tmp) / 'repo'
            repo.mkdir()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            (repo / '.gitignore').write_text('.build.noindex/\nnode_modules/\n')
            proofs = ['.build.noindex/test_floor_fail_first.py', '.build.noindex/test_r2_fail_first.py',
                      '.build.noindex/pytest/deep/run.log', '.build.noindex/proof/dist/notes.md',
                      '.build.noindex/Docs.Local/note.md', 'node_modules/Docs.Local/note.md',
                      '.build.noindex/swift/proof/deep/script.py']
            output = ['.build.noindex/workspace-state.json', '.build.noindex/.lock',
                      '.build.noindex/arm64-apple-macosx/debug/object',
                      '.build.noindex/swift/arm64-apple-macosx/debug/object',
                      '.build.noindex/swift/debug.yaml', '.build.noindex/swift/build.db',
                      '.build.noindex/swift/plugin-tools.yaml',
                      '.build.noindex/swift/workspace-state.json', '.build.noindex/swift/.lock',
                      '.build.noindex/swift/checkouts/pkg/source', '.build.noindex/swift/artifacts/item',
                      '.build.noindex/swift/repositories/repo/item', '.build.noindex/release/object',
                      '.build.noindex/ModuleCache/mod', '.build.noindex/index/item',
                      '.build.noindex/__pycache__/module.pyc']
            for rel in proofs + output:
                path = repo / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('fixture')
            # Case aliases inside otherwise disposable output must also protect it.
            alias = '.build.noindex/swift/arm64-apple-macosx/Docs.Local/keep.md'
            (repo / alias).parent.mkdir(parents=True)
            (repo / alias).write_text('keep')
            dest = Path(tmp) / 'archive'
            self.assertEqual(archive.archive(str(repo), [str(dest)]), 0)
            receipt = {r.split('\t')[0] for r in (dest / 'RECEIPT.tsv').read_text().splitlines()}
            for rel in proofs + [alias]:
                self.assertIn(rel, receipt)
                self.assertTrue((dest / rel).is_file())
            protected_output = '.build.noindex/swift/arm64-apple-macosx/debug/object'
            for rel in output:
                if rel != protected_output:
                    self.assertNotIn(rel, receipt)
            plan = Path(tmp) / 'plan.tsv'
            helper = ROOT / 'scripts/lib/worktree-gc-plan.py'
            subprocess.run(['python3', str(helper), 'init', str(plan)], check=True)
            subprocess.run(['python3', str(helper), 'append', str(plan), str(repo), str(repo),
                            'fixture', 'REMOVE', 'fixture'], check=True)
            with plan.open() as fh:
                notes = json.loads(next(csv.DictReader(fh, delimiter='\t'))['notes_to_archive_json'])
            for rel in proofs + [alias]:
                self.assertIn(rel, notes)
            for rel in output:
                if rel != protected_output:
                    self.assertNotIn(rel, notes)

    def test_unmarked_swiftpm_names_are_notes_in_archive_and_plan(self):
        import csv
        import json
        scratch = ROOT / 'docs.local/storage-tools'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as tmp:
            repo = Path(tmp) / 'repo'
            repo.mkdir()
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            (repo / '.gitignore').write_text('.build.noindex/\n')
            paths = ['.build.noindex/artifacts/proof.log',
                     '.build.noindex/.build.noindex/debug/notes.md']
            for rel in paths:
                path = repo / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('handwritten proof')
            dest = Path(tmp) / 'archive'
            archive.archive(str(repo), [str(dest)])
            self.assertTrue((dest / 'RECEIPT.tsv').exists(), 'unmarked proofs must be archived')
            receipt = (dest / 'RECEIPT.tsv').read_text()
            plan = Path(tmp) / 'plan.tsv'
            helper = ROOT / 'scripts/lib/worktree-gc-plan.py'
            subprocess.run(['python3', str(helper), 'init', str(plan)], check=True)
            subprocess.run(['python3', str(helper), 'append', str(plan), str(repo), str(repo),
                            'fixture', 'REMOVE', 'fixture'], check=True)
            with plan.open() as fh:
                notes = json.loads(next(csv.DictReader(fh, delimiter='\t'))['notes_to_archive_json'])
            for rel in paths:
                self.assertIn(rel, receipt)
                self.assertIn(rel, notes)
                self.assertEqual((dest / rel).read_text(), 'handwritten proof')


if __name__ == '__main__':
    unittest.main()

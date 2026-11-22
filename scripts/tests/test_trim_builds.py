"""Scratch-only CLI tests; never invoke trimming on a real checkout."""
import os
import sys
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'trim-builds'


class TrimBuildsTests(unittest.TestCase):
    def setUp(self):
        fixture_parent = SCRIPT.parent.parent / 'docs.local/trim-builds'
        fixture_parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='trim-builds-', dir=fixture_parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.main = self.base / 'main'
        self.main.mkdir()
        self.git(self.main, 'init', '-q')
        self.git(self.main, 'config', 'user.email', 'fixture@localhost')
        self.git(self.main, 'config', 'user.name', 'fixture')
        (self.main / '.gitignore').write_text('*\n!.gitignore\n')
        self.git(self.main, 'add', '.gitignore')
        self.git(self.main, 'commit', '-qm', 'fixture')
        self.tree = self.base / 'tree'
        self.git(self.main, 'worktree', 'add', '-q', '--detach', str(self.tree))
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.lsof('exit 1')

    def git(self, root, *args):
        return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True)

    def lsof(self, body):
        stub = self.bin / 'lsof'
        stub.write_text('#!/bin/sh\n' + body + '\n')
        stub.chmod(0o755)

    def output(self, name='node_modules'):
        path = self.tree / name
        path.mkdir(parents=True)
        (path / 'output').write_text('rebuild me')
        return path

    def run_trim(self, *args, root=None, real_lsof=False):
        env = dict(os.environ)
        if not real_lsof:
            env['PATH'] = str(self.bin) + os.pathsep + env['PATH']
        # Never let an old/red implementation put fixtures in the owner's Trash.
        driver = """
import runpy, subprocess, sys
original = subprocess.run
def guarded(command, *args, **kwargs):
    if isinstance(command, (list, tuple)) and str(command[0]).endswith('/trash'):
        raise RuntimeError('test forbids system Trash')
    return original(command, *args, **kwargs)
subprocess.run = guarded
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
"""
        return subprocess.run([sys.executable, '-c', driver, str(SCRIPT), str(root or self.tree), *args], capture_output=True, text=True, env=env)

    def test_removes_exact_nested_outputs_and_receipts(self):
        paths = [self.output(name) for name in ('node_modules', '.venv', 'venv', '.build', 'pkg/dist', '.next', '__pycache__', '.pytest_cache', 'DerivedData')]
        expected = {path: sum(entry.lstat().st_blocks * 512 for entry in [path, *path.rglob('*')]) for path in paths}
        result = self.run_trim()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(all(not path.exists() for path in paths))
        rows = (self.main / 'docs.local/trim-builds/receipts.tsv').read_text().splitlines()
        self.assertEqual(len(rows), len(paths))
        for row in rows:
            path, size, mtime = row.split('\t')
            self.assertIn(Path(path), paths)
            self.assertEqual(int(size), expected[Path(path)])
            self.assertGreater(float(mtime), 0)

    def test_main_refused(self):
        path = self.main / 'node_modules'
        path.mkdir()
        self.assertNotEqual(self.run_trim(root=self.main).returncode, 0)
        self.assertTrue(path.exists())

    def test_symlink_escape_refused(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (self.tree / 'node_modules').symlink_to(outside, target_is_directory=True)
        self.assertNotEqual(self.run_trim().returncode, 0)
        self.assertTrue(outside.exists())

    def test_tracked_refused(self):
        path = self.output()
        self.git(self.tree, 'add', '-f', str(path / 'output'))
        self.assertNotEqual(self.run_trim().returncode, 0)
        self.assertTrue(path.exists())

    def test_busy_and_lsof_errors_refused(self):
        for body in ('echo p123; exit 0', 'echo failure >&2; exit 1', 'exit 2'):
            self.lsof(body)
            path = self.tree / 'node_modules'
            path.mkdir(exist_ok=True)
            self.assertNotEqual(self.run_trim().returncode, 0)
            self.assertTrue(path.exists())

    def test_protected_subtrees_and_nested_notes(self):
        paths = [self.output(name) for name in ('.build.noindex/node_modules', 'docs.local/dist', '.build-custom/dist', 'node_modules/docs.local')]
        result = self.run_trim()
        self.assertNotEqual(result.returncode, 0)  # nested notes refuse the outer candidate
        self.assertTrue(all(path.exists() for path in paths))

    def test_nested_git_metadata_refused(self):
        path = self.output()
        (path / '.git').write_text('gitdir: elsewhere')
        self.assertNotEqual(self.run_trim().returncode, 0)
        self.assertTrue(path.exists())

    def test_dry_run_no_mutations(self):
        path = self.output()
        result = self.run_trim('--dry-run')
        self.assertEqual(result.stdout.splitlines(), [
            'path\tbytes\treason',
            f'{path}\t{path.lstat().st_blocks * 512 + (path / "output").lstat().st_blocks * 512}\teligible: ignored allowlisted output; no tracked files or open descriptors',
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(path.exists())
        self.assertFalse((self.main / 'docs.local/trim-builds').exists())

    def test_receipt_symlink_refused(self):
        path = self.output()
        outside = self.base / 'outside'
        outside.mkdir()
        (self.main / 'docs.local').symlink_to(outside, target_is_directory=True)
        self.assertNotEqual(self.run_trim().returncode, 0)
        self.assertTrue(path.exists())
        self.assertEqual(list(outside.iterdir()), [])

    def test_unignored_and_nested_repository_kept(self):
        path = self.output()
        (self.tree / '.gitignore').write_text('')
        self.assertNotEqual(self.run_trim().returncode, 0)
        self.assertTrue(path.exists())
        nested = self.tree / 'vendor'
        nested.mkdir()
        self.git(nested, 'init', '-q')
        output = self.output('vendor/dist')
        self.run_trim()
        self.assertTrue(output.exists())

    def test_case_alias_tracked_file_refused(self):
        path = self.tree / 'dist'
        path.mkdir()
        (path / 'keep.txt').write_text('KEEP')
        (self.tree / '.gitignore').write_text('dist/\n')
        self.git(self.tree, 'config', 'core.ignorecase', 'true')
        # Exact APFS repro: physical dist/ but index spelling Dist/keep.txt.
        if (self.tree / 'Dist').exists():
            self.git(self.tree, 'add', '-f', 'Dist/keep.txt')
        else:
            blob = self.git(self.tree, 'hash-object', '-w', 'dist/keep.txt').stdout.decode().strip()
            self.git(self.tree, 'update-index', '--add', '--cacheinfo', '100644', blob, 'Dist/keep.txt')
        self.git(self.tree, 'commit', '-qm', 'keep case alias')
        self.assertIn(b'Dist/keep.txt', self.git(self.tree, 'ls-files').stdout)
        for args in [('--dry-run',), ()]:
            result = self.run_trim(*args)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn('tracked files', result.stderr)
            self.assertEqual((path / 'keep.txt').read_text(), 'KEEP')

    def test_case_alias_untracked_exception_refused(self):
        path = self.output('dist')
        (self.tree / '.gitignore').write_text('dist/\n')
        # Nonignored case-variant subtree on case-sensitive hosts also has to be
        # matched by Git's icase pathspec (APFS aliases it to the same directory).
        alias = self.tree / 'Dist'
        if alias.exists():
            (self.tree / '.gitignore').write_text('dist/*\n!dist/keep.txt\n')
        else:
            alias.mkdir()
        (alias / 'keep.txt').write_text('KEEP')
        result = self.run_trim('--dry-run')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('nonignored files', result.stderr)
        self.assertTrue(path.exists())

    def test_casefold_protected_roots(self):
        for name in ('.Build.noindex/node_modules', '.BUILD-custom/dist', 'Docs.Local/dist', 'pkg/.GIT/dist'):
            with self.subTest(name=name):
                path = self.output(name)
                result = self.run_trim('--dry-run')
                self.assertNotIn(str(path) + '\t', result.stdout)
                self.assertTrue(path.exists())

    def test_casefold_nested_protected_names(self):
        for name in ('Docs.Local', '.GIT', '.Build.noindex', '.BUILD-custom'):
            with self.subTest(name=name):
                path = self.output('pkg' + name + '/dist/' + name)
                result = self.run_trim('--dry-run')
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn('protected', result.stderr)
                self.assertIn(str(path.parent), result.stderr)
                self.assertTrue(path.exists())

    def test_internal_symlinks_unlinked_without_following(self):
        for name in ('node_modules', '.venv'):
            with self.subTest(name=name):
                path = self.output(name)
                outside = self.base / ('outside-' + name)
                outside.mkdir()
                (outside / 'keep').write_text('KEEP')
                bindir = path / '.bin'
                bindir.mkdir()
                (bindir / 'outside').symlink_to(outside, target_is_directory=True)
                (bindir / 'local').symlink_to(path / 'output')
                (bindir / 'dangling').symlink_to(path / 'absent')
                result = self.run_trim()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(path.exists())
                self.assertEqual((outside / 'keep').read_text(), 'KEEP')

    def test_symlink_parent_is_never_followed(self):
        real = self.tree / 'real'
        (real / 'dist').mkdir(parents=True)
        (real / 'dist/keep').write_text('KEEP')
        (self.tree / 'alias').symlink_to(real, target_is_directory=True)
        # Direct validation proves parent alias refusal; discovery must not
        # enter it either (use a nonignored real subtree so it is kept).
        import runpy
        module = runpy.run_path(str(SCRIPT))
        with self.assertRaises(ValueError):
            module['validate'](self.tree, self.tree / 'alias/dist')
        self.assertNotIn(self.tree / 'alias/dist', list(module['candidates'](self.tree)))
        self.assertEqual((real / 'dist/keep').read_text(), 'KEEP')

    def test_local_run_has_no_trim_hook(self):
        source = (SCRIPT.parent / 'ratchet/local-run.sh').read_text()
        self.assertNotIn('trim-builds', source)
        self.assertNotIn('--no-checkout', source)

    def test_allocated_bytes_exclude_external_hardlinks_and_symlink_targets(self):
        path = self.output()
        outside = self.base / 'large-outside'
        outside.write_bytes(b'x' * 65536)
        os.link(outside, path / 'shared')
        (path / 'outside-link').symlink_to(outside)
        expected = sum(entry.lstat().st_blocks * 512 for entry in (
            path, path / 'output', path / 'outside-link'))
        result = self.run_trim('--dry-run')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(int(result.stdout.splitlines()[1].split('\t')[1]), expected)
        result = self.run_trim()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(path.exists())
        self.assertEqual(outside.read_bytes(), b'x' * 65536)
        row = (self.main / 'docs.local/trim-builds/receipts.tsv').read_text().splitlines()[0]
        self.assertEqual(int(row.split('\t')[1]), expected)

    def test_remove_is_rmtree_with_stop_callback(self):
        import runpy
        from unittest.mock import patch
        module = runpy.run_path(str(SCRIPT))
        path = self.output()
        for version, callback in (((3, 11), 'onerror'), ((3, 12), 'onexc')):
            with self.subTest(version=version), patch.object(sys, 'version_info', version), patch('shutil.rmtree') as remove, patch('subprocess.run', side_effect=AssertionError('no system Trash')):
                # Mock removal leaves the path: completion guard must refuse.
                with self.assertRaises(ValueError):
                    module['remove'](path)
                self.assertEqual(remove.call_count, 1)
                self.assertEqual(set(remove.call_args.kwargs), {callback})
                stop = remove.call_args.kwargs[callback]
                error = PermissionError('fixture failure')
                callback_error = error if callback == 'onexc' else (type(error), error, None)
                with self.assertRaises(PermissionError) as raised:
                    stop(None, str(path), callback_error)
                self.assertIs(raised.exception, error)

    def test_real_open_file(self):
        path = self.output()
        with (path / 'output').open():
            result = self.run_trim(real_lsof=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(path.exists())
        self.assertIn('busy', result.stderr)


if __name__ == '__main__':
    unittest.main()

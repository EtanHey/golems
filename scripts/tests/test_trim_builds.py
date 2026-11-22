"""Scratch-only CLI tests; never invoke trimming on a real checkout."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'trim-builds'


class TrimBuildsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='trim-builds-', dir=SCRIPT.parent.parent / 'docs.local/trim-builds')
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
        return subprocess.run([str(SCRIPT), str(root or self.tree), *args], capture_output=True, text=True, env=env)

    def test_removes_exact_nested_outputs_and_receipts(self):
        paths = [self.output(name) for name in ('node_modules', '.venv', 'venv', '.build', 'pkg/dist', '.next', '__pycache__', '.pytest_cache', 'DerivedData')]
        result = self.run_trim()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(all(not path.exists() for path in paths))
        rows = (self.main / 'docs.local/trim-builds/receipts.tsv').read_text().splitlines()
        self.assertEqual(len(rows), len(paths))
        for row in rows:
            path, size, mtime = row.split('\t')
            self.assertIn(Path(path), paths)
            self.assertEqual(int(size), 10)
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

    def test_internal_symlink_and_git_metadata_refused(self):
        path = self.output()
        (path / 'alias').symlink_to(self.main, target_is_directory=True)
        self.assertNotEqual(self.run_trim().returncode, 0)
        self.assertTrue(path.exists())
        (path / 'alias').unlink()
        (path / '.git').write_text('gitdir: elsewhere')
        self.assertNotEqual(self.run_trim().returncode, 0)
        self.assertTrue(path.exists())

    def test_dry_run_no_mutations(self):
        path = self.output()
        result = self.run_trim('--dry-run')
        self.assertEqual(result.stdout.splitlines(), [
            'path\tbytes\treason',
            f'{path}\t10\teligible: ignored allowlisted output; no tracked files or open descriptors',
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

    def test_exit_hook_success_failure_keep_and_refusal(self):
        # Execute the actual EXIT-trap body, with a stub trim command, on owned
        # scratch only. No installer/network/heavy ratchet rows are run.
        source = (SCRIPT.parent / 'ratchet/local-run.sh').read_text()
        cleanup = source[source.index('cleanup() {'):source.index('trap cleanup EXIT')]
        ratchet = self.base / 'hooks/ratchet'
        ratchet.mkdir(parents=True)
        trimmer = ratchet.parent / 'trim-builds'
        log = self.base / 'calls'
        run = self.base / 'run'
        run.mkdir()
        scratch = self.base / 'scratch'
        (scratch / 'home').mkdir(parents=True)
        clone = scratch / 'clone'
        clone.mkdir()
        env = dict(os.environ, HERE=str(ratchet), RUN=str(run), SCRATCH=str(scratch),
                   SH=str(scratch / 'home'), CLONE=str(clone), REAL_HOME=str(self.base),
                   KEEP='1')
        for status in (0, 7):
            trimmer.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "' + str(log) + '"\n')
            trimmer.chmod(0o755)
            result = subprocess.run(['bash', '-c', cleanup + '\ntrap cleanup EXIT\nexit ' + str(status)], env=env, capture_output=True)
            self.assertEqual(result.returncode, status, result.stderr)
        self.assertEqual(log.read_text().splitlines(), [str(clone)] * 2)
        trimmer.write_text('#!/bin/sh\nexit 1\n')
        env['KEEP'] = '0'
        result = subprocess.run(['bash', '-c', cleanup + '\ntrap cleanup EXIT\nexit 7'], env=env, capture_output=True)
        self.assertEqual(result.returncode, 7)
        self.assertTrue(clone.exists())
        self.assertIn(b'retaining scratch', result.stderr)

    def test_real_open_file(self):
        path = self.output()
        with (path / 'output').open():
            result = self.run_trim(real_lsof=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(path.exists())
        self.assertIn('busy', result.stderr)


if __name__ == '__main__':
    unittest.main()

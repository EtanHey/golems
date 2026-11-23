"""Plan snapshots reuse probes; apply helpers retain their fresh default."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

LIB = Path(__file__).resolve().parents[1] / 'lib'
def load(name):
    spec = importlib.util.spec_from_file_location(name, LIB / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class Snapshots(unittest.TestCase):
    def test_open_files_probed_once_and_reused(self):
        files = load('worktree-gc-t3')
        scratch = LIB.parents[1] / 'docs.local'
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            snapshot = Path(directory) / 'files.json'
            result = subprocess.CompletedProcess([], 0, 'p123\nfcwd\nn/elsewhere\nf3\nn/tree/open\n', '')
            with patch.object(files.subprocess, 'check_output', return_value=b'123\n'), patch.object(files.subprocess, 'run', return_value=result) as lsof:
                snapshot.write_text(json.dumps(files.open_file_snapshot()))
                with patch.dict(os.environ, WORKTREE_GC_FILES_SNAPSHOT=str(snapshot)):
                    self.assertFalse(files.files_unused('/tree'))
                    self.assertTrue(files.files_unused('/other'))
                self.assertEqual(lsof.call_count, 1)
            snapshot.unlink()
            with patch.dict(os.environ, WORKTREE_GC_FILES_SNAPSHOT=str(snapshot)):
                with self.assertRaises(OSError):
                    files.files_unused('/tree')

    def test_database_source_opened_once(self):
        import sqlite3
        state = load('worktree-gc-state')
        scratch = LIB.parents[1] / 'docs.local'
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            source, target = Path(directory) / 'source.sqlite', Path(directory) / 'snapshot.sqlite'
            with sqlite3.connect(source) as conn:
                conn.execute('CREATE TABLE orchestration_v2_projection_threads(thread_id, payload_json, deleted_at)')
                conn.execute('INSERT INTO orchestration_v2_projection_threads VALUES (?,?,NULL)', ('thread', '{"worktreePath":"/tree"}'))
                conn.execute('CREATE TABLE projection_projects(workspace_root)')
                conn.execute('CREATE TABLE scheduled_tasks(thread_id, enabled)')
                for name in ('runs', 'provider_sessions', 'runtime_requests', 'provider_threads', 'turn_items'):
                    conn.execute('CREATE TABLE orchestration_v2_projection_' + name + '(thread_id,status,payload_json)')
            conn.close()
            with patch.dict(os.environ, WORKTREE_GC_T3_DB=str(source), WORKTREE_GC_T3_SNAPSHOT=''):
                with patch.object(state.sqlite3, 'connect', wraps=sqlite3.connect) as connect:
                    state.snapshot_database(str(target))
                    source_reads = [call for call in connect.call_args_list if 'mode=ro' in str(call)]
                    self.assertEqual(len(source_reads), 1)
            source.unlink()
            with patch.dict(os.environ, WORKTREE_GC_T3_DB=str(source), WORKTREE_GC_T3_SNAPSHOT=str(target)):
                with patch.object(state.subprocess, 'run', wraps=subprocess.run) as sqlite_probe:
                    self.assertEqual(state.t3_threads('/tree')[0]['id'], 'thread')
                    self.assertEqual(state.t3_threads('/tree')[0]['id'], 'thread')
                    self.assertTrue(all(str(target) in str(call) for call in sqlite_probe.call_args_list))
            with sqlite3.connect(target) as conn:
                self.assertEqual(conn.execute('SELECT thread_id FROM orchestration_v2_projection_threads').fetchall(), [('thread',)])
            conn.close()

    def test_recent_root_keeps_without_walking_or_reading_git(self):
        import time
        from types import SimpleNamespace
        files = load('worktree-gc-t3')
        with patch.object(files.os, 'lstat', return_value=SimpleNamespace(st_mtime=time.time())), patch.object(files, 'git', side_effect=AssertionError('unnecessary Git read')), patch.object(files, 'walk', side_effect=AssertionError('unnecessary walk')):
            self.assertFalse(files.old('/tree'))

    def test_old_tree_requires_complete_walk(self):
        import time
        from types import SimpleNamespace
        files = load('worktree-gc-t3')
        with patch.object(files.os, 'lstat', return_value=SimpleNamespace(st_mtime=time.time()-172800)), patch.object(files, 'git', return_value=b'/nonexistent-admin'), patch.object(files, 'walk', side_effect=OSError('unreadable')):
            with self.assertRaises(OSError):
                files.old('/tree')

    def test_symlink_scan_reused_and_missing_snapshot_fails(self):
        state = load('worktree-gc-state')
        scratch = LIB.parents[1] / 'docs.local'
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            snapshot = Path(directory) / 'symlinks.json'
            with patch.object(state, 'symlink_targets', return_value=iter([('/skill', '/tree/skill')])) as scan:
                snapshot.write_text(json.dumps(list(state.symlink_targets())))
                with patch.dict(os.environ, WORKTREE_GC_SYMLINK_SNAPSHOT=str(snapshot)):
                    self.assertTrue(state.live_symlink('/tree'))
                    self.assertFalse(state.live_symlink('/other'))
                self.assertEqual(scan.call_count, 1)
            snapshot.unlink()
            with patch.dict(os.environ, WORKTREE_GC_SYMLINK_SNAPSHOT=str(snapshot)):
                with self.assertRaises(OSError):
                    state.live_symlink('/tree')

    def test_partial_open_files_fail_closed(self):
        files = load('worktree-gc-t3')
        result = subprocess.CompletedProcess([], 0, 'p999\nf3\nn/elsewhere\n', '')
        with patch.object(files.subprocess, 'check_output', return_value=b'123\n'), patch.object(files.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(ValueError, 'partial open-file process coverage'):
                files.open_file_snapshot()

    def test_stalled_plan_remote_is_bounded_and_unproven(self):
        result = subprocess.run(['python3', str(LIB / 'worktree-gc-remote.py'), '0.05',
                                 'python3', '-c', 'import time; time.sleep(10)'],
                                capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 124)
        self.assertIn('remote-state-unproven', result.stderr)

    def test_remote_wrapper_signals_reap_its_child(self):
        import signal
        import time
        scratch = LIB.parents[1] / 'docs.local'
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            with self.subTest(signal=sig), tempfile.TemporaryDirectory(dir=scratch) as directory:
                pidfile = Path(directory) / 'child.pid'
                code = 'import os,time,pathlib,sys,signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); time.sleep(30)'
                wrapper = subprocess.Popen(['python3', str(LIB / 'worktree-gc-remote.py'), '30',
                                            'python3', '-c', code, str(pidfile)],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                child = None
                try:
                    deadline = time.monotonic() + 3
                    while not pidfile.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(pidfile.exists())
                    child = int(pidfile.read_text())
                    wrapper.send_signal(sig)
                    self.assertEqual(wrapper.wait(timeout=3), 128 + sig)
                    with self.assertRaises(ProcessLookupError):
                        os.kill(child, 0)
                finally:
                    if wrapper.poll() is None:
                        wrapper.kill()
                        wrapper.wait()
                    if child:
                        try:
                            os.kill(child, signal.SIGKILL)
                        except ProcessLookupError:
                            pass

    def test_empty_finished_pr_has_categorized_error(self):
        result = subprocess.run(['python3', str(LIB / 'worktree-gc-prs.py'), 'finished'], input='[]', text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('no merged or closed PR', result.stderr)

if __name__ == '__main__':
    unittest.main()

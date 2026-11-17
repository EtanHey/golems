"""Retained, non-destructive outage fixtures. No cleanup/temporary-directory teardown."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
ENTRY = Path(os.environ.get('OUTAGE_GC_ENTRY', ROOT / 'scripts/worktree-gc.sh'))
BUDGET = Path(os.environ.get('OUTAGE_GC_BUDGET', ROOT / 'scripts/lib/worktree-gc-budget.py'))


def kill_owned_tree(root_pid):
    # Snapshot ancestry while the root is still ours/alive, then stop only its groups.
    rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,pgid='], text=True, timeout=2)
    table = [tuple(map(int, row.split())) for row in rows.splitlines()]
    owned = {root_pid}
    while True:
        next_owned = owned | {pid for pid, parent, _group in table if parent in owned}
        if next_owned == owned:
            break
        owned = next_owned
    groups = {group for pid, _parent, group in table if pid in owned}
    assert os.getpgrp() not in groups
    for group in groups:
        try:
            os.killpg(group, signal.SIGKILL)
        except ProcessLookupError:
            pass


class OutageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        parent = Path.home() / '.local/state/golems/gc-fixtures'
        parent.mkdir(parents=True, exist_ok=True)
        cls.scratch = Path(tempfile.mkdtemp(prefix='outage-retained-', dir=parent))
        print('RETAINED SCRATCH: ' + str(cls.scratch), flush=True)
        cls.real_git = subprocess.check_output(['/bin/sh', '-c', 'command -v git'], text=True).strip()

    def fixture(self, label):
        folder = self.scratch / label
        folder.mkdir()
        repo = folder / 'repo'
        env = os.environ.copy()
        for name in list(env):
            if name.startswith(('GIT_', 'GC_RUN_', 'GC_BUDGET_', 'GC_SUPERVISOR')):
                env.pop(name)
        env.update(HOME=str(folder / 'home'), GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1')
        Path(env['HOME']).mkdir()
        def git(*args):
            subprocess.run([self.real_git, *args], env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=5)
        git('init', '-q', '-b', 'main', str(repo))
        git('-C', str(repo), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'seed', '--allow-empty')
        bare = folder / 'origin.git'
        git('clone', '--bare', '-q', str(repo), str(bare))
        git('-C', str(repo), 'remote', 'add', 'origin', str(bare))
        git('-C', str(repo), 'fetch', '-q', 'origin')
        bad, safe = repo / '.worktrees/a-bad', repo / '.worktrees/z-pinned'
        git('-C', str(repo), 'worktree', 'add', '-qb', 'a-bad', str(bad), 'origin/main')
        git('-C', str(repo), 'worktree', 'add', '-qb', 'z-pinned', str(safe), 'origin/main')
        git('-C', str(repo), 'config', 'url.' + str(bare) + '.insteadOf', 'https://github.com/fixture/outage')
        git('-C', str(repo), 'remote', 'set-url', 'origin', 'https://github.com/fixture/outage')
        pins = folder / 'pins'; pins.write_text(str(safe) + '\n')
        registry = folder / 'registry'; registry.write_text('')
        binary = folder / 'bin'; binary.mkdir()
        gh = binary / 'gh'; gh.write_text('#!/bin/bash\necho "[]"\n'); gh.chmod(0o755)
        env.update(PATH=str(binary) + ':' + env['PATH'], REAL_GIT=self.real_git,
                   OUTAGE_BIN=str(binary), OUTAGE_ENTRY=str(ENTRY), OUTAGE_REPO=str(repo),
                   WORKTREE_GC_REPORT_DIR=str(folder / 'report'), WORKTREE_GC_PINS_FILE=str(pins),
                   WORKTREE_GC_CMUX_REGISTRY=str(registry), WORKTREE_GC_T3_DB=str(folder / 'missing.sqlite'),
                   WORKTREE_GC_BUDGET_SECONDS='5', WORKTREE_GC_GH_TIMEOUT_SECONDS='2',
                   WORKTREE_GC_GIT_TIMEOUT_SECONDS='.25')
        (Path(env['HOME']) / '.bash_profile').write_text('export PATH="$OUTAGE_BIN:$PATH"\n')
        return folder, repo, bad, safe, binary, env

    def run_gc(self, folder, env, mode, maximum=5):
        env = dict(env, OUTAGE_MODE=mode)
        output = folder / (mode[2:] + '.console')
        start = time.time()
        with output.open('wb') as stream:
            child = subprocess.Popen(['/bin/bash', '-lc', 'exec /bin/bash "$OUTAGE_ENTRY" "$OUTAGE_MODE" --repo "$OUTAGE_REPO"'],
                                     env=env, stdout=stream, stderr=stream, start_new_session=True)
            while child.poll() is None and time.time() - start < maximum:
                time.sleep(.02)
            finished = child.poll() is not None
            if not finished:
                kill_owned_tree(child.pid)
                child.wait(timeout=2)
        elapsed = time.time() - start
        print(mode, 'finished=', finished, 'exit=', child.returncode, 'elapsed=', round(elapsed, 3), flush=True)
        self.assertTrue(finished, 'outer test watchdog had to stop the GC; ' + str(output))
        return child.returncode, elapsed, output.read_text()

    def test_bootstrap_hang_budget_in_every_mode(self):
        for mode in ('--dry-run', '--prune-plan', '--apply'):
            with self.subTest(mode=mode):
                folder, _repo, bad, safe, binary, env = self.fixture('startup-' + mode[2:])
                script = binary / 'git'
                script.write_text('#!/bin/bash\ncase "$*" in *--local-env-vars*) trap "" TERM; while :; do /bin/sleep 1; done;; esac\nexec "$REAL_GIT" "$@"\n')
                script.chmod(0o755)
                env['WORKTREE_GC_BUDGET_SECONDS'] = '.7'
                code, elapsed, text = self.run_gc(folder, env, mode)
                self.assertEqual(code, 124)
                self.assertLess(elapsed, 4)
                report = json.loads((folder / 'report/last-run.json').read_text())
                self.assertEqual(report['status'], 'partial')
                self.assertTrue(report['budget_exhausted'])
                self.assertTrue(bad.exists() and safe.exists())
                self.assertNotIn(' · REMOVING · ', text)

    def test_gh_pipe_hang_timeout_is_local_and_continues(self):
        for mode in ('--dry-run', '--prune-plan', '--apply'):
            with self.subTest(mode=mode):
                folder, _repo, bad, safe, binary, env = self.fixture('gh-' + mode[2:])
                env['OUTAGE_GH_MARKER'] = str(folder/'gh-started')
                script = binary / 'gh'
                script.write_text('#!/bin/bash\ncase "$*" in *"--head a-bad "*) echo "$$" > "$OUTAGE_GH_MARKER"; trap "" TERM; (trap "" TERM; while :; do /bin/sleep 1; done) & wait;; *) echo "[]";; esac\n')
                script.chmod(0o755)
                env['WORKTREE_GC_BUDGET_SECONDS'] = '7'
                env['WORKTREE_GC_GH_TIMEOUT_SECONDS'] = '2'
                code, elapsed, text = self.run_gc(folder, env, mode, maximum=8)
                self.assertEqual(code, 0)
                self.assertTrue((folder/'gh-started').exists(), 'hung gh must actually execute')
                self.assertLess(elapsed, 6)
                report = json.loads((folder / 'report/last-run.json').read_text())
                rows = {r['path']: r for r in report['checkouts']}
                self.assertEqual(rows[str(bad)]['verdict'], 'KEEP-undetermined')
                self.assertIn('timeout', rows[str(bad)]['detail'].lower())
                self.assertEqual(rows[str(safe)]['verdict'], 'KEEP-pinned')
                self.assertFalse(report['budget_exhausted'])
                self.assertNotIn(' · REMOVING · ', text)

    def test_git_fetch_hang_is_bounded_without_nightly(self):
        folder, _repo, bad, safe, binary, env = self.fixture('fetch')
        env['OUTAGE_GIT_MARKER'] = str(folder/'git-started')
        script = binary / 'git'
        script.write_text('#!/bin/bash\ncase " $* " in *" fetch "*) echo "$$" > "$OUTAGE_GIT_MARKER"; trap "" TERM; (trap "" TERM; while :; do /bin/sleep 1; done) & wait;; esac\nexec "$REAL_GIT" "$@"\n')
        script.chmod(0o755)
        code, elapsed, text = self.run_gc(folder, env, '--prune-plan')
        self.assertEqual(code, 0)
        self.assertLess(elapsed, 4)
        self.assertTrue(bad.exists() and safe.exists())
        self.assertIn('KEEP-undetermined', text)
        self.assertTrue((folder/'git-started').exists(), 'hung fetch must actually execute')

    def test_git_ls_remote_hang_is_bounded(self):
        folder, _repo, bad, safe, binary, env = self.fixture('ls-remote')
        env['OUTAGE_GIT_MARKER'] = str(folder/'git-started')
        env['WORKTREE_GC_BUDGET_SECONDS'] = '5'
        env['WORKTREE_GC_T3_ROOTS'] = str(bad)
        with sqlite3.connect(env['WORKTREE_GC_T3_DB']) as db:
            db.executescript("""
                CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT,payload_json TEXT,deleted_at TEXT);
                CREATE TABLE orchestration_v2_projection_runs(thread_id TEXT,status TEXT);
                CREATE TABLE orchestration_v2_projection_provider_sessions(thread_id TEXT,status TEXT);
                CREATE TABLE orchestration_v2_projection_runtime_requests(thread_id TEXT,status TEXT);
                CREATE TABLE orchestration_v2_projection_provider_threads(thread_id TEXT,payload_json TEXT,status TEXT);
                CREATE TABLE orchestration_v2_projection_turn_items(thread_id TEXT,status TEXT);
                CREATE TABLE projection_projects(workspace_root TEXT);
                CREATE TABLE scheduled_tasks(thread_id TEXT,enabled INTEGER);
            """)
            db.execute('INSERT INTO orchestration_v2_projection_threads VALUES (?,?,NULL)',
                       ('t', json.dumps(dict(worktreePath=str(bad), settledAt='2020-01-01'))))
        db.close()
        script = binary / 'git'
        script.write_text('#!/bin/bash\ncase " $* " in *" ls-remote "*) echo "$$" > "$OUTAGE_GIT_MARKER"; trap "" TERM; while :; do /bin/sleep 1; done;; esac\nexec "$REAL_GIT" "$@"\n')
        script.chmod(0o755)
        code, elapsed, text = self.run_gc(folder, env, '--prune-plan')
        self.assertEqual(code, 0)
        self.assertLess(elapsed, 4)
        self.assertTrue(bad.exists() and safe.exists())
        self.assertIn('remote default lookup failed', text)
        self.assertTrue((folder/'git-started').exists(), 'hung ls-remote must actually execute')

    def test_network_parent_exit_does_not_leave_output_holder(self):
        folder, _repo, _bad, _safe, binary, _env = self.fixture('exited-parent')
        script = binary / 'gh'
        pidfile = folder / 'pids'
        script.write_text('#!/bin/bash\n(trap "" TERM; while :; do /bin/sleep 1; done) &\necho "$$ $!" > "$OUTAGE_PIDS"\necho "[]"\nexit 0\n')
        script.chmod(0o755)
        spec = importlib.util.spec_from_file_location('exit_budget', BUDGET)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        previous = os.environ.copy()
        try:
            os.environ.update(GC_RUN_DEADLINE=str(time.clock_gettime(time.CLOCK_MONOTONIC)+10),
                              GC_RUN_WALL_DEADLINE=str(time.time()+10),
                              GC_BUDGET_MARKER=str(folder/'budget'), GC_CAPTURE_DIR=str(folder/'captures'),
                              WORKTREE_GC_GH_TIMEOUT_SECONDS='2', OUTAGE_PIDS=str(pidfile), HOME=_env['HOME'])
            self.assertEqual(module.run([str(script)]), 0)
            leader, descendant = map(int, pidfile.read_text().split())
            state = subprocess.run(['/bin/ps', '-o', 'stat=', '-p', str(descendant)],
                                   capture_output=True, text=True, timeout=2).stdout.strip()
            alive = bool(state and not state.startswith('Z'))
            if alive:
                self.assertEqual(os.getpgid(descendant), leader)
                os.killpg(leader, signal.SIGKILL)  # Only the just-created fixture group.
            self.assertFalse(alive, 'network parent exited but its output-holding child survived')
        finally:
            os.environ.clear(); os.environ.update(previous)

    def test_gh_timeout_does_not_poison_the_next_unpinned_checkout(self):
        folder, _repo, bad, safe, binary, env = self.fixture('transient-gh')
        Path(env['WORKTREE_GC_PINS_FILE']).write_text('')
        env['WORKTREE_GC_BUDGET_SECONDS'] = '8'
        env['WORKTREE_GC_GH_TIMEOUT_SECONDS'] = '2'
        env['OUTAGE_GH_MARKER'] = str(folder/'gh-started')
        gh=binary/'gh'
        gh.write_text('#!/bin/bash\ncase "$*" in *"--head a-bad "*) echo "$$" > "$OUTAGE_GH_MARKER"; trap "" TERM; while :; do /bin/sleep 1; done;; *) echo "[]";; esac\n')
        gh.chmod(0o755)
        code, _elapsed, text=self.run_gc(folder, env, '--prune-plan', maximum=9)
        self.assertEqual(code, 0)
        report=json.loads((folder/'report/last-run.json').read_text())
        rows={row['path']:row for row in report['checkouts']}
        self.assertTrue((folder/'gh-started').exists())
        self.assertEqual(rows[str(bad)]['verdict'], 'KEEP-undetermined')
        self.assertEqual(rows[str(safe)]['verdict'], 'KEEP-active')
        self.assertEqual(report['network_error_count'], 1)
        self.assertTrue(bad.exists() and safe.exists())
        self.assertNotIn(' · REMOVING · ', text)

    def test_fetch_timeout_does_not_poison_the_next_checkout(self):
        folder, _repo, bad, safe, binary, env = self.fixture('transient-fetch')
        Path(env['WORKTREE_GC_PINS_FILE']).write_text('')
        env['OUTAGE_FETCH_FLAG'] = str(folder/'first-fetch')
        env['WORKTREE_GC_BUDGET_SECONDS'] = '6'
        script = binary/'git'
        script.write_text('#!/bin/bash\ncase " $* " in *" fetch "*) if [[ ! -e "$OUTAGE_FETCH_FLAG" ]]; then : > "$OUTAGE_FETCH_FLAG"; trap "" TERM; while :; do /bin/sleep 1; done; fi;; esac\nexec "$REAL_GIT" "$@"\n')
        script.chmod(0o755)
        code, _elapsed, text = self.run_gc(folder, env, '--prune-plan', maximum=7)
        self.assertEqual(code, 0)
        report=json.loads((folder/'report/last-run.json').read_text())
        rows={row['path']:row for row in report['checkouts']}
        self.assertEqual(rows[str(bad)]['verdict'], 'KEEP-undetermined')
        self.assertEqual(rows[str(safe)]['verdict'], 'KEEP-active')
        self.assertEqual(report['network_error_count'], 1)
        self.assertEqual(report['status'], 'partial')
        self.assertTrue(bad.exists() and safe.exists())
        self.assertNotIn(' · REMOVING · ', text)

    def test_global_budget_stops_hung_network_group_after_an_earlier_decision(self):
        folder, repo, bad, _safe, binary, env = self.fixture('global-gh')
        early = repo / '.worktrees/0-early'
        subprocess.run([self.real_git, '-C', str(repo), 'worktree', 'add', '-qb', '0-early', str(early), 'origin/main'],
                       check=True, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=3)
        with Path(env['WORKTREE_GC_PINS_FILE']).open('a') as pins:
            pins.write(str(early)+'\n')
        pids = folder / 'network-pids'; env['OUTAGE_PIDS'] = str(pids)
        env['WORKTREE_GC_BUDGET_SECONDS'] = '2.5'
        env['WORKTREE_GC_GH_TIMEOUT_SECONDS'] = '30'
        gh = binary / 'gh'
        gh.write_text('#!/bin/bash\ntrap "" TERM\n(trap "" TERM; while :; do /bin/sleep 1; done) &\necho "$$ $!" > "$OUTAGE_PIDS"\nwait\n')
        gh.chmod(0o755)
        code, duration, text = self.run_gc(folder, env, '--apply')
        self.assertEqual(code, 124); self.assertLess(duration, 4)
        report = json.loads((folder/'report/last-run.json').read_text())
        self.assertTrue(report['budget_exhausted']); self.assertEqual(report['status'], 'partial')
        self.assertTrue(any(row['path']==str(early) and row['verdict']=='KEEP-pinned' for row in report['checkouts']))
        self.assertTrue(bad.exists() and early.exists())
        self.assertNotIn(' · REMOVING · ', text)
        self.assertTrue(pids.exists(), 'network hang must actually have started')
        leader, descendant = map(int, pids.read_text().split())
        end = time.time() + .3
        while True:
            status = subprocess.run(['/bin/ps', '-o', 'stat=', '-p', str(descendant)], capture_output=True, text=True, timeout=2).stdout.strip()
            alive = bool(status and not status.startswith('Z'))
            if not alive or time.time() >= end:
                break
            time.sleep(.01)
        if alive:
            self.assertEqual(os.getpgid(descendant), leader)
            os.killpg(leader, signal.SIGKILL)
        self.assertFalse(alive, 'global budget left a hung network descendant running')

    def test_normal_raw_modes_finish_and_keep_pinned_data(self):
        for mode in ('--dry-run', '--prune-plan', '--apply'):
            with self.subTest(mode=mode):
                folder, _repo, bad, safe, _binary, env = self.fixture('normal-'+mode[2:])
                env['WORKTREE_GC_BUDGET_SECONDS'] = '8'
                code, _duration, text = self.run_gc(folder, env, mode, maximum=10)
                self.assertEqual(code, 0)
                report=json.loads((folder/'report/last-run.json').read_text())
                self.assertFalse(report['budget_exhausted'])
                rows={row['path']:row for row in report['checkouts']}
                self.assertEqual(rows[str(bad)]['verdict'], 'REMOVE' if mode == '--dry-run' else 'KEEP-active')
                self.assertEqual(rows[str(safe)]['verdict'], 'KEEP-pinned')
                self.assertTrue(safe.exists() and bad.exists())  # Apply is held by fresh activity.
                self.assertNotIn(' · REMOVED · ', text)

    def test_partial_report_preserves_complete_rows_after_interrupted_append(self):
        folder=self.scratch/'interrupted-journal'; folder.mkdir()
        journal=folder/'rows.jsonl'
        row=dict(kind='checkout', repo='fixture', path=str(folder/'kept'), branch='pinned',
                 verdict='KEEP-pinned', detail='earlier complete decision', size_bytes=1)
        journal.write_text(json.dumps(row)+'\n'+ '{"kind":')
        spec=importlib.util.spec_from_file_location('partial_publisher', ROOT/'scripts/lib/worktree-gc-state.py')
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        module.finish_report(str(journal), str(folder/'report'), 124, 0)
        result=json.loads((folder/'report/last-run.json').read_text())
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['journal_error_count'], 1)
        self.assertEqual(result['checkouts'][0]['verdict'], 'KEEP-pinned')

    def test_deadline_epoch_is_shared_across_python_interpreters(self):
        probe = "import importlib.util; s=importlib.util.spec_from_file_location('budget', __import__('sys').argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.remaining())"
        env=dict(os.environ, GC_RUN_DEADLINE=str(time.clock_gettime(time.CLOCK_MONOTONIC)+5),
                 GC_RUN_WALL_DEADLINE=str(time.time()+10))
        for executable in {sys.executable, '/usr/bin/python3'}:
            with self.subTest(executable=executable):
                value=float(subprocess.check_output([executable, '-c', probe, str(BUDGET)], env=env, text=True, timeout=2))
                self.assertGreater(value, 3)
                self.assertLessEqual(value, 5)

    def test_wall_deadline_wins_when_monotonic_has_not_advanced(self):
        spec = importlib.util.spec_from_file_location('outage_budget', BUDGET)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        marker = self.scratch / 'wall-expired'
        previous = os.environ.copy()
        try:
            os.environ.update(GC_RUN_DEADLINE=str(time.clock_gettime(time.CLOCK_MONOTONIC)+1000),
                              GC_RUN_WALL_DEADLINE=str(time.time()-1), GC_BUDGET_MARKER=str(marker))
            self.assertTrue(module.expired())
        finally:
            os.environ.clear(); os.environ.update(previous)


if __name__ == '__main__':
    unittest.main(verbosity=2)

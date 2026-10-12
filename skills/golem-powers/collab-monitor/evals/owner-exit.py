#!/usr/bin/env python3
"""Real process lifecycle regressions, isolated from fleet monitor state."""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import time
import unittest

MONITOR = Path(__file__).resolve().parents[1] / 'scripts/collab-monitor.sh'
PARENT = MONITOR.parents[4] / 'docs.local/owner-exit'
PARENT.mkdir(parents=True, exist_ok=True)


def alive(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True)
    return result.returncode == 0 and not result.stdout.strip().startswith('Z')


def eventually(predicate, seconds=4):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(.05)
    return False


class OwnerExit(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=PARENT)
        self.root = Path(self.temp.name)
        self.file = self.root / 'collab.md'
        self.file.touch()
        self.env = dict(os.environ, MONITOR_STATE_DIR=str(self.root / 'state'), POLL_SECONDS='60')
        self.procs = []
        self.pids = []
        self.logs = []

    def tearDown(self):
        for pid in reversed(self.pids):
            if alive(pid):
                os.kill(pid, 15)
        for proc in reversed(self.procs):
            if proc.poll() is None:
                proc.terminate()
            proc.wait(timeout=5)
        for pid in self.pids:
            eventually(lambda: not alive(pid))
        for log in self.logs:
            log.close()
        self.temp.cleanup()

    def spawn(self, args):
        log = (self.root / f'log{len(self.logs)}').open('w')
        self.logs.append(log)
        proc = subprocess.Popen(args, env=self.env, stdout=log, stderr=log)
        self.procs.append(proc)
        return proc

    def cmd(self, mode, *options):
        return ['/bin/bash', str(MONITOR), mode, *options, '@fixture', *([] if mode == 'follow' else [str(self.file)])]

    def ready_run(self):
        path = self.root / 'state/fixture/run.lock/owner.pid'
        self.assertTrue(eventually(path.exists), 'run never acquired its lock')
        pid = int(path.read_text())
        self.pids.append(pid)
        return pid

    def children(self, pid):
        output = subprocess.run(['ps', '-ax', '-o', 'pid=,ppid='], capture_output=True, text=True, check=True).stdout
        return [int(row.split()[0]) for row in output.splitlines() if row.split()[1] == str(pid)]

    def tailers(self, pid):
        return [child for child in self.children(pid) if 'tail -n +1 -f' in
                subprocess.run(['ps', '-p', str(child), '-o', 'command='],
                               capture_output=True, text=True).stdout]

    def assert_exit(self, pid, children=()):
        self.assertTrue(eventually(lambda: not alive(pid)), f'monitor {pid} survived owner loss')
        self.assertTrue(eventually(lambda: all(not alive(child) for child in children)), 'child tail/sleep survived')

    def test_run_explicit_owner_loss_during_long_sleep(self):
        owner = self.spawn(['sleep', '60'])
        proc = self.spawn(self.cmd('run', '--owner-pid', str(owner.pid)))
        self.ready_run()
        time.sleep(1.2)
        self.assertIsNone(proc.poll(), 'exited while owner alive')
        children = self.children(proc.pid)
        owner.terminate()
        owner.wait()
        self.assert_exit(proc.pid, children)
        self.assertEqual(proc.wait(), 0)
        self.assertFalse((self.root / 'state/fixture/run.lock').exists())

    def orphan(self, command):
        pidfile = self.root / 'child.pid'
        script = ' '.join(map(shlex.quote, command)) + ' & echo $! > ' + shlex.quote(str(pidfile)) + '; wait'
        owner = self.spawn(['/bin/bash', '-c', script])
        self.assertTrue(eventually(pidfile.exists))
        pid = int(pidfile.read_text())
        self.pids.append(pid)
        return owner, pid

    def test_run_default_parent_loss(self):
        owner, pid = self.orphan(self.cmd('run'))
        self.ready_run()
        time.sleep(1.2)
        self.assertTrue(alive(pid))
        owner.terminate()
        owner.wait()
        self.assert_exit(pid, self.children(pid))

    def test_reparent_to_one_even_with_explicit_owner_alive(self):
        owner, pid = self.orphan(self.cmd('run', '--owner-pid', str(os.getpid())))
        self.ready_run()
        owner.terminate()
        owner.wait()
        self.assert_exit(pid)

    def start(self):
        proc = self.spawn(self.cmd('start', '--owner-pid', str(os.getpid())))
        self.assertEqual(proc.wait(timeout=5), 0)
        pid = self.ready_run()
        self.assertTrue(alive(pid))
        return pid

    def test_follow_owner_loss_reaps_tailer(self):
        producer = self.start()
        owner = self.spawn(['sleep', '60'])
        follow = self.spawn(self.cmd('follow', '--owner-pid', str(owner.pid)))
        self.assertTrue(eventually(lambda: bool(self.tailers(follow.pid))), 'no follower tailer')
        children = self.tailers(follow.pid)
        time.sleep(1.2)
        self.assertIsNone(follow.poll())
        owner.terminate()
        owner.wait()
        self.assert_exit(follow.pid, children)
        self.assertEqual(follow.wait(), 0)
        self.assertTrue(alive(producer), 'follower killed independently owned producer')

    def test_follow_reparent_reaps_tailer(self):
        self.start()
        owner, pid = self.orphan(self.cmd('follow', '--owner-pid', str(os.getpid())))
        self.assertTrue(eventually(lambda: bool(self.tailers(pid))))
        children = self.tailers(pid)
        owner.terminate()
        owner.wait()
        self.assert_exit(pid, children)

    def test_default_owner_without_agent_ancestor(self):
        ownerfile = self.root / 'owner.pid'
        pidfile = self.root / 'child.pid'
        script = ('echo $$ > ' + shlex.quote(str(ownerfile)) + '; ' +
                  ' '.join(map(shlex.quote, self.cmd('run'))) +
                  ' & echo $! > ' + shlex.quote(str(pidfile)) + '; wait')
        # Detach the stub owner itself, so its ancestry contains no fleet agent.
        launcher = self.spawn(['perl', '-MPOSIX=setsid', '-e',
                              'fork() and exit; setsid() >= 0 or die $!; exec @ARGV or die $!',
                              '/bin/bash', '-c', script])
        self.assertEqual(launcher.wait(timeout=5), 0)
        self.assertTrue(eventually(ownerfile.exists))
        owner = int(ownerfile.read_text())
        self.pids.append(owner)
        pid = self.ready_run()
        time.sleep(1.2)
        self.assertTrue(alive(pid))
        children = self.children(pid)
        os.kill(owner, 15)
        self.assert_exit(pid, children)

    def test_detached_explicit_owner_loss_cleans_state(self):
        owner = self.spawn(['sleep', '60'])
        proc = self.spawn(self.cmd('start', '--owner-pid', str(owner.pid)))
        self.assertEqual(proc.wait(timeout=5), 0)
        pid = self.ready_run()
        time.sleep(1.2)
        self.assertTrue(alive(pid))
        children = self.children(pid)
        owner.terminate()
        owner.wait()
        self.assert_exit(pid, children)
        for name in ('monitor.pid', 'monitor.instance', 'ready.pid', 'ready.instance', 'run.lock'):
            self.assertFalse((self.root / 'state/fixture' / name).exists(), name)

    def test_invalid_owner_rejected(self):
        for mode in ('run', 'start', 'follow'):
            for owner in ('0', '-1', '1;echo', 'abc'):
                with self.subTest(mode=mode, owner=owner):
                    proc = self.spawn(self.cmd(mode, '--owner-pid', owner))
                    self.assertEqual(proc.wait(timeout=5), 2)

    def test_detached_start_survives_shell_but_dies_with_agent_ancestor(self):
        # argv[0] models an agent CLI; the intervening launcher shell exits.
        script = '/bin/sh -c ' + shlex.quote(' '.join(map(shlex.quote, self.cmd('start')))) + '; sleep 60'
        log = (self.root / 'agent.log').open('w')
        self.logs.append(log)
        agent = subprocess.Popen(['codex', '-c', script], executable='/bin/bash', env=self.env, stdout=log, stderr=log)
        self.procs.append(agent)
        pid = self.ready_run()
        time.sleep(1.2)
        self.assertTrue(alive(pid), 'detached producer lost launching shell')
        agent.terminate()
        agent.wait()
        self.assert_exit(pid, self.children(pid))
        for name in ('monitor.pid', 'monitor.instance', 'ready.pid', 'ready.instance', 'run.lock'):
            self.assertFalse((self.root / 'state/fixture' / name).exists(), name)


if __name__ == '__main__':
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Real-process pruning and vanished-checkout regressions in private state."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest

from importlib.util import spec_from_file_location, module_from_spec
spec = spec_from_file_location('owner_exit', Path(__file__).with_name('owner-exit.py'))
owner_exit = module_from_spec(spec)
spec.loader.exec_module(owner_exit)
MONITOR = owner_exit.MONITOR
alive = owner_exit.alive
eventually = owner_exit.eventually


class StateHygiene(owner_exit.OwnerExit):
    def command(self, mode, name='@fixture', script=MONITOR):
        args = ['/bin/bash', str(script), mode]
        if mode == 'start':
            args += ['--owner-pid', str(os.getpid())]
        args += [name]
        if mode == 'start':
            args += [str(self.file)]
        return subprocess.run(args, env=self.env, capture_output=True, text=True, timeout=5)

    def debris(self, name='dead', pid=None):
        if pid is None:
            dead = self.spawn(['sleep', '60'])
            dead.terminate()
            dead.wait()
            pid = dead.pid
        state = self.root / 'state' / name
        (state / 'run.lock').mkdir(parents=True)
        for filename in ('monitor.pid', 'ready.pid', 'run.lock/owner.pid'):
            (state / filename).write_text(str(pid) + '\n')
        for filename in ('monitor.instance', 'ready.instance', 'run.lock/owner.instance'):
            (state / filename).write_text('a' * 64 + '\n')
        (state / 'monitor.owner').write_text('old owner\n')
        (state / f'events.{pid}').write_text('abandoned\n')
        (state / 'seen.sha256').write_text('durable dedup\n')
        return state

    def assert_pruned(self, state):
        self.assertEqual(sorted(p.name for p in state.iterdir()), ['seen.sha256'])
        self.assertEqual((state / 'seen.sha256').read_text(), 'durable dedup\n')

    def test_status_prunes_all_dead_instances(self):
        state = self.debris()
        result = self.command('status')
        self.assertNotEqual(result.returncode, 0)
        self.assert_pruned(state)

    def test_start_prunes_dead_instances(self):
        state = self.debris()
        self.start()
        self.assert_pruned(state)

    def test_reused_pid_pruned_without_signaling_process(self):
        unrelated = self.spawn(['sleep', '60'])
        state = self.debris(pid=unrelated.pid)
        self.command('status')
        self.assert_pruned(state)
        self.assertIsNone(unrelated.poll())

    def test_live_state_untouched_and_owner_visible(self):
        pid = self.start()
        state = self.root / 'state/fixture'
        event = state / f'events.{pid}'
        event.write_text('live temporary file\n')
        before = {str(p.relative_to(state)): p.read_bytes() for p in state.rglob('*') if p.is_file()}
        result = self.command('status')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'owner_pid={os.getpid()}', result.stdout)
        self.assertEqual(before, {str(p.relative_to(state)): p.read_bytes() for p in state.rglob('*') if p.is_file()})

    def test_live_with_corrupt_token_stays_preserved(self):
        self.start()
        state = self.root / 'state/fixture'
        (state / 'monitor.instance').write_text('b' * 64 + '\n')
        before = {str(p.relative_to(state)): p.read_bytes() for p in state.rglob('*') if p.is_file()}
        self.command('status')
        self.assertEqual(before, {str(p.relative_to(state)): p.read_bytes() for p in state.rglob('*') if p.is_file()})

    def test_foreground_run_state_preserved(self):
        proc = self.spawn(self.cmd('run', '--owner-pid', str(os.getpid())))
        pid = self.ready_run()
        state = self.root / 'state/fixture'
        event = state / f'events.{pid}'
        event.write_text('live\n')
        self.assertTrue(eventually(lambda: bool(list((state / 'sizes').glob('*.size')))))
        (state / 'ready.pid').write_text(str(pid) + '\n')
        before = {str(p.relative_to(state)): p.read_bytes() for p in state.rglob('*') if p.is_file()}
        self.assertNotEqual(self.command('start').returncode, 0)
        self.assertEqual(before, {str(p.relative_to(state)): p.read_bytes() for p in state.rglob('*') if p.is_file()})
        self.command('status')
        self.assertTrue((state / 'run.lock/owner.pid').exists())
        self.assertTrue(event.exists())
        self.assertIsNone(proc.poll())

    def test_start_lock_protects_unpublished_child_state(self):
        state = self.debris()
        (state / 'start.lock').mkdir()
        (state / 'start.lock/owner.pid').write_text(str(os.getpid()) + '\n')
        before = {str(p.relative_to(state)): p.read_bytes() for p in state.rglob('*') if p.is_file()}
        self.command('status')
        self.assertEqual(before, {str(p.relative_to(state)): p.read_bytes() for p in state.rglob('*') if p.is_file()})

    def test_ownerless_run_lock_and_orphan_events_pruned(self):
        state = self.root / 'state/orphan'
        (state / 'run.lock').mkdir(parents=True)
        (state / 'events.99999999').touch()
        (state / 'ready.pid').write_text('99999999\n')
        self.command('status')
        self.assertEqual(list(state.iterdir()), [])

    def copy_script(self):
        copy = self.root / 'scripts'
        shutil.copytree(MONITOR.parent, copy)
        return copy / MONITOR.name

    def test_live_from_other_checkout_preserved(self):
        script = self.copy_script()
        result = self.command('start', script=script)
        self.assertEqual(result.returncode, 0, result.stderr)
        pid = self.ready_run()
        result = self.command('status')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(alive(pid))

    def test_removed_script_directory_exits_run_and_follow(self):
        script = self.copy_script()
        self.assertEqual(self.command('start', script=script).returncode, 0)
        pid = self.ready_run()
        follower = self.spawn(['/bin/bash', str(script), 'follow', '--owner-pid', str(os.getpid()), '@fixture'])
        self.assertTrue(eventually(lambda: bool(self.tailers(follower.pid))))
        children = self.children(pid) + self.tailers(follower.pid)
        shutil.rmtree(script.parent)
        self.assert_exit(pid, children)
        self.assertEqual(follower.wait(timeout=5), 0)

    def test_removed_routing_helper_exits_without_busy_loop(self):
        script = self.copy_script()
        self.assertEqual(self.command('start', script=script).returncode, 0)
        pid = self.ready_run()
        (script.parent / 'monitor/routing.awk').unlink()
        self.assert_exit(pid)
        log = (self.root / 'state/fixture/monitor.log').read_text()
        self.assertNotIn("can't open", log)


if __name__ == '__main__':
    unittest.main(verbosity=2)

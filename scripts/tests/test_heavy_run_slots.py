"""Lane interoperability, using live commands and synthetic HOME only."""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
HOOKS = ROOT / 'scripts/hooks'

class LaneTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'docs.local').mkdir(exist_ok=True)
        self.fixture = tempfile.TemporaryDirectory(dir=ROOT/'docs.local')
        self.addCleanup(self.fixture.cleanup)
        self.home = Path(self.fixture.name)
        self.env = {k:v for k,v in os.environ.items() if not k.startswith('GOLEMS_HEAVY_')}
        self.env['HOME'] = str(self.home)

    def launch(self, source='pass', host='m1', wait='.3', limit='8', entry=False):
        bootstrap = (f'import sys,runpy; sys.path.insert(0,{str(HOOKS)!r}); '
            f'import heavy_watchdog as w; w.lane_host=lambda: {host!r}; '
            f'runpy.run_path({str(HOOKS/"heavy-suite.py")!r},run_name="__main__")')
        launcher = [sys.executable, str(HOOKS/'heavy-run')] if entry else [sys.executable, '-c', bootstrap, '--lane-slots']
        return subprocess.Popen([*launcher, '--lane','fixture','--limit-gb',limit,
            '--min-free-gb','0','--max-load','99999','--poll-seconds','.02',
            '--max-wait',wait,'--kill-grace-seconds','.05','--',sys.executable,'-c',source],
            env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def finish(self, child):
        out, err = child.communicate(timeout=15)
        return child.returncode, out, err

    def test_foreign_slot_never_removed(self):
        slot = self.home/'.m1-heavy.lock'; slot.mkdir()
        (slot/'foreign').write_text('untouched')
        (slot/'owner.json').write_text('legacy record is not owner')
        result, _, err = self.finish(self.launch('raise SystemExit(99)'))
        self.assertEqual(result,75,err)
        self.assertIn('WAIT',err)
        self.assertEqual((slot/'foreign').read_text(),'untouched')

    def test_secondary_and_one_lock(self):
        primary = self.home/'.m4-heavy.lock'; primary.mkdir()
        legacy = self.home/'.local/state/golems/heavy-suite.lock'
        legacy.parent.mkdir(parents=True)
        with legacy.open('a+') as stream:
            fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
            result, out, err = self.finish(self.launch('from pathlib import Path; from datetime import datetime; '
                'p=Path.home(); lines=(p/".m4-heavy-2.lock/owner").read_text().splitlines(); r=dict(line.split("=",1) for line in lines); '
                'assert list(r)==["lane","worker","start","pid","token","cmd"] and len(lines)==6; assert r["lane"]=="fixture" and int(r["pid"])>0 and r["worker"] and r["cmd"]; assert datetime.fromisoformat(r["start"]).utcoffset().total_seconds()==0; '
                'assert not list((p/".local/state/golems").glob("*.slot*.lock")); print("owned")',host='m4'))
        self.assertEqual(result,0,err); self.assertIn('owned',out)
        self.assertTrue(primary.is_dir()); self.assertFalse((self.home/'.m4-heavy-2.lock').exists())
        self.assertIn('gate missing',err)
        log=(self.home/'.m4-heavy.log').read_text()
        self.assertIn('fixture took ',log); self.assertIn('fixture released ',log)
        self.assertIn('gate missing',log)

    def test_missing_gate_log_failure_preserves_execution(self):
        # A bad log path must leave the notice on stderr and still release our slot.
        (self.home/'.m1-heavy.log').mkdir()
        result,_,err=self.finish(self.launch())
        self.assertEqual(result,0,err)
        self.assertIn('gate missing',err)
        self.assertIn('WARNING lane log unavailable',err)
        self.assertFalse((self.home/'.m1-heavy.lock').exists())

    def test_gate_waits_and_retries(self):
        gate=self.home/'.local/bin/m4-heavy-gate'; gate.parent.mkdir(parents=True)
        for code in (1,2):
            gate.write_text(f'#!/bin/sh\nexit {code}\n'); gate.chmod(0o700)
            result,_,err=self.finish(self.launch(host='m4'))
            self.assertEqual(result,75,err); self.assertIn('WAIT',err)
            self.assertFalse((self.home/'.m4-heavy.lock').exists())
        gate.write_text('#!/bin/sh\nexit 0\n')
        self.assertEqual(self.finish(self.launch(host='m4'))[0],0)

    def test_release_exit_and_watchdog(self):
        for source,limit,expected in [('pass','8',0),('raise SystemExit(7)','8',7),
            ('import time; x=bytearray(260*1024*1024); time.sleep(10)','.2',125)]:
            result,_,err=self.finish(self.launch(source,limit=limit))
            self.assertEqual(result,expected,err)
            self.assertFalse((self.home/'.m1-heavy.lock').exists())

    def test_signals_release_slot(self):
        for sig in (signal.SIGTERM,signal.SIGINT):
            ready=self.home/'ready'
            child=self.launch('from pathlib import Path; import time; (Path.home()/"ready").touch(); time.sleep(10)')
            try:
                deadline=time.monotonic()+5
                while not ready.exists() and child.poll() is None and time.monotonic()<deadline: time.sleep(.02)
                self.assertTrue(ready.exists())
                child.send_signal(sig)
                result,_,err=self.finish(child)
                self.assertEqual(result,128+sig,err)
                self.assertFalse((self.home/'.m1-heavy.lock').exists())
                ready.unlink()
            finally:
                if child.poll() is None: child.terminate(); self.finish(child)

    def test_wait_then_admit(self):
        slot=self.home/'.m1-heavy.lock'; slot.mkdir()
        child=self.launch(wait='3')
        try:
            # Observe WAIT before releasing the foreign, ownerless fixture.
            lines=[]
            while True:
                line=child.stderr.readline(); lines.append(line)
                if 'WAIT' in line or not line: break
            self.assertIn('WAIT',''.join(lines))
            self.assertTrue(slot.is_dir()); slot.rmdir()
            result,_,err=self.finish(child)
            self.assertEqual(result,0,err)
            self.assertFalse(slot.exists())
        finally:
            if child.poll() is None: child.terminate(); self.finish(child)

    def test_no_bypass_or_nested_lock(self):
        for key in ('GOLEMS_HEAVY_FORCE','GOLEMS_HEAVY_SUITE_HELD'):
            self.env[key]='1'
            result,_,err=self.finish(self.launch(entry=True))
            self.assertEqual(result,75,err)
            del self.env[key]
        self.assertFalse(list(self.home.glob('.*heavy*.lock')))

    def test_ownership_changes_refuse_release(self):
        from unittest.mock import patch
        sys.path.insert(0,str(HOOKS))
        import heavy_lane
        for change in ('token','pid','missing-owner','owner-inode','directory','extra-file'):
            with patch.dict(os.environ,{'HOME':str(self.home)}), patch.object(heavy_lane.watchdog,'lane_host',return_value='m1'):
                slot=heavy_lane.LaneSlot('fixture',['test'],lambda _:None)
                slot.acquire(.01,time.monotonic()+1)
                path=slot.path
                if change in ('token','pid'):
                    owner=path/'owner'
                    record=owner.read_text().splitlines()
                    owner.write_text('\n'.join(f'{change}=foreign' if line.startswith(change+'=') else line for line in record)+'\n')
                elif change=='missing-owner': (path/'owner').unlink()
                elif change=='owner-inode':
                    replacement=path/'replacement'
                    replacement.write_text((path/'owner').read_text())
                    replacement.replace(path/'owner')
                elif change=='directory':
                    path.rename(self.home/'original')
                    path.mkdir()
                else: (path/'foreign').touch()
                slot.release()
                self.assertTrue(path.is_dir())
                # Delete only explicitly created fixture entries.
                for name in ('owner','foreign'):
                    (path/name).unlink(missing_ok=True)
                path.rmdir()
        original=self.home/'original'
        (original/'owner').unlink(); original.rmdir()

    def test_owner_write_failure_cleans_created_directory(self):
        from unittest.mock import patch
        sys.path.insert(0,str(HOOKS))
        import heavy_lane
        with patch.dict(os.environ,{'HOME':str(self.home)}), patch.object(heavy_lane.watchdog,'lane_host',return_value='m1'), patch.object(heavy_lane,'write_owner',side_effect=OSError('injected')):
            result=heavy_lane.run('fixture',['test'],.01,time.monotonic()+1,lambda _:99,lambda _:None)
        self.assertEqual(result,75)
        self.assertFalse((self.home/'.m1-heavy.lock').exists())

    def test_cancel_wait_preserves_foreign(self):
        slot=self.home/'.m1-heavy.lock'; slot.mkdir()
        child=self.launch(wait='10')
        try:
            while True:
                line=child.stderr.readline()
                if 'WAIT' in line or not line: break
            child.terminate()
            self.assertEqual(self.finish(child)[0],143)
            self.assertTrue(slot.is_dir())
        finally:
            if child.poll() is None: child.terminate(); self.finish(child)

    def test_nested_suite_reuses_lane(self):
        source=(f'import subprocess,sys; from pathlib import Path; '
            f'r=subprocess.run([sys.executable,{str(HOOKS/'heavy-suite.py')!r},"--",sys.executable,"-c","pass"]); '
            'assert r.returncode==0; assert not list((Path.home()/".local/state/golems").glob("*lock"))')
        result,_,err=self.finish(self.launch(source))
        self.assertEqual(result,0,err)

    def test_owner_values_stay_on_single_lines(self):
        from unittest.mock import patch
        sys.path.insert(0,str(HOOKS))
        import heavy_lane
        with patch.dict(os.environ,{'HOME':str(self.home),'GOLEMS_HEAVY_WORKER':'worker=one\ninjected=value'}), patch.object(heavy_lane.watchdog,'lane_host',return_value='m4'):
            slot=heavy_lane.LaneSlot('lane\r\ntwo',['printf','a=b\nc'],lambda _:None)
            try:
                slot.acquire(.01,time.monotonic()+1)
                with (slot.path/'owner').open() as stream: record=heavy_lane.read_owner(stream)
                self.assertEqual(list(record),['lane','worker','start','pid','token','cmd'])
                self.assertEqual(record['worker'],'worker=one\\ninjected=value')
                self.assertNotIn('\n',record['cmd'])
                self.assertNotIn('\r',record['lane'])
            finally: slot.release()
            self.assertFalse((self.home/'.m4-heavy.lock').exists())

    def test_host_detection(self):
        from unittest.mock import patch
        sys.path.insert(0,str(HOOKS))
        import heavy_watchdog
        for brand, expected in [('Apple M1 Pro','m1'),('Apple M4 Max','m4')]:
            with patch.object(heavy_watchdog.sys,'platform','darwin'), patch.object(subprocess,'check_output',return_value=brand):
                self.assertEqual(heavy_watchdog.lane_host(),expected)

    def test_entry_point(self):
        result,_,err=self.finish(self.launch(entry=True))
        self.assertEqual(result,0,err)
        self.assertIn('gate missing',err)
        self.assertTrue(any('gate missing' in log.read_text() for log in self.home.glob('.*heavy.log')))
        self.assertFalse(list(self.home.glob('.*heavy*.lock')))

if __name__=='__main__': unittest.main()

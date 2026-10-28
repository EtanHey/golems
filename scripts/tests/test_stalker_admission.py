import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / 'scripts/stalker/stalker-admission.py'
CHILD = """import importlib.util,json,sys
s=importlib.util.spec_from_file_location('admission',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
print('ready',flush=True); sys.stdin.readline()
code,result=m.admit(sys.argv[2],json.loads(sys.argv[3])); print(json.dumps([code,result]),flush=True)
sys.stdin.readline()
"""


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='p2a-', dir=ROOT / 'scripts/tests')
        self.addCleanup(self.tmp.cleanup)
        self.spool = Path(self.tmp.name).resolve()
        self.db = self.spool / 'ledger.sqlite'
        self.sources = [self.spool / name for name in ('video.ts', 'chat.log')]
        for path in self.sources:
            path.write_bytes(b'original sentinel\x00\xff\n')
        self.before = [(p.stat().st_size, hashlib.sha256(p.read_bytes()).hexdigest()) for p in self.sources]
        self.addCleanup(self.unchanged)
        spec = importlib.util.spec_from_file_location('admission', CORE)
        self.api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.api)

    def unchanged(self):
        self.assertEqual(self.before, [(p.stat().st_size, hashlib.sha256(p.read_bytes()).hexdigest()) for p in self.sources])

    def request(self, job='one', **changes):
        return dict(schemaVersion=1, kind='capture', jobKey=job, spool=str(self.spool),
                    platform='twitch', channel='Theo', broadcastId='b1', expectedBytes=10,
                    temporaryBytes=2, derivedBytes=3, reserveBytes=5) | changes

    def admit(self, request, free=100, device=1):
        return self.api.admit(self.db, request, observe=lambda p: (device, free))

    def cli(self, *args):
        run = subprocess.run([sys.executable, str(CORE), *args, '--db', str(self.db)], capture_output=True, text=True)
        result = json.loads(run.stdout if run.returncode == 0 else run.stderr)
        self.assertEqual(result['schemaVersion'], 1)
        if run.returncode:
            self.assertFalse(result['authorized'])
            self.assertIn('utc', result)
        return run.returncode, result

    def child(self, request):
        p = subprocess.Popen([sys.executable, '-u', '-c', CHILD, str(CORE), str(self.db), json.dumps(request)],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: (p.kill() if p.poll() is None else None, p.communicate()))
        self.assertEqual(p.stdout.readline().strip(), 'ready')
        return p

    def test_synchronized_cross_platform_case_collision(self):
        a = self.child(self.request(reserveBytes=0))
        b = self.child(self.request('two', platform='youtube', channel='tHEo', broadcastId='b2', reserveBytes=0))
        for p in (a, b):
            p.stdin.write('\n'); p.stdin.flush()
        results = [json.loads(p.stdout.readline()) for p in (a, b)]
        self.assertEqual(sum(r['authorized'] for _, r in results), 1)
        self.assertEqual(sorted(code for code, _ in results), [0, 75])

    def test_replay_conflict_completion_and_history(self):
        request = self.request()
        code, receipt = self.admit(request)
        self.assertEqual(code, 0)
        self.assertEqual(receipt['coverageStatus'], 'unknown')
        self.assertEqual(receipt['coverageReason'], 'capture_not_observed')
        self.assertEqual(self.admit(request)[0], 75)
        self.assertEqual(self.cli('inspect', '--job-key', 'one')[1], receipt | {'authorized': False})
        self.assertEqual(self.admit(request | {'expectedBytes': 11})[0], 64)
        self.assertEqual(self.cli('inspect', '--job-key', 'one')[1], receipt | {'authorized': False})
        self.assertEqual(self.cli('admit', '--request', str(self.write_request(request)))[0], 75)
        self.assertEqual(self.api.finish(self.db, receipt['claim'], 'complete')[0], 0)
        self.assertEqual(self.admit(request)[0], 75)
        self.assertEqual(self.admit(request | {'jobKey': 'two'})[1]['reason'], 'WORK_COMPLETE')

    def write_request(self, request):
        path = self.spool / 'request.json'
        path.write_text(json.dumps(request))
        return path

    def test_ingest_identity_and_independent_resources(self):
        a = dict(schemaVersion=1, kind='ingest', jobKey='i1', spool=str(self.spool),
                 sourceSha256='a' * 64, configSha256='b' * 64, expectedBytes=1, temporaryBytes=0, derivedBytes=0, reserveBytes=0)
        self.assertEqual(self.admit(a)[0], 0)
        other = self.spool / 'other'; other.mkdir()
        self.assertEqual(self.admit(a | {'jobKey': 'i2', 'spool': str(other)})[1]['reason'], 'RECOVERY_REQUIRED')
        code, r = self.admit(a | {'jobKey': 'i3', 'configSha256': 'c' * 64})
        self.assertEqual(code, 0)
        self.assertEqual(self.api.finish(self.db, r['claim'], 'complete')[0], 0)
        self.assertEqual(self.admit(a | {'jobKey': 'i4', 'configSha256': 'c' * 64})[1]['reason'], 'WORK_COMPLETE')

    def test_process_death_never_expires_claim(self):
        p = self.child(self.request(reserveBytes=0))
        p.stdin.write('\n'); p.stdin.flush()
        self.assertEqual(json.loads(p.stdout.readline())[0], 0)
        p.kill(); p.wait()
        # No PID or clock input can transfer ownership, including an ancient receipt.
        with sqlite3.connect(self.db) as db:
            receipt = json.loads(db.execute('SELECT receipt FROM jobs').fetchone()[0])
            receipt['utc'] = '1970-01-01T00:00:00+00:00'
            db.execute('UPDATE jobs SET receipt=?', (json.dumps(receipt),))
        request = self.request('restart', reserveBytes=0)
        self.assertEqual(self.cli('admit', '--request', str(self.write_request(request)))[1]['reason'], 'RECOVERY_REQUIRED')
        self.assertEqual(self.admit(request | {'pid': 999999})[0], 64)

    def test_disk_boundaries_reservations_and_devices(self):
        self.assertEqual(self.admit(self.request(), free=20)[0], 0)
        self.assertEqual(self.admit(self.request('two', channel='Other', broadcastId='b2'), free=39)[1]['reason'], 'LOW_DISK')
        low = self.api.inspect(self.db, 'two')[1]
        self.assertEqual((low['freeBytes'], low['outstandingBytes'], low['requiredBytes']), (39, 20, 20))
        self.assertEqual(self.admit(self.request('three', channel='Third', broadcastId='b3'), free=20, device=2)[0], 0)
        self.assertEqual(self.admit(self.request('four', channel='Fourth', broadcastId='b4'), free=19, device=3)[0], 75)
        default = self.request('default', channel='Fifth', broadcastId='b5')
        del default['reserveBytes']
        self.assertEqual(self.admit(default, free=0)[1]['requiredBytes'], 20 * 1024**3 + 15)

    def test_finish_tokens_failed_retry_and_successor(self):
        with mock.patch.object(self.api.secrets, 'token_urlsafe', return_value='-' + 'x' * 42):
            _, first = self.admit(self.request())
        self.assertEqual(self.api.finish(self.db, 'wrong', 'complete')[0], 75)
        self.assertEqual(self.admit(self.request('busy', broadcastId='b2'))[1]['reason'], 'BUSY')
        self.assertEqual(self.cli('finish', '--claim', first['claim'], '--outcome', 'failed')[0], 0)
        _, second = self.admit(self.request('retry'))
        self.assertTrue(second['authorized'])
        self.assertEqual(self.api.finish(self.db, first['claim'], 'complete')[0], 75)
        self.assertEqual(self.api.inspect(self.db, 'retry')[1]['state'], 'active')
        self.assertEqual(self.api.inspect(self.db, 'one')[1]['state'], 'failed')

    def test_finish_keeps_other_reservation_and_storage_failure_never_authorizes(self):
        _, first = self.admit(self.request())
        _, other = self.admit(self.request('other', channel='Other', broadcastId='b2'))
        self.assertEqual(self.api.finish(self.db, first['claim'], 'failed')[0], 0)
        self.assertEqual(self.admit(self.request('new', channel='New', broadcastId='b3'), free=39)[1]['outstandingBytes'], 20)
        self.assertEqual(self.api.inspect(self.db, 'other')[1]['claim'], other['claim'])
        connect = sqlite3.connect
        class DiskFull(sqlite3.Connection):
            def execute(self, sql, *args):
                if sql.startswith('INSERT'):
                    raise sqlite3.OperationalError('fixture disk full')
                return super().execute(sql, *args)
        with mock.patch.object(sqlite3, 'connect', side_effect=lambda p, **kw: connect(p, factory=DiskFull, **kw)):
            for free in (0, 100):
                code, receipt = self.admit(self.request('io', channel='IO', broadcastId='io'), free=free)
                self.assertEqual(code, 73)
                self.assertFalse(receipt['authorized'])
                self.assertEqual(self.api.inspect(self.db, 'io')[0], 64)

    def test_invalid_requests_and_storage_fail_closed(self):
        for changes in ({'broadcastId': ''}, {'expectedBytes': -1}, {'temporaryBytes': '2'},
                        {'derivedBytes': True}, {'expectedBytes': 2**63}, {'schemaVersion': 2}, {'kind': 'other'},
                        {'spool': str(self.spool / 'absent')}, {'broadcastId': None}):
            code, result = self.admit(self.request() | changes)
            self.assertEqual(code, 64)
            self.assertFalse(result['authorized'])
        oversized = self.write_request(self.request())
        oversized.write_text(oversized.read_text().replace('"expectedBytes": 10', '"expectedBytes": ' + '9' * 5000))
        self.assertEqual(self.cli('admit', '--request', str(oversized))[0], 64)
        self.assertEqual(self.api.admit(self.spool, self.request())[0], 73)
        for content, expected in ((b'corrupt database', 73), (b'', 64)):
            self.db.write_bytes(content)
            self.assertEqual(self.admit(self.request())[0], expected)
            self.assertEqual(self.db.read_bytes(), content)
        self.db.unlink()
        with sqlite3.connect(self.db) as db:
            db.execute('PRAGMA user_version=99')
        self.assertEqual(self.admit(self.request())[0], 64)


if __name__ == '__main__':
    unittest.main()

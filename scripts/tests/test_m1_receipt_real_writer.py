"""Real release writer, real client status, synthetic HOME and fake SSH only."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest
import test_m1_sync
from test_m1_sync import ROOT, HEAD, VERSION


class RealWriterTest(unittest.TestCase):
    def setUp(self):
        self.sync = s = test_m1_sync.SyncTest()
        s.setUp()
        self.addCleanup(s.doCleanups)
        s.base, s.assets, s.bin, s.remote = [p.resolve() for p in (s.base, s.assets, s.bin, s.remote)]
        s.env.update(HOME=str(s.base), REMOTE_HOME=str(s.remote), ASSETS=str(s.assets),
                     EVENTS=str(s.base / 'events'), PATH=str(s.bin) + os.pathsep + os.environ['PATH'])
        self.source = s.remote / '.golems/current'
        paths = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
            "import {shipped} from './scripts/release/build-release.mjs'; import {execFileSync} from 'node:child_process'; console.log(JSON.stringify(execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\\0').filter(shipped)))"], cwd=ROOT, text=True))
        records = []
        for relative in paths:
            src, dst = ROOT / relative, self.source / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            mode = '0755' if src.stat().st_mode & 0o111 else '0644'
            dst.chmod(int(mode, 8))
            records.append(dict(path=relative, sha256=hashlib.sha256(dst.read_bytes()).hexdigest(), mode=mode))
        (self.source / 'MANIFEST.json').write_text(json.dumps(dict(commit=HEAD, version=VERSION, files=records)))
        (s.remote / '.golems/release.json').write_text(json.dumps(dict(commit=HEAD, version=VERSION)))
        for root in ('.claude/skills', '.agents/skills', '.golems/bin'):
            path = s.remote / root / 'fixture'; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('remote bytes')
        for root in ('Applications', 'BrainLayer', 'audio'):
            path = s.remote / root / 'never-touch'; path.parent.mkdir(parents=True); path.write_text('preserve')
        self.state = s.remote / '.local/state/golems/install-receipts'
        self.state.mkdir(parents=True)
        preload = s.base / 'remote-host.cjs'
        preload.write_text("require('node:os').hostname=()=> 'fixture-m1'; require('node:module').syncBuiltinESMExports();")
        (s.remote / '.codex/config.toml').write_text('# preserve this configuration\n')
        (s.base / '.golems/release.json').write_text(json.dumps(dict(commit='b' * 40, version='wrong-local-version')))
        s.env.update(NODE_OPTIONS='--require=' + str(preload), CODEX_HOME=str(s.remote / '.codex'),
                     RATCHET_SKILL_CONFIG=str(s.remote / 'no-live-config.json'))
        s.stub('scutil', "print('Third-Party-Mac')\n")
        s.stub('python3', """import json
if len(sys.argv)>2 and sys.argv[2].endswith('/installed-skills.py'):
    assert Path.home() == Path(os.environ['REMOTE_HOME'])
    print(json.dumps(dict(measurement='live',host_identity_valid=True,name_content_parity=True,required_readable_valid=True)))
else: os.execv(""" + repr(os.sys.executable) + ', [' + repr(os.sys.executable) + '] + sys.argv[1:])\n')
        result = subprocess.run(['node', str(self.source / 'scripts/hooks/install-hooks.mjs'), '--host', 'client',
            '--source', str(self.source), '--apply'], env=dict(s.env, HOME=str(s.remote)), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(shutil.which('ssh', path=s.env['PATH']), str(s.bin / 'ssh'))

    def tree(self):
        root = self.sync.remote
        return {str(p.relative_to(root)): ('link', os.readlink(p)) if p.is_symlink() else
                ('dir', p.stat().st_mode) if p.is_dir() else ('file', p.stat().st_mode, hashlib.sha256(p.read_bytes()).hexdigest())
                for p in root.rglob('*')}

    def hook(self):
        s = self.sync
        work = s.base / ('receipt-run-' + str(len(list(s.base.glob('receipt-run-*')))))
        work.mkdir()
        code = "import runpy,sys; from pathlib import Path; m=runpy.run_path(sys.argv[1]); m['after_m1_sync'](sys.argv[2],Path(sys.argv[3]))"
        helper = os.environ.get('M1_RECEIPT_TEST_HELPER', str(ROOT / 'scripts/ratchet/sync-m1.py'))
        result = subprocess.run([os.sys.executable, '-B', '-c', code, helper, HEAD, str(work)],
                                env=s.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def assert_receipt_only(self, before):
        after = self.tree()
        changed = {p for p in before.keys() | after.keys() if before.get(p) != after.get(p)}
        self.assertTrue(changed)
        self.assertTrue(all(p.startswith('.local/state/golems/install-receipts/') for p in changed), changed)

    def test_real_writer_uses_remote_probes_and_only_receipt_state_changes(self):
        before = self.tree()
        self.assertIn('m1-receipt: LIVE', self.hook())
        self.assert_receipt_only(before)
        r = json.loads((self.state / 'golems/latest-skills-sync-release-channel.json').read_text())
        self.assertEqual(r['host']['alias'], 'm1-pro')
        self.assertEqual(r['host']['hostname'], 'fixture-m1')
        self.assertEqual(r['installed']['embedded_commit'], HEAD)
        self.assertEqual(r['install_source']['path'], str(self.source))
        self.assertTrue(all(row['path'].startswith(str(self.sync.remote) + '/') for row in r['install_source']['roots']))
        for row in r['install_source']['roots']:
            root = Path(row['path'])
            lines = [str(p.relative_to(root)) + '\t' + hashlib.sha256(p.read_bytes()).hexdigest() + '\n'
                     for p in sorted(root.rglob('*')) if p.is_file()]
            self.assertEqual(row['tree_sha256'], hashlib.sha256(''.join(sorted(lines)).encode()).hexdigest())
        roots = [row['path'] + '\t' + row['tree_sha256'] + '\n' for row in r['install_source']['roots']]
        self.assertEqual(r['installed']['content_sha256'], hashlib.sha256(''.join(sorted(roots)).encode()).hexdigest())
        self.assertEqual(r['install_source']['owner_status']['exit'], 0)
        self.assertTrue(r['activation']['skill_parity']['pass'])

    def test_unknown_host_key_fails_closed_without_any_remote_writes(self):
        argv = self.sync.base / 'ssh-argv.json'
        self.sync.stub('ssh', "import json\nPath(" + repr(str(argv)) + ").write_text(json.dumps(sys.argv[1:]))\nprint('Host key verification failed.',file=sys.stderr)\nsys.exit(255)\n")
        before = self.tree()
        self.assertIn('m1-receipt: unavailable', self.hook())
        args = json.loads(argv.read_text())
        self.assertIn('StrictHostKeyChecking=yes', args)
        self.assertIn('BatchMode=yes', args)
        self.assertIn('UpdateHostKeys=no', args)
        self.assertEqual(self.tree(), before)

    def test_nested_parity_transport_failure_writes_nothing(self):
        self.sync.stub('python3', "if len(sys.argv)>2 and sys.argv[2].endswith('/installed-skills.py'): sys.exit(255)\nos.execv(" + repr(os.sys.executable) + ', [' + repr(os.sys.executable) + '] + sys.argv[1:])\n')
        before = self.tree()
        self.assertIn('m1-receipt: unavailable', self.hook())
        self.assertEqual(self.tree(), before)

    def test_missing_node_or_writer_writes_nothing(self):
        writer = self.source / 'scripts/skills-sync-receipt.mjs'
        saved = writer.read_bytes()
        for fault in ('node', 'writer'):
            with self.subTest(fault=fault):
                if fault == 'node': self.sync.stub('node', 'sys.exit(127)\n')
                else: (self.sync.bin / 'node').unlink(); writer.unlink()
                before = self.tree()
                self.assertIn('m1-receipt: unavailable', self.hook())
                self.assertEqual(self.tree(), before)
        writer.write_bytes(saved)

    def test_real_writer_identity_failure_writes_nothing_then_can_retry(self):
        record = self.sync.remote / '.golems/release.json'
        record.write_text(json.dumps(dict(commit=HEAD, version='wrong')))
        before = self.tree()
        self.assertIn('m1-receipt: unavailable', self.hook())
        self.assertEqual(self.tree(), before)
        record.write_text(json.dumps(dict(commit=HEAD, version=VERSION)))
        before = self.tree()
        self.assertIn('m1-receipt: LIVE', self.hook())
        self.assert_receipt_only(before)

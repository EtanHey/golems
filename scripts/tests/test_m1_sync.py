"""Offline sync contract: fake transport, real remote orchestration, scratch HOME."""
import hashlib
import io
import json
import os
import shutil
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HEAD = 'a' * 40
VERSION = '2026.10.27-' + HEAD[:7]


class SyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.assets, self.bin, self.remote = [self.base / p for p in ('assets', 'bin', 'remote')]
        for p in (self.assets, self.bin, self.remote / '.codex/skills/only-m1', self.remote / '.golems'):
            p.mkdir(parents=True)
        (self.remote / '.codex/skills/only-m1/SKILL.md').write_text('retain me')
        (self.remote / '.codex/config.toml').write_text('unchanged')
        self.record('b' * 40)
        self.auth = self.base / '.golems/ratchet/m1-sync-authorized.json'
        self.auth.parent.mkdir(parents=True)
        self.auth.write_text(json.dumps({'schema': 1, 'item': 32, 'scope': 'm1-skills-install',
                                         'words': 'TEST FIXTURE ONLY: authorize skill sync', 'date': '2026-10-27'}))
        self.auth.chmod(0o600)
        self.auth.parent.chmod(0o700)
        self.env = dict(os.environ, HOME=str(self.base), REMOTE_HOME=str(self.remote),
                        ASSETS=str(self.assets), EVENTS=str(self.base / 'events'),
                        PATH=str(self.bin) + os.pathsep + os.environ['PATH'])
        # Pin local and remote helper execution to the test interpreter, including 3.9.
        self.stub('python3', "if sys.argv[2].endswith('/installed-skills.py'): sys.exit(0)\nos.execv(" + repr(os.sys.executable) + ", [" + repr(os.sys.executable) + "] + sys.argv[1:])\n")
        self.stub('gh', '''import shutil
if os.environ.get('MISSING'): print('gh: Not Found (HTTP 404)', file=sys.stderr); sys.exit(1)
if os.environ.get('GH_FAILURE'): print(os.environ['GH_FAILURE'], file=sys.stderr); sys.exit(4)
if sys.argv[1:3] == ['release', 'download']:
    dest = Path(sys.argv[sys.argv.index('--dir') + 1])
    for p in Path(os.environ['ASSETS']).iterdir(): shutil.copy(p, dest / p.name)
else: print('true' if os.environ.get('DRAFT') else 'false')
''')
        self.stub('ssh', '''with open(os.environ['EVENTS'], 'a') as f: f.write('ssh\\n')
r = subprocess.run(sys.argv[-1], shell=True, input=sys.stdin.buffer.read(), env=dict(os.environ, HOME=os.environ['REMOTE_HOME']))
sys.exit(r.returncode)
''')
        self.stub('scp', '''import shutil
assert list(Path(os.environ['REMOTE_HOME']).glob('.claude/skills.bak-*')), 'copy preceded backup'
with open(os.environ['EVENTS'], 'a') as f: f.write('copy\\n')
dest = Path(os.environ['REMOTE_HOME']) / sys.argv[-1].split('m1:')[1]
for p in sys.argv[3:-1]: shutil.copy(p, dest / Path(p).name)
''')
        self.assertEqual(shutil.which('ssh', path=self.env['PATH']), str(self.bin / 'ssh'))
        self.payload()

    def stub(self, name, body):
        p = self.bin / name
        p.write_text('#!' + os.sys.executable + '\nimport os, sys, subprocess\nfrom pathlib import Path\n' + body)
        p.chmod(0o755)

    def record(self, sha):
        (self.remote / '.golems/release.json').write_text(json.dumps({'commit': sha}))

    def payload(self):
        installer = '''#!/bin/sh
printf 'install\\n' >> "$EVENTS"
[ -z "${BAD_CONFIG:-}" ] || echo changed >> "$HOME/.codex/config.toml"
[ -z "${DELETE_SKILL:-}" ] || rm "$HOME/.codex/skills/only-m1/SKILL.md"
[ -n "${NO_KEEP:-}" ] || echo "Keeping existing path $HOME/.codex/skills/only-m1"
mkdir -p "$HOME/.golems/current/skills/golem-powers"
for link in "$HOME/.codex/skills/"checkout*; do
  [ ! -L "$link" ] || ln -sfn "$HOME/.golems/current/skills/golem-powers/$(basename "$link")" "$link"
done
[ -z "${DELETE_CHECKOUT:-}" ] || rm "$HOME/.codex/skills/checkout"
printf '{"commit":"%s"}' "''' + HEAD + '''" > "$HOME/.golems/release.json"
exit "${INSTALL_FAIL:-0}"
'''
        files = {'scripts/release/install.sh': installer.encode(), 'skills/catalog.json': b'{"roots":{"claude":[],"agents":[]}}'}
        manifest = json.dumps({'commit': HEAD, 'version': VERSION, 'files': [
            {'path': p, 'sha256': hashlib.sha256(b).hexdigest(), 'mode': '0644'} for p, b in files.items()]}).encode()
        files['MANIFEST.json'] = manifest
        with tarfile.open(self.assets / f'golems-{VERSION}.tar.gz', 'w:gz') as t:
            for p, b in files.items():
                info = tarfile.TarInfo(p)
                info.size = len(b)
                t.addfile(info, io.BytesIO(b))
        (self.assets / 'MANIFEST.json').write_bytes(manifest)
        (self.assets / 'SHA256SUMS').write_text(''.join(
            f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in self.assets.iterdir() if p.name != 'SHA256SUMS'))
        self.stub('bun', '''if os.environ.get('REPOINT_FAIL'): sys.exit(1)
with open(os.environ['EVENTS'], 'a') as f: f.write('apply\\n' if '--apply' in sys.argv else 'dry-run\\n')
''')

    def invoke(self, **env):
        return subprocess.run(['python3', '-B', str(ROOT / 'scripts/ratchet/sync-m1.py'),
                               HEAD, VERSION, str(self.base / ('run-' + str(len(list(self.base.glob('run-*'))))))], env=dict(self.env, **env), capture_output=True, text=True)

    def events(self):
        p = self.base / 'events'
        return p.read_text() if p.exists() else ''

    def invoke_live(self, *flags, **env):
        main = self.base / 'main'
        (main / '.git').mkdir(parents=True, exist_ok=True)
        self.env['MAIN'] = str(main)
        self.stub('git', "if '--git-common-dir' in sys.argv: print(os.environ['MAIN'] + '/.git')\nelif '--format=%ct' in sys.argv: print('1793059200')\nelse: print('" + HEAD + "')\n")
        real_gh = (self.bin / 'gh').read_text()
        (self.bin / 'gh').write_text(real_gh.replace("if os.environ.get('MISSING')", "if sys.argv[1:3] == ['pr', 'view']: print('" + HEAD + " branch'); sys.exit(0)\nif sys.argv[1] == 'api' and '/releases/tags/' not in sys.argv[2]: print('{}'); sys.exit(0)\nif os.environ.get('MISSING')"))
        self.stub('node', "with open(os.environ['EVENTS'], 'a') as f: f.write('parity\\n' if 'run-rows.mjs' in sys.argv[1] else 'table\\n')\n")
        return subprocess.run(['bash', str(ROOT / 'scripts/ratchet/live-rows.sh'),
                               '--merged-pr', '1', '--lease-pr', '2', '--lease-repo', str(ROOT), *flags],
                              env=dict(self.env, **env), capture_output=True, text=True)

    def test_default_and_escape_never_sync_and_parity_runs(self):
        for flags in ((), ('--no-sync-m1',)):
            r = self.invoke_live(*flags)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertNotIn('ssh', self.events())
            self.assertNotIn('copy', self.events())
            self.assertIn('parity', self.events())

    def test_flag_runs_full_sync_before_parity(self):
        r = self.invoke_live('--sync-m1')
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertIn('install\ndry-run\napply\nssh\nparity\n', self.events())
        backup = next(self.remote.glob('.claude/skills.bak-*'))
        with tarfile.open(backup) as archive:
            self.assertEqual(archive.extractfile('.codex/skills/only-m1/SKILL.md').read(), b'retain me')
        self.assertEqual((self.remote / '.codex/skills/only-m1/SKILL.md').read_text(), 'retain me')

    def test_current_with_flag_reaches_parity_without_backup(self):
        self.record(HEAD)
        stage = self.remote / '.golems/m1-sync' / (HEAD + '-verified-fixture')
        stage.mkdir(parents=True)
        (stage / 'success.json').write_text(json.dumps({'head': HEAD}))
        r = self.invoke_live('--sync-m1')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('parity', self.events())
        self.assertNotIn('copy', self.events())
        self.assertFalse(list(self.remote.glob('.claude/skills.bak-*')))

    def test_flag_requires_owner_only_authorization_before_transport(self):
        valid = self.auth.read_text()
        for state in ('missing', 'malformed', 'insecure', 'symlink', 'writable-parent'):
            with self.subTest(state=state):
                self.auth.unlink(missing_ok=True)
                if state == 'symlink':
                    target = self.base / 'authorization-target'
                    target.write_text(valid)
                    self.auth.symlink_to(target)
                elif state != 'missing':
                    self.auth.write_text('invalid' if state == 'malformed' else valid)
                    self.auth.chmod(0o644 if state == 'insecure' else 0o600)
                self.auth.parent.chmod(0o777 if state == 'writable-parent' else 0o700)
                r = self.invoke_live('--sync-m1')
                self.assertNotEqual(r.returncode, 0)
                self.assertEqual(r.stderr.strip(), 'M1 sync not authorized (Etan #32)')
                self.assertEqual(self.events(), '')

    def test_sync_failure_never_reaches_parity(self):
        r = self.invoke_live('--sync-m1', MISSING='1')
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn('not published yet', r.stderr)
        self.assertEqual(self.events(), '')

    def test_bad_checksum_precedes_ssh(self):
        (self.assets / 'MANIFEST.json').write_text('corrupt')
        r = self.invoke()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('checksum mismatch', r.stderr)
        self.assertEqual(self.events(), '')

    def test_missing_keep_message_fails(self):
        r = self.invoke(NO_KEEP='1')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('Keeping existing path', r.stderr)

    def test_deleted_m1_only_skill_fails(self):
        r = self.invoke(DELETE_SKILL='1')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('M1-only skill changed', r.stderr)

    def test_failed_guards_remain_failed_on_rerun(self):
        for fault in ({'BAD_CONFIG': '1'}, {'BAD_CONFIG': '1', 'INSTALL_FAIL': '1'},
                      {'DELETE_SKILL': '1'}, {'NO_KEEP': '1'}, {'REPOINT_FAIL': '1'}):
            with self.subTest(fault=fault):
                case = SyncTest()
                case.setUp()
                try:
                    first = case.invoke(**fault)
                    self.assertNotEqual(first.returncode, 0, first.stdout)
                    events = case.events()
                    again = case.invoke()
                    self.assertNotEqual(again.returncode, 0, again.stdout)
                    self.assertIn('needs attention', again.stderr)
                    self.assertEqual(case.events(), events + 'ssh\n')
                    self.assertFalse(list(case.remote.glob('.golems/m1-sync/*/success.json')))
                finally:
                    case.doCleanups()

    def test_success_marker_allows_idempotent_rerun(self):
        self.assertEqual(self.invoke().returncode, 0)
        self.assertTrue(list(self.remote.glob('.golems/m1-sync/*/success.json')))
        events = self.events()
        r = self.invoke()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.events(), events + 'ssh\nssh\n')

    def test_current_without_success_marker_needs_attention(self):
        self.record(HEAD)
        r = self.invoke()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('needs attention', r.stderr)
        self.assertEqual(self.events(), 'ssh\n')

    def test_incomplete_stage_blocks_even_with_an_older_success_marker(self):
        self.assertEqual(self.invoke().returncode, 0)
        (self.remote / '.golems/m1-sync' / (HEAD + '-interrupted')).mkdir()
        r = self.invoke()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('needs attention', r.stderr)

    def test_non_object_marker_needs_attention_without_traceback(self):
        self.record(HEAD)
        stage = self.remote / '.golems/m1-sync' / (HEAD + '-invalid-marker')
        stage.mkdir(parents=True)
        for payload in ('[]', 'null', '"bad"', '123', 'true', '{'):
            with self.subTest(payload=payload):
                (stage / 'success.json').write_text(payload)
                events = self.events()
                r = self.invoke()
                self.assertNotEqual(r.returncode, 0)
                self.assertIn('needs attention', r.stderr)
                self.assertNotIn('Traceback', r.stderr)
                self.assertEqual(self.events(), events + 'ssh\n')

    def test_checkout_links_can_be_replaced(self):
        for checkout, name in (('Gits/golems', 'checkout'), ('Gits/golems/.worktrees/worker', 'checkout-worker')):
            target = self.remote / checkout / ('skills/golem-powers/' + name)
            target.mkdir(parents=True)
            (self.remote / '.codex/skills' / name).symlink_to(target)
        r = self.invoke()
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_managed_checkout_link_must_not_be_deleted(self):
        target = self.remote / 'Gits/golems/skills/golem-powers/checkout'
        target.mkdir(parents=True)
        (self.remote / '.codex/skills/checkout').symlink_to(target)
        r = self.invoke(DELETE_CHECKOUT='1')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('M1-only skill changed', r.stderr)

    def test_other_checkout_link_replacement_is_caught(self):
        target = self.remote / 'Gits/another-repo/skills/golem-powers/checkout-other'
        target.mkdir(parents=True)
        (self.remote / '.codex/skills/checkout-other').symlink_to(target)
        r = self.invoke()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('M1-only skill changed', r.stderr)

    def test_draft_is_not_published_and_no_transport(self):
        r = self.invoke(DRAFT='1')
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn('not published yet; re-run when it is', r.stderr)
        self.assertEqual(self.events(), '')

    def test_gh_auth_and_network_errors_are_not_missing_releases(self):
        for message in ('gh: authentication failed (HTTP 401)', 'error connecting to api.github.com'):
            r = self.invoke(GH_FAILURE=message)
            self.assertEqual(r.returncode, 1, r.stderr)
            self.assertIn(message, r.stderr)
            self.assertNotIn('not published yet', r.stderr)
            self.assertEqual(self.events(), '')

    def receipt_writer(self, fail=False):
        writer = self.remote / '.golems/current/scripts/skills-sync-receipt.mjs'
        writer.parent.mkdir(parents=True, exist_ok=True)
        writer.write_text('// fixture writer; exercised by fake node')
        self.stub('node', '''import json
assert Path(sys.argv[1]).resolve() == (Path(os.environ['REMOTE_HOME']) / '.golems/current/scripts/skills-sync-receipt.mjs').resolve()
assert sys.argv[2:5] == ['emit', 'release-channel', 'm1']
record = json.loads((Path.home() / '.golems/release.json').read_text())
assert record['commit'] == "''' + HEAD + '''"
with open(os.environ['EVENTS'], 'a') as f: f.write('receipt\\n')
''' + ('sys.exit(1)\n' if fail else "print('skills-sync receipt: LIVE')\n"))

    def test_receipt_runs_from_installed_release_after_apply(self):
        self.receipt_writer()
        r = self.invoke()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('apply\nssh\nreceipt\n', self.events())
        self.assertIn('m1-receipt: LIVE', r.stdout)

    def test_missing_writer_is_unavailable_without_receipt_writes(self):
        r = self.invoke()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('m1-receipt: unavailable', r.stdout)
        self.assertFalse((self.remote / '.local/state/golems/install-receipts').exists())

    def test_failed_writer_is_unavailable_and_current_sync_can_retry(self):
        self.receipt_writer(fail=True)
        r = self.invoke()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('m1-receipt: unavailable', r.stdout)
        self.receipt_writer()
        again = self.invoke()
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn('m1-receipt: LIVE', again.stdout)

    def test_missing_node_is_unavailable_without_receipt_writes(self):
        self.receipt_writer()
        self.stub('node', 'sys.exit(127)\n')
        r = self.invoke()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('m1-receipt: unavailable', r.stdout)
        self.assertFalse((self.remote / '.local/state/golems/install-receipts').exists())


if __name__ == '__main__':
    unittest.main()

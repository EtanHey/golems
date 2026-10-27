"""Offline sync contract: fake transport, real remote orchestration, scratch HOME."""
import hashlib
import io
import json
import os
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
        self.env = dict(os.environ, HOME=str(self.base), REMOTE_HOME=str(self.remote),
                        ASSETS=str(self.assets), EVENTS=str(self.base / 'events'),
                        PATH=str(self.bin) + os.pathsep + os.environ['PATH'])
        self.stub('gh', '''import shutil
if os.environ.get('MISSING'): sys.exit(1)
if sys.argv[1:3] == ['release', 'download']:
    dest = Path(sys.argv[sys.argv.index('--dir') + 1])
    for p in Path(os.environ['ASSETS']).iterdir(): shutil.copy(p, dest / p.name)
else: print('false')
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
        self.stub('bun', '''with open(os.environ['EVENTS'], 'a') as f: f.write('apply\\n' if '--apply' in sys.argv else 'dry-run\\n')
''')

    def invoke(self, **env):
        return subprocess.run(['python3', '-B', str(ROOT / 'scripts/ratchet/sync-m1.py'),
                               HEAD, VERSION, str(self.base / ('run-' + env.get('INSTALL_FAIL', 'default')))], env=dict(self.env, **env), capture_output=True, text=True)

    def events(self):
        p = self.base / 'events'
        return p.read_text() if p.exists() else ''

    def invoke_live(self, *flags, **env):
        main = self.base / 'main'
        (main / '.git').mkdir(parents=True, exist_ok=True)
        self.env['MAIN'] = str(main)
        self.stub('git', "if '--git-common-dir' in sys.argv: print(os.environ['MAIN'] + '/.git')\nelif '--format=%ct' in sys.argv: print('1793059200')\nelse: print('" + HEAD + "')\n")
        real_gh = (self.bin / 'gh').read_text()
        (self.bin / 'gh').write_text(real_gh.replace("if os.environ.get('MISSING')", "if sys.argv[1:3] == ['pr', 'view']: print('" + HEAD + " branch'); sys.exit(0)\nif sys.argv[1] == 'api': print('{}'); sys.exit(0)\nif os.environ.get('MISSING')"))
        self.stub('node', "with open(os.environ['EVENTS'], 'a') as f: f.write('parity\\n' if 'run-rows.mjs' in sys.argv[1] else 'table\\n')\n")
        # Only configuration preflight is stubbed; helper/remote Python remain real.
        self.stub('python3', "if sys.argv[2].endswith('/installed-skills.py'): sys.exit(0)\nos.execv(" + repr(os.sys.executable) + ", [" + repr(os.sys.executable) + "] + sys.argv[1:])\n")
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
        self.assertIn('install\ndry-run\napply\nparity\n', self.events())
        backup = next(self.remote.glob('.claude/skills.bak-*'))
        with tarfile.open(backup) as archive:
            self.assertEqual(archive.extractfile('.codex/skills/only-m1/SKILL.md').read(), b'retain me')
        self.assertEqual((self.remote / '.codex/skills/only-m1/SKILL.md').read_text(), 'retain me')

    def test_current_with_flag_reaches_parity_without_backup(self):
        self.record(HEAD)
        r = self.invoke_live('--sync-m1')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('parity', self.events())
        self.assertNotIn('copy', self.events())
        self.assertFalse(list(self.remote.glob('.claude/skills.bak-*')))

    def test_flag_requires_owner_only_authorization_before_transport(self):
        valid = self.auth.read_text()
        for state in ('missing', 'malformed', 'insecure', 'symlink'):
            with self.subTest(state=state):
                self.auth.unlink(missing_ok=True)
                if state == 'symlink':
                    target = self.base / 'authorization-target'
                    target.write_text(valid)
                    self.auth.symlink_to(target)
                elif state != 'missing':
                    self.auth.write_text('invalid' if state == 'malformed' else valid)
                    self.auth.chmod(0o644 if state == 'insecure' else 0o600)
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

    def test_changed_config_on_success_fails(self):
        for failed in ('0', '1'):
            self.record('b' * 40)
            r = self.invoke(BAD_CONFIG='1', INSTALL_FAIL=failed)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('config.toml changed', r.stderr)


if __name__ == '__main__':
    unittest.main()

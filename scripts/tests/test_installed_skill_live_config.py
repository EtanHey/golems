"""Owned temporary fixture hosts; real documented shell/producer, stubbed identities/issuers."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROOTS = ('.claude/skills', '.agents/skills', '.codex/skills')


class LiveConfig(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='class-live-parity-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve() / 'class-home'
        self.main = self.home / 'Gits/golems'
        ratchet = self.main / 'scripts/ratchet'
        ratchet.mkdir(parents=True)
        (self.main / '.git').mkdir()
        for name in ['live-rows.sh', 'installed-skills.py', 'run-rows.mjs', 'table.mjs']:
            shutil.copy2(ROOT / 'scripts/ratchet' / name, ratchet / name)
        self.pins = [{k: hashlib.sha256((label+k).encode()).hexdigest()
                      for k in ['machine', 'home', 'hostname']} for label in ['class-local', 'class-remote']]
        required = dict(schema=2, identities=self.pins, roots={})
        remote = dict(schema=2, identity=self.pins[1], roots={})
        for root in ROOTS:
            skill = self.home / root / 'class-a'
            skill.mkdir(parents=True)
            data = b'# class-a\n'; (skill / 'SKILL.md').write_bytes(data)
            required['roots'][root] = dict(readable=['class-a'], allow_broken=[], allow_empty=[], target_aliases={})
            remote['roots'][root] = dict(exists=True, entries={'class-a': dict(
                kind='dir', exists=True, normalized_target='$HOME/'+root+'/class-a',
                skill_sha256=hashlib.sha256(data).hexdigest(), internal_skills={},
                files={'SKILL.md': dict(kind='file', sha256=hashlib.sha256(data).hexdigest(), executable=False)})})
        self.required = self.home / 'class-requirements.json'
        self.required.write_text(json.dumps(required))
        self.remote = self.home / 'class-remote.json'; self.remote.write_text(json.dumps(remote))
        key = self.home / 'class-identity'; key.write_text('class-only marker, not a credential\n')
        self.config = self.home / '.golems/ratchet/installed-skills.json'
        self.config.parent.mkdir(parents=True)
        self.config.write_text(json.dumps(dict(schema=1, host='class-remote', identity=str(key), requirements=str(self.required))))
        self.config.chmod(0o600)
        definition = json.loads((ROOT / 'scripts/ratchet/rows.json').read_text())
        row = next(r for r in definition['rows'] if r['id'] == 'installed-skill-parity')
        stub = dict(id='class-unrelated-issuer', metric='class stub', kind='unit', runner='live',
                    direction='pass', ceiling=True, command='echo class-unrelated-issuer-stub')
        (ratchet / 'rows.json').write_text(json.dumps(dict(schema=1, rows=[stub, row])))
        self.bin = self.home / 'class-bin'; self.bin.mkdir()
        self.gh_marker = self.home / 'class-gh.marker'
        self.ssh_args = self.home / 'class-ssh-args.json'
        self.command('git', "print(%r if '--git-common-dir' in sys.argv else 'a'*40)" % str(self.main / '.git'))
        self.command('gh', "Path(%r).touch(); print('a'*40+' class-branch' if 'pr' in sys.argv else 'class-owner')" % str(self.gh_marker))
        self.command('ssh', "Path(%r).write_text(json.dumps(sys.argv[1:])); print(Path(%r).read_text())" % (str(self.ssh_args), str(self.remote)))
        real_node = shutil.which('node')
        if not real_node: self.fail('node required; no capability skip')
        self.real_node = real_node
        self.command('node', "os.execv(%r, [%r]+sys.argv[1:]) if sys.argv[1].endswith('run-rows.mjs') else print('class-table-publication-stub')" % (real_node, real_node))
        self.command('python3', '''args=sys.argv[1:]
if args and args[0]=='-B': args=args[1:]
spec=importlib.util.spec_from_file_location('class_checker',args[0]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.observed_identity=lambda: %r
sys.argv=args
sys.exit(module.main())''' % self.pins[0])
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(('RATCHET_', 'GIT_'))}
        self.env.update(HOME=str(self.home), PATH=str(self.bin)+':'+os.environ['PATH'], PYTHONDONTWRITEBYTECODE='1')

    def command(self, name, body):
        path = self.bin / name
        path.write_text('#!'+sys.executable+'\nimport os,sys,json,importlib.util\nfrom pathlib import Path\n'+body+'\n')
        path.chmod(0o755)

    def recovery(self):
        source = (ROOT / 'scripts/ratchet/live-freshness.mjs').as_uri()
        js = 'import {recoveryCommand} from '+json.dumps(source)+'; console.log(recoveryCommand(42,77));'
        return subprocess.check_output([self.real_node, '--input-type=module', '-e', js], text=True).strip()

    def run_recovery(self):
        return subprocess.run(['bash', '-c', self.recovery()], cwd=self.main, env=self.env, capture_output=True, text=True)

    def test_documented_recovery_loads_config_and_runs_actual_row(self):
        run = self.run_recovery()
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(next((self.main / 'docs.local/ratchet-runs').glob('*/results.json')).read_text())
        self.assertTrue(result['results']['installed-skill-parity']['value'])
        args = json.loads(self.ssh_args.read_text())
        self.assertIn('IdentitiesOnly=yes', args); self.assertIn('IdentityAgent=none', args)
        self.assertIn(str(self.home / 'class-identity'), args)
        self.assertIn('class-unrelated-issuer-stub', run.stderr)
        self.assertIn('class-table-publication-stub', run.stdout)

    def test_missing_configuration_fails_before_github_or_issuer(self):
        self.config.rename(self.config.with_suffix('.held'))
        run = self.run_recovery()
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('RATCHET_SKILL_CONFIG missing', run.stderr)
        self.assertFalse(self.gh_marker.exists()); self.assertFalse(self.ssh_args.exists())

    def test_public_permissions_and_malformed_config_fail_before_probes(self):
        self.config.chmod(0o644)
        run = self.run_recovery()
        self.assertIn('owner-only', run.stderr); self.assertFalse(self.gh_marker.exists())
        self.config.chmod(0o600); self.config.write_text('[]')
        run = self.run_recovery()
        self.assertIn('RATCHET_SKILL_CONFIG: malformed', run.stderr)
        self.assertFalse(self.gh_marker.exists()); self.assertNotIn('Traceback', run.stderr)

    def test_schema_string_allowlist_fails_preflight_and_has_no_traceback(self):
        required = json.loads(self.required.read_text())
        required['roots'][ROOTS[0]]['allow_broken'] = 'xabx'
        self.required.write_text(json.dumps(required))
        run = self.run_recovery()
        self.assertNotEqual(run.returncode, 0); self.assertFalse(self.gh_marker.exists())
        self.assertIn('malformed readable/allowlist', run.stderr); self.assertNotIn('Traceback', run.stderr)

    def test_fake_ssh_self_host_is_rejected(self):
        remote = json.loads(self.remote.read_text()); remote['identity'] = self.pins[0]
        self.remote.write_text(json.dumps(remote))
        run = self.run_recovery()
        result = json.loads(next((self.main / 'docs.local/ratchet-runs').glob('*/results.json')).read_text())
        self.assertFalse(result['results']['installed-skill-parity']['value'])
        self.assertIn('same machine', run.stderr)


if __name__ == '__main__': unittest.main()

"""Lead-token issuer: lease only, the lead's own open PR branch, never main/master or the
default branch, logged to a machine log and the collab. Fixture HOME/repo; gh mocked."""
import importlib.machinery
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import test_gate
from test_commands import ROOT

ISSUER = ROOT.parents[2] / 'scripts/golems-lead-confirm'
KEYGEN = ROOT.parents[2] / 'scripts/golems-lead-keygen'
SHA = 'c' * 40


def load(path, name):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
    loader.exec_module(module)
    return module


class Fixture:
    def make(self):
        scratch_root = ROOT.parents[2] / 'docs.local/human-confirm-gate'
        scratch_root.mkdir(parents=True, exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(dir=scratch_root)
        self.home = Path(self.scratch.name).resolve()
        isolated = patch.dict(os.environ, dict(HOME=str(self.home), SSH_AUTH_SOCK=str(self.home / 'no-agent.sock')))
        isolated.start(); self.addCleanup(isolated.stop); self.addCleanup(self.scratch.cleanup)
        os.environ.pop('GOLEMS_LEAD_COLLAB', None)
        self.repo = self.home / 'repo'
        git = ['git', '-C', str(self.repo)]
        subprocess.run(['git', 'init', '-q', '-b', 'topic', str(self.repo)], check=True)
        subprocess.run(git + ['remote', 'add', 'origin', 'git@github.com:o/r.git'], check=True)
        self.signer = self.home / '.config/golems/lead-signer'
        self.signer.mkdir(parents=True); self.signer.chmod(0o700)
        self.key = self.signer / 'lead_ed25519'
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(self.key)], check=True)
        self.key.chmod(0o600)
        self.anchor = ('lead ' + self.key.with_suffix('.pub').read_text()).encode()
        # The issuer always writes the coordinator's OSS collab under its home: a fixture home here.
        self.collab = self.home / 'Gits/orchestrator/collab/2026-09-24-oss-consolidation.md'
        self.collab.parent.mkdir(parents=True); self.collab.write_text('# fixture collab\n')
        self.pr = dict(number=7, state='OPEN', mergedAt=None, isCrossRepository=False, headRefName='topic', headRefOid=SHA)
        self.default = 'develop'
        self.targets = []  # every repository gh was asked about
        self.issuer = load(ISSUER, 'lead_issuer')

    def gh(self, argv, **_):
        """Real git; gh answers from the fixture PR (never the network)."""
        if os.path.basename(argv[0]) == 'gh':
            self.targets.append(argv[3] if argv[1:3] == ['repo', 'view'] else argv[argv.index('--repo') + 1])
            if argv[1:3] == ['repo', 'view']:
                return json.dumps(dict(defaultBranchRef=dict(name=self.default)))
            return json.dumps(self.pr)
        return subprocess.run(argv, capture_output=True, text=True, check=True, timeout=5).stdout.strip()

    def issue(self, *extra, ref='refs/heads/topic', sha=SHA, anchor=None, remote=None):
        argv = [str(self.repo), '--ref', ref, '--sha', sha, '--session', 'lead-session', *extra]
        if remote: argv += ['--remote', remote]
        with patch('tokens.read_command', side_effect=self.gh), patch('tokens.trusted_binary', return_value='gh'):
            return self.issuer.issue(argv, home=self.home, anchor_fn=lambda home: anchor or self.anchor)

    def refused(self, **kwargs):
        try:
            self.issue(**kwargs)
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            return str(exc) or 'refused'
        return None

    def store(self):
        root = self.home / '.config/golems/human-confirm'
        return sorted(p.name for p in root.glob('*')) if root.exists() else []


class LeadIssuer(Fixture, unittest.TestCase):
    setUp = Fixture.make

    def test_issues_one_signed_lease_token_and_logs_it(self):
        path = self.issue()
        token = json.loads(path.read_text())
        self.assertEqual((token['kind'], token['session_id'], token['collab']), ('lead', 'lead-session', str(self.collab)))
        [op] = token['operations']
        self.assertEqual((op['class'], op['ref'], op['sha'], op['remote'], op['source']),
                         ('lease', 'refs/heads/topic', SHA, 'origin', 'HEAD'))
        self.assertLessEqual(token['expires_at'] - token['issued_at'], 300)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        from tokens import verify_signature
        self.assertTrue(verify_signature(path.read_bytes(), self.anchor, 'lead', str(path) + '.sig'))
        log = self.home / '.config/golems/human-confirm/lead-issued.log'
        self.assertTrue(log.is_file(), 'machine log written')
        [entry] = log.read_text().splitlines()
        logged = json.loads(entry)
        self.assertEqual(tuple(logged.get(k) for k in ('repo', 'github', 'ref', 'sha', 'pr', 'nonce')),
                         (str(self.repo), 'o/r', 'refs/heads/topic', SHA, 7, token['nonce']))
        self.assertIn('env', logged)
        lines = self.collab.read_text().splitlines()
        self.assertIn('GOLEMS_CONFIRM ' + json.dumps(token, sort_keys=True, separators=(',', ':')), lines)
        self.assertTrue(any(line.startswith('- lead-token issued ') and f'repo=o/r ref=refs/heads/topic sha={SHA[:12]} pr=#7' in line
                            for line in lines))

    def test_scope_refusals(self):
        cases = {
            'not a branch ref': dict(ref='topic'),
            'tag ref': dict(ref='refs/tags/v1'),
            'main': dict(ref='refs/heads/main'),
            'master': dict(ref='refs/heads/master'),
            'short sha': dict(sha='c' * 12),
            'non-hex sha': dict(sha='z' * 40),
        }
        for name, kwargs in cases.items():
            with self.subTest(name):
                self.assertIsNotNone(self.refused(**kwargs))
        self.assertEqual(self.store(), [])

    def test_never_main_or_master_even_when_default_is_elsewhere(self):
        for branch in ('main', 'master'):
            with self.subTest(branch):
                subprocess.run(['git', '-C', str(self.repo), 'symbolic-ref', 'HEAD', 'refs/heads/' + branch], check=True)
                self.pr.update(headRefName=branch)
                self.assertIsNotNone(self.refused(ref='refs/heads/' + branch))

    def test_pull_request_refusals(self):
        for updates in [dict(state='CLOSED'), dict(state='MERGED'), dict(mergedAt='2026-01-01T00:00:00Z'),
                        dict(isCrossRepository=True), dict(headRefName='other'), dict(headRefOid='d' * 40)]:
            with self.subTest(updates=updates):
                saved = dict(self.pr); self.pr.update(updates)
                self.assertIsNotNone(self.refused())
                self.pr.clear(); self.pr.update(saved)
        self.default = 'topic'
        self.assertIsNotNone(self.refused())
        self.assertEqual(self.store(), [])

    def test_repository_refusals(self):
        git = ['git', '-C', str(self.repo)]
        subprocess.run(git + ['symbolic-ref', 'HEAD', 'refs/heads/elsewhere'], check=True)
        self.assertIsNotNone(self.refused())  # not the current branch
        subprocess.run(git + ['symbolic-ref', 'HEAD', 'refs/heads/topic'], check=True)
        subprocess.run(git + ['remote', 'set-url', '--add', '--push', 'origin', 'git@github.com:o/r.git'], check=True)
        subprocess.run(git + ['remote', 'set-url', '--add', '--push', 'origin', 'git@github.com:x/y.git'], check=True)
        self.assertIsNotNone(self.refused())  # two push URLs: not one GitHub remote
        subprocess.run(git + ['remote', 'remove', 'origin'], check=True)
        subprocess.run(git + ['remote', 'add', 'origin', 'https://git.localhost/o/r.git'], check=True)
        self.assertIsNotNone(self.refused())  # not GitHub
        for alias in ('git@github.com-etanhey:o/r.git', 'gh:o/r', 'ssh://git@github.com/o/r.git'):
            with self.subTest(alias=alias):
                subprocess.run(git + ['remote', 'set-url', 'origin', alias], check=True)
                self.assertIsNotNone(self.refused())  # an SSH alias or unanchored spelling: unknown host
        self.assertEqual(self.store(), [])

    def test_the_pushed_remote_alone_names_the_repository(self):
        """Other remotes do not matter (fleet checkouts carry several GitHub remotes); the
        token is bound to the pushed remote's repository and that repository's PR."""
        subprocess.run(['git', '-C', str(self.repo), 'remote', 'add', 'fork', 'git@github.com:x/r.git'], check=True)
        token = json.loads(self.issue().read_text())
        self.assertEqual((token['operations'][0]['remote'], set(self.targets)), ('origin', {'o/r'}))
        self.targets.clear()
        token = json.loads(self.issue(remote='fork').read_text())
        self.assertEqual((token['operations'][0]['remote'], set(self.targets)), ('fork', {'x/r'}))
        logged = [json.loads(line)['github'] for line in (self.home / '.config/golems/human-confirm/lead-issued.log').read_text().splitlines()]
        self.assertEqual(logged, ['o/r', 'x/r'])

    def test_key_and_collab_refusals(self):
        self.signer.chmod(0o755)  # ssh-keygen would still sign: only the issuer's check refuses
        self.assertIsNotNone(self.refused())
        self.signer.chmod(0o700); self.key.chmod(0o644)
        self.assertIsNotNone(self.refused())
        self.key.chmod(0o600)
        self.collab.unlink()
        self.assertIsNotNone(self.refused())  # the OSS collab must exist
        outside = self.home / 'elsewhere.md'; outside.write_text('')
        self.collab.symlink_to(outside)
        self.assertIsNotNone(self.refused())  # and resolve inside the collab directory
        self.assertEqual(self.store(), [])

    def test_no_collab_override(self):
        """GOLEMS_LEAD_COLLAB is not honoured: issuances always reach the OSS collab."""
        other = self.collab.with_name('other.md'); other.write_text('')
        with patch.dict(os.environ, GOLEMS_LEAD_COLLAB=str(other)):
            self.issue()
        self.assertEqual(other.read_text(), '')
        self.assertIn('- lead-token issued ', self.collab.read_text())

    def test_a_failed_log_write_refuses_and_leaves_no_token(self):
        root = self.home / '.config/golems/human-confirm'; root.mkdir(parents=True, mode=0o700)
        (root / 'lead-issued.log').mkdir()
        self.assertIsNotNone(self.refused())
        self.assertEqual(self.store(), ['lead-issued.log'])
        (root / 'lead-issued.log').rmdir()
        self.collab.chmod(0o400)
        self.assertIsNotNone(self.refused())
        self.assertNotIn('.json', ''.join(self.store()))

    def test_each_issuer_layer_refuses_on_its_own(self):
        """With the shared scope rule stubbed open, the issuer's own checks still refuse."""
        opened = lambda op, fn: dict(self.pr)
        with patch.object(self.issuer, 'lead_scope', opened):
            for branch in ('main', 'master'):
                with self.subTest(branch):
                    self.assertIsNotNone(self.refused(ref='refs/heads/' + branch))
            subprocess.run(['git', '-C', str(self.repo), 'config', 'remote.origin.mirror', 'true'], check=True)
            self.assertIsNotNone(self.refused())  # configured mirror: not a plain lease
        self.assertEqual(self.store(), [])

    def test_shared_scope_rule(self):
        from tokens import lead_scope
        pr = dict(self.pr, headRefName='main')
        for ref in ('refs/heads/main', 'refs/heads/master', 'refs/tags/topic'):
            with self.subTest(ref), self.assertRaises(ValueError):
                lead_scope(dict(ref=ref, sha=SHA), lambda op: ('develop', dict(pr, headRefName=ref.rsplit('/', 1)[1])))
        self.assertEqual(lead_scope(dict(ref='refs/heads/topic', sha=SHA), lambda op: ('develop', self.pr))['number'], 7)
        with self.assertRaises(ValueError):  # the default branch in another letter case
            lead_scope(dict(ref='refs/heads/topic', sha=SHA), lambda op: ('Topic', self.pr))

    def test_signature_must_match_the_anchor(self):
        other = self.home / 'other'
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(other)], check=True)
        self.assertIsNotNone(self.refused(anchor=('lead ' + other.with_suffix('.pub').read_text()).encode()))
        self.assertEqual([n for n in self.store() if n.endswith(('.json', '.sig'))], [])


class LeadKeygen(unittest.TestCase):
    def test_creates_a_private_key_once_and_prints_the_anchor_line(self):
        root = ROOT.parents[2] / 'docs.local/human-confirm-gate'; root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as tmp:
            home = Path(tmp)
            keygen = load(KEYGEN, 'lead_keygen')
            line = keygen.generate(home)
            key = home / '.config/golems/lead-signer/lead_ed25519'
            self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(key.parent.stat().st_mode), 0o700)
            self.assertEqual(line, 'lead ' + ' '.join(key.with_suffix('.pub').read_text().split()[:2]))
            self.assertTrue(line.startswith('lead ssh-ed25519 '))
            self.assertNotIn('PRIVATE', line)
            before = key.read_bytes()
            try:
                keygen.generate(home)  # never overwrites
                outcome = 'generated'
            except Exception as exc:  # the issuer's own refusal, not ssh-keygen's prompt
                outcome = type(exc).__name__
            self.assertEqual(outcome, 'ValueError')
            self.assertEqual(key.read_bytes(), before)

    def test_refuses_symlinked_key_paths(self):
        root = ROOT.parents[2] / 'docs.local/human-confirm-gate'; root.mkdir(parents=True, exist_ok=True)
        keygen = load(KEYGEN, 'lead_keygen_links')
        for name in ('lead_ed25519', 'lead_ed25519.pub'):
            with self.subTest(name), tempfile.TemporaryDirectory(dir=root) as tmp:
                home = Path(tmp); signer = home / '.config/golems/lead-signer'; signer.mkdir(parents=True)
                target = home / 'elsewhere'
                (signer / name).symlink_to(target)  # dangling
                try:
                    keygen.generate(home); outcome = 'generated'
                except Exception as exc:
                    outcome = type(exc).__name__
                self.assertEqual(outcome, 'ValueError')
                self.assertFalse(target.exists())


class LeadTokenThroughTheGate(unittest.TestCase):
    """The issued token is accepted by the gate's own authorize() exactly once, and by nothing broader."""
    tearDown = test_gate.Gate.tearDown
    lock = test_gate.Gate.lock
    unlock = test_gate.Gate.unlock
    commit_pins = test_gate.Gate.commit_pins

    def setUp(self):
        test_gate.Gate.setUp(self)
        git = ['git', '-C', str(self.repo)]
        subprocess.run(git + ['checkout', '-q', '-b', 'topic'], check=True)
        subprocess.run(git + ['remote', 'add', 'origin', 'git@github.com:o/r.git'], check=True)
        signer = self.home / '.config/golems/lead-signer'; signer.mkdir(parents=True); signer.chmod(0o700)
        shutil.copy(self.lead_key, signer / 'lead_ed25519'); (signer / 'lead_ed25519').chmod(0o600)
        self.collab = self.home / 'Gits/orchestrator/collab/2026-09-24-oss-consolidation.md'; self.collab.write_text('')
        self.issuer = load(ISSUER, 'lead_issuer_gate')
        self.pr = dict(number=7, state='OPEN', mergedAt=None, isCrossRepository=False, headRefName='topic', headRefOid=self.sha)

    def metadata(self, op):
        return 'main', self.pr

    def issue(self):
        self.lock()
        with patch('tokens.trusted_binary', return_value='gh'):
            return self.issuer.issue([str(self.repo), '--ref', 'refs/heads/topic', '--sha', self.sha, '--session', 'worker'],
                                     home=self.home, metadata_fn=self.metadata)

    def payload(self, command, cwd=None):
        return dict(cwd=str(cwd or self.repo), tool_input=dict(command=command), session_id='worker')

    def test_issued_token_authorizes_exactly_its_lease_once(self):
        from tokens import authorize
        from commands import operations
        self.issue()
        command = self.command
        self.assertTrue(authorize(self.payload(command), operations(command, str(self.repo)), self.home, self.metadata))
        self.assertFalse(authorize(self.payload(command), operations(command, str(self.repo)), self.home, self.metadata))

    def signed(self, command):
        """A hand-signed lead token for `command` (what a same-UID agent could forge with the lead key)."""
        import hashlib, time
        from commands import operations
        token = dict(version=1, kind='lead', nonce='b' * 32, issued_at=time.time(), expires_at=time.time() + 120,
                     command_sha256=hashlib.sha256((str(self.repo) + '\0' + command).encode()).hexdigest(),
                     operations=operations(command, str(self.repo)), session_id='worker', collab=str(self.collab))
        path = self.store / (token['nonce'] + '.json'); path.write_text(json.dumps(token, sort_keys=True)); path.chmod(0o600)
        subprocess.run(['ssh-keygen', '-Y', 'sign', '-q', '-f', str(self.lead_key), '-n', 'golems-confirm', str(path)], check=True)
        self.collab.write_text('GOLEMS_CONFIRM ' + json.dumps(token, sort_keys=True, separators=(',', ':')) + '\n')
        return token['operations']

    def test_gate_denies_lead_leases_to_main_or_master_whatever_the_default(self):
        from tokens import authorize
        self.lock()
        for branch in ('main', 'master', 'Main'):
            with self.subTest(branch):
                command = self.command.replace('refs/heads/topic', 'refs/heads/' + branch)
                ops = self.signed(command)
                pr = dict(self.pr, headRefName=branch)
                self.assertFalse(authorize(self.payload(command), ops, self.home, lambda op: ('develop', pr)))
                for leftover in self.store.glob('b' * 32 + '.json*'): leftover.unlink()
        ops = self.signed(self.command)  # control: the same forge for the PR branch is accepted
        self.assertTrue(authorize(self.payload(self.command), ops, self.home, lambda op: ('develop', self.pr)))

    def test_issued_token_authorizes_nothing_else(self):
        from tokens import authorize
        from commands import operations
        self.issue()
        other_sha = self.command.replace(self.sha, 'b' * 40)
        other_ref = self.command.replace('refs/heads/topic', 'refs/heads/topic2')
        force = 'git push --force origin HEAD:refs/heads/topic'
        other_repo = self.home / 'repo2'
        subprocess.run(['git', 'init', '-q', str(other_repo)], check=True)
        for command, cwd in [(other_sha, None), (other_ref, None), (force, None), (self.command, other_repo)]:
            with self.subTest(command=command, cwd=cwd):
                ops = operations(command, str(cwd or self.repo))
                self.assertFalse(authorize(self.payload(command, cwd), ops, self.home, self.metadata))
        self.assertTrue(authorize(self.payload(self.command), operations(self.command, str(self.repo)), self.home, self.metadata))


if __name__ == '__main__':
    unittest.main()

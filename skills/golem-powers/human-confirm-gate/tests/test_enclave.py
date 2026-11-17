"""Disposable software keys only. Never calls the native approver or SSH agent."""
import hashlib
import json
import os
import subprocess
import time
import uuid
import unittest
from unittest.mock import patch
import test_gate


class Enclave(unittest.TestCase):
    tearDown = test_gate.Gate.tearDown
    run_hook = test_gate.Gate.run_hook
    commit_pins = test_gate.Gate.commit_pins
    def setUp(self):
        test_gate.Gate.setUp(self)
        self.git('config', 'remote.origin.url', 'https://example.invalid/A.git')
        self.command = 'git push --delete origin refs/heads/topic'
        self.ec = self.home / 'ec.pem'
        self.pub = self.home / '.config/golems/enclave-public.der'
        subprocess.run(['/usr/bin/openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', str(self.ec)], check=True, capture_output=True)
        subprocess.run(['/usr/bin/openssl', 'pkey', '-in', str(self.ec), '-pubout', '-outform', 'DER', '-out', str(self.pub)], check=True, capture_output=True)
        self.pub.chmod(0o600)
        self.commit_pins(self.pins.read_text() + hashlib.sha256(self.pub.read_bytes()).hexdigest() + ' enclave-fixture\n')

    def git(self, *args):
        return subprocess.run(['/usr/bin/git', '-C', str(self.repo), *args], check=True, capture_output=True, text=True).stdout.strip()

    def enclave(self, **updates):
        from commands import operations
        from enclave import scope
        ops = operations(self.command, str(self.repo))
        token = dict(version=1, kind='enclave', nonce=uuid.uuid4().hex, issued_at=int(time.time()), expires_at=int(time.time()) + 120,
                     command_sha256=hashlib.sha256((str(self.repo) + '\0' + self.command).encode()).hexdigest(), operations=ops, session_id='worker',
                     cwd=str(self.repo), command=self.command, **scope(self.command, str(self.repo), ops))
        token.update(updates)
        path = self.store / (token['nonce'] + '.json')
        path.write_bytes(json.dumps(token, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()); path.chmod(0o600)
        subprocess.run(['/usr/bin/openssl', 'dgst', '-sha256', '-sign', str(self.ec), '-out', str(path) + '.sig', str(path)], check=True, capture_output=True)
        return path

    def test_enclave_consumption_and_replay(self):
        path = self.enclave(); raw = path.read_bytes(); sig = path.with_suffix('.json.sig').read_bytes()
        self.assertEqual(self.run_hook()[0], 0)
        path.write_bytes(raw); path.chmod(0o600); path.with_suffix('.json.sig').write_bytes(sig)
        self.assertEqual(self.run_hook()[0], 2)

    def test_forged_unpinned_software_key_refused(self):
        self.commit_pins(self.pins.read_text().splitlines()[1] + '\n')
        self.enclave()
        self.assertEqual(self.run_hook()[0], 2)

    def test_ssh_agent_signature_cannot_be_enclave(self):
        path = self.enclave(); path.with_suffix('.json.sig').unlink()
        subprocess.run(['/usr/bin/ssh-keygen', '-Y', 'sign', '-q', '-f', str(self.key), '-n', 'golems-confirm', str(path)], check=True)
        self.assertEqual(self.run_hook()[0], 2)

    def test_signed_fields_must_match_real_scope(self):
        for update in [dict(expires_at=int(time.time()) - 1), dict(ref='refs/heads/other'), dict(remote_url='https://example.invalid/B.git'), dict(command='echo harmless'), dict(git_provider='/fake/git')]:
            self.enclave(**update)
            self.assertEqual(self.run_hook()[0], 2)

    def test_rewrite_invalidates_enclave(self):
        self.enclave()
        self.git('config', 'url.https://example.invalid/B.git.pushInsteadOf', 'https://example.invalid/A.git')
        self.assertEqual(self.run_hook()[0], 2)

    def test_environment_does_not_forge_signature(self):
        self.commit_pins(self.pins.read_text().splitlines()[1] + '\n')
        self.enclave()
        for name in ['DEVELOPER_DIR', 'TOOLCHAINS', 'SDKROOT', 'PATH', 'PYTHONPATH', 'TMPDIR', 'GOLEMS_APPROVAL', 'GOLEMS_SKIP_TOUCH_ID']:
            from commands import operations
            from tokens import authorize
            payload = dict(cwd=str(self.repo), tool_input=dict(command=self.command), session_id='worker')
            ops = operations(self.command, str(self.repo))
            with patch.dict(os.environ, {name: 'invented-skip'}):
                self.assertFalse(authorize(payload, ops, self.home))

    def test_enclave_issuer_and_question_receipt(self):
        import importlib.machinery
        import importlib.util
        import enclave
        helper = self.home / 'test-only-signer'
        helper.write_text('#!/usr/bin/python3\nimport subprocess,sys\nsys.stdout.buffer.write(subprocess.run(["/usr/bin/openssl","dgst","-sha256","-sign",' + repr(str(self.ec)) + '],input=sys.stdin.buffer.read(),capture_output=True,check=True).stdout)\n')
        helper.chmod(0o700)
        loader = importlib.machinery.SourceFileLoader('test_enclave_issue', str(test_gate.ROOT.parents[2] / 'scripts/golems-confirm'))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec); loader.exec_module(module)
        receipt = self.home / 'receipt.json'
        receipt.write_text(json.dumps(dict(approved=True, cwd=str(self.repo), command=self.command, session_id='worker'))); receipt.chmod(0o600)
        args = [str(self.repo), 'topic', 'delete', '--session', 'worker', '--enclave', '--command', self.command, '--approval-receipt', str(receipt)]
        with patch.object(enclave, 'HELPER', str(helper)), patch.object(module, 'owner_terminal', side_effect=AssertionError('enclave must not require owner terminal')):
            path = module.issue(args, home=self.home)
            self.assertEqual(json.loads(path.read_bytes())['kind'], 'enclave')
            self.assertEqual(self.run_hook()[0], 0)
            with self.assertRaises(FileExistsError):
                module.issue(args, home=self.home)

    def test_ref_remote_and_bytes_changes_refuse(self):
        self.enclave()
        self.assertEqual(self.run_hook('git push --delete origin refs/heads/other')[0], 2)
        self.git('config', 'remote.origin.url', 'https://example.invalid/B.git')
        self.assertEqual(self.run_hook()[0], 2)
        self.git('config', 'remote.origin.url', 'https://example.invalid/A.git')
        path = next(self.store.glob('*.json'))
        token = json.loads(path.read_bytes()); token['nonce'] = 'c' * 32
        path.write_text(json.dumps(token))
        self.assertEqual(self.run_hook()[0], 2)

    def test_P3_gh_targets_refuse_instead_of_showing_cwd_origin(self):
        from commands import operations
        from enclave import scope
        for command in ['gh api -X DELETE repos/invented/other-repo', 'gh repo delete invented/other-repo --yes',
                        'gh --repo invented/other-repo api -X PATCH repos/invented/other-repo -f default_branch=x']:
            with self.subTest(command=command), self.assertRaisesRegex(ValueError, 'GitHub target'):
                scope(command, str(self.repo), operations(command, str(self.repo)))

    def test_P3_gh_alias_target_also_refuses(self):
        from commands import operations
        from enclave import scope
        self.git('config', 'alias.invented', '!gh repo delete invented/other-repo --yes')
        command = 'git invented'
        with self.assertRaisesRegex(ValueError, 'GitHub target'):
            scope(command, str(self.repo), operations(command, str(self.repo)))

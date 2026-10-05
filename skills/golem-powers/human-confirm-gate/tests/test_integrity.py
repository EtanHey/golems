import json
import os
import subprocess
from types import SimpleNamespace
from unittest.mock import patch
from test_gate import Gate


class Integrity(Gate):
    def metadata(self, _):
        return 'main', dict(state='OPEN', mergedAt=None, isCrossRepository=False,
                            headRefName='topic', headRefOid=self.sha)

    def authorize(self):
        from tokens import authorize
        from commands import operations
        return authorize(dict(cwd=str(self.repo), tool_input=dict(command=self.command), session_id='worker'),
                         operations(self.command, str(self.repo)), self.home, self.metadata)

    def test_version_nonce_and_anchor_mode(self):
        self.token(version=2); self.assertEqual(self.run_hook()[0], 2)
        path = self.token(); path.rename(self.store / ('b' * 32 + '.json'))
        path.with_suffix('.json.sig').rename(self.store / ('b' * 32 + '.json.sig'))
        self.assertEqual(self.run_hook()[0], 2)
        self.token(); os.chflags(self.policy, 0); self.policy.chmod(0o644)
        self.assertEqual(self.run_hook()[0], 2)

    def test_separate_principal_keys(self):
        for kind, key in [('human', self.lead_key), ('lead', self.key)]:
            path = self.token(kind); path.with_suffix('.json.sig').unlink()
            subprocess.run(['ssh-keygen', '-Y', 'sign', '-q', '-f', str(key), '-n', 'golems-confirm', str(path)], check=True)
            self.assertFalse(self.authorize())

    def test_unsigned_fresh_token(self):
        path = self.token(); path.with_suffix('.json.sig').write_text('forged')
        self.assertFalse(self.authorize())

    def test_unknown_cwd_cannot_scope_push(self):
        from commands import operations
        try:
            operations('cd "$UNKNOWN"; git push -f origin topic', str(self.repo), alias_lookup=lambda *_: None)
        except ValueError:
            pass
        else:
            self.fail('unknown cwd must refuse before attempting metadata')

    def test_nofollow_and_uid(self):
        from tokens import private_read
        path = self.token(); raw = self.home / 'fixture-raw'; path.rename(raw); path.symlink_to(raw)
        self.assertEqual(self.run_hook()[0], 2)
        info = os.stat(raw)
        wrong = SimpleNamespace(st_mode=info.st_mode, st_uid=os.getuid() + 1, st_size=info.st_size)
        with patch('tokens.os.fstat', return_value=wrong):
            try:
                private_read(raw)
            except ValueError:
                pass
            else:
                self.fail('foreign uid must refuse')

    def test_lead_class_exact_command_and_collab_directory(self):
        from commands import operations
        from tokens import authorize
        ops = operations(self.command, str(self.repo)); ops[0]['class'] = 'force'
        self.token('lead', operations=ops)
        self.assertFalse(authorize(dict(cwd=str(self.repo), tool_input=dict(command=self.command), session_id='worker'),
                                   ops, self.home, self.metadata))
        for command in ['git push -f origin topic',
                        'bash -c ' + __import__('shlex').quote(self.command),
                        self.command + '; echo done',
                        self.command.replace(self.sha, 'a' * 7)]:
            with self.subTest(command=command):
                original = self.command; self.command = command
                self.token('lead'); self.assertFalse(self.authorize()); self.command = original
        original = self.collab
        self.collab = self.home / 'outside.md'; self.token('lead')
        self.assertFalse(self.authorize()); self.collab = original

    def test_mirror_and_config_override_and_short_lease(self):
        from commands import operations
        self.assertEqual(operations(self.command.replace(self.sha, 'a' * 7), str(self.repo))[0]['class'], 'force')
        self.assertEqual(self.run_hook('git -c remote.origin.mirror=true push origin')[0], 2)
        subprocess.run(['git', '-C', str(self.repo), 'config', 'remote.origin.mirror', 'true'], check=True)
        self.assertEqual(self.run_hook('git push origin')[0], 2)

    def test_literal_shell_inputs_can_be_human_authorized(self):
        import uuid
        for command in ["bash <<'X'\ngit push -f origin topic\nX", "sh <<< 'git push -f origin topic'",
                        "fish -c 'git push -f origin topic'", "trap 'git push -f origin topic' EXIT"]:
            self.command = command
            try:
                self.token(nonce=uuid.uuid4().hex)
            except Exception as exc:
                self.fail('literal payload must classify: ' + str(exc))
            self.assertEqual(self.run_hook()[0], 0)

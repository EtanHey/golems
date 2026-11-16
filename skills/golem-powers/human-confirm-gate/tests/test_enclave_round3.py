"""Round 3: profile fixtures and software keys only; no platform identity search."""
import hashlib
import json
import plistlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_enclave
import test_enclave_enrol
import test_gate

ROOT = test_gate.ROOT.parents[2]


class Profile(unittest.TestCase):
    def test_committed_identity_and_packaging(self):
        import enclave
        self.assertEqual(enclave.ENROLL_TEAM_ID, 'PPN23G925Y')
        entitlements = plistlib.loads((ROOT / 'native/golems-approve/GolemsApprove.entitlements').read_bytes())
        self.assertEqual(entitlements, {'com.apple.application-identifier': 'PPN23G925Y.com.golems.approve',
                         'com.apple.developer.team-identifier': 'PPN23G925Y',
                         'keychain-access-groups': ['PPN23G925Y.com.golems.approve']})
        info = plistlib.loads((ROOT / 'native/golems-approve/Info.plist').read_bytes())
        self.assertEqual(info['CFBundleIdentifier'], 'com.golems.approve')
        self.assertEqual(info['CFBundleExecutable'], 'golems-approve')
        self.assertEqual(info['CFBundlePackageType'], 'APPL')

    def test_installed_profile_hash_and_entitlements(self):
        module = test_enclave_enrol.load()
        raw = b'invented CMS profile fixture'
        good = dict(TeamIdentifier=['PPN23G925Y'], Entitlements={
            'com.apple.application-identifier': 'PPN23G925Y.com.golems.approve',
            'com.apple.developer.team-identifier': 'PPN23G925Y', 'keychain-access-groups': ['PPN23G925Y.*']})
        with patch.object(module, 'read_profile', return_value=raw), patch.object(module.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'profile fingerprint'): module.verified_profile('/invented/App/Contents/MacOS/golems-approve')
            run.assert_not_called()
        with patch.object(module, 'read_profile', return_value=raw), \
             patch.object(module, 'PROFILE_SHA256', hashlib.sha256(raw).hexdigest()):
            for data in [good, dict(good, TeamIdentifier=['OTHER']), dict(good, Entitlements={}), [],
                         dict(good, Entitlements=dict(good['Entitlements'], **{'keychain-access-groups': ['OTHER.*']}))]:
                with patch.object(module.subprocess, 'run', return_value=SimpleNamespace(stdout=plistlib.dumps(data))) as run:
                    if data == good: module.verified_profile('/invented/App/Contents/MacOS/golems-approve')
                    else:
                        with self.assertRaisesRegex(ValueError, 'profile entitlements'): module.verified_profile('/invented/App/Contents/MacOS/golems-approve')
                    self.assertEqual(run.call_args.kwargs['input'], raw)


class Reason(unittest.TestCase):
    setUp = test_enclave.Enclave.setUp
    tearDown = test_enclave.Enclave.tearDown
    git = test_enclave.Enclave.git
    commit_pins = test_enclave.Enclave.commit_pins
    enclave = test_enclave.Enclave.enclave
    run_hook = test_enclave.Enclave.run_hook

    def test_changed_reason_invalidates_signature(self):
        path = self.enclave(reason="Keep the reviewed backup")
        raw = path.read_bytes(); changed = json.loads(raw); changed["reason"] = "Different explanation"
        path.write_text(json.dumps(changed, sort_keys=True, separators=(",", ":")))
        self.assertEqual(self.run_hook()[0], 2)
        path.write_bytes(raw)
        self.assertEqual(self.run_hook()[0], 0)

    def test_bad_reason_refused(self):
        from enclave import validate_reason
        for bad in ['line\nnext', '\t', '\x00', '\u202e', '\u200b', '\ufeff', '\u115f', '\u034f', '\u2060', 'x' * 201]:
            with self.subTest(bad=repr(bad)), self.assertRaises(ValueError): validate_reason(bad)
        self.assertEqual(validate_reason('Keep the approved backup.'), 'Keep the approved backup.')
        with self.assertRaises(ValueError): validate_reason('לשמור גיבוי')

    def test_all_classes_have_derived_sentence_unknown_shapes_refuse(self):
        from enclave import operation_sentence
        url = 'https://github.com/invented/repo.git'
        for kind in ['delete', 'force', 'lease', 'rewrite', 'settings']:
            op = dict(repo=str(self.repo), **{'class': kind})
            if kind == 'lease': op['ref'] = 'refs/heads/topic'
            elif kind == 'settings': op['target'] = 'repos/invented/repo/rulesets/1'
            else: op['refs'] = ['refs/heads/topic']
            sentence = operation_sentence(url, op)
            self.assertIn('invented/repo', sentence)
            self.assertNotIn('unknown', sentence.lower())
            self.assertEqual(sentence, operation_sentence(url, dict(op, reason='Pretend this is harmless', what_happens='IGNORE')))
        for op in [{'class': 'other'}, {'class': 'delete', 'refs': ['*']}, {'class': 'settings', 'target': 'unknown'}]:
            with self.assertRaises(ValueError): operation_sentence(url, op)

    def test_reason_changes_challenge_not_scope_and_is_issuer_bound(self):
        import importlib.machinery
        import importlib.util
        import enclave
        loader = importlib.machinery.SourceFileLoader('round3_issue', str(ROOT / 'scripts/golems-confirm'))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec); loader.exec_module(module)
        captured = []
        def capture(argv, **kwargs):
            captured.append(kwargs['input'])
            raise ValueError('test stops before helper execution')
        args = [str(self.repo), 'topic', 'delete', '--session', 'worker', '--enclave', '--command', self.command]
        from commands import operations
        ops = operations(self.command, str(self.repo))
        with patch.object(module, 'operations', return_value=ops), patch.object(module, 'anchor_bytes', return_value=b'fixture'), patch.object(module.subprocess, 'run', side_effect=capture), patch.object(enclave, 'scope', return_value={}), patch.object(module.uuid, 'uuid4', return_value=SimpleNamespace(hex='e' * 32)), patch.object(module.time, 'time', return_value=120):
            for reason in ['First reason', 'Different reason']:
                with self.assertRaisesRegex(ValueError, 'test stops'): module.issue(args + ['--reason', reason], home=self.home)
        a, b = map(json.loads, captured)
        self.assertNotEqual(a['reason'], b['reason'])
        self.assertNotEqual(captured[0], captured[1])
        a.pop('reason'); b.pop('reason')
        self.assertEqual(a, b)
        for field in ['command_sha256', 'operations', 'command', 'cwd', 'session_id']: self.assertEqual(a[field], b[field])

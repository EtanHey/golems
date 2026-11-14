"""r1275 P1: substituted software helper must never become the enrolment pin.
All platform commands below are mocked; no keychain, certificates or native helper.
"""
import importlib.machinery
import importlib.util
import os
import stat
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_enclave
import test_gate


def load():
    loader = importlib.machinery.SourceFileLoader('enrol_round2', str(test_gate.ROOT.parents[2] / 'scripts/golems-enclave-enroll'))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec); loader.exec_module(module)
    return module


class Enrolment(unittest.TestCase):
    setUp = test_enclave.Enclave.setUp
    tearDown = test_enclave.Enclave.tearDown
    git = test_enclave.Enclave.git
    commit_pins = test_enclave.Enclave.commit_pins
    def test_P1_substituted_software_helper_refused(self):
        import enclave
        helper = self.home / 'fake-golems-approve'
        helper.write_text('#!/bin/sh\n/usr/bin/openssl pkey -in "' + str(self.ec) + '" -pubout -outform DER\n'); helper.chmod(0o755)
        self.pub.unlink()
        module = load()
        # Same owner-terminal patch as reviewer P1; command spy ensures refusal
        # precedes helper invocation or any public-file reservation.
        with patch.object(enclave, 'HELPER', str(helper)), \
             patch('importlib.machinery.SourceFileLoader.exec_module', lambda _, m: m.__dict__.update(owner_terminal=lambda: None)), \
             patch.object(module.subprocess, 'run', side_effect=AssertionError('must refuse before execution')):
            with self.assertRaises(ValueError):
                module.main()
        self.assertFalse(self.pub.exists())

    def test_placeholder_refuses_before_platform_commands(self):
        module = load()
        with patch.object(module.subprocess, 'run', side_effect=AssertionError('no platform command with placeholder')):
            with self.assertRaisesRegex(ValueError, 'TEAMID'):
                module.verified_helper()

    def test_signature_and_zero_identity_gates(self):
        import enclave
        module = load()
        def root_owned(path):
            return SimpleNamespace(st_uid=0, st_mode=(stat.S_IFREG if str(path) == enclave.HELPER else stat.S_IFDIR) | 0o755)
        with patch.object(enclave, 'ENROLL_TEAM_ID', 'ABCDEFGHIJ'), patch.object(module.Path, 'lstat', root_owned):
            with patch.object(module.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'codesign')) as call:
                with self.assertRaises(subprocess.CalledProcessError): module.verified_helper()
                self.assertEqual(call.call_count, 1)
            for output in ['1 valid identities found', 'unexpected output', '1) certificate\n0 valid identities found']:
                with patch.object(module.subprocess, 'run', side_effect=[SimpleNamespace(), SimpleNamespace(stdout=output)]):
                    with self.assertRaisesRegex(ValueError, 'zero code-signing identities'): module.verified_helper()
            with patch.object(module.subprocess, 'run', side_effect=[SimpleNamespace(), SimpleNamespace(stdout='     0 valid identities found\n')]) as call:
                self.assertEqual(module.verified_helper(), enclave.HELPER)
                verify, identities = [c.args[0] for c in call.call_args_list]
                self.assertEqual(verify, ['/usr/bin/codesign', '--verify', '--strict', '-R', '=anchor apple generic and certificate leaf[subject.OU] = "ABCDEFGHIJ" and identifier "com.golems.approve"', enclave.HELPER])
                self.assertEqual(identities, ['/usr/bin/security', 'find-identity', '-p', 'codesigning', '-v'])

    def test_root_path_must_be_immutable_to_same_user(self):
        import enclave
        module = load()
        for uid, mode in [(os.getuid(), 0o755), (0, 0o775), (0, 0o777)]:
            with patch.object(enclave, 'ENROLL_TEAM_ID', 'ABCDEFGHIJ'), \
                 patch.object(module.Path, 'lstat', return_value=SimpleNamespace(st_uid=uid, st_mode=stat.S_IFDIR | mode)), \
                 patch.object(module.subprocess, 'run', side_effect=AssertionError('unsafe ancestor')):
                with self.assertRaisesRegex(ValueError, 'root-owned'): module.verified_helper()

    def test_P1_configured_requirement_rejects_fake_before_reservation(self):
        import enclave
        helper = self.home / 'fake-golems-approve'
        helper.write_text('software-key substitution must never execute'); helper.chmod(0o755)
        self.pub.unlink()
        module = load()
        def root_owned(path):
            return SimpleNamespace(st_uid=0, st_mode=(stat.S_IFREG if str(path) == str(helper) else stat.S_IFDIR) | 0o755)
        with patch.object(enclave, 'HELPER', str(helper)), patch.object(enclave, 'ENROLL_TEAM_ID', 'ABCDEFGHIJ'), \
             patch.object(module.Path, 'lstat', root_owned), \
             patch('importlib.machinery.SourceFileLoader.exec_module', lambda _, m: m.__dict__.update(owner_terminal=lambda: None)), \
             patch.object(module.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'codesign')) as call:
            with self.assertRaises(subprocess.CalledProcessError): module.main()
        self.assertEqual(call.call_count, 1)
        self.assertEqual(call.call_args.args[0][-1], str(helper))
        self.assertEqual(call.call_args.args[0][:3], ['/usr/bin/codesign', '--verify', '--strict'])
        self.assertFalse(self.pub.exists())

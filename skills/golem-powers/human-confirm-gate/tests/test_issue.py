import importlib.machinery
import importlib.util
import json
import subprocess
import unittest
from unittest.mock import patch
import test_gate
from test_gate import ROOT

HELPER = ROOT.parents[2] / 'scripts/golems-confirm'


class Issue(unittest.TestCase):
    setUp = test_gate.Gate.setUp
    tearDown = test_gate.Gate.tearDown
    run_hook = test_gate.Gate.run_hook
    def test_owner_helper_signs_via_public_key_agent_interface(self):
        loader = importlib.machinery.SourceFileLoader('confirm_issue', str(HELPER))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec); loader.exec_module(module)
        calls = []
        def signer(argv, **kwargs):
            calls.append(argv)
            # Test-only signer: a disposable key, never the owner's agent or op.
            args = list(argv); args[args.index('-f') + 1] = str(self.key)
            return subprocess.run(args, **kwargs)
        args = [str(self.repo), 'refs/heads/topic', 'lease', '--sha', self.sha,
                '--session', 'worker', '--key', str(self.key.with_suffix('.pub'))]
        with patch.object(module, 'owner_terminal'), patch.object(module, 'sign', side_effect=signer):
            path = module.issue(args, home=self.home)
        self.assertEqual(calls[0][calls[0].index('-f') + 1], str(self.key.with_suffix('.pub')))
        self.assertEqual(json.loads(path.read_text())['kind'], 'human')
        self.assertEqual(self.run_hook()[0], 0)
        self.assertFalse(path.exists())

    def test_issuer_does_not_skip_agent_detection(self):
        loader = importlib.machinery.SourceFileLoader('confirm_issue', str(HELPER))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec); loader.exec_module(module)
        real_run = subprocess.run
        def fixture_sign(argv, **kwargs):
            args = list(argv); args[args.index('-f') + 1] = str(self.key)
            return real_run(args, **kwargs)
        args = [str(self.repo), 'topic', 'lease', '--sha', self.sha, '--session', 'worker', '--key', str(self.key.with_suffix('.pub'))]
        with patch.dict('os.environ', {'CMUX_AGENT_ID': 'worker'}), patch('sys.stdin.isatty', return_value=True), \
             patch.object(module, 'sign', side_effect=fixture_sign), self.assertRaises(ValueError):
            module.issue(args, home=self.home)
        self.assertEqual(list(self.store.glob('*.json')), [])

    def test_helper_refuses_detectable_agent_and_invalid_scope(self):
        loader = importlib.machinery.SourceFileLoader('confirm_issue', str(HELPER))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec); loader.exec_module(module)
        with patch.dict('os.environ', {'CMUX_AGENT_ID': 'worker'}), patch('sys.stdin.isatty', return_value=True), self.assertRaises(ValueError):
            module.owner_terminal()
        with patch.object(module, 'owner_terminal'), self.assertRaises(ValueError):
            module.issue([str(self.repo), 'wrong-ref', 'lease', '--sha', self.sha, '--session', 'worker',
                          '--command', self.command, '--key', str(self.key.with_suffix('.pub'))], home=self.home)
        self.assertEqual(list(self.store.glob('*.json')), [])

    def test_helper_refuses_software_private_key(self):
        loader = importlib.machinery.SourceFileLoader('confirm_issue', str(HELPER))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec); loader.exec_module(module)
        with patch.object(module, 'owner_terminal'), self.assertRaises(ValueError):
            module.issue([str(self.repo), 'topic', 'lease', '--sha', self.sha, '--session', 'worker',
                          '--key', str(self.key)], home=self.home)
        self.assertEqual(list(self.store.glob('*.json')), [])

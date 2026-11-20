"""golems-confirm finds the SSH agent that holds the signing key, for the signing child only.

`ssh-keygen -Y sign -U` reads only SSH_AUTH_SOCK, so a terminal pointing at another agent
failed with "Couldn't find key in agent". Fake ssh-add, a test signer on a disposable key,
and real AF_UNIX sockets bound inside the fixture home. Never the owner's agent."""
import importlib.machinery
import importlib.util
import os
import socket
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import test_gate
from test_gate import ROOT

HELPER = ROOT.parents[2] / 'scripts/golems-confirm'
ONEPASSWORD = 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'
FAKE_SSH_ADD = """#!/bin/sh
printf '%s\\n' "$SSH_AUTH_SOCK" >> "$0.log"
[ "$1" = -L ] || exit 64
if [ -n "$SSH_AUTH_SOCK" ] && [ -f "$SSH_AUTH_SOCK.keys" ]; then exec cat "$SSH_AUTH_SOCK.keys"; fi
echo 'Could not open a connection to your authentication agent.' >&2
exit 2
"""


def load():
    loader = importlib.machinery.SourceFileLoader('confirm_agent', str(HELPER))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
    loader.exec_module(module)
    return module


class AgentSocket(unittest.TestCase):
    tearDown = test_gate.Gate.tearDown
    run_hook = test_gate.Gate.run_hook

    def setUp(self):
        test_gate.Gate.setUp(self)
        self.module = load()
        self.pub = self.key.with_suffix('.pub')
        self.other = self.lead_key.with_suffix('.pub')
        self.fake = self.home / 'bin/ssh-add'
        self.fake.parent.mkdir()
        self.fake.write_text(FAKE_SSH_ADD); self.fake.chmod(0o755)
        self.fingerprint = subprocess.run(['ssh-keygen', '-lf', str(self.pub)], capture_output=True,
                                          text=True, check=True).stdout.split()[1]
        self.calls = []

    def bind(self, path, holds=None):
        """A real unix socket; `holds` is the public key file the fake agent lists for it."""
        path.parent.mkdir(parents=True, exist_ok=True)
        sock = socket.socket(socket.AF_UNIX)
        self.addCleanup(sock.close)
        cwd = os.getcwd(); os.chdir(path.parent)  # fixture paths exceed sun_path; bind relative
        try: sock.bind(path.name)
        finally: os.chdir(cwd)
        if holds: Path(str(path) + '.keys').write_text(holds.read_text())
        return path

    def identity_agent(self, value):
        config = self.home / '.ssh/config'
        config.parent.mkdir(exist_ok=True)
        config.write_text(f'Host example.com\n  IdentityAgent none\n\nHost *\n  IdentityAgent "{value}"\n')

    def signer(self, argv, **kwargs):
        # Test-only signer: a disposable key, never the owner's agent or op.
        self.assertIn('-U', argv)
        self.calls.append(kwargs.get('env'))
        args = list(argv); args.remove('-U'); args[args.index('-f') + 1] = str(self.key)
        return subprocess.run(args, **kwargs)

    def issue(self, current, sign=None):
        args = [str(self.repo), 'topic', 'lease', '--sha', self.sha, '--session', 'worker', '--key', str(self.pub)]
        with patch.dict(os.environ, {'SSH_AUTH_SOCK': str(current)}), \
             patch.object(self.module, 'SSH_ADD', str(self.fake), create=True), \
             patch.object(self.module, 'owner_terminal'), \
             patch.object(self.module, 'sign', side_effect=sign or self.signer):
            path = self.module.issue(args, home=self.home)
            self.assertEqual(os.environ['SSH_AUTH_SOCK'], str(current), 'never change our own environment')
        return path

    def probed(self):
        log = Path(str(self.fake) + '.log')
        return log.read_text().splitlines() if log.exists() else []

    def refused(self, current, *needles):
        never = AssertionError('must refuse before signing')
        with self.assertRaises(ValueError) as caught:
            self.issue(current, sign=never)
        message = str(caught.exception)
        for needle in (self.fingerprint, 'SSH_AUTH_SOCK', '1Password', *needles):
            self.assertIn(needle, message)
        self.assertEqual(list(self.store.glob('*')), [], 'no token file on refusal')
        return message

    def test_current_agent_with_key_keeps_environment(self):
        current = self.bind(self.home / 'cur.sock', holds=self.pub)
        self.identity_agent(self.bind(self.home / 'ia/agent.sock', holds=self.pub))
        path = self.issue(current)
        self.assertEqual(self.calls, [None], 'signing child inherits the unchanged environment')
        self.assertEqual(self.probed(), [str(current)], 'the current agent is asked, nothing else')
        self.assertEqual(self.run_hook()[0], 0)
        self.assertFalse(path.exists())

    def test_identity_agent_socket_used_for_child_only(self):
        current = self.bind(self.home / 'cur.sock', holds=self.other)
        agent = self.bind(self.home / 'ia/agent.sock', holds=self.pub)
        self.bind(self.home / ONEPASSWORD, holds=self.pub)  # IdentityAgent wins over the default path
        self.identity_agent('~/ia/agent.sock')
        self.issue(current)
        self.assertEqual(len(self.calls), 1)
        self.assertIsInstance(self.calls[0], dict, 'the signing child gets the holding agent')
        self.assertEqual(self.calls[0]['SSH_AUTH_SOCK'], os.path.realpath(agent))
        self.assertEqual(self.probed(), [str(current), os.path.realpath(agent)])
        self.assertEqual(self.run_hook()[0], 0)

    def test_identity_agent_inline_comments_choose_configured_socket(self):
        current = self.bind(self.home / 'cur.sock')
        agent = self.bind(self.home / 'ia/agent.sock', holds=self.pub)
        decoy = self.bind(Path(str(agent) + ' # comment'), holds=self.pub)
        config = self.home / '.ssh/config'
        config.parent.mkdir()
        for value in (f'{agent} # comment', f'"{agent}" # comment'):
            with self.subTest(value=value):
                config.write_text(f'Host * # defaults\n IdentityAgent {value}\n')
                self.issue(current)
                self.assertEqual(self.module.identity_agent(self.home), agent)
                self.assertEqual(self.calls[-1]['SSH_AUTH_SOCK'], os.path.realpath(agent))
                self.assertNotIn(str(decoy), self.probed())

    def test_identity_agent_quoted_hash_is_literal(self):
        current = self.bind(self.home / 'cur.sock')
        agent = self.bind(self.home / 'ia/agent # literal.sock', holds=self.pub)
        self.identity_agent(agent)
        config = self.home / '.ssh/config'
        config.write_text(config.read_text().rstrip() + ' # comment\n')
        self.assertEqual(self.module.identity_agent(self.home), agent)
        self.issue(current)
        self.assertEqual(self.calls[-1]['SSH_AUTH_SOCK'], os.path.realpath(agent))

    def test_identity_agent_matches_native_ssh_comment_and_quote_grammar(self):
        config = self.home / '.ssh/config'
        config.parent.mkdir()
        for value in ('/synthetic/agent.sock # comment',
                      '"/synthetic/agent.sock" # comment',
                      '"/synthetic/agent # literal.sock" # comment',
                      '/synthetic/agent#literal.sock',
                      "'/synthetic/agent.sock' # comment",
                      r'/synthetic/agent\ name.sock # comment',
                      r'"/synthetic/agent\ name.sock" # comment'):
            with self.subTest(value=value):
                config.write_text(f'Host * # defaults\n IdentityAgent {value}\n')
                native = subprocess.run(['/usr/bin/ssh', '-G', '-F', str(config), 'fixture.invalid'],
                                        capture_output=True, text=True, check=True)
                expected = next(line.removeprefix('identityagent ') for line in native.stdout.splitlines()
                                if line.startswith('identityagent '))
                self.assertEqual(str(self.module.identity_agent(self.home)), expected)

    def test_refusal_outside_home_displays_names_only(self):
        # Synthetic absolute paths: neither parent directories nor fixture HOME may leak.
        self.identity_agent('/synthetic/private/configured.sock')
        message = self.refused('/synthetic/private/current.sock', 'current.sock', 'configured.sock')
        self.assertNotIn('/synthetic/private', message)
        self.assertNotIn(str(self.home), message)

    def test_onepassword_default_socket_when_config_names_none(self):
        current = self.bind(self.home / 'cur.sock')
        agent = self.bind(self.home / ONEPASSWORD, holds=self.pub)
        self.issue(current)
        self.assertIsInstance(self.calls[0], dict, 'the signing child gets the holding agent')
        self.assertEqual(self.calls[0]['SSH_AUTH_SOCK'], os.path.realpath(agent))

    def test_no_agent_holds_key_refuses_before_any_token(self):
        current = self.bind(self.home / 'cur.sock')
        configured = self.bind(self.home / 'ia/agent.sock')
        self.identity_agent(configured)
        message = self.refused(current, '~/cur.sock', '~/ia/agent.sock', '~/' + ONEPASSWORD)
        self.assertNotIn(str(self.home), message)
        self.assertIn('unlock 1Password', message)

    def test_non_socket_or_foreign_candidate_refused(self):
        current = self.bind(self.home / 'cur.sock')
        plain = self.home / 'ia/agent.sock'
        plain.parent.mkdir()
        plain.write_text(''); Path(str(plain) + '.keys').write_text(self.pub.read_text())
        self.identity_agent(plain)
        self.assertIn('not a socket', self.refused(current))
        self.assertEqual(self.probed(), [str(current)], 'a non-socket is never asked for keys')
        plain.unlink(); self.bind(plain, holds=self.pub)
        uid = os.getuid()
        with patch('os.getuid', return_value=uid + 1):
            self.assertIn('owned by another user', self.refused(current))

    def test_candidate_listing_other_key_refused(self):
        current = self.bind(self.home / 'cur.sock')
        agent = self.bind(self.home / 'ia/agent.sock', holds=self.other)
        self.bind(self.home / ONEPASSWORD, holds=self.other)
        self.identity_agent(agent)
        self.assertIn('key not listed', self.refused(current))


if __name__ == '__main__':
    unittest.main()

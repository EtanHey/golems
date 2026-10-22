import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHECK = ROOT / 'skills/golem-powers/ecosystem-health/scripts/check-cmuxlayer-off.py'
POLICY = ROOT / 'scripts/sync/mcp_policy.py'


class CmuxlayerOffTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'docs.local/cmuxlayer-off').mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / 'docs.local/cmuxlayer-off')
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.ps = self.home / 'processes.txt'
        self.ps.write_text('')

    def write(self, path, value):
        target = self.home / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value if isinstance(value, str) else json.dumps(value))

    def check(self, red=False):
        result = subprocess.run(
            ['python3', str(CHECK), '--process-list', str(self.ps)],
            env={**os.environ, 'HOME': str(self.home)}, text=True, capture_output=True)
        self.assertEqual(result.returncode, 1 if red else 0, result.stdout + result.stderr)
        self.assertIn('RED' if red else 'GREEN', result.stdout)
        return result.stdout

    def test_empty_home(self):
        self.check()

    def test_legitimate_codex_project_trust(self):
        self.write('.codex/config.toml', f'[projects."{self.home}/Gits/cmuxlayer"]\ntrust_level="trusted"\n')
        self.check()

    def test_legitimate_block_lists(self):
        self.write('.golems/config.yaml', 'contextProfiles:\n  demo:\n    mcps:\n      block: [cmuxlayer]\n')
        self.check()

    def test_legitimate_claude_project_paths(self):
        self.write('.claude.json', {'projects': {f'{self.home}/Gits/cmuxlayer': {
            'mcpServers': {'brainlayer': {'command': 'brainlayer-mcp'}},
            'disabledMcpjsonServers': ['cmuxlayer']}}})
        self.check()

    def test_all_json_registration_locations(self):
        paths = ['.claude.json', '.claude/settings.json', '.claude/settings.local.json',
                 '.claude/.mcp.json', '.cursor/mcp.json', '.gemini/settings.json',
                 '.gemini/config/mcp_config.json',
                 'Gits/demo/.mcp.json', 'Gits/another/.mcp.json']
        for path in paths:
            self.write(path, {'mcpServers': {'cmuxlayer': {'command': 'cmuxlayer'}}})
        output = self.check(red=True)
        for path in paths:
            self.assertIn(str(self.home / path), output)
        self.assertIn('mcpServers.cmuxlayer', output)

    def test_claude_project_registration_and_enabled_lists(self):
        for entry in [{'mcpServers': {'cmuxlayer': {}}},
                      {'enabledMcpjsonServers': ['cmuxlayer']}]:
            with self.subTest(entry=entry):
                self.write('.claude.json', {'projects': {'/Gits/demo': entry}})
                self.assertIn('cmuxlayer', self.check(red=True))
        self.write('.claude.json', {'enabledMcpjsonServers': ['cmuxlayer']})
        self.check(red=True)

    def test_codex_mcp_tables(self):
        for table in ['[mcp_servers.cmuxlayer]', '[mcp_servers."cmuxlayer"]',
                      '[mcp_servers.cmuxlayer.env]']:
            with self.subTest(table=table):
                self.write('.codex/config.toml', table + '\nVALUE="fixture"\n')
                self.assertIn('mcp_servers.cmuxlayer', self.check(red=True))

    def test_registration_alias(self):
        for definition in [
            {'command': '~/.golems/bin/cmuxlayer-mcp'},
            {'command': 'node', 'args': ['/opt/cmuxlayer/dist/index.js']},
            {'command': '/bin/sh', 'args': ['-c', 'exec cmuxlayer-mcp']},
            {'command': 'node', 'args': [
                '/opt/homebrew/Cellar/cmuxlayer/0.4.107/libexec/dist/index.js']},
            *({'command': '/usr/bin/env', 'args': [name]} for name in [
                'cmuxlayer', 'cmuxlayer-mcp', 'cmuxlayer-app-server', 'cmuxlayer-proxy']),
        ]:
            with self.subTest(definition=definition):
                self.write('.cursor/mcp.json', {'mcpServers': {'cmux': definition}})
                self.assertIn('mcpServers.cmux', self.check(red=True))

    def test_shell_wrapped_registration(self):
        self.write('.cursor/mcp.json', {'mcpServers': {'cmux': {
            'command': 'sh', 'args': ['-c', 'exec ~/.golems/bin/cmuxlayer-mcp;']}}})
        self.assertIn('mcpServers.cmux', self.check(red=True))

    def test_precise_process_matches(self):
        commands = ['/opt/bin/cmuxlayer', 'cmuxlayer-app-server --stdio',
                    '~/.golems/bin/cmuxlayer-mcp',
                    '/opt/homebrew/opt/node/bin/node /opt/homebrew/Cellar/cmuxlayer/0.4.107/libexec/dist/index.js',
                    '/opt/bin/cmuxlayer-proxy',
                    '/opt/bin/node /opt/cmuxlayer/dist/index.js',
                    'node --inspect=9229 /opt/cmuxlayer/dist/server.js']
        self.ps.write_text('\n'.join(f'{100+i} {cmd}' for i, cmd in enumerate(commands)))
        output = self.check(red=True)
        for i, cmd in enumerate(commands):
            self.assertIn(f'pid={100+i} {cmd}', output)

    def test_resource_guard_duties_are_not_mcp_servers(self):
        keg = '/opt/homebrew/Cellar/cmuxlayer/0.4.107/libexec'
        commands = [
            '/opt/homebrew/opt/node/bin/node /opt/homebrew/Cellar/cmuxlayer/0.4.107/libexec/dist/resource-guard.js',
            '/opt/homebrew/opt/node/bin/node /opt/homebrew/Cellar/cmuxlayer/0.4.107/libexec/dist/mcp-reaper.js',
            '/opt/homebrew/opt/cmuxlayer/bin/cmux-resource-guard',
            f'/bin/bash {keg}/launchd/resource-guard/cmux-memory-watchdog.sh',
            f'/bin/bash {keg}/launchd/resource-guard/heavy-ml-guardian.sh',
            f'/bin/bash {keg}/launchd/cmux-ram-sampler/bin/cmux-ram-sampler.sh',
        ]
        self.ps.write_text('\n'.join(f'{300+i} {cmd}' for i, cmd in enumerate(commands)))
        self.check()

    def test_unrelated_process_mentions(self):
        self.ps.write_text('''200 /bin/zsh -c "cd ~/Gits/cmuxlayer; sleep 10"
201 /usr/bin/grep cmuxlayer
202 /bin/ps -ww -axo pid=,args=
203 /Applications/Editor.app/Contents/MacOS/Editor /Gits/cmuxlayer/dist/index.js
204 node /other/check.js cmuxlayer /opt/cmuxlayer/dist/index.js
205 node /opt/notcmuxlayer/dist/index.js
206 python3 check-cmuxlayer-off.py
207 node --eval "console.log('cmuxlayer')"
208 node --title /opt/cmuxlayer/dist/index.js /other/check.js
209 node /other/check.js /opt/homebrew/Cellar/cmuxlayer/0.4.107/libexec/dist/index.js
210 /bin/zsh -c "cd ~/Gits/cmuxlayer; sleep 10"
''')
        self.check()

    def test_invalid_config_is_not_green(self):
        self.write('.cursor/mcp.json', '{broken')
        self.assertIn('cannot inspect', self.check(red=True))

    def test_profiles_with_omitted_or_null_lists_get_default_block(self):
        spec = importlib.util.spec_from_file_location('mcp_policy', POLICY)
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        profiles = {'missing': {}, 'null': {'mcps': None},
                    'null_lists': {'mcps': {'allow': None, 'block': None}}}
        policy.apply_default_mcp_blocks({'contextProfiles': profiles})
        for profile in profiles.values():
            self.assertIn('cmuxlayer', profile['mcps']['block'])

    def test_every_profile_blocks_and_generator_omits_cmuxlayer(self):
        spec = importlib.util.spec_from_file_location('mcp_policy', POLICY)
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        profiles = {name: {'mcps': {'allow': ['brainlayer', 'cmuxlayer']}}
                    for name in (f'profile-{i}' for i in range(9))}
        config = {'reposPath': str(self.home / 'Gits'), 'contextProfiles': profiles,
                  'mcpServers': {'brainlayer': {'command': 'brainlayer-mcp'},
                                 'cmuxlayer': {'command': 'cmuxlayer'}}}
        for name in profiles:
            (self.home / 'Gits' / name).mkdir(parents=True)
        policy.apply_default_mcp_blocks(config)
        for profile in profiles.values():
            self.assertIn('cmuxlayer', profile['mcps']['block'])
            self.assertNotIn('cmuxlayer', profile['mcps']['allow'])
        # Feed the unguarded old config through the real generator as well.
        for profile in profiles.values():
            profile['mcps'] = {'allow': ['brainlayer', 'cmuxlayer']}
        source = self.home / 'config.json'
        source.write_text(json.dumps(config))
        result = subprocess.run(['bash', str(ROOT / 'scripts/sync/sync-config.sh'),
                                 '--config', str(source), '--enforce'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for name in profiles:
            generated = json.loads((self.home / 'Gits' / name / '.mcp.json').read_text())
            self.assertEqual(set(generated['mcpServers']), {'brainlayer'})
        self.check()


if __name__ == '__main__':
    unittest.main()

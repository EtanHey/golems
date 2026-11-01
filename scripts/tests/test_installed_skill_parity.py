"""Class-only fixtures: no installed names, account data, or personal paths."""
import copy
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'ratchet/installed-skills.py'
PLUGIN = 'class-plugin@class-market'
spec = importlib.util.spec_from_file_location('parity', SCRIPT)
parity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parity)


class Parity(unittest.TestCase):
    def setUp(self):
        self.pins = [{k: hashlib.sha256((label+k).encode()).hexdigest() for k in ('machine', 'hostname', 'home')} for label in ('class-local', 'class-remote')]
        self.left = {'schema': 2, 'identity': copy.deepcopy(self.pins[0]), 'roots': {},
                     'claude_plugins': {'.claude': {'enabled': [PLUGIN]}}}
        self.required = {'schema': 2, 'identities': copy.deepcopy(self.pins), 'roots': {}}
        for root in parity.ROOTS:
            entry = dict(kind='symlink', exists=True, skill_sha256='a'*64,
                         normalized_target='$HOME/source/class-a',
                         internal_skills={}, files={'SKILL.md': {'kind': 'file', 'sha256': 'a'*64, 'executable': False}})
            self.left['roots'][root] = {'exists': True, 'entries': {'class-a': entry}}
            self.required['roots'][root] = {'readable': ['class-a'], 'allow_broken': [],
                                           'allow_empty': [], 'target_aliases': {}}
        self.right = copy.deepcopy(self.left)
        self.right['identity'] = copy.deepcopy(self.pins[1])
        self.root = parity.ROOTS[0]

    def check(self):
        return parity.compare(self.left, self.right, self.required)

    def test_app_managed_skills_do_not_gate_parity(self):
        for root, namespace in [('.codex/skills', '.system'), ('.claude/skills', 'synced')]:
            with self.subTest(root=root):
                self.setUp()
                entry = copy.deepcopy(self.left['roots'][root]['entries']['class-a'])
                self.left['roots'][root]['entries'][namespace] = entry
                self.required['roots'][root]['readable'].append(namespace + '/class-app')
                self.assertEqual(self.check()['errors'], [])
                self.right['roots'][root]['entries'][namespace] = copy.deepcopy(entry)
                entry['skill_sha256'] = 'b'*64
                self.assertEqual(self.check()['errors'], [])
                self.right['roots'][root]['entries']['class-a']['skill_sha256'] = 'c'*64
                self.assertFalse(self.check()['name_content_parity'])

    def test_scanner_skips_only_app_managed_roots(self):
        with tempfile.TemporaryDirectory(prefix='class-managed-') as directory:
            homes = self.skill_homes(Path(directory))
            for root, namespace in [('.codex/skills', '.system'), ('.claude/skills', 'synced')]:
                managed = homes[1] / root / namespace / 'class-app'
                managed.mkdir(parents=True)
                (managed / 'SKILL.md').write_text('# app version\n')
                (managed / 'cycle').symlink_to(managed, target_is_directory=True)
            left, right = [self.scan(home, pin) for home, pin in zip(homes, self.pins)]
            self.assertEqual(parity.compare(left, right, self.required)['errors'], [])
            for root, namespace in [('.agents/skills', '.system'), ('.codex/skills', 'synced')]:
                self.right['roots'][root]['entries'][namespace] = copy.deepcopy(
                    self.right['roots'][root]['entries']['class-a'])
            self.assertFalse(self.check()['name_content_parity'])

    def test_receipt_hash_tracks_owned_content_but_not_app_managed_roots(self):
        with tempfile.TemporaryDirectory(prefix='class-receipt-managed-') as directory:
            home = Path(directory)
            for root in parity.ROOTS:
                folder = home / root
                owned = folder / 'class-owned'
                owned.mkdir(parents=True)
                (owned / 'SKILL.md').write_text('# owned\n')
                before = parity.tree_sha256(folder)
                for namespace in parity.APP_MANAGED.get(root, set()):
                    managed = folder / namespace / 'class-app'
                    managed.mkdir(parents=True)
                    (managed / 'SKILL.md').write_text('# app version\n')
                    self.assertEqual(parity.tree_sha256(folder), before)
                    (managed / 'SKILL.md').write_text('# changed app version\n')
                    self.assertEqual(parity.tree_sha256(folder), before)
                (owned / 'SKILL.md').write_text('# changed owned\n')
                self.assertNotEqual(parity.tree_sha256(folder), before)
                nested = owned / 'synced'
                nested.mkdir()
                before = parity.tree_sha256(folder)
                (nested / 'SKILL.md').write_text('# owned nested content\n')
                self.assertNotEqual(parity.tree_sha256(folder), before)
            codex = home / '.codex/skills'
            before = parity.tree_sha256(codex)
            (codex / 'synced').mkdir()
            (codex / 'synced/SKILL.md').write_text('# owned codex namespace\n')
            self.assertNotEqual(parity.tree_sha256(codex), before)

    def test_equal(self):
        self.assertEqual(self.check()['errors'], [])

    def test_missing_and_extra(self):
        for action in ['missing', 'extra']:
            with self.subTest(action=action):
                self.setUp()
                entries = self.right['roots'][self.root]['entries']
                if action == 'missing': entries.pop('class-a')
                else: entries['class-extra'] = copy.deepcopy(entries['class-a'])
                self.assertTrue(self.check()['errors'])

    def test_required_missing_on_both(self):
        for host in [self.left, self.right]: host['roots'][self.root]['entries'].clear()
        self.assertFalse(self.check()['required_readable_valid'])

    def test_broken_required_on_one_or_both(self):
        for both in [False, True]:
            with self.subTest(both=both):
                self.setUp()
                for host in [self.right, self.left] if both else [self.right]:
                    entry = host['roots'][self.root]['entries']['class-a']
                    entry.update(exists=False, skill_sha256=None, files={})
                self.assertTrue(self.check()['errors'])
                self.assertFalse(self.check()['required_readable_valid'])

    def test_skill_and_supporting_hash_or_mode_drift(self):
        for kind in ['skill', 'support', 'mode']:
            with self.subTest(kind=kind):
                self.setUp()
                entry = self.right['roots'][self.root]['entries']['class-a']
                if kind == 'skill': entry['skill_sha256'] = 'b'*64
                elif kind == 'mode': entry['files']['SKILL.md']['executable'] = True
                else: entry['files']['helper.py'] = {'kind': 'file', 'sha256': 'b'*64, 'executable': False}
                self.assertFalse(self.check()['name_content_parity'])

    def test_missing_root_and_malformed_manifest(self):
        self.right['roots'][self.root]['exists'] = False
        self.assertTrue(self.check()['errors'])
        with self.assertRaises(ValueError): parity.compare({}, self.left, self.required)

    def test_disclosed_invalid_is_separate_from_parity(self):
        for host in [self.left, self.right]:
            host['roots'][self.root]['entries']['class-retired'] = dict(
                kind='symlink', exists=False, skill_sha256=None, files={}, internal_skills={},
                normalized_target='$HOME/source/class-retired')
        self.required['roots'][self.root]['allow_broken'] = ['class-retired']
        result = self.check()
        self.assertEqual(result['errors'], [])
        self.assertEqual(len(result['disclosed_invalid']), 2)
        self.required['roots'][self.root]['readable'].append('class-retired')
        self.assertFalse(self.check()['required_readable_valid'])

    def test_empty_placeholder_requires_explicit_shape_exception(self):
        for host in [self.left, self.right]:
            host['roots'][self.root]['entries']['class-placeholder'] = dict(
                kind='dir', exists=True, skill_sha256=None, files={}, internal_skills={},
                normalized_target='$HOME/discovery/class-placeholder')
        self.assertTrue(self.check()['errors'])
        self.required['roots'][self.root]['allow_empty'] = ['class-placeholder']
        self.assertEqual(self.check()['errors'], [])

    def test_install_kind_and_target_do_not_affect_content_parity(self):
        self.assertEqual(parity.normalize('/host-a/source/class-a', '/host-a'),
                         parity.normalize('/host-b/source/class-a', '/host-b'))
        self.assertEqual(parity.normalize('/host-ab/source', '/host-a'), '/host-ab/source')
        entry = self.right['roots'][self.root]['entries']['class-a']
        entry['kind'] = 'dir'
        entry['normalized_target'] = '$HOME/mirror/class-a'
        self.assertEqual(self.check()['errors'], [])
        entry['normalized_target'] = '/foreign/source/class-a'
        self.assertEqual(self.check()['errors'], [])

    def test_nested_markers_are_content_in_fixture_catalogs(self):
        for marker in ['.golems-source-commit', '.golems-install.json']:
            with self.subTest(marker=marker):
                self.setUp()
                self.right['roots'][self.root]['entries']['class-a']['files']['scripts/' + marker] = dict(
                    kind='file', sha256='b'*64, executable=False)
                self.assertFalse(self.check()['name_content_parity'])

    def test_installed_version_must_match_when_recorded(self):
        for local, remote in [('v1', 'v1'), ('v1', 'v2'), (None, 'v1'), ('v1', None)]:
            with self.subTest(local=local, remote=remote):
                self.setUp()
                if local is not None: self.left['installed_version'] = local
                if remote is not None: self.right['installed_version'] = remote
                result = self.check()
                self.assertEqual(result['name_content_parity'], local is None or remote is None or local == remote)
                if local is not None and remote is not None and local != remote:
                    self.assertIn('installed version mismatch', result['errors'][0])
                    self.assertIn('local=', result['errors'][0])
                    self.assertIn('remote=', result['errors'][0])

    def test_checkout_commit_notes_are_informational_in_both_directions(self):
        for checkout in ('local', 'remote'):
            for release_commit in ('a'*40, 'b'*40):
                with self.subTest(checkout=checkout, release_commit=release_commit):
                    self.setUp()
                    owner, client = (self.left, self.right) if checkout == 'local' else (self.right, self.left)
                    owner['checkout_commits'] = ['a'*40]
                    client.update(installed_version='v1', installed_commit=release_commit)
                    result = self.check()
                    self.assertEqual(result['errors'], [])
                    self.assertEqual(bool(result['notes']), release_commit != 'a'*40)
                    if result['notes']:
                        self.assertIn(checkout + ' checkout HEAD', result['notes'][0])
                        self.assertIn(release_commit, result['notes'][0])
                    client['roots'][self.root]['entries']['class-a']['skill_sha256'] = 'b'*64
                    self.assertFalse(self.check()['name_content_parity'])

    def test_scanner_observes_resolved_checkout_head_and_release_commit(self):
        with tempfile.TemporaryDirectory(prefix='class-checkout-head-') as directory:
            homes = self.skill_homes(Path(directory))
            checkout = Path(directory) / 'class-source'
            checkout.mkdir()
            subprocess.run(['git', '-C', str(checkout), 'init', '-q'], check=True)
            (checkout / 'SKILL.md').write_text('# class-a\n')
            subprocess.run(['git', '-C', str(checkout), 'add', 'SKILL.md'], check=True)
            subprocess.run(['git', '-C', str(checkout), '-c', 'user.name=class', '-c',
                            'user.email=fixture@example.com', 'commit', '-qm', 'class'], check=True)
            head = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
            for root in parity.ROOTS:
                shutil.rmtree(homes[0] / root / 'class-a')
                (homes[0] / root / 'class-a').symlink_to(checkout, target_is_directory=True)
            record = homes[1] / '.golems/release.json'
            record.parent.mkdir()
            record.write_text(json.dumps(dict(version='v1', commit='b'*40)))
            left, right = [self.scan(home, pin) for home, pin in zip(homes, self.pins)]
            self.assertEqual(left['checkout_commits'], [head])
            self.assertEqual(right['installed_commit'], 'b'*40)
            result = parity.compare(left, right, self.required)
            self.assertEqual(result['errors'], [])
            self.assertEqual(len(result['notes']), 1)

    def test_invalid_inventory_versions_fail_closed(self):
        for value in [None, 1, '', ' v1', 'v1\n']:
            with self.subTest(value=value):
                self.setUp(); self.right['installed_version'] = value
                with self.assertRaisesRegex(ValueError, 'installed version'):
                    self.check()

    def scan(self, home, pin, dirs=parity.DEFAULT_CLAUDE_CONFIG_DIRS):
        with patch.object(parity.Path, 'home', return_value=home), \
                patch.object(parity, 'observed_identity', return_value=pin):
            return parity.inventory(dirs)

    def test_real_release_tarball_matches_checkout_shipped_content(self):
        scratch = SCRIPT.parents[2] / 'docs.local/parity-fixtures'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            base = Path(directory)
            checkout = base / 'checkout'
            source = checkout / 'skills/golem-powers/class-a'
            source.mkdir(parents=True)
            (source / 'SKILL.md').write_bytes(b'# class-a\n')
            helper = source / 'scripts/helper'
            helper.parent.mkdir()
            helper.write_bytes(b'echo class-a\n')
            helper.chmod(0o755)
            excluded = ['evals/case.json', 'tests/case.py', 'fixtures/case.json',
                        'test/case.py', '__tests__/case.py', 'testdata/case.json',
                        '__snapshots__/case.json', 'private/case.txt', 'docs.local/case.txt',
                        'node_modules/case.js', '__pycache__/case.py', '.env.local',
                        'secrets.json', 'scripts/helper.test.js', 'scripts/helper.spec.ts',
                        'key.pem', 'key.key', 'cache.pyc']
            for path in excluded:
                file = source / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('checkout-only bytes\n')
            subprocess.run(['git', 'init', '-q', str(checkout)], check=True)
            subprocess.run(['git', '-C', str(checkout), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(checkout), '-c', 'user.name=class', '-c',
                            'user.email=fixture@example.com', 'commit', '-qm', 'class'], check=True)
            built = json.loads(subprocess.check_output([
                'node', str(SCRIPT.parents[1] / 'release/build-release.mjs'),
                '--repo', str(checkout), '--out', str(base / 'build')], text=True))
            release = base / 'release'
            release.mkdir()
            subprocess.run(['tar', '-xzf', built['tarball'], '-C', str(release)], check=True)
            installed = release / 'skills/golem-powers/class-a'
            self.assertEqual({str(p.relative_to(installed)) for p in installed.rglob('*') if p.is_file()},
                             {'SKILL.md', 'scripts/helper'})
            local, remote = base / 'local', base / 'remote'
            for root in parity.ROOTS:
                for home, target in [(local, source), (remote, installed)]:
                    (home / root).mkdir(parents=True)
                    (home / root / 'class-a').symlink_to(target, target_is_directory=True)
            for home in (local, remote): self.settings(home)
            record = remote / '.golems/release.json'
            record.parent.mkdir()
            record.write_text(json.dumps(dict(version=built['version'], commit=built['commit'])))

            def compare():
                return parity.compare(self.scan(local, self.pins[0]),
                                      self.scan(remote, self.pins[1]), self.required)

            self.assertEqual(compare()['errors'], [])
            (source / 'evals/case.json').write_text('different excluded bytes\n')
            self.assertEqual(compare()['errors'], [])
            shipped = installed / 'scripts/helper'
            shipped.write_bytes(b'echo class-b\n')
            self.assertFalse(compare()['name_content_parity'])
            shipped.write_bytes(b'echo class-a\n')
            shipped.chmod(0o644)
            self.assertFalse(compare()['name_content_parity'])
            shipped.chmod(0o755)
            shipped.unlink()
            self.assertFalse(compare()['name_content_parity'])

    def test_scanned_checkout_links_and_release_copies_compare_by_content(self):
        with tempfile.TemporaryDirectory(prefix='class-install-content-') as directory:
            base = Path(directory)
            local, remote = base / 'class-local', base / 'class-remote'
            source = base / 'class-checkout'
            source.mkdir()
            (source / 'SKILL.md').write_bytes(b'# class-a\n')
            (source / 'scripts').mkdir()
            (source / 'scripts/helper').write_bytes(b'echo class-a\n')
            (source / 'scripts/helper').chmod(0o755)
            (source / 'helper-link').symlink_to(source / 'scripts/helper')
            (source / 'scripts-link').symlink_to(source / 'scripts', target_is_directory=True)
            for root in parity.ROOTS:
                (local / root).mkdir(parents=True)
                (local / root / 'class-a').symlink_to(source, target_is_directory=True)
                shutil.copytree(source, remote / root / 'class-a')
            for home in (local, remote): self.settings(home)
            for marker in ['.golems-source-commit', '.golems-install.json']:
                (remote / self.root / 'class-a' / marker).write_text('installer metadata\n')
            left, right = self.scan(local, self.pins[0]), self.scan(remote, self.pins[1])
            self.assertEqual(parity.compare(left, right, self.required)['errors'], [])
            files = left['roots'][self.root]['entries']['class-a']['files']
            self.assertEqual(files['helper-link'], files['scripts/helper'])
            self.assertEqual(files['scripts-link/helper'], files['scripts/helper'])
            self.assertTrue(files['helper-link']['executable'])
            for marker in ['.golems-source-commit', '.golems-install.json']:
                self.assertNotIn(marker, right['roots'][self.root]['entries']['class-a']['files'])
            skill = remote / self.root / 'class-a/SKILL.md'
            skill.write_bytes(b'# class-b\n')  # Exactly one changed byte.
            right = self.scan(remote, self.pins[1])
            self.assertFalse(parity.compare(left, right, self.required)['name_content_parity'])
            skill.write_bytes(b'# class-a\n')
            helper = remote / self.root / 'class-a/scripts/helper'
            helper.write_bytes(b'echo class-b\n')
            right = self.scan(remote, self.pins[1])
            self.assertFalse(parity.compare(left, right, self.required)['name_content_parity'])
            helper.write_bytes(b'echo class-a\n')
            helper.chmod(0o644)
            right = self.scan(remote, self.pins[1])
            self.assertFalse(parity.compare(left, right, self.required)['name_content_parity'])
            shutil.rmtree(remote / self.root / 'class-a')
            right = self.scan(remote, self.pins[1])
            result = parity.compare(left, right, self.required)
            self.assertFalse(result['name_content_parity'])
            self.assertFalse(result['required_readable_valid'])

    def skill_homes(self, base):
        homes = [base / label for label in ['class-local', 'class-remote']]
        for home in homes:
            for root in parity.ROOTS:
                skill = home / root / 'class-a'
                skill.mkdir(parents=True)
                (skill / 'SKILL.md').write_text('# class-a\n')
            self.settings(home)
        return homes

    def settings(self, home, directory='.claude', plugins=None):
        path = home / directory / 'settings.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'enabledPlugins': {PLUGIN: True} if plugins is None else plugins}))
        return path

    def test_plugin_enabled_mismatch_fails_by_name(self):
        dirs = ('.claude', '.claude-secondary')
        with tempfile.TemporaryDirectory(prefix='class-plugin-parity-') as directory:
            homes = self.skill_homes(Path(directory))
            for home in homes:
                for config in dirs: self.settings(home, config, {PLUGIN: True, 'class-off@class-market': False})
            other = 'class-design@class-market'
            for config in dirs: self.settings(homes[0], config, {PLUGIN: True, other: True})
            self.settings(homes[1], dirs[0], {PLUGIN: True, other: False})

            def compare():
                left, right = [self.scan(home, pin, dirs) for home, pin in zip(homes, self.pins)]
                return parity.compare(left, right, self.required, dirs)

            result = compare()
            self.assertEqual(result['errors'], [
                'plugin-enabled-mismatch ' + other + ': local=[.claude,.claude-secondary] remote=[]'])
            self.assertFalse(result['plugin_enabled_parity'])
            self.assertTrue(result['name_content_parity'])
            self.settings(homes[1], dirs[1], {PLUGIN: True, other: True})
            self.assertEqual(compare()['errors'], [
                'plugin-enabled-mismatch ' + other + ': local=[.claude,.claude-secondary] remote=[.claude-secondary]'])
            self.settings(homes[1], dirs[0], {PLUGIN: True, other: True})
            result = compare()
            self.assertEqual(result['errors'], [])
            self.assertTrue(result['plugin_enabled_parity'])

    def test_plugin_settings_missing_or_malformed_fail_closed(self):
        cases = [('missing', None, 'settings.json missing'), ('not-json', '{', 'settings.json not JSON'),
                 ('array', '[]', 'settings.json not a JSON object'),
                 ('plugins-list', '{"enabledPlugins": ["' + PLUGIN + '"]}', 'enabledPlugins malformed'),
                 ('plugins-string-value', '{"enabledPlugins": {"' + PLUGIN + '": "true"}}', 'enabledPlugins malformed')]
        for label, text, reason in cases:
            for both in (False, True):
                with self.subTest(label=label, both=both), tempfile.TemporaryDirectory(prefix='class-plugin-settings-') as directory:
                    homes = self.skill_homes(Path(directory))
                    for home in homes if both else homes[1:]:
                        path = home / '.claude/settings.json'
                        if text is None: path.unlink()
                        else: path.write_text(text)
                    left, right = [self.scan(home, pin) for home, pin in zip(homes, self.pins)]
                    result = parity.compare(left, right, self.required)
                    expected = ['plugin-settings-invalid .claude: remote ' + reason]
                    if both: expected.insert(0, 'plugin-settings-invalid .claude: local ' + reason)
                    self.assertEqual(result['errors'], expected)
                    self.assertFalse(result['plugin_enabled_parity'])

    def test_plugin_inventory_absent_or_other_dirs_fails_closed(self):
        self.right.pop('claude_plugins')
        self.assertEqual(self.check()['errors'], ['plugin-inventory missing: remote reported no claude_plugins'])
        self.setUp()
        self.right['claude_plugins']['.claude-secondary'] = {'enabled': []}
        self.assertIn('plugin-config-dirs mismatch: remote', self.check()['errors'][0])
        self.setUp()
        self.assertIn('plugin-config-dirs mismatch: local',
                      parity.compare(self.left, self.right, self.required, ('.claude', '.claude-secondary'))['errors'][0])
        for value in [{}, [], {'.claude': {}}, {'.claude': {'enabled': [1]}}, {'.claude': {'enabled': [PLUGIN, PLUGIN]}},
                      {'../class': {'enabled': []}}, {'.claude': {'error': ''}}, {'.claude': {'enabled': [], 'error': 'x'}}]:
            with self.subTest(value=value):
                self.setUp(); self.right['claude_plugins'] = value
                with self.assertRaises(ValueError): self.check()

    def test_config_dirs_default_and_validate(self):
        self.assertEqual(parity.config_dirs(['~/.claude', '~/.claude-secondary/']), ('.claude', '.claude-secondary'))
        for value in [[], '~/.claude', ['.claude'], ['/abs/.claude'], ['~/../class'], ['~/.claude', '~/.claude'], [1]]:
            with self.subTest(value=value), self.assertRaises(ValueError): parity.config_dirs(value)
        with tempfile.TemporaryDirectory(prefix='class-config-dirs-') as directory:
            base = Path(directory)
            for name in ('identity', 'requirements'): (base / name).write_text('class\n')
            config = base / 'config.json'
            values = dict(schema=1, host='class-remote', identity=str(base / 'identity'), requirements=str(base / 'requirements'))
            for extra, expected in [({}, ('.claude',)), ({'claude_config_dirs': ['~/.claude', '~/.claude-secondary']}, ('.claude', '.claude-secondary'))]:
                config.write_text(json.dumps(dict(values, **extra))); config.chmod(0o600)
                self.assertEqual(parity.load_config(config)['claude_config_dirs'], expected)
            config.write_text(json.dumps(dict(values, claude_config_dirs=['.claude'])))
            with self.assertRaisesRegex(ValueError, 'claude_config_dirs'): parity.load_config(config)

    def test_remote_script_carries_config_dirs(self):
        with tempfile.TemporaryDirectory(prefix='class-stdin-plugins-') as directory:
            home = self.skill_homes(Path(directory))[1]
            self.settings(home, '.claude-secondary', {})
            source = "__name__ = 'class_fixture'\n" + parity.remote_inventory_script(('.claude', '.claude-secondary')) + '\n' + (
                'Path.home = classmethod(lambda cls: Path(' + repr(str(home)) + '))\n'
                'observed_identity = lambda: ' + repr(self.pins[1]) + '\n'
                'sys.argv = ["-", "--inventory"]\nmain()\n')
            run = subprocess.run([sys.executable, '-B', '-'], input=source, text=True, capture_output=True, cwd=directory)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(json.loads(run.stdout)['claude_plugins'],
                             {'.claude': {'enabled': [PLUGIN]}, '.claude-secondary': {'enabled': []}})

    def test_real_schema_sync_records_on_both_hosts_are_ignored(self):
        with tempfile.TemporaryDirectory(prefix='class-sync-record-') as directory:
            homes = self.skill_homes(Path(directory))
            for home in homes:
                record = home / '.golems/installed.json'
                record.parent.mkdir()
                record.write_text(json.dumps(dict(commit='a'*40, counts={'skills': 1}, dirty=False,
                                                  payload_sha256='b'*64, scope='skills',
                                                  source_host='class-source', ts='2026-10-11T00:00:00Z')))
            left, right = [self.scan(home, pin) for home, pin in zip(homes, self.pins)]
            self.assertNotIn('installed_version', left)
            self.assertNotIn('installed_version', right)
            self.assertEqual(parity.compare(left, right, self.required)['errors'], [])

    def test_scanner_compares_release_versions_and_reports_one_sided_record(self):
        with tempfile.TemporaryDirectory(prefix='class-release-record-') as directory:
            homes = self.skill_homes(Path(directory))
            for versions in [('v1', None), (None, 'v1'), ('v1', 'v1'), ('v1', 'v2')]:
                with self.subTest(versions=versions):
                    for home, value in zip(homes, versions):
                        record = home / '.golems/release.json'
                        record.parent.mkdir(exist_ok=True)
                        if value is None:
                            record.unlink(missing_ok=True)
                        else:
                            record.write_text(json.dumps(dict(version=value, commit='a'*40)))
                    left, right = [self.scan(home, pin) for home, pin in zip(homes, self.pins)]
                    result = parity.compare(left, right, self.required)
                    self.assertEqual(result['name_content_parity'], None in versions or versions[0] == versions[1])
                    if None in versions:
                        self.assertEqual(result['errors'], [])
                        self.assertEqual(result['installed_version'], dict(zip(('local', 'remote'), [v or '<checkout>' for v in versions])))

    def test_scanner_records_version_only_from_release_and_refuses_bad_records(self):
        with tempfile.TemporaryDirectory(prefix='class-install-version-') as directory:
            home = Path(directory)
            self.assertNotIn('installed_version', self.scan(home, self.pins[0]))
            record = home / '.golems/release.json'
            record.parent.mkdir()
            sync_record = record.with_name('installed.json')
            sync_record.write_text(json.dumps({'version': 'sync-version'}))
            self.assertNotIn('installed_version', self.scan(home, self.pins[0]))
            sync_record.write_text('unreadable as JSON; owned by sync\n')
            record.write_text(json.dumps({'version': 'v1', 'source': 'class-release'}))
            self.assertEqual(self.scan(home, self.pins[0])['installed_version'], 'v1')
            for value in ['{', '[]', '{}', '{"version":1}', '{"version":""}', '{"version":"v1","commit":1}', '{"version":"v1","commit":"bad"}']:
                record.write_text(value)
                with self.assertRaisesRegex(ValueError, 'release.json'):
                    self.scan(home, self.pins[0])
            record.unlink()
            record.symlink_to(home / 'class-missing-record')
            with self.assertRaisesRegex(ValueError, 'release.json'):
                self.scan(home, self.pins[0])

    def test_scanner_keeps_marker_abuses_and_cache_named_directories(self):
        for path in ['.golems-source-commit/evil.sh', '.golems-install.json/evil.sh',
                     'scripts/.golems-install.json', 'scripts/.golems-source-commit',
                     '.DS_Store/evil.sh', 'class.pyc/evil.sh']:
            with self.subTest(path=path), tempfile.TemporaryDirectory(prefix='class-marker-content-') as directory:
                homes = self.skill_homes(Path(directory))
                helper = homes[1] / self.root / 'class-a' / path
                helper.parent.mkdir(parents=True, exist_ok=True)
                helper.write_text('echo class-content\n')
                left, right = [self.scan(home, pin) for home, pin in zip(homes, self.pins)]
                self.assertIn(path, right['roots'][self.root]['entries']['class-a']['files'])
                self.assertFalse(parity.compare(left, right, self.required)['name_content_parity'])

    def test_scanner_keeps_marker_symlinks_as_content(self):
        for marker in ['.golems-source-commit', '.golems-install.json']:
            with self.subTest(marker=marker), tempfile.TemporaryDirectory(prefix='class-marker-link-') as directory:
                homes = self.skill_homes(Path(directory))
                target = Path(directory) / 'class-helper'
                target.write_text('echo class-content\n')
                (homes[1] / self.root / 'class-a' / marker).symlink_to(target)
                left, right = [self.scan(home, pin) for home, pin in zip(homes, self.pins)]
                self.assertIn(marker, right['roots'][self.root]['entries']['class-a']['files'])
                self.assertFalse(parity.compare(left, right, self.required)['name_content_parity'])

    def test_discovery_root_marker_names_and_ds_store_directories_are_content(self):
        for marker in ['.golems-source-commit', '.golems-install.json', '.DS_Store']:
            with self.subTest(marker=marker), tempfile.TemporaryDirectory(prefix='class-root-marker-') as directory:
                homes = self.skill_homes(Path(directory))
                skill = homes[1] / self.root / marker
                skill.mkdir()
                (skill / 'SKILL.md').write_text('# class-content\n')
                left, right = [self.scan(home, pin) for home, pin in zip(homes, self.pins)]
                self.assertIn(marker, right['roots'][self.root]['entries'])
                self.assertFalse(parity.compare(left, right, self.required)['name_content_parity'])

    def test_scanner_still_ignores_regular_cache_files(self):
        with tempfile.TemporaryDirectory(prefix='class-cache-file-') as directory:
            homes = self.skill_homes(Path(directory))
            (homes[1] / self.root / '.DS_Store').write_text('class-cache\n')
            for name in ['.DS_Store', 'class.pyc']:
                (homes[1] / self.root / 'class-a' / name).write_text('class-cache\n')
            left, right = [self.scan(home, pin) for home, pin in zip(homes, self.pins)]
            self.assertEqual(parity.compare(left, right, self.required)['errors'], [])

    def test_fixture_cli_reports_pass_and_content_or_version_failure(self):
        with tempfile.TemporaryDirectory(prefix='class-parity-cli-') as directory:
            paths = [Path(directory) / name for name in ['left.json', 'right.json', 'required.json']]
            command = [sys.executable, '-B', str(SCRIPT), '--left', str(paths[0]),
                       '--right', str(paths[1]), '--requirements', str(paths[2])]
            for kind in ['equal', 'content', 'version', 'one-sided', 'one-sided-content']:
                with self.subTest(kind=kind):
                    self.setUp()
                    entry = self.right['roots'][self.root]['entries']['class-a']
                    entry.update(kind='dir', normalized_target='$HOME/releases/v1/class-a')
                    if kind in ('content', 'one-sided-content'): entry['skill_sha256'] = 'b'*64
                    if kind.startswith('one-sided'): self.right['installed_version'] = 'v1'
                    if kind == 'version':
                        self.left['installed_version'] = 'v1'
                        self.right['installed_version'] = 'v2'
                    for path, document in zip(paths, [self.left, self.right, self.required]):
                        path.write_text(json.dumps(document))
                    run = subprocess.run(command, capture_output=True, text=True)
                    result = json.loads(run.stdout)
                    self.assertEqual(run.returncode, 0 if kind in ('equal', 'one-sided') else 1, run.stderr)
                    self.assertEqual(result['measurement'], 'fixture')
                    self.assertEqual(result['error_count'], 0 if kind in ('equal', 'one-sided') else 1)
                    self.assertEqual(result['name_content_parity'], kind in ('equal', 'one-sided'))
                    if kind.startswith('one-sided'):
                        self.assertEqual(result['installed_version'], {'local': '<checkout>', 'remote': 'v1'})
                    if kind == 'version': self.assertIn('installed version mismatch: local=v1 remote=v2', run.stderr)

    def test_supporting_symlink_cycles_and_hashless_manifests_fail_closed(self):
        entry = self.right['roots'][self.root]['entries']['class-a']
        entry['files']['helper'] = dict(kind='symlink', target='$HOME/class-helper')
        with self.assertRaisesRegex(ValueError, 'content digest'):
            self.check()
        with tempfile.TemporaryDirectory(prefix='class-skill-cycle-') as directory:
            home = Path(directory)
            skill = home / self.root / 'class-a'
            skill.mkdir(parents=True)
            (skill / 'SKILL.md').write_text('# class-a\n')
            (skill / 'cycle').symlink_to(skill, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'cycle'):
                self.scan(home, self.pins[0])

    def test_scanner_reads_nested_skills_and_rejects_broken_support(self):
        with tempfile.TemporaryDirectory(prefix='class-skill-parity-') as directory:
            home = Path(directory)
            for root in parity.ROOTS:
                skill = home / root / 'class-a'
                skill.mkdir(parents=True)
                (skill / 'SKILL.md').write_text('# class-a\n')
            namespace = home / parity.ROOTS[0] / 'class-namespace'
            nested = namespace / 'class-b'
            nested.mkdir(parents=True)
            (nested / 'SKILL.md').write_text('# class-b\n')
            (namespace / 'class-metadata').write_text('outside skill content\n')
            with patch.object(parity.Path, 'home', return_value=home), patch.object(parity, 'observed_identity', return_value=self.pins[0]):
                snapshot = parity.inventory()
                entry = snapshot['roots'][parity.ROOTS[0]]['entries']['class-namespace']
                self.assertEqual(set(entry['internal_skills']), {'class-b'})
                self.assertNotIn('class-metadata', entry['files'])
                self.assertTrue(snapshot['roots'][parity.ROOTS[0]]['entries']['class-a']['skill_sha256'])
                (nested / 'class-helper').symlink_to(nested / 'class-absent')
                with self.assertRaises(ValueError): parity.inventory()

    def test_identity_pins_reject_self_swapped_and_unexpected_hosts(self):
        self.right['identity'] = self.pins[0]
        self.assertFalse(self.check()['host_identity_valid'])
        self.setUp()
        self.left['identity'], self.right['identity'] = copy.deepcopy(self.pins[1]), self.pins[0]
        self.assertFalse(self.check()['host_identity_valid'])
        self.setUp()
        self.right['identity']['hostname'] = 'f'*64
        self.assertTrue(self.check()['errors'])

    def test_malformed_identity_and_schema_fail(self):
        for value in [None, {}, 'class-host', {'machine': True}]:
            with self.subTest(value=value):
                self.setUp(); self.right['identity'] = value
                with self.assertRaises(ValueError): self.check()
        self.setUp(); self.right.pop('identity')
        with self.assertRaises(ValueError): self.check()
        self.setUp(); self.left['schema'] = 1
        with self.assertRaises(ValueError): self.check()

    def test_exact_allowlists_and_catalog_types(self):
        for value in ['xabx', {'ab': True}, [1], ['../class-a'], ['class-a', 'class-a']]:
            with self.subTest(value=value):
                self.setUp(); self.required['roots'][self.root]['allow_broken'] = value
                with self.assertRaises(ValueError): self.check()
        for field in ['entries', 'readable', 'target_aliases']:
            self.setUp()
            doc = self.right if field == 'entries' else self.required
            doc['roots'][self.root][field] = [] if field != 'readable' else {}
            with self.assertRaises(ValueError): self.check()
        for targets in ['class-target', ['$HOME/class-a'], ['$HOME/../class-a', '$HOME/class-b'], [1, 2]]:
            self.setUp()
            self.required['roots'][self.root]['target_aliases'] = {'class-a': targets}
            with self.assertRaises(ValueError): self.check()

    def test_diagnostics_name_entry_root_and_host(self):
        self.right['roots'][self.root]['entries']['class-a']['skill_sha256'] = 'b'*64
        self.assertIn(self.root + '/class-a: local/remote content/shape mismatch', self.check()['errors'])

    def test_ssh_unavailable_cannot_skip(self):
        with patch.object(sys, 'argv', [str(SCRIPT), '--config', 'class-config']), \
                patch.object(parity, 'load_config', return_value=dict(host='class-host', identity='/class-identity', requirements='/class-manifest', claude_config_dirs=('.claude',))), \
                patch.object(parity.Path, 'read_text', return_value=json.dumps(self.required)), \
                patch.object(parity, 'remote_inventory_script', return_value='class scanner'), \
                patch.object(parity.subprocess, 'run', side_effect=FileNotFoundError('SSH absent')) as ssh:
            self.assertEqual(parity.main(), 1)
            ssh.assert_called_once()

    def test_stdin_scanner_carries_policy_without_remote_sibling_files(self):
        with tempfile.TemporaryDirectory(prefix='class-stdin-scanner-') as directory:
            home = self.skill_homes(Path(directory))[1]
            excluded = home / self.root / 'class-a/evals/case.json'
            excluded.parent.mkdir()
            excluded.write_text('excluded remote content\n')
            source = parity.remote_inventory_script()
            # Match python3 - transport: __file__ is <stdin>, and the target has
            # no repository or policy file. Only host identity is a fixture.
            source = "__name__ = 'class_fixture'\n" + source + '\n' + (
                'Path.home = classmethod(lambda cls: Path(' + repr(str(home)) + '))\n'
                'observed_identity = lambda: ' + repr(self.pins[1]) + '\n'
                'print(json.dumps(inventory()))\n')
            run = subprocess.run([sys.executable, '-B', '-'], input=source,
                                 text=True, capture_output=True, cwd=directory)
            self.assertEqual(run.returncode, 0, run.stderr)
            document = json.loads(run.stdout)
            self.assertEqual(document['identity'], self.pins[1])
            self.assertEqual(document['roots'][self.root]['entries']['class-a']['files'],
                             self.scan(home, self.pins[1])['roots'][self.root]['entries']['class-a']['files'])
            self.assertNotIn('evals/case.json', document['roots'][self.root]['entries']['class-a']['files'])

    def test_missing_or_malformed_shipping_policy_fails_closed(self):
        for value in ['{}', '{', '{"schema":1}', '[]']:
            with self.subTest(value=value), patch.object(parity.Path, 'read_text', return_value=value):
                with self.assertRaises(ValueError): parity.release_policy()
        with patch.object(parity.Path, 'read_text', side_effect=FileNotFoundError):
            with self.assertRaises(FileNotFoundError): parity.release_policy()

    def test_live_missing_capability_cannot_skip(self):
        with tempfile.TemporaryDirectory(prefix='class-missing-config-') as home:
            run = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True,
                                 env={'PATH': '/usr/bin:/bin', 'HOME': home})
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('FAIL', run.stderr)


if __name__ == '__main__': unittest.main()

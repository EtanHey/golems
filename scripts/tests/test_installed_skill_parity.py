"""Class-only fixtures: no installed names, account data, or personal paths."""
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'ratchet/installed-skills.py'
spec = importlib.util.spec_from_file_location('parity', SCRIPT)
parity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parity)


class Parity(unittest.TestCase):
    def setUp(self):
        self.left = {'schema': 1, 'roots': {}}
        self.required = {'schema': 1, 'roots': {}}
        for root in parity.ROOTS:
            entry = dict(kind='symlink', exists=True, skill_sha256='a'*64,
                         normalized_target='$HOME/source/class-a',
                         files={'SKILL.md': {'kind': 'file', 'sha256': 'a'*64, 'executable': False}})
            self.left['roots'][root] = {'exists': True, 'entries': {'class-a': entry}}
            self.required['roots'][root] = {'readable': ['class-a'], 'allow_broken': [],
                                           'allow_empty': [], 'target_aliases': {}}
        self.right = copy.deepcopy(self.left)
        self.root = parity.ROOTS[0]

    def check(self):
        return parity.compare(self.left, self.right, self.required)

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
        self.right['roots'].pop(self.root)
        self.assertTrue(self.check()['errors'])
        with self.assertRaises(ValueError): parity.compare({}, self.left, self.required)

    def test_disclosed_invalid_is_separate_from_parity(self):
        for host in [self.left, self.right]:
            host['roots'][self.root]['entries']['class-retired'] = dict(
                kind='symlink', exists=False, skill_sha256=None, files={},
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

    def test_home_normalization_and_explicit_mirror_alias(self):
        self.assertEqual(parity.normalize('/host-a/source/class-a', '/host-a'),
                         parity.normalize('/host-b/source/class-a', '/host-b'))
        self.assertEqual(parity.normalize('/host-ab/source', '/host-a'), '/host-ab/source')
        entry = self.right['roots'][self.root]['entries']['class-a']
        entry['normalized_target'] = '$HOME/mirror/class-a'
        self.assertTrue(self.check()['errors'])
        self.required['roots'][self.root]['target_aliases']['class-a'] = [
            '$HOME/source/class-a', '$HOME/mirror/class-a']
        self.assertEqual(self.check()['errors'], [])
        entry['normalized_target'] = '/foreign/source/class-a'
        self.assertTrue(self.check()['errors'])

    def test_scanner_reads_nested_skills_and_rejects_broken_support(self):
        scratch = SCRIPT.parents[2] / 'docs.local/parity-tests'
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
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
            with patch.object(parity.Path, 'home', return_value=home):
                snapshot = parity.inventory()
                entry = snapshot['roots'][parity.ROOTS[0]]['entries']['class-namespace']
                self.assertEqual(set(entry['internal_skills']), {'class-b'})
                self.assertNotIn('class-metadata', entry['files'])
                self.assertTrue(snapshot['roots'][parity.ROOTS[0]]['entries']['class-a']['skill_sha256'])
                (nested / 'class-helper').symlink_to(nested / 'class-absent')
                with self.assertRaises(ValueError): parity.inventory()

    def test_ssh_unavailable_cannot_skip(self):
        with patch.object(sys, 'argv', [str(SCRIPT), '--host', 'class-host', '--requirements', 'class-manifest']), \
                patch.object(parity.Path, 'read_text', return_value=json.dumps(self.required)), \
                patch.object(parity.subprocess, 'run', side_effect=FileNotFoundError('SSH absent')):
            self.assertEqual(parity.main(), 1)

    def test_live_missing_capability_cannot_skip(self):
        run = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True,
                             env={'PATH': '/usr/bin:/bin'})
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('FAIL', run.stderr)


if __name__ == '__main__': unittest.main()

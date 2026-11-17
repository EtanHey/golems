"""Shared reason vectors + tiny real Git fixtures. No keys, enrolment or platform queries."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import test_enclave_enrol
import test_gate

ROOT = test_gate.ROOT.parents[2]


class SharedReasons(unittest.TestCase):
    def test_same_vectors_as_swift(self):
        from enclave import validate_reason
        vectors = json.loads((ROOT / 'native/golems-approve/Tests/ApprovalCoreTests/reason-vectors.json').read_text())
        for v in vectors:
            with self.subTest(name=v['name']):
                if v['allowed']: self.assertEqual(validate_reason(v['text']), v['text'])
                else:
                    with self.assertRaises(ValueError): validate_reason(v['text'])

    def test_local_rewrite_copy(self):
        from enclave import operation_sentence
        text = operation_sentence('https://github.com/invented/repo.git', {'class': 'rewrite', 'refs': ['-f', '--', 'refs/heads/topic']})
        self.assertEqual(text, 'Rewrite local history on branch topic in GitHub repo invented/repo.')


class EnrolSource(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / 'docs.local/round4-source-fixtures'; scratch.mkdir(exist_ok=True, parents=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch); self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git('init', '-q')
        (self.repo / 'note').write_text('invented fixture\n')
        self.git('add', 'note'); self.commit()
        self.sha = self.git('rev-parse', 'HEAD')
        self.git('remote', 'add', 'origin', 'https://github.com/EtanHey/golems.git')
        self.git('update-ref', 'refs/remotes/origin/master', self.sha)
        self.module = test_enclave_enrol.load()
        self.file = patch.object(self.module, '__file__', str(self.repo / 'scripts/golems-enclave-enroll'))
        self.file.start(); self.addCleanup(self.file.stop)
    def git(self, *args):
        return subprocess.run(['/usr/bin/git', '-C', str(self.repo), *args], check=True, capture_output=True, text=True,
                              env={'PATH': '/usr/bin:/bin', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}).stdout.strip()
    def commit(self):
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture')
    def test_clean_exact_merged_source_passes(self): self.module.verified_source(self.sha)
    def test_dirty_source_refuses(self):
        (self.repo / 'note').write_text('modified\n')
        with self.assertRaisesRegex(ValueError, 'clean'): self.module.verified_source(self.sha)
    def test_untracked_source_refuses(self):
        (self.repo / 'untracked').write_text('invented\n')
        with self.assertRaisesRegex(ValueError, 'clean'): self.module.verified_source(self.sha)
    def test_wrong_head_refuses(self):
        with self.assertRaisesRegex(ValueError, 'HEAD'): self.module.verified_source('b' * 40)
    def test_unmerged_commit_refuses(self):
        (self.repo / 'note').write_text('next revision\n'); self.git('add', 'note'); self.commit()
        with self.assertRaisesRegex(ValueError, 'origin/master'): self.module.verified_source(self.git('rev-parse', 'HEAD'))
    def test_wrong_origin_refuses(self):
        self.git('remote', 'set-url', 'origin', 'https://example.invalid/invented/repo.git')
        with self.assertRaisesRegex(ValueError, 'origin'): self.module.verified_source(self.sha)
    def test_source_rejection_precedes_checkout_imports(self):
        with patch.object(self.module, 'verified_source', side_effect=ValueError('reject source')), \
             patch('importlib.machinery.SourceFileLoader.exec_module', side_effect=AssertionError('must not import checkout code')):
            with self.assertRaisesRegex(ValueError, 'reject source'): self.module.main(['--commit', self.sha])
    def test_malformed_commit_refuses(self):
        with self.assertRaisesRegex(ValueError, 'full trusted merged commit'): self.module.verified_source('HEAD')
    def test_linked_worktree_shape_refuses(self):
        with patch.object(self.module.Path, 'is_dir', return_value=False):
            with self.assertRaisesRegex(ValueError, 'fresh standalone clone'): self.module.verified_source(self.sha)

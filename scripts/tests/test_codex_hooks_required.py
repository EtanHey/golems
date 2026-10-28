"""Required native ratchet must fail closed; optional developer runs may skip."""
import os
from pathlib import Path
import subprocess
import sys
import unittest

NATIVE = Path(__file__).with_name('test_codex_hooks_native.py')


class RequiredCodexTests(unittest.TestCase):
    def run_native_without_codex(self, required):
        env = dict(os.environ, PATH='')
        env.pop('GOLEMS_REQUIRE_CODEX', None)
        if required:
            env['GOLEMS_REQUIRE_CODEX'] = '1'
        return subprocess.run([sys.executable, str(NATIVE)], env=env,
                              capture_output=True, text=True, timeout=10)

    def test_required_missing_codex_fails(self):
        result = self.run_native_without_codex(True)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertIn('Codex CLI not installed', result.stderr)
        self.assertNotIn('skipped=', result.stderr)

    def test_optional_missing_codex_skips(self):
        result = self.run_native_without_codex(False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('skipped=1', result.stderr)


if __name__ == '__main__':
    unittest.main()

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("human-confirm probe preserves bounded diagnostics and reports the first failure", () => {
  const run = spawnSync("python3", ["-c", String.raw`import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('hc_probe', Path('scripts/ratchet/mac/hc-probe.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class DiagnosticsTest(unittest.TestCase):
    def test_long_reason_and_first_failure(self):
        reason = 'lookup failed: ' + 'x' * 300 + '\nfull reason ends here'
        denied = subprocess.CompletedProcess([], 0, json.dumps({'permissionDecisionReason': reason, 'permissionDecision': 'deny'}), 'stderr detail')
        issued = subprocess.CompletedProcess([], 0, 'issued', '')
        with patch.object(probe, 'hook_command', return_value='hook'), patch.object(probe.subprocess, 'run', side_effect=[denied, issued, denied, denied, denied]), patch('sys.argv', ['probe', '--repo', '.', '--branch', 'fixture', '--sha', 'a'*40, '--issuer', 'issuer']), contextlib.redirect_stdout(io.StringIO()) as stdout, contextlib.redirect_stderr(io.StringIO()) as stderr:
            self.assertEqual(probe.main(), 1)
        result = json.loads(stdout.getvalue())
        self.assertEqual(result['first_failure'], 'C_token')
        self.assertIn('full reason ends here', result['details']['C_token']['stdout'])
        self.assertEqual(result['details']['C_token']['stderr'], 'stderr detail')
        self.assertEqual(result['details']['C_token']['rc'], 0)
        self.assertGreaterEqual(result['details']['C_token']['wall_ms'], 0)
        self.assertIn('C_token', stderr.getvalue())
        self.assertIn('full reason ends here', stderr.getvalue())
        self.assertEqual(len(stderr.getvalue().splitlines()), 1)
        self.assertLess(len(result['steps']['C_token'][1]), 180)

    def test_streams_are_bounded_and_verdict_uses_complete_output(self):
        run = subprocess.CompletedProcess([], 0, 'x'*5000 + '"deny"', 'y'*5000)
        with patch.object(probe.subprocess, 'run', return_value=run):
            verdict, summary, detail = probe.feed('hook', 'command', '.', 'session')
        self.assertEqual(verdict, 'DENY')
        self.assertLessEqual(len(detail['stdout'].encode()), 4096)
        self.assertLessEqual(len(detail['stderr'].encode()), 4096)
        self.assertTrue(detail['stdout_truncated'])
        self.assertTrue(detail['stderr_truncated'])


if __name__ == '__main__':
    unittest.main()
`], {
    cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /OK/);
});

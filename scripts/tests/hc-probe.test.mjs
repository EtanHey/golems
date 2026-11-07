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
import tempfile
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
        allowed = subprocess.CompletedProcess([], 0, '{}', '')
        with patch.object(probe, 'hook_command', return_value='hook'), patch.object(probe.subprocess, 'run', side_effect=[allowed, denied, denied, issued, denied, allowed, denied]), patch('sys.argv', ['probe', '--repo', '.', '--branch', 'fixture', '--sha', 'a'*40, '--issuer', 'issuer']), contextlib.redirect_stdout(io.StringIO()) as stdout, contextlib.redirect_stderr(io.StringIO()) as stderr:
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

    def test_consumption_requires_matching_new_marker_and_removed_pair(self):
        for shape in ('correct', 'preexisting', 'wrong', 'two', 'json-left', 'sig-left'):
            with self.subTest(shape=shape), tempfile.TemporaryDirectory() as tmp:
                home = Path(tmp)
                root = home / '.config/golems/human-confirm'
                root.mkdir(parents=True)
                nonce, other = 'a'*32, 'b'*32
                if shape == 'preexisting': (root / (nonce + '.spent')).touch()
                before_issue = probe.token_files(home)
                token, signature = root / (nonce + '.json'), root / (nonce + '.json.sig')
                token.write_text('fixture'); signature.write_text('fixture')
                before_command = probe.token_files(home)
                if shape != 'json-left': token.unlink()
                if shape != 'sig-left': signature.unlink()
                if shape != 'preexisting':
                    (root / ((other if shape == 'wrong' else nonce) + '.spent')).touch()
                if shape == 'two': (root / (other + '.spent')).touch()
                verdict, _, detail = probe.consumed_token(home, before_issue, before_command)
                self.assertEqual(verdict, 'OK' if shape == 'correct' else 'NOT_SPENT')
                self.assertEqual(detail['rc'], 0 if shape == 'correct' else 1)


if __name__ == '__main__':
    unittest.main()
`], {
    cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /OK/);
});

test("probe rejects a mocked issuer but proves a real lead token was consumed", () => {
  const run = spawnSync("python3", ["-c", String.raw`import json, subprocess, sys
from pathlib import Path

root = Path.cwd()
cell = r"""import contextlib, importlib.util, io, json, os, subprocess, sys, time, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

source, mode = Path(sys.argv[1]), sys.argv[2]
sys.path.insert(0, str(source / 'skills/golem-powers/human-confirm-gate/hooks'))
sys.path.insert(0, str(source / 'skills/golem-powers/human-confirm-gate/tests'))
gate = load('gate', source / 'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py')
probe = load('probe', source / 'scripts/ratchet/mac/hc-probe.py')
import tokens
from test_lead_issuer import Fixture, SHA

class Harness(Fixture, unittest.TestCase):
    pass

isolated = patch.dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
isolated.start()
fixture = Harness()
try:
    fixture.make()
    repo = fixture.repo
    subprocess.run(['/usr/bin/git', '-C', str(repo), 'remote', 'set-url', 'origin', 'https://github.com/EtanHey/golems.git'], check=True)
    config = (repo / '.git/config').read_bytes()
    commands = []
    def feed(hook, command, cwd, session):
        commands.append(command)
        payload = dict(tool_name='Bash', cwd=cwd, session_id=session, tool_input=dict(command=command))
        out, err = io.StringIO(), io.StringIO()
        started = time.monotonic()
        with patch('sys.stdin', io.StringIO(json.dumps(payload))), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = gate.main()
        assert rc in (0, 2) and not err.getvalue(), (rc, err.getvalue())
        reply = subprocess.CompletedProcess([], rc, out.getvalue(), err.getvalue())
        return ('DENY' if rc == 2 else 'ALLOW'), 'in-process gate', probe.diagnostics(reply, started)
    def issue(argv, **kwargs):
        if mode == 'mock':
            return subprocess.CompletedProcess(argv, 0, 'mock issuer OK; no token created', '')
        with contextlib.redirect_stdout(io.StringIO()) as issued:
            fixture.issuer.issue(argv[1:], home=fixture.home,
                metadata_fn=lambda op: (fixture.default, dict(fixture.pr, github='EtanHey/golems')),
                anchor_fn=lambda home: fixture.anchor)
        return subprocess.CompletedProcess(argv, 0, issued.getvalue(), '')
    issuer = Mock(side_effect=issue)
    metadata = lambda target, branch: ('master', dict(name=branch, protected=False))
    argv = ['probe', '--repo', str(repo), '--branch', 'topic', '--sha', SHA, '--issuer', 'fixture-issuer']
    # Metadata and anchor provisioning are fixtures; real mode issues/signs/verifies/consumes a genuine token.
    with patch.object(probe, 'hook_command', return_value='fixture'), patch.object(probe, 'feed', side_effect=feed), patch.object(probe, 'subprocess', SimpleNamespace(run=issuer, CompletedProcess=subprocess.CompletedProcess)), patch.object(tokens, 'anchor_bytes', return_value=fixture.anchor), patch.object(tokens, 'read_command', side_effect=fixture.gh), patch.object(tokens, 'trusted_binary', return_value='gh'), patch.object(tokens, 'own_lease_metadata', metadata), patch('sys.argv', argv), contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()) as err:
        rc = probe.main()
    assert (repo / '.git/config').read_bytes() == config, 'probe changed scratch remotes'
    issuer.assert_called_once()
    print(json.dumps(dict(rc=rc, result=json.loads(out.getvalue()), stderr=err.getvalue(), commands=commands)))
finally:
    fixture.doCleanups()
    isolated.stop()
"""

def measure(mode):
    run = subprocess.run([sys.executable, '-c', cell, str(root), mode], capture_output=True, text=True, check=True)
    return json.loads(run.stdout)

mock, candidate = measure('mock'), measure('real')
assert mock['rc'] == 1 and mock['result']['ok'] is False and mock['result']['first_failure'] == 'C_spent', mock
assert mock['result']['steps']['C_token'][0] == 'ALLOW' and mock['result']['steps']['C_spent'][0] == 'NOT_SPENT', mock
assert mock['result']['details']['C_spent']['rc'] == 1 and 'C_spent' in mock['stderr'], mock
expected = dict(A_own_lease='ALLOW', A2_plain_force='DENY', A3_foreign='DENY', B_issue='OK', C_token='ALLOW', C_spent='OK', D_replay='ALLOW', E_master='DENY')
assert candidate['rc'] == 0 and candidate['result']['first_failure'] is None, candidate
assert {key: value[0] for key, value in candidate['result']['steps'].items()} == expected, candidate
assert ' https://github.com/pingdotgg/t3code.git ' in candidate['commands'][2], candidate
assert set(candidate['result']['details']) == set(expected), candidate
assert set(candidate['result']) == {'ok', 'steps', 'details', 'first_failure'}, candidate
consumed = json.loads(candidate['result']['details']['C_spent']['stdout'])
assert consumed['issued'] == consumed['new_spent'] == 1 and consumed['matching_spent'] and consumed['token_and_signature_gone'], consumed
print(json.dumps(dict(mock=mock['result'], candidate=candidate['result'])))
`], { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const proof = JSON.parse(run.stdout);
  assert.equal(proof.mock.first_failure, "C_spent");
  assert.equal(proof.candidate.ok, true);
  console.log("source-hook proof: mock issuer rejected at C_spent; real signed token PASS 8/8 (metadata/anchor provisioning stubbed)");
});

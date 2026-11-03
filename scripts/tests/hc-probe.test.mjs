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


if __name__ == '__main__':
    unittest.main()
`], {
    cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /OK/);
});

test("new probe expectations fail on master's hook and pass on the own-lease hook", () => {
  const run = spawnSync("python3", ["-c", String.raw`import io, json, subprocess, sys, tarfile, tempfile
from pathlib import Path

root = Path.cwd()
cell = r"""import contextlib, importlib.util, io, json, os, subprocess, sys, tempfile, time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

source, current = map(Path, sys.argv[1:])
sys.path.insert(0, str(source / 'skills/golem-powers/human-confirm-gate/hooks'))
gate = load('gate', source / 'skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py')
probe = load('probe', current / 'scripts/ratchet/mac/hc-probe.py')
import tokens

with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, HOME=tmp, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull):
    repo = Path(tmp) / 'repo'
    subprocess.run(['/usr/bin/git', 'init', '-q', '-b', 'topic', str(repo)], check=True)
    subprocess.run(['/usr/bin/git', '-C', str(repo), 'remote', 'add', 'origin', 'https://github.com/EtanHey/golems.git'], check=True)
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
    issuer = Mock(return_value=subprocess.CompletedProcess([], 0, 'fixture issuer OK', ''))
    metadata = lambda target, branch: ('master', dict(name=branch, protected=False))
    argv = ['probe', '--repo', str(repo), '--branch', 'topic', '--sha', 'a'*40, '--issuer', 'fixture-issuer']
    # Only issuance and read-only metadata are stubbed; the real gate's authorize runs without an anchor.
    with patch.object(probe, 'hook_command', return_value='fixture'), patch.object(probe, 'feed', side_effect=feed), patch.object(probe, 'subprocess', SimpleNamespace(run=issuer)), patch.object(tokens, 'own_lease_metadata', metadata, create=True), patch('sys.argv', argv), contextlib.redirect_stdout(io.StringIO()) as out, contextlib.redirect_stderr(io.StringIO()) as err:
        rc = probe.main()
    assert (repo / '.git/config').read_bytes() == config, 'probe changed scratch remotes'
    issuer.assert_called_once()
    print(json.dumps(dict(rc=rc, result=json.loads(out.getvalue()), stderr=err.getvalue(), commands=commands)))
"""

def measure(source):
    run = subprocess.run([sys.executable, '-c', cell, str(source), str(root)], capture_output=True, text=True, check=True)
    return json.loads(run.stdout)

with tempfile.TemporaryDirectory() as tmp:
    archive = subprocess.check_output(['git', 'archive', 'f4bdb28c2238e27ab7b7201614d89fd4029d9e4c', 'skills/golem-powers/human-confirm-gate/hooks', 'skills/golem-powers/_shared'])
    with tarfile.open(fileobj=io.BytesIO(archive)) as tree:
        tree.extractall(tmp, filter='data')
    base, candidate = measure(Path(tmp)), measure(root)
assert base['rc'] == 1 and base['result']['first_failure'] == 'A_own_lease', base
assert base['result']['steps']['A_own_lease'][0] == 'DENY', base
expected = dict(A_own_lease='ALLOW', A2_plain_force='DENY', A3_foreign='DENY', B_issue='OK', C_token='ALLOW', D_replay='ALLOW', E_master='DENY')
assert candidate['rc'] == 0 and candidate['result']['first_failure'] is None, candidate
assert {key: value[0] for key, value in candidate['result']['steps'].items()} == expected, candidate
assert ' https://github.com/pingdotgg/t3code.git ' in candidate['commands'][2], candidate
assert set(candidate['result']['details']) == set(expected), candidate
assert set(candidate['result']) == {'ok', 'steps', 'details', 'first_failure'}, candidate
print(json.dumps(dict(base=base['result'], candidate=candidate['result'])))
`], { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const proof = JSON.parse(run.stdout);
  assert.equal(proof.base.first_failure, "A_own_lease");
  assert.equal(proof.candidate.ok, true);
  console.log("source-hook proof: f4bdb28c FAIL A_own_lease; candidate PASS 7/7 (issuer/metadata stubbed)");
});

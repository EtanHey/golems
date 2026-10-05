"""Transport parity against the existing, shared pristine command corpus."""
import json
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / "scripts/hooks/codex-policy-hook.py"
TARGETS = {
    "tmp-block": "skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py",
    "git-guardian": "skills/golem-powers/git-guardian/hooks/pre_tool_use.py",
}


def clean_env():
    env = os.environ.copy()
    for key in ("CLAUDE_WORKER", "GIT_GUARDIAN_LIB", "WEAVE_ALLOW_TMP",
                "WEAVE_ALLOW_WT_MIGRATION", "TMP_BLOCK_LEDGER"):
        env.pop(key, None)
    env["TMP_BLOCK_LEDGER"] = str(ROOT / "docs.local/codex-hooks-port/test-ledger.jsonl")
    return env


def run(gate, payload, adapter=ADAPTER, cwd=ROOT, env=None):
    data = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run([sys.executable, str(adapter), gate], input=data,
                          capture_output=True, text=True, cwd=cwd,
                          env=env or clean_env(), timeout=12)


def payload(command, tool="Bash"):
    return {"tool_name": tool, "tool_input": {"command": command},
            "cwd": str(ROOT), "hook_event_name": "PreToolUse"}


class CodexPolicyHookTests(unittest.TestCase):
    def check(self, proc, deny):
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads(proc.stdout)
        output = result.get("hookSpecificOutput", {})
        self.assertEqual(output.get("permissionDecision") == "deny", deny)
        if deny:
            self.assertEqual(output["hookEventName"], "PreToolUse")
            self.assertTrue(output["permissionDecisionReason"])
        self.assertFalse(proc.stderr)
        return result

    def test_core_denials_and_allowed_commands(self):
        for gate, command, deny in [
            ("tmp-block", "printf x > /tmp/codex-policy-test.md", True),
            ("git-guardian", "git push --force origin main", True),
            ("tmp-block", "printf x > docs.local/result.md", False),
            ("git-guardian", "git status --short", False),
        ]:
            with self.subTest(gate=gate, command=command):
                self.check(run(gate, payload(command)), deny)

    def test_shared_corpus_parity(self):
        corpus = json.loads((ROOT / "scripts/tests/fixtures/pristine-harness/corpus.json").read_text())
        spec = importlib.util.spec_from_file_location("pristine_materializer", ROOT / "scripts/ci/pristine-harness.py")
        harness = importlib.util.module_from_spec(spec); spec.loader.exec_module(harness)
        counts = {}
        scratch = ROOT / "docs.local/codex-hooks-port/parity-fixture"
        shutil.rmtree(scratch, ignore_errors=True); scratch.mkdir(parents=True)
        harness.make_fixture(scratch)
        for gate, target in TARGETS.items():
            rows = []
            for x in corpus:
                if x["target"] != gate:
                    continue
                try:
                    p = json.loads(x["input"])
                except json.JSONDecodeError:
                    continue  # malformed transport is covered separately
                if isinstance(p, dict) and p.get("tool_name") == "Bash" and isinstance(p.get("tool_input", {}).get("command"), str):
                    rows.append(x)
            counts[gate] = len(rows)
            for row in rows:
                with self.subTest(gate=gate, case=row["id"]):
                    data = harness.materialize(row["input"], scratch)
                    cwd = harness.fixture_cwd(scratch, row["cwd"]) if row.get("cwd") else ROOT
                    p = json.loads(data); p["cwd"] = str(cwd); data = json.dumps(p)
                    env = clean_env(); env.update(harness.materialize(row.get("env", {}), scratch))
                    env["TMP_BLOCK_LEDGER"] = str(scratch / "ledger.jsonl")
                    original = subprocess.run([sys.executable, str(ROOT / target)],
                        input=data, capture_output=True, text=True,
                        env=env, cwd=cwd, timeout=8)
                    self.assertIn(original.returncode, (0, 2))
                    self.check(run(gate, data, cwd=cwd, env=env), original.returncode == 2)
        self.assertGreaterEqual(sum(counts.values()), 100)
        print("Codex parity corpus:", counts)

    def test_invalid_payloads_fail_closed_without_values(self):
        for value in ["bad-PRIVATE-VALUE", "[]", "{}", "null",
                      json.dumps(payload(123)), json.dumps(payload("x", "unknown"))]:
            with self.subTest(value=value):
                result = self.check(run("tmp-block", value), True)
                self.assertNotIn("PRIVATE-VALUE", json.dumps(result))

    def test_patch_projection_uses_existing_file_policy(self):
        for gate, path, deny in [
            ("tmp-block", "/tmp/codex-test.md", True),
            ("tmp-block", "docs.local/result.md", False),
            ("git-guardian", "credentials.json", True),
            ("git-guardian", "docs.local/result.md", False),
        ]:
            patch = f"*** Begin Patch\n*** Add File: {path}\n+x\n*** End Patch\n"
            self.check(run(gate, payload(patch, "apply_patch")), deny)
        for gate, path, deny in [("git-guardian", ".env", True), ("tmp-block", "/tmp/to-delete.txt", False)]:
            patch = f"*** Begin Patch\n*** Delete File: {path}\n*** End Patch\n"
            self.check(run(gate, payload(patch, "apply_patch")), deny)

    def test_missing_broken_malformed_and_timed_out_gate_fail_closed(self):
        (ROOT / "docs.local").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch)
            adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True)
            shutil.copyfile(ADAPTER, adapter)
            hook = base / TARGETS["tmp-block"]
            hook.parent.mkdir(parents=True)
            bodies = [None, "broken syntax PRIVATE-VALUE", "raise RuntimeError('PRIVATE-VALUE')",
                      "print('{}'); raise SystemExit(1)", "print('{}'); raise SystemExit(3)",
                      "print('PRIVATE-VALUE')", "print('null')", "print('{}'); raise SystemExit(2)",
                      "print(''); raise SystemExit(0)", "import time; time.sleep(10)",
                      "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import time; time.sleep(10)']); time.sleep(10)"]
            for body in bodies:
                with self.subTest(body=body):
                    if body is not None:
                        hook.write_text(body)
                    result = self.check(run("tmp-block", payload("pwd"), adapter), True)
                self.assertNotIn("PRIVATE-VALUE", json.dumps(result))

    def test_indented_patch_headers_use_shared_policy(self):
        for prefix in ("", "  ", "\t", " \t ", "\u2003", "\r"):
            for verb in ("Add File", "Update File", "Move to", "Delete File"):
                for gate, path in [("tmp-block", "/tmp/indent.md"), ("git-guardian", ".env")]:
                    with self.subTest(prefix=prefix, verb=verb, gate=gate):
                        patch = f"*** Begin Patch\n{prefix}*** {verb}: {path}  \n+x\n*** End Patch\n"
                        p = payload(patch, "apply_patch")
                        deny = gate == "git-guardian" or verb != "Delete File"
                        self.check(run(gate, p), deny)
                        if gate == "tmp-block":
                            original = subprocess.run([sys.executable, str(ROOT / TARGETS[gate])],
                                input=json.dumps(p), capture_output=True, text=True, env=clean_env())
                            self.assertEqual(original.returncode == 2, deny)
                allowed = f"*** Begin Patch\n{prefix}*** {verb}: docs.local/ok.md\n+x\n*** End Patch\n"
                for gate in TARGETS:
                    self.check(run(gate, payload(allowed, "apply_patch")), False)

    def test_guardian_library_override_cannot_replace_pinned_policy(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            lib = Path(scratch)
            (lib / "git_safety.py").write_text(
                "from contextlib import nullcontext\n"
                "class PolicyEvaluationDeadlineExceeded(Exception): pass\n"
                "policy_evaluation_deadline = nullcontext\n"
                "cancel_policy_evaluation_deadline = lambda: None\n"
                "dangerous_shell_reason = lambda text: None\n"
                "policy_command_size_reason = lambda text: None\n"
                "shell_text_without_heredoc_bodies = lambda text: text\n")
            env = clean_env(); env["GIT_GUARDIAN_LIB"] = str(lib)
            p = payload("git push --force origin main")
            original = subprocess.run([sys.executable, str(ROOT / TARGETS["git-guardian"])],
                input=json.dumps(p), capture_output=True, text=True, env=env)
            self.assertEqual(original.returncode, 0, "permissive override control was invalid")
            self.check(run("git-guardian", p, env=env), True)

    def test_payload_temp_cwd_overrides_process_cwd(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            env = clean_env(); env["TMPDIR"] = scratch
            p = payload("printf x > relative.md"); p["cwd"] = scratch
            self.check(run("tmp-block", p, cwd=ROOT, env=env), True)
            p["cwd"] = str(ROOT)
            self.check(run("tmp-block", p, cwd=ROOT, env=env), False)

    def test_gate_stderr_on_allow_is_static_denial(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch); adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter)
            hook = base / TARGETS["tmp-block"]; hook.parent.mkdir(parents=True)
            hook.write_text("import sys; print('{}'); print('PRIVATE-VALUE', file=sys.stderr)")
            result = self.check(run("tmp-block", payload("pwd"), adapter), True)
            self.assertNotIn("PRIVATE-VALUE", json.dumps(result))

    def test_large_patch_and_last_sensitive_target(self):
        patch = "*** Begin Patch\n" + "".join(
            f"*** Add File: docs.local/allowed-{i}.md\n+x\n" for i in range(64)) + "*** End Patch\n"
        self.check(run("git-guardian", payload(patch, "apply_patch")), False)
        self.check(run("git-guardian", payload(patch.replace("allowed-63.md", "../../../.env"), "apply_patch")), True)
        repeated = "*** Begin Patch\n" + "*** Update File: docs.local/ok.md\n+x\n" * 128 + "*** End Patch\n"
        self.check(run("git-guardian", payload(repeated, "apply_patch")), False)

    def test_timeout_has_split_hint_without_reinstall(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch); adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter)
            hook = base / TARGETS["tmp-block"]; hook.parent.mkdir(parents=True)
            hook.write_text("import time; time.sleep(20)")
            result = self.check(run("tmp-block", payload("pwd"), adapter), True)
            reason = result["hookSpecificOutput"]["permissionDecisionReason"]
            self.assertIn("split the patch", reason)
            self.assertNotIn("reinstall", reason.lower())

    def test_payload_cwd_reaches_both_policies(self):
        p = payload("git worktree add /workspace/sibling/x HEAD")
        self.check(run("tmp-block", p), True)
        p["cwd"] = "/missing-PRIVATE-VALUE/cwd"
        result = self.check(run("tmp-block", p), True)
        self.assertNotIn("PRIVATE-VALUE", json.dumps(result))

    def test_timeout_stops_descendant_effects(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch)
            adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter)
            marker = base / "late-effect.txt"
            child = f"import time; from pathlib import Path; time.sleep(8); Path({str(marker)!r}).write_text('late')"
            hook = base / TARGETS["tmp-block"]; hook.parent.mkdir(parents=True)
            hook.write_text(f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{child!r}]); time.sleep(10)")
            self.check(run("tmp-block", payload("pwd"), adapter), True)
            # Past the descendant's eight-second effect even with the child's
            # six-second deadline; a kill-parent-only mutation must be caught.
            time.sleep(2.5)
            self.assertFalse(marker.exists(), "timed-out gate descendant survived")

    def test_corrupt_patch_parser_cannot_contaminate_denial(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch); adapter = base / "scripts/hooks/codex-policy-hook.py"
            adapter.parent.mkdir(parents=True); shutil.copyfile(ADAPTER, adapter)
            module = base / "skills/golem-powers/tmp-block/hooks/tmp_block_impl/tool_targets.py"
            module.parent.mkdir(parents=True)
            module.write_text("print('PRIVATE-VALUE'); raise RuntimeError('PRIVATE-VALUE')")
            result = self.check(run("git-guardian", payload("*** Begin Patch\n*** End Patch", "apply_patch"), adapter), True)
            self.assertNotIn("PRIVATE-VALUE", json.dumps(result))


if __name__ == "__main__":
    unittest.main()

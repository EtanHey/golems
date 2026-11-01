"""Real Codex CLI, synthetic local Responses server, scratch home; no paid calls."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / "scripts/hooks/codex-policy-hook.py"
TMP_DENIAL = ("Blocked: files in /tmp get wiped, so this work would be lost. "
              "Save it under the repo's docs.local/ or .worktrees/ instead.")
GIT_DENIAL = ("Blocked: this git command can destroy work (force-push). "
              "Use a safe alternative, or ask the lead.")
SECRET_DENIAL = ("Blocked: this git command can destroy work (changing secret files). "
                 "Use a safe alternative, or ask the lead.")
_cases_spec = importlib.util.spec_from_file_location("codex_hook_cases", ROOT / "scripts/tests/test_codex_policy_hook.py")
_cases = importlib.util.module_from_spec(_cases_spec)
_cases_spec.loader.exec_module(_cases)
desynced_patch_cases = _cases.desynced_patch_cases


@unittest.skipUnless(shutil.which("codex"), "Codex CLI not installed")
class NativeHooksTests(unittest.TestCase):
    def test_native_preexecution_denial_and_allow(self):
        self.run_native_fixture("trusted")

    def test_missing_trust_does_not_run_hooks(self):
        self.run_native_fixture("missing")

    def test_changed_definition_does_not_run_hooks(self):
        self.run_native_fixture("modified")

    def run_native_fixture(self, trust):
        (ROOT / "docs.local").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
            base = Path(scratch)
            home = base / "home"
            home.mkdir()
            workspace = base / "workspace"
            workspace.mkdir()
            bin_dir = base / "bin"
            bin_dir.mkdir()
            git = bin_dir / "git"
            git.write_text("#!/bin/sh\nprintf FAKE_GIT_EXECUTED\n")
            git.chmod(0o700)
            tempdir = base / "temp-class"; tempdir.mkdir()
            commands = [
                # Baseline-safe: the literal temp write is unreachable even if
                # the hook fails. The marker distinguishes handler execution.
                "if false; then printf x > /tmp/codex-hooks-native-probe.md; fi; printf x > blocked-temp-executed.txt",
                "git push --force origin main",  # fake git; no remote effects
                "printf allowed > allowed.txt",
                "git status --short",
                f"apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: {tempdir}/heredoc-leak.md\n+x\n*** End Patch\nEOF",
                "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: .env\n+SYNTHETIC=x\n*** End Patch\nEOF",
                f"cd '{tempdir}' && apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: cd-leak.md\n+x\n*** End Patch\nEOF",
                "applypatch <<'EOF'\n*** Begin Patch\n\t*** Add File: credentials.json\n+{}\n*** End Patch\nEOF",
                f"cd '{workspace}' && apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: allowed-heredoc.md\n+allowed apply_patch\n*** End Patch\nEOF",
            ]
            # Exercise prefix classes that desync the shared tokenizer while
            # Codex still intercepts the heredoc in-process, before any shell.
            for label, prefix in (("ansi-c", "X=$'\\'' "), ("array", "X=(one) ")):
                for cd in (False, True):
                    lead = f"cd '{workspace}' && " if cd else ""
                    alias = "applypatch" if cd else "apply_patch"
                    commands.append(f"{lead}{prefix}{alias} <<'EOF'\n*** Begin Patch\n*** Add File: {tempdir}/{label}-{cd}.md\n+x\n*** End Patch\nEOF")
            (workspace / "sub").mkdir(); (workspace / "s b").mkdir()
            for name, command in desynced_patch_cases(str(tempdir / "shape-leak.md")).items():
                commands.append(command.replace("shape-leak.md", name + ".md"))
            # Optional private regression catalogue; public code carries no new
            # working bypass spelling while the shared tokenizer fix is pending.
            private_cases = os.environ.get("CODEX_NATIVE_PRIVATE_CASES")
            if private_cases:
                cases = json.loads(Path(private_cases).read_text())
                self.assertIsInstance(cases, dict)
                for command in cases.values():
                    self.assertIsInstance(command, str)
                    commands.append(command.replace("__TEMP_CLASS__", str(tempdir)))
            patches = [
                "*** Begin Patch\n  *** Add File: .env\n+SYNTHETIC=x\n*** End Patch\n",
                "*** Begin Patch\n\t*** Add File: credentials.json\n+{}\n*** End Patch\n",
                "*** Begin Patch\n \t *** Add File: allowed-note.md\n+allowed\n*** End Patch\n",
            ]
            if trust != "trusted":
                # Only harmless marker writes and fake git are needed here.
                commands = commands[:4]
                patches = []
            requests = []

            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *_args):
                    pass

                def do_POST(self):
                    body = self.rfile.read(int(self.headers["Content-Length"]))
                    requests.append(json.loads(body))
                    index = len(requests) - 1
                    events = [{"type": "response.created", "response": {"id": f"r{index}"}}]
                    if index < len(commands):
                        item = {"type": "function_call", "call_id": f"call-{index}",
                                "name": "exec_command", "arguments": json.dumps({
                                    "cmd": commands[index], "workdir": str(workspace),
                                    "login": False, "yield_time_ms": 1000})}
                    elif index < len(commands) + len(patches):
                        item = {"type": "custom_tool_call", "call_id": f"call-{index}",
                                "name": "apply_patch", "input": patches[index - len(commands)]}
                    else:
                        item = {"type": "message", "id": "m-final", "role": "assistant",
                                "content": [{"type": "output_text", "text": "NATIVE_FIXTURE_DONE"}]}
                    events.append({"type": "response.output_item.done", "item": item})
                    events.append({"type": "response.completed", "response": {
                        "id": f"r{index}", "usage": {"input_tokens": 0,
                        "output_tokens": 0, "total_tokens": 0}}})
                    data = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)

            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            config = f'''model = "gpt-6-luna"
model_reasoning_effort = "low"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.fixture]
name = "Local synthetic fixture"
base_url = "http://127.0.0.1:{server.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
[features]
enable_request_compression = false
plugins = false
[features.code_mode]
enabled = false
[shell_environment_policy.set]
PATH = {json.dumps(str(bin_dir) + os.pathsep + os.environ['PATH'])}
'''
            (home / "config.toml").write_text(config)
            def hook_command(gate):
                if os.environ.get("CODEX_NATIVE_BASELINE") == "1":
                    source = "tmp-block/hooks/tmp-block-pretooluse.py" if gate == "tmp-block" else "git-guardian/hooks/pre_tool_use.py"
                    return shlex.join([sys.executable, str(ROOT / "skills/golem-powers" / source)])
                # Exercise the installed shell fallback and Codex wire output.
                module = ROOT / "scripts/hooks/codex-hooks-install.mjs"
                r = subprocess.run(["node", "--input-type=module", "-e",
                    "const m=await import(process.argv[1]); console.log(m.codexCommand(...process.argv.slice(2)))",
                    module.as_uri(), sys.executable, str(ADAPTER), gate],
                    capture_output=True, text=True, check=True)
                return r.stdout.strip()
            groups = [
                {"matcher": "^(Bash|apply_patch)$", "hooks": [{"type": "command",
                 "command": hook_command(gate), "timeout": 10}]}
                for gate in ("tmp-block", "git-guardian")
            ]
            hooks_path = home / "hooks.json"
            hooks_path.write_text(json.dumps({"hooks": {"PreToolUse": groups}}))
            if trust != "missing":
                # Codex rust-v0.166.0: hooks/src/engine/discovery.rs hook_hash
                # and config/src/fingerprint.rs version_for_toml. TOML omits
                # absent optional fields; async=false remains in the identity.
                # /hooks persists these exact per-handler approval records.
                for index, group in enumerate(groups):
                    handler = dict(group["hooks"][0], **{"async": False})
                    if trust == "modified":
                        handler["command"] += " stale-definition"
                    identity = dict(event_name="pre_tool_use", matcher=group["matcher"],
                                    hooks=[handler])
                    payload = json.dumps(identity, sort_keys=True, separators=(",", ":"),
                                         ensure_ascii=False).encode()
                    digest = "sha256:" + hashlib.sha256(payload).hexdigest()
                    key = f"{hooks_path}:pre_tool_use:{index}:0"
                    config += f"\n[hooks.state.{json.dumps(key)}]\ntrusted_hash = {json.dumps(digest)}\n"
                (home / "config.toml").write_text(config)
            env = os.environ.copy()
            for key in ("CLAUDE_WORKER", "WEAVE_ALLOW_TMP", "WEAVE_ALLOW_WT_MIGRATION", "GIT_GUARDIAN_LIB"):
                env.pop(key, None)
            env.update(HOME=str(home), CODEX_HOME=str(home), TMPDIR=str(tempdir),
                       TMP_BLOCK_LEDGER=str(base / "ledger.jsonl"))
            try:
                result = subprocess.run([shutil.which("codex"), "exec", "--json",
                    "--skip-git-repo-check",
                    "Run the synthetic fixture commands."], cwd=workspace, env=env,
                    capture_output=True, text=True, timeout=45)
            finally:
                server.shutdown()
                server.server_close()
            self.assertEqual(result.returncode, 0, result.stderr[-3000:])
            self.assertEqual(len(requests), len(commands) + len(patches) + 1, result.stderr[-3000:])
            outputs = {}
            for request in requests:
                for item in request.get("input", []):
                    if item.get("type") in ("function_call_output", "custom_tool_call_output"):
                        outputs[item["call_id"]] = str(item["output"])
            if trust != "trusted":
                self.assertEqual((workspace / "blocked-temp-executed.txt").read_text(), "x")
                self.assertIn("FAKE_GIT_EXECUTED", outputs["call-1"])
                self.assertNotIn(TMP_DENIAL, outputs["call-0"])
                self.assertNotIn(GIT_DENIAL, outputs["call-1"])
                self.assertFalse((base / "ledger.jsonl").exists())
                self.assertEqual((workspace / "allowed.txt").read_text(), "allowed")
                self.assertIn("FAKE_GIT_EXECUTED", outputs["call-3"])
                self.assertIn("NATIVE_FIXTURE_DONE", result.stdout)
                print(f"Native trust={trust}: hooks not executed; paid tokens=0")
                return
            self.assertIn(TMP_DENIAL, outputs["call-0"])
            self.assertFalse((workspace / "blocked-temp-executed.txt").exists())
            self.assertIn(GIT_DENIAL, outputs["call-1"])
            self.assertNotIn("FAKE_GIT_EXECUTED", outputs["call-1"])
            self.assertEqual((workspace / "allowed.txt").read_text(), "allowed")
            self.assertIn("FAKE_GIT_EXECUTED", outputs["call-3"])
            self.assertEqual(list(tempdir.iterdir()), [], "Bash patch bypass wrote into temp class")
            for index in (4, 5, 6, 7):
                self.assertIn("blocked by PreToolUse hook", outputs[f"call-{index}"])
            self.assertIn(TMP_DENIAL, outputs["call-6"], "cd patch must reach existing policy")
            self.assertEqual((workspace / "allowed-heredoc.md").read_text().strip(), "allowed apply_patch")
            self.assertFalse((workspace / ".env").exists())
            self.assertFalse((workspace / "credentials.json").exists())
            for index in range(9, len(commands)):
                self.assertIn("blocked by PreToolUse hook", outputs[f"call-{index}"])
                self.assertIn("native apply_patch", outputs[f"call-{index}"])
            for index in (len(commands), len(commands) + 1):
                self.assertIn(SECRET_DENIAL, outputs[f"call-{index}"])
            self.assertEqual((workspace / "allowed-note.md").read_text().strip(), "allowed")
            self.assertIn("NATIVE_FIXTURE_DONE", result.stdout)
            print(f"Native trusted fixture: {len(commands) + len(patches) - 4} pre-execution denials, 4 real allowed executions; paid tokens=0")


if __name__ == "__main__":
    unittest.main()

"""Real Codex CLI, synthetic local Responses server, scratch home; no paid calls."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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


@unittest.skipUnless(shutil.which("codex"), "Codex CLI not installed")
class NativeHooksTests(unittest.TestCase):
    def test_native_preexecution_denial_and_allow(self):
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
            patches = [
                "*** Begin Patch\n  *** Add File: .env\n+SYNTHETIC=x\n*** End Patch\n",
                "*** Begin Patch\n\t*** Add File: credentials.json\n+{}\n*** End Patch\n",
                "*** Begin Patch\n \t *** Add File: allowed-note.md\n+allowed\n*** End Patch\n",
            ]
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
            (home / "hooks.json").write_text(json.dumps({"hooks": {"PreToolUse": [
                {"matcher": "^(Bash|apply_patch)$", "hooks": [{"type": "command",
                 "command": hook_command(gate), "timeout": 10}]}
                for gate in ("tmp-block", "git-guardian")
            ]}}))
            env = os.environ.copy()
            for key in ("CLAUDE_WORKER", "WEAVE_ALLOW_TMP", "WEAVE_ALLOW_WT_MIGRATION", "GIT_GUARDIAN_LIB"):
                env.pop(key, None)
            env.update(HOME=str(home), CODEX_HOME=str(home), TMPDIR=str(tempdir),
                       TMP_BLOCK_LEDGER=str(base / "ledger.jsonl"))
            try:
                result = subprocess.run([shutil.which("codex"), "exec", "--json",
                    "--skip-git-repo-check", "--dangerously-bypass-hook-trust",
                    "Run the synthetic fixture commands."], cwd=workspace, env=env,
                    capture_output=True, text=True, timeout=45)
            finally:
                server.shutdown()
                server.server_close()
            self.assertEqual(result.returncode, 0, result.stderr[-3000:])
            self.assertEqual(len(requests), 13, result.stderr[-3000:])
            outputs = {}
            for request in requests:
                for item in request.get("input", []):
                    if item.get("type") in ("function_call_output", "custom_tool_call_output"):
                        outputs[item["call_id"]] = str(item["output"])
            self.assertIn("TMP-BLOCK", outputs["call-0"])
            self.assertFalse((workspace / "blocked-temp-executed.txt").exists())
            self.assertIn("BLOCKED", outputs["call-1"])
            self.assertNotIn("FAKE_GIT_EXECUTED", outputs["call-1"])
            self.assertEqual((workspace / "allowed.txt").read_text(), "allowed")
            self.assertIn("FAKE_GIT_EXECUTED", outputs["call-3"])
            self.assertEqual(list(tempdir.iterdir()), [], "Bash patch bypass wrote into temp class")
            for index in (4, 5, 6, 7):
                self.assertIn("blocked by PreToolUse hook", outputs[f"call-{index}"])
            self.assertIn("TMP-BLOCK", outputs["call-6"], "cd patch must reach existing policy")
            self.assertEqual((workspace / "allowed-heredoc.md").read_text().strip(), "allowed apply_patch")
            self.assertFalse((workspace / ".env").exists())
            self.assertFalse((workspace / "credentials.json").exists())
            for index in (9, 10):
                self.assertIn("BLOCKED", outputs[f"call-{index}"])
            self.assertEqual((workspace / "allowed-note.md").read_text().strip(), "allowed")
            self.assertIn("NATIVE_FIXTURE_DONE", result.stdout)
            print("Native 0.160 fixture: 8 pre-execution denials, 4 real allowed executions; paid tokens=0")


if __name__ == "__main__":
    unittest.main()

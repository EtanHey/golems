"""Real Codex CLI, synthetic Responses server, scratch home: fail-first proof.

The synthetic model asks Codex to `cat` a stand-in for claude-eval's settings
file (invented token only). Without the guard the token reaches the model;
with the trusted guard hook Codex refuses before the command runs. No paid
calls; the real settings file is never touched.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading

import pytest

ROOT = Path(__file__).resolve().parents[4]
ADAPTER = ROOT / "scripts/hooks/codex-policy-hook.py"
TOKEN = "FAKE-SYNTH-CODEX-5e1d"

pytestmark = pytest.mark.skipif(not shutil.which("codex") and os.environ.get("GOLEMS_REQUIRE_CODEX") != "1",
                                reason="Codex CLI not installed")


def hook_command():
    module = ROOT / "scripts/hooks/codex-hooks-install.mjs"
    r = subprocess.run(["node", "--input-type=module", "-e",
                        "const m=await import(process.argv[1]); console.log(m.codexCommand(...process.argv.slice(2)))",
                        module.as_uri(), sys.executable, str(ADAPTER), "secret-read-guard"],
                       capture_output=True, text=True, check=True)
    return r.stdout.strip()


def run_codex(guarded):
    assert shutil.which("codex"), "Codex CLI not installed (GOLEMS_REQUIRE_CODEX=1)"
    (ROOT / "docs.local").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ROOT / "docs.local") as scratch:
        base = Path(scratch)
        home, workspace = base / "home", base / "workspace"
        home.mkdir(); workspace.mkdir()
        standin = base / "t3-eval-homes/claude-eval/bin/settings.json"
        standin.parent.mkdir(parents=True)
        standin.write_text(json.dumps({"env": {"ANTHROPIC_AUTH_TOKEN": TOKEN}, "model": "x"}))
        commands = [f"cat {shlex.quote(str(standin))}", "printf allowed > allowed.txt"]
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
                    item = {"type": "function_call", "call_id": f"call-{index}", "name": "exec_command",
                            "arguments": json.dumps({"cmd": commands[index], "workdir": str(workspace),
                                                     "login": False, "yield_time_ms": 30000})}
                else:
                    item = {"type": "message", "id": "m-final", "role": "assistant",
                            "content": [{"type": "output_text", "text": "NATIVE_FIXTURE_DONE"}]}
                events.append({"type": "response.output_item.done", "item": item})
                events.append({"type": "response.completed", "response": {
                    "id": f"r{index}", "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}}})
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
'''
        if guarded:
            group = {"matcher": "^Bash$", "hooks": [{"type": "command", "command": hook_command(), "timeout": 10}]}
            hooks_path = home / "hooks.json"
            hooks_path.write_text(json.dumps({"hooks": {"PreToolUse": [group]}}))
            # The trust record /hooks persists (same identity as test_codex_hooks_native.py).
            handler = dict(group["hooks"][0], **{"async": False})
            identity = dict(event_name="pre_tool_use", matcher=group["matcher"], hooks=[handler])
            digest = "sha256:" + hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":"),
                                                           ensure_ascii=False).encode()).hexdigest()
            config += f"\n[hooks.state.{json.dumps(f'{hooks_path}:pre_tool_use:0:0')}]\ntrusted_hash = {json.dumps(digest)}\n"
        (home / "config.toml").write_text(config)
        env = os.environ.copy()
        env.update(HOME=str(home), CODEX_HOME=str(home), SECRET_READ_GUARD_LEDGER=str(base / "ledger.jsonl"))
        try:
            result = subprocess.run([shutil.which("codex"), "exec", "--json", "--skip-git-repo-check",
                                     "Print claude-eval's settings file."], cwd=workspace, env=env,
                                    capture_output=True, text=True, timeout=60)
        finally:
            server.shutdown()
            server.server_close()
        assert result.returncode == 0, result.stderr[-3000:]
        outputs = {}
        for request in requests:
            for item in request.get("input", []):
                if item.get("type") == "function_call_output":
                    outputs[item["call_id"]] = str(item["output"])
        return outputs, (workspace / "allowed.txt").exists()


def test_without_the_guard_codex_prints_the_secret():
    outputs, allowed = run_codex(guarded=False)
    assert TOKEN in outputs["call-0"]  # today's setup: the cat reaches the model
    assert allowed


def test_with_the_guard_codex_refuses_before_the_command_runs():
    outputs, allowed = run_codex(guarded=True)
    assert TOKEN not in outputs["call-0"]
    assert "blocked by PreToolUse hook" in outputs["call-0"]
    assert "masked-read.py" in outputs["call-0"]
    assert allowed  # an ordinary command still runs

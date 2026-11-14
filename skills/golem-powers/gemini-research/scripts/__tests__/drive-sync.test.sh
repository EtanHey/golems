#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT="$ROOT_DIR/scripts/drive-sync.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_fixture() {
  local path="$1"
  cat >"$path" <<'EOF'
{
  "next_notebook_id": 11,
  "next_task_id": 21,
  "drive_context_files": [
    {"id": "ctx-1", "name": "00-code-map.md", "mime": "text/markdown"},
    {"id": "ctx-2", "name": "01-search.py.txt", "mime": "text/plain"}
  ],
  "prompts": [
    {"id": "prompt-82", "name": "R82-memory.md", "content": "# R82\nCompare BrainLayer vs Mem0"}
  ],
  "results": [],
  "notebooks": {},
  "operations": []
}
EOF
  python3 - "$path" "$ROOT_DIR/references/prompt-template.md" <<'PY'
import json, pathlib, re, sys
template = pathlib.Path(sys.argv[2]).read_text()
prompt = template.split('For explicitly authorized web-only research,')[0]
prompt += '# Owner asks (verbatim)' + template.split('# Owner asks (verbatim)', 1)[1]
prompt = prompt.replace('<reviewer-one>', 'reader-a').replace('<reviewer-two>', 'reader-b')
# Synthetic private answers must differ from the public questions/doc titles.
prompt = prompt.replace('<exact verified answer>', 'Fixture-only verified answer')
prompt = prompt.replace('<exact current answer>', 'Fixture-only current answer')
prompt = prompt.replace('<exact verified first line>', '# Fixture verified heading')
prompt = prompt.replace('<exact current first line>', '# Fixture current heading')
prompt = prompt.replace('<Current project facts document title>', 'Current facts')
prompt = re.sub(r'<[^>]+>', 'Example statement', prompt).replace('- [ ]', '- [x]')
p = pathlib.Path(sys.argv[1]); fixture = json.loads(p.read_text())
fixture['prompts'][0]['content'] = prompt
p.write_text(json.dumps(fixture))
PY
}

run_new_project_case() {
  local tmp_dir fixture state_file output result_file
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  fixture="$tmp_dir/fixture.json"
  state_file="$tmp_dir/research-state.json"
  output="$tmp_dir/output.json"
  make_fixture "$fixture"

  GEMINI_DRIVE_SYNC_FIXTURE="$fixture" \
    GEMINI_RESEARCH_STATE_FILE="$state_file" \
    "$SCRIPT" --project brainlayer --prompt R82-memory.md >"$output"

  python3 - "$output" "$fixture" "$state_file" <<'PY'
import json, pathlib, sys
summary = json.loads(pathlib.Path(sys.argv[1]).read_text())
fixture = json.loads(pathlib.Path(sys.argv[2]).read_text())
state = json.loads(pathlib.Path(sys.argv[3]).read_text())

assert summary["project"] == "brainlayer"
assert summary["notebook_id"] == "nb-11"
assert summary["prompt"] == "R82-memory.md"
assert summary["result"]["name"] == "R82-gemini-result.md"
assert state["brainlayer"]["notebook_id"] == "nb-11"
ops = fixture["operations"]
assert ops[0]["op"] == "verify-account"
assert any(op["op"] == "notebook_create" for op in ops)
assert any(op["op"] == "source_add_drive" and op["document_id"] == "ctx-1" for op in ops)
assert any(op["op"] == "source_add_drive" and op["document_id"] == "ctx-2" for op in ops)
assert any(op["op"] == "research_start" and op["source"] == "drive" for op in ops)
assert any(op["op"] == "research_import" for op in ops)
assert any(op["op"] == "write_result" and op["name"] == "R82-gemini-result.md" for op in ops)
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_existing_project_case() {
  local tmp_dir fixture state_file output
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  fixture="$tmp_dir/fixture.json"
  state_file="$tmp_dir/research-state.json"
  output="$tmp_dir/output.json"
  make_fixture "$fixture"
  cat >"$state_file" <<'EOF'
{"brainlayer":{"notebook_id":"nb-existing"}}
EOF

  GEMINI_DRIVE_SYNC_FIXTURE="$fixture" \
    GEMINI_RESEARCH_STATE_FILE="$state_file" \
    "$SCRIPT" --project brainlayer --prompt R82-memory.md >"$output"

  python3 - "$fixture" <<'PY'
import json, pathlib, sys
fixture = json.loads(pathlib.Path(sys.argv[1]).read_text())
ops = fixture["operations"]
assert not any(op["op"] == "notebook_create" for op in ops)
assert any(op["op"] == "research_start" and op["notebook_id"] == "nb-existing" for op in ops)
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_account_failure_case() {
  local tmp_dir fixture state_file stderr_file
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  fixture="$tmp_dir/fixture.json"
  state_file="$tmp_dir/research-state.json"
  stderr_file="$tmp_dir/stderr"
  make_fixture "$fixture"

  set +e
  GEMINI_DRIVE_SYNC_FIXTURE="$fixture" \
    GEMINI_DRIVE_SYNC_FAIL_VERIFY=1 \
    GEMINI_RESEARCH_STATE_FILE="$state_file" \
    "$SCRIPT" --project brainlayer --prompt R82-memory.md >/dev/null 2>"$stderr_file"
  exit_code=$?
  set -e

  [[ $exit_code -ne 0 ]] || fail "expected account verification failure"
  grep -q "account verification failed" "$stderr_file" || fail "expected explicit account failure"

  trap - RETURN
  rm -rf "$tmp_dir"
}

# The live verify_account() branch shells out to VERIFY_ACCOUNT_SCRIPT; every
# fixture case returns before that path is used, so pin it directly.
run_shared_helper_paths_case() {
  python3 - "$ROOT_DIR/scripts/drive_sync.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("drive_sync_under_test", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.SHARED_DRIVE_HELPER.is_file(), module.SHARED_DRIVE_HELPER
assert module.VERIFY_ACCOUNT_SCRIPT.is_file(), module.VERIFY_ACCOUNT_SCRIPT
PY
}

# Live mode has no default nlm profile: with GEMINI_RESEARCH_PROFILE unset it
# must stop with a clear error before running any command.
run_live_mode_requires_profile_case() {
  env -u GEMINI_RESEARCH_PROFILE -u GEMINI_DRIVE_SYNC_FIXTURE \
    python3 - "$ROOT_DIR/scripts/drive_sync.py" <<'PY'
import contextlib, importlib.util, io, sys
spec = importlib.util.spec_from_file_location("drive_sync_under_test", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.NLM_PROFILE == "", f"unset profile must not fall back to a default: {module.NLM_PROFILE!r}"

calls = []
def record(args, check=True):
    calls.append(args)
    raise module.GeminiDriveSyncError("stubbed command")
module.run_cli = record
sys.argv = ["drive_sync.py", "--project", "brainlayer", "--prompt", "R82-memory.md"]
stderr = io.StringIO()
with contextlib.redirect_stderr(stderr):
    code = module.main()
assert code == 1, code
assert calls == [], f"ran commands without a profile: {calls}"
assert "GEMINI_RESEARCH_PROFILE" in stderr.getvalue(), stderr.getvalue()
PY
}

# Live mode checks the signed-in account against RESEARCH_ACCOUNT (the same
# variable verify-account.sh reads). A hardcoded placeholder would fail every
# real account, so it must be set, and it must be what verify is asked for.
run_live_mode_account_case() {
  # HOME is a throwaway fixture inside the worktree, so the real
  # ~/.config/research-lifecycle/research.env is never read.
  local fixture_home
  fixture_home=$(mktemp -d "$ROOT_DIR/scripts/__tests__/.home.XXXXXX")
  trap 'rm -rf "$fixture_home"' RETURN EXIT

  env -u RESEARCH_ACCOUNT -u GEMINI_DRIVE_SYNC_FIXTURE HOME="$fixture_home" GEMINI_RESEARCH_PROFILE=research \
    python3 - "$ROOT_DIR/scripts/drive_sync.py" <<'PY'
import contextlib, importlib.util, io, os, sys
spec = importlib.util.spec_from_file_location("drive_sync_under_test", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

calls = []
def record(args, check=True):
    calls.append(args)
    raise module.GeminiDriveSyncError("stubbed command")
module.run_cli = record
sys.argv = ["drive_sync.py", "--project", "brainlayer", "--prompt", "R82-memory.md"]

stderr = io.StringIO()
with contextlib.redirect_stderr(stderr):
    code = module.main()
assert code == 1, code
assert calls == [], f"ran commands without an account: {calls}"
assert "RESEARCH_ACCOUNT" in stderr.getvalue(), stderr.getvalue()

module.RESEARCH_ACCOUNT = "someone@example.org"
with contextlib.redirect_stderr(io.StringIO()):
    module.main()
verify = calls[0]
assert verify[verify.index("--expect") + 1] == "someone@example.org", verify
PY

  # The config file supplies the account when the environment does not.
  mkdir -p "$fixture_home/.config/research-lifecycle"
  printf 'RESEARCH_ACCOUNT=from-file@example.org\n' >"$fixture_home/.config/research-lifecycle/research.env"
  env -u RESEARCH_ACCOUNT -u GEMINI_DRIVE_SYNC_FIXTURE HOME="$fixture_home" GEMINI_RESEARCH_PROFILE=research \
    python3 - "$ROOT_DIR/scripts/drive_sync.py" <<'PY'
import contextlib, importlib.util, io, sys
spec = importlib.util.spec_from_file_location("drive_sync_under_test", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

calls = []
def record(args, check=True):
    calls.append(args)
    raise module.GeminiDriveSyncError("stubbed command")
module.run_cli = record
sys.argv = ["drive_sync.py", "--project", "brainlayer", "--prompt", "R82-memory.md"]
with contextlib.redirect_stderr(io.StringIO()):
    module.main()
assert calls, "config-file account did not reach verify-account"
verify = calls[0]
assert verify[verify.index("--expect") + 1] == "from-file@example.org", verify
PY

  trap - RETURN EXIT
  rm -rf "$fixture_home"
}

run_prompt_failure_case() {
  local tmp_dir
  tmp_dir=$(mktemp -d)
  make_fixture "$tmp_dir/fixture.json"
  python3 - "$tmp_dir/fixture.json" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1]); data = json.loads(p.read_text())
data['prompts'][0]['content'] = '# Grounding\n- "Overview"\n'
p.write_text(json.dumps(data))
PY
  if GEMINI_DRIVE_SYNC_FIXTURE="$tmp_dir/fixture.json" GEMINI_RESEARCH_STATE_FILE="$tmp_dir/state.json" \
    "$SCRIPT" --project example --prompt R82-memory.md >"$tmp_dir/out" 2>"$tmp_dir/err"; then
    fail "missing practices reached research"
  fi
  python3 - "$tmp_dir/fixture.json" "$tmp_dir/err" <<'PY'
import json, pathlib, sys
ops = json.loads(pathlib.Path(sys.argv[1]).read_text())['operations']
assert [op['op'] for op in ops] == ['verify-account'], ops
assert 'prompt preflight failed' in pathlib.Path(sys.argv[2]).read_text()
PY
  rm -rf "$tmp_dir"
}

run_prompt_dispatch_case() {
  local tmp_dir
  tmp_dir=$(mktemp -d)
  make_fixture "$tmp_dir/fixture.json"
  GEMINI_DRIVE_SYNC_FIXTURE="$tmp_dir/fixture.json" GEMINI_RESEARCH_STATE_FILE="$tmp_dir/state.json" \
    python3 - "$ROOT_DIR/scripts/drive_sync.py" <<'PY'
import contextlib, importlib.util, io, re, sys
spec = importlib.util.spec_from_file_location('drive_sync_under_test', sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
sys.argv = ['drive_sync.py', '--project', 'example', '--prompt', 'R82-memory.md']
received = []
original = module.run_research
def capture(notebook, prompt, fixture):
    received.append(prompt)
    return original(notebook, prompt, fixture)
module.run_research = capture
with contextlib.redirect_stdout(io.StringIO()):
    assert module.main() == 0
assert len(received) == 1
assert all(word not in received[0] for word in ['Pre-fire checks', 'Bias check', 'reader-a', 'reader-b'])
assert 'PROPOSED' in received[0] and 'Recompute every worked example' in received[0]
assert 'reader-a' in module.load_fixture()['prompts'][0]['content']
assert all(word not in received[0] for word in ['admission-key', 'Fixture-only verified answer', 'Fixture-only current answer'])

# The same otherwise-valid author record must fail before research without its key.
fixture = module.load_fixture()
fixture['prompts'][0]['content'] = re.sub(r'```admission-key\n[\s\S]*?```', '', fixture['prompts'][0]['content'])
module.save_fixture(fixture)
previous_ops = len(fixture['operations'])
received.clear()
stderr = io.StringIO()
with contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(io.StringIO()):
    assert module.main() == 1
assert 'ADMISSION_KEY:' in stderr.getvalue(), stderr.getvalue()
assert not received, 'missing key reached research'
assert [op['op'] for op in module.load_fixture()['operations'][previous_ops:]] == ['verify-account']

run = module.subprocess.run
def missing_node(args, **kwargs):
    if args[0] == 'node': raise FileNotFoundError('node')
    return run(args, **kwargs)
module.subprocess.run = missing_node
received.clear()
stderr = io.StringIO()
with contextlib.redirect_stderr(stderr):
    assert module.main() == 1
assert stderr.getvalue().strip() == 'prompt preflight needs node'
assert not received
PY
  rm -rf "$tmp_dir"
}

node --test "$ROOT_DIR/scripts/__tests__/prompt-preflight.test.mjs"
run_prompt_dispatch_case
run_prompt_failure_case
run_shared_helper_paths_case
run_live_mode_requires_profile_case
run_live_mode_account_case
run_new_project_case
run_existing_project_case
run_account_failure_case

echo "drive-sync.test.sh PASS"

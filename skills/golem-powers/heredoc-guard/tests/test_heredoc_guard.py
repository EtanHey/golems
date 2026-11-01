"""All shell text is inert data: only Python hooks receive it over stdin."""
import importlib.util
import hashlib
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import pytest

ROOT = Path(__file__).resolve().parents[4]
HOOK = ROOT / "skills/golem-powers/heredoc-guard/hooks/heredoc-guard-pretooluse.py"
PARSER = HOOK.with_name("heredoc_parser.py")
LAUNCHER = ROOT / "scripts/hooks/fail-open.py"
ADAPTER = ROOT / "scripts/hooks/codex-policy-hook.py"
DENY = [
    "cat > f <<EOF\n`npx x`\nEOF",
    "cat <<-EOF\n\t$(id)\n\tEOF",
    "cat <<'A' <<B\n`literal`\nA\n$(id)\nB",
    "cat <<EOF | cat && true\n$(id)\nEOF",
    "true && cat <<EOF\n`id`\nEOF",
    "cat <<EOF\n'$(id)'\nEOF",  # Body quotes do not suppress expansion.
    "cat <<EOF\n$((1+$(id)))\nEOF",
    "cat <<EOF\n$((cmd) )\nEOF",
    "cat <<EOF\n$((echo hi); (id))\nEOF",
    "cat <<EOF\n$((id); echo)\nEOF",
    "cat <<EOF\n\\\\$(id)\nEOF",  # Even backslashes leave the dollar active.
    "cat <<EOF\nprefix\\\nEOF\n$(id)\nEOF",  # Joined line is not the terminator.
    "cat <<EOF\n$(id)\nEOF\ncat <<'X'\nsafe\nX",
    "echo \\ #word; cat <<EOF\n$(id)\nEOF",
    'echo "$(cat <<EOF\n$(id)\nEOF\n)"',
    "echo $(cat <<EOF\n`id`\nEOF\n)",
    "cat <\\\n<EOF\n$(id)\nEOF",
    'echo "$\\\n(cat <<EOF\n$(id)\nEOF\n)"',
    "apply_patch <<EOF\n*** Begin Patch\n*** Add File: f\n+`id`\n*** End Patch\nEOF",
]
ALLOW = [
    "cat <<'EOF'\n`npx x`\nEOF",
    'cat <<"EOF"\n$(id)\nEOF',
    "cat <<\\EOF\n$(id)\nEOF",
    'cat <<E"OF"\n$(id)\nEOF',
    "cat <<E''OF\n`id`\nEOF",
    "cat <<EOF\n$HOME ${HOME} $((1+2))\nEOF",
    "cat <<EOF\n$((1+2))\nEOF",
    "cat <<EOF\n$(((1+2)*3))\nEOF",
    "cat <<EOF\n\\$(x) \\`x\\`\nEOF",
    "cat <<< '$(id)'",
    "printf '%s' '<<EOF'",
    'printf "%s" "<<EOF"',
    "# cat <<EOF\ntrue",
    "printf x # <<EOF\ntrue",
    "cat <<'A' <<B\n$(id)\nA\n$HOME\nB",
    "python3 - <<'EOF'\nprint('`literal` $(literal)')\nEOF",
    "bash -c 'cat <<EOF\n$(id)\nEOF'",  # Outer command string only.
    "cat <<EOF\n\\\\\\$(id)\nEOF",
    "cat <<-EOF\n\t$HOME\n\tEOF",
    "cat <<EOF\nsafe\nEOF",  # Final newline is optional.
    "cat <<EOF\nsafe\nEO\\\nF",  # Unquoted body joins escaped newlines.
    "cat <<EOF\n\\\nEOF\n$(id)\nEOF",  # The joined EOF closes this heredoc.
    "cat <<''\n$(id)\n\n",
    "echo $((1 << 2))",
    "(( x = 1 << 2 ))",
    "cat <<EO\\\nF\n$HOME\nEOF",
    "printf '%s' 'multiline\n<<EOF\n$(id)\nEOF'",
    "echo $'it\\'s <<EOF'",
    "echo \\$'it\\' ; cat <<'EOF'\n$(id)\nEOF",
    "apply_patch <<'EOF'\nnot a patch; $(literal)\nEOF",
    "v=$(cmd)\ncat <<EOF\n$v\nEOF",
    "echo 'open",
    "echo it's",
]
MALFORMED = ["cat <<", "cat <<EOF\nsafe", "cat <<'EOF\nsafe\nEOF"]


@pytest.fixture(autouse=True)
def isolated_home(monkeypatch):
    scratch = ROOT / "docs.local/heredoc-guard-tests"
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=scratch) as home:
        monkeypatch.setenv("HOME", home)
        monkeypatch.setenv("HEREDOC_GUARD_LEDGER", str(Path(home) / "ledgers/denials.jsonl"))
        yield Path(home)


@pytest.fixture
def parser():
    spec = importlib.util.spec_from_file_location("heredoc_parser", PARSER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("command", DENY)
def test_dangerous_body(parser, command):
    assert parser.unsafe_delimiter(command) is not None


@pytest.mark.parametrize("command", ALLOW)
def test_safe_outer_command(parser, command):
    assert parser.unsafe_delimiter(command) is None


@pytest.mark.parametrize("command", MALFORMED)
def test_parser_errors_are_explicit(parser, command):
    with pytest.raises(ValueError):
        parser.unsafe_delimiter(command)


def run_hook(value, codex=False):
    argv = ([sys.executable, str(ADAPTER), "heredoc-guard"] if codex else
            [sys.executable, "-I", "-B", str(LAUNCHER), "--fail-closed", str(HOOK)])
    return subprocess.run(argv, input=value if isinstance(value, str) else json.dumps(value),
                          text=True, capture_output=True, cwd=ROOT, timeout=12)


def payload(command):
    return {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": str(ROOT)}


@pytest.mark.parametrize("codex", [False, True])
@pytest.mark.parametrize("command", DENY)
def test_hook_denial(codex, command):
    proc = run_hook(payload(command), codex)
    assert proc.returncode == (0 if codex else 2), proc.stderr
    result = json.loads(proc.stdout)["hookSpecificOutput"]
    assert result["permissionDecision"] == "deny"
    reason = result["permissionDecisionReason"]
    assert reason.startswith("heredoc-guard: unquoted heredoc <<")
    assert "quote the delimiter" in reason and "Incident: a backticked command" in reason
    assert "compute it first" in reason and "v=$(cmd)" in reason and "$v" in reason
    assert "\n" not in reason and not proc.stderr


@pytest.mark.parametrize("value", [payload(DENY[0]), payload(MALFORMED[0])])
def test_claude_denial_matches_tmp_block_full_shape(value):
    proc = run_hook(value)
    assert proc.returncode == 2 and not proc.stderr
    result = json.loads(proc.stdout)
    reason = result["reason"]
    assert isinstance(reason, str) and reason
    assert result == {
        "decision": "block",
        "reason": reason,
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }


@pytest.mark.parametrize("codex", [False, True])
@pytest.mark.parametrize("command", ALLOW)
def test_hook_allow(codex, command):
    proc = run_hook(payload(command), codex)
    assert proc.returncode == 0 and json.loads(proc.stdout) == {}, proc.stdout
    assert not proc.stderr


@pytest.mark.parametrize("value", ["{", "[]", {}, {"tool_name": "Bash"}, payload(42)] +
                         [payload(command) for command in MALFORMED])
@pytest.mark.parametrize("codex", [False, True])
def test_hook_fails_closed(codex, value):
    proc = run_hook(value, codex)
    assert proc.returncode == (0 if codex else 2)
    result = json.loads(proc.stdout)["hookSpecificOutput"]
    assert result["permissionDecision"] == "deny"
    if not codex:
        assert "parse error" in result["permissionDecisionReason"]


def test_manifest_wires_every_tmp_block_host():
    manifest = json.loads((ROOT / "scripts/hooks/manifest.json").read_text())
    for host, entries in manifest["hosts"].items():
        if not any(row["id"] == "tmp-block" for row in entries):
            continue
        rows = [row for row in entries if row["id"] == "heredoc-guard"]
        assert len(rows) == 1, host
        assert rows[0]["matcher"] == "Bash" and rows[0]["event"] == "PreToolUse"
        assert "golems-fail-open.py --fail-closed" in rows[0]["command"]
        assert (ROOT / rows[0]["source"] / "hooks" / rows[0]["match"]).is_file()
        gates = [row for row in manifest["codex_hosts"][host] if row["gate"] == "heredoc-guard"]
        assert len(gates) == 1 and gates[0]["matcher"] == "^(Bash|apply_patch)$"


@pytest.mark.parametrize("codex", [False, True])
def test_native_patch_content_is_never_shell(codex, isolated_home):
    value = payload("*** Begin Patch\n*** Add File: f\n+cat <<EOF\n+$(cmd)\n+EOF\n*** End Patch")
    value["tool_name"] = "apply_patch"
    proc = run_hook(value, codex)
    assert proc.returncode == 0 and json.loads(proc.stdout) == {} and not proc.stderr
    assert not (isolated_home / ".claude/logs/heredoc-guard-ledger.jsonl").exists()
    assert not (isolated_home / "ledgers/denials.jsonl").exists()


def test_non_bash_allows_before_validating_input():
    proc = run_hook({"tool_name": "Write", "tool_input": None})
    assert proc.returncode == 0 and json.loads(proc.stdout) == {} and not proc.stderr


@pytest.mark.parametrize("codex", [False, True])
@pytest.mark.parametrize("command,cause", [
    ("cat <<", "missing heredoc delimiter"),
    ("cat <<EOF\nsafe", "unterminated heredoc"),
    ("cat <<'EOF\nsafe\nEOF", "unterminated quote"),
])
def test_parse_denial_names_stage_and_short_cause(codex, command, cause):
    proc = run_hook(payload(command), codex)
    reason = json.loads(proc.stdout)["hookSpecificOutput"]["permissionDecisionReason"]
    assert "shell: " + cause in reason


@pytest.mark.parametrize("codex", [False, True])
def test_denial_ledger_hashes_commands_without_recording_them(codex, isolated_home):
    command = "cat <<EOF\n$(PRIVATE_COMMAND_SENTINEL)\nEOF"
    for text in [command, "cat <<EOF\nsafe"]:
        proc = run_hook(payload(text), codex)
        assert json.loads(proc.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"
    proc = run_hook(payload("echo safe"), codex)
    assert json.loads(proc.stdout) == {}
    ledger = isolated_home / "ledgers/denials.jsonl"
    raw = ledger.read_text()
    rows = [json.loads(line) for line in raw.splitlines()]
    assert len(rows) == 2
    for row, text, rule in zip(rows, [command, "cat <<EOF\nsafe"], ["command-substitution", "parse-error"]):
        assert set(row) == {"ts", "command_sha256", "rule", "reason"}
        assert datetime.fromisoformat(row["ts"]).tzinfo is not None
        assert row["command_sha256"] == hashlib.sha256(text.encode()).hexdigest()
        assert row["rule"] == rule
        assert 0 < len(row["reason"]) <= 120 and "\n" not in row["reason"]
    assert "PRIVATE_COMMAND_SENTINEL" not in raw and command not in raw


def test_unwritable_ledger_still_denies(isolated_home):
    (isolated_home / "ledgers").write_text("fixture blocks ledger directory")
    proc = run_hook(payload(DENY[0]))
    assert proc.returncode == 2 and not proc.stderr
    reason = json.loads(proc.stdout)["reason"]
    assert "denial ledger unavailable" in reason


@pytest.mark.parametrize("codex", [False, True])
def test_denial_writes_override_without_touching_default(codex, isolated_home):
    proc = run_hook(payload(DENY[0]), codex)
    assert json.loads(proc.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"
    ledger = isolated_home / "ledgers/denials.jsonl"
    assert json.loads(ledger.read_text())["rule"] == "command-substitution"
    assert not (isolated_home / ".claude/logs/heredoc-guard-ledger.jsonl").exists()


def test_environment_is_not_a_bypass(monkeypatch):
    for name in ("WEAVE_ALLOW_TMP", "HEREDOC_GUARD_ALLOW", "CLAUDE_WORKER"):
        monkeypatch.setenv(name, "1")
    proc = run_hook(payload(DENY[0]))
    assert proc.returncode == 2 and "heredoc-guard: unquoted heredoc" in proc.stdout

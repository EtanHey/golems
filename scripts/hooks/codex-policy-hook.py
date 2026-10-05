#!/usr/bin/env python3
"""Codex transport for existing policy gates; no command-classification policy."""
import importlib.util
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
TARGETS = {
    "tmp-block": "skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py",
    "git-guardian": "skills/golem-powers/git-guardian/hooks/pre_tool_use.py",
}
REPAIR_REASON = (
    "BLOCKED: Codex policy hook unavailable; refusing tool call. "
    "FLAG THIS TO THE USER: repair with "
    "scripts/hooks/install-hooks.sh --host <host> --update --apply; "
    "then review the hooks through /hooks."
)


def denial(reason=REPAIR_REASON):
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
            "permissionDecision": "deny", "permissionDecisionReason": reason}}


def gate_result(proc):
    # Codex ignores stdout JSON at exit 2. Consume the Claude result ourselves
    # and emit a supported exit-0 decision, preserving deliberate policy reasons.
    if proc.returncode not in (0, 2) or proc.stderr:
        raise ValueError("gate failed")
    value = json.loads(proc.stdout)
    if not isinstance(value, dict):
        raise ValueError("invalid gate output")
    specific = value.get("hookSpecificOutput", {})
    if not isinstance(specific, dict):
        raise ValueError("invalid gate output")
    if any(k in value for k in ("continue", "stopReason", "suppressOutput")):
        raise ValueError("unsupported gate output")
    is_deny = value.get("decision") == "block" or specific.get("permissionDecision") == "deny"
    if is_deny:
        reason = specific.get("permissionDecisionReason") or value.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("missing denial reason")
        return denial(reason)
    if proc.returncode != 0 or value.get("decision") is not None or specific.get("permissionDecision") is not None:
        raise ValueError("inconsistent gate decision")
    # Only the existing empty allow / advisory protocol is accepted.
    if set(value) - {"hookSpecificOutput", "systemMessage"} or set(specific) - {"hookEventName", "additionalContext"}:
        raise ValueError("unknown gate output")
    if "systemMessage" in value and not isinstance(value["systemMessage"], str):
        raise ValueError("invalid system message")
    if specific and (specific.get("hookEventName") != "PreToolUse"
                     or not isinstance(specific.get("additionalContext"), str)):
        raise ValueError("invalid advisory")
    return value


def guardian_inputs(payload):
    if payload["tool_name"] != "apply_patch":
        return [payload]
    # Reuse tmp-block's existing patch header parser; project writes into the
    # guardian's existing Write path instead of inventing a second file policy.
    module_path = ROOT / "skills/golem-powers/tmp-block/hooks/tmp_block_impl/tool_targets.py"
    spec = importlib.util.spec_from_file_location("codex_patch_targets", module_path)
    module = importlib.util.module_from_spec(spec)
    output, errors = StringIO(), StringIO()
    with redirect_stdout(output), redirect_stderr(errors):
        spec.loader.exec_module(module)
    if output.getvalue() or errors.getvalue():
        raise ValueError("patch parser emitted unexpected output")
    command = payload["tool_input"]["command"]
    # Deleting a sensitive file is also a guardian file operation. tmp-block
    # still receives the original envelope and retains its delete allowance.
    command = command.replace("\n*** Delete File:", "\n*** Update File:")
    paths = [m.group(2) for m in module._APPLY_PATCH_TARGET_RE.finditer(command)]
    if len(paths) > 64:
        raise ValueError("patch budget exceeded")
    return [{**payload, "tool_name": "Write", "tool_input": {"file_path": p}} for p in paths]


def evaluate():
    started = time.monotonic()
    gate = sys.argv[1] if len(sys.argv) == 2 else None
    if gate not in TARGETS:
        raise ValueError("unknown gate")
    raw = sys.stdin.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("payload budget exceeded")
    p = json.loads(raw)
    if not isinstance(p, dict) or p.get("tool_name") not in ("Bash", "apply_patch"):
        raise ValueError("invalid tool")
    ti = p.get("tool_input")
    if not isinstance(ti, dict) or not isinstance(ti.get("command"), str):
        raise ValueError("invalid command")
    cwd = p.get("cwd", os.getcwd())
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or not os.path.isdir(cwd):
        raise ValueError("invalid cwd")
    # Native Codex Bash omits workdir from tool_input; tmp-block's patch path
    # resolver expects cwd there. Both child processes also start in that cwd.
    p = {**p, "tool_input": {**ti, "cwd": cwd}}
    env = os.environ.copy()
    # Preserve existing policy environment semantics, including the worker
    # exemption. Only the library source is fixed to hooks-live.
    env.pop("GIT_GUARDIAN_LIB", None)
    result = {}
    for item in guardian_inputs(p) if gate == "git-guardian" else [p]:
        remaining = 3 - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("gate budget exceeded")
        proc = subprocess.Popen([sys.executable, str(ROOT / TARGETS[gate])],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=cwd, env=env, start_new_session=True)
        try:
            stdout, stderr = proc.communicate(json.dumps(item), timeout=remaining)
        finally:
            # A broken gate must not leave descendants executing after denial.
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
        result = gate_result(subprocess.CompletedProcess(proc.args, proc.returncode, stdout, stderr))
        if result.get("hookSpecificOutput", {}).get("permissionDecision") == "deny":
            break
    return result


if __name__ == "__main__":
    def timeout(_signum, _frame):
        raise TimeoutError("adapter budget exceeded")

    signal.signal(signal.SIGALRM, timeout)
    signal.setitimer(signal.ITIMER_REAL, 3)
    try:
        result = evaluate()
    except BaseException:
        result = denial()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    print(json.dumps(result, separators=(",", ":")))

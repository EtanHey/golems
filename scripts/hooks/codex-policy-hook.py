#!/usr/bin/env python3
"""Codex transport for existing policy gates; no command-classification policy."""
import importlib.util
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import os
import re
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
    "then review /hooks from plain codex with no --profile."
)
BUDGET_SECONDS = 7
TIMEOUT_REASON = "BLOCKED: policy check timed out or patch is too large; split the patch or retry a smaller tool call."
PATCH_TRANSPORT_REASON = (
    "BLOCKED: shell-wrapped apply_patch requires a single literal patch with "
    "a resolvable cwd; use the native apply_patch tool."
)


class PatchTransportRefusal(ValueError):
    """Unsupported shell patch input, rather than a broken policy adapter."""


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


def load_parser(relative, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    output, errors = StringIO(), StringIO()
    with redirect_stdout(output), redirect_stderr(errors):
        spec.loader.exec_module(module)
    if output.getvalue() or errors.getvalue():
        raise ValueError("parser emitted unexpected output")
    return module


def transport_inputs(payload):
    command = payload["tool_input"]["command"]
    raw_names = re.findall(r"\bapply_?patch\b", command)
    if payload["tool_name"] != "Bash" or (not raw_names and "*** Begin Patch" not in command):
        return [payload]
    parser = load_parser("skills/golem-powers/_shared/shell_parse.py", "codex_shell_parser")
    tokens, positions, _, _ = parser._parse_bash(command)
    names = [token for i, token in enumerate(tokens)
             if positions[i] and token in ("apply_patch", "applypatch")]
    if not names:
        return [payload]
    # Codex intercepts shell heredocs after the Bash hook, without firing an
    # apply_patch hook. Decode transport only; both policies remain unchanged.
    if len(names) != 1 or command.count("*** Begin Patch") != 1 or command.count("*** End Patch") != 1:
        raise PatchTransportRefusal("ambiguous patch transport")
    cwd = payload["tool_input"]["cwd"]
    changes = [i for i, token in enumerate(tokens)
               if positions[i] and token in ("cd", "pushd", "popd", "chdir")]
    if changes:
        if changes != [0] or tokens[0] != "cd" or len(tokens) < 5 or tokens[2:4] != ["&", "&"]:
            raise PatchTransportRefusal("ambiguous patch cwd")
        target = tokens[1]
        # Codex's intercepted cd target is literal, not shell-expanded. Refuse
        # dynamic or escaped spellings instead of guessing another directory.
        prefix = command.split("&&", 1)[0]
        if not re.fullmatch(r"\s*cd[ \t]+(?:'[^'\n]+'|\"[^\"\n]+\"|[^\s;&|<>\"'()]+)[ \t]*", prefix):
            raise PatchTransportRefusal("ambiguous cd prefix")
        if target.startswith("-") or any(c in prefix for c in "$`\\~*?{["):
            raise PatchTransportRefusal("unresolved patch cwd")
        cwd = os.path.realpath(os.path.join(cwd, target))
        if not os.path.isdir(cwd):
            raise PatchTransportRefusal("invalid patch cwd")
    begin = command.index("*** Begin Patch")
    end = command.index("*** End Patch") + len("*** End Patch")
    prefix = command[:begin]
    # A heredoc body is literal in Codex's interceptor. Quoted multiline
    # arguments (here-string / printf pipe) use the existing shell tokenizer.
    head = prefix.rsplit("&&", 1)[-1] if changes else prefix
    heredoc = re.fullmatch(
        r"\s*apply_?patch[ \t]+<<-?[ \t]*(?P<quote>['\"]?)"
        r"(?P<delimiter>[A-Za-z_][A-Za-z0-9_]*)(?P=quote)[ \t]*\n[^\S\n]*", head)
    if heredoc:
        tail = command[end:]
        if not re.fullmatch(r"[ \t\r]*\n" + re.escape(heredoc["delimiter"]) + r"[ \t]*(?:\n\s*)?", tail):
            raise PatchTransportRefusal("ambiguous heredoc suffix")
        patch = command[begin:end]
    else:
        words = parser._shell_tokens(command)
        words = words[4:] if changes else words
        bodies = [token for token in words
                  if token.startswith("*** Begin Patch\n") and token.rstrip().endswith("*** End Patch")]
        if len(bodies) != 1 or any(c in bodies[0] for c in "$`\\"):
            raise PatchTransportRefusal("unresolved patch body")
        here_string = words == [names[0], "<<<", bodies[0]]
        printf_pipe = (len(words) == 5 and words[0] == "printf"
                       and words[1] in ("%s", "%s\\n", "%sn")
                       and words[2:] == [bodies[0], "|", names[0]])
        if not here_string and not printf_pipe:
            raise PatchTransportRefusal("ambiguous patch producer")
        patch = bodies[0].rstrip()
    lines = patch.split("\n")
    if len(lines) < 3 or lines[0].strip() != "*** Begin Patch" or lines[-1].strip() != "*** End Patch":
        raise PatchTransportRefusal("invalid patch body")
    synthetic = {**payload, "tool_name": "apply_patch", "cwd": cwd,
                 "tool_input": {"command": patch, "cwd": cwd}}
    return [payload, synthetic]


def guardian_inputs(payload):
    if payload["tool_name"] != "apply_patch":
        return [payload]
    # Reuse tmp-block's existing patch header parser; project writes into the
    # guardian's existing Write path instead of inventing a second file policy.
    module = load_parser("skills/golem-powers/tmp-block/hooks/tmp_block_impl/tool_targets.py", "codex_patch_targets")
    command = payload["tool_input"]["command"]
    # Deleting a sensitive file is also a guardian file operation. tmp-block
    # still receives the original envelope and retains its delete allowance.
    command = re.sub(r"(?m)^([^\S\n]*\*\*\*[^\S\n]+)Delete File:", r"\1Update File:", command)
    paths = list(dict.fromkeys(m.group(2) for m in module._APPLY_PATCH_TARGET_RE.finditer(command)))
    if len(paths) > 64:
        raise TimeoutError("patch budget exceeded")
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
    p = {**p, "cwd": cwd, "tool_input": {**ti, "cwd": cwd}}
    env = os.environ.copy()
    # Preserve existing policy environment semantics, including the worker
    # exemption. Only the library source is fixed to hooks-live.
    env.pop("GIT_GUARDIAN_LIB", None)
    result = {}
    inputs = transport_inputs(p)
    if gate == "git-guardian":
        inputs = [item for envelope in inputs for item in guardian_inputs(envelope)]
    for item in inputs:
        # Leave a cleanup margin: simultaneous child/global deadlines can throw
        # SIGALRM inside Popen.__del__, leaking an unraisable traceback to stderr.
        remaining = BUDGET_SECONDS - 1 - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("gate budget exceeded")
        proc = subprocess.Popen([sys.executable, str(ROOT / TARGETS[gate])],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=item["cwd"], env=env, start_new_session=True)
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
    signal.setitimer(signal.ITIMER_REAL, BUDGET_SECONDS)
    try:
        result = evaluate()
    except (TimeoutError, subprocess.TimeoutExpired):
        result = denial(TIMEOUT_REASON)
    except PatchTransportRefusal:
        result = denial(PATCH_TRANSPORT_REASON)
    except BaseException:
        result = denial()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    print(json.dumps(result, separators=(",", ":")))

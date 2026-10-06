#!/usr/bin/env python3
"""Codex transport for existing policy gates; no command-classification policy."""
import os
import sys

# AIDEV-NOTE: no hook dir is ever FIRST on sys.path, even when this file runs
# without the launcher: the stdlib must win over anything planted beside it.
_HOOK_DIR = os.path.dirname(os.path.realpath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) != _HOOK_DIR] + [_HOOK_DIR]

import importlib.util
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import os
import re
from pathlib import Path
import subprocess
import signal
import shlex
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
# Policy children get the Claude launcher's import hardening (-I -B, runpy
# preload, hook dir last). Its fail-open exit 0 + stderr is a denial here.
LAUNCHER = ROOT / "scripts/hooks/fail-open.py"
ISOLATED = ("-I", "-B")
TARGETS = {
    "tmp-block": "skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py",
    "git-guardian": "skills/golem-powers/git-guardian/hooks/pre_tool_use.py",
    "human-confirm": "skills/golem-powers/human-confirm-gate/hooks/human-confirm-pretooluse.py",
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


def desynced_patch_head(command):
    """Refuse a complete trailing patch heredoc despite lost command positions."""
    lines = command.split("\n")
    while lines and not lines[-1].strip():
        lines.pop()
    if len(lines) < 4:
        return False
    delimiter_line = lines[-1].lstrip("\t").rstrip("\r")
    end = len(lines) - 2
    while end >= 0 and not lines[end].strip():
        end -= 1
    # Codex's lenient parser also unwraps a literal EOF heredoc in the body.
    wrapped = (end > 0 and lines[end].rstrip().endswith("EOF")
               and lines[end - 1].strip() == "*** End Patch")
    if wrapped:
        end -= 1
    if end < 0 or lines[end].strip() != "*** End Patch":
        return False
    name = re.search(r"\bapply_?patch\b", command)
    if not name:
        return False
    # Match the intercepted body shape, not assignment or prefix grammar.
    # The caller enforces the shared 32 KiB limit; candidate count also bounds
    # delimiter decoding when quoted data contains many apparent operators.
    offset, previous, checked = 0, None, 0
    for index, line in enumerate(lines[:end]):
        start = line.strip() == "*** Begin Patch"
        if wrapped:
            start = (line.lstrip().rstrip("\r") in ("<<EOF", "<<'EOF'", '<<"EOF"')
                     and lines[index + 1].strip() == "*** Begin Patch")
        if start and previous is not None:
            head_offset, head = previous
            for op in re.finditer(r"(?<!<)<<-?(?!<)[ \t]*", head):
                if name.start() >= head_offset + op.start():
                    continue
                checked += 1
                if checked > 64:
                    raise TimeoutError("heredoc scan budget exceeded")
                raw = head[op.end():]
                # ANSI-C delimiter spelling is also recognized conservatively.
                if raw.startswith("$'"):
                    raw = raw[1:]
                lexer = shlex.shlex(raw, posix=True)
                lexer.whitespace_split = True
                lexer.commenters = ""
                try:
                    delimiter = lexer.get_token()
                except ValueError:
                    continue
                if (delimiter and delimiter_line.startswith(delimiter)
                        and not delimiter_line[len(delimiter):].strip(" \t\r")):
                    return True
        if line.strip():
            previous = (offset, line)
        offset += len(line) + 1
    return False


def transport_inputs(payload):
    command = payload["tool_input"]["command"]
    raw_names = re.findall(r"\bapply_?patch\b", command)
    if payload["tool_name"] != "Bash" or (not raw_names and "*** Begin Patch" not in command):
        return [payload]
    parser = load_parser("skills/golem-powers/_shared/shell_parse.py", "codex_shell_parser")
    if parser.policy_command_size_reason(command):
        raise TimeoutError("command size budget exceeded")
    tokens, positions, _, _ = parser._parse_bash(command)
    names = [token for i, token in enumerate(tokens)
             if positions[i] and token in ("apply_patch", "applypatch")]
    if not names:
        if desynced_patch_head(command):
            raise PatchTransportRefusal("unresolved patch command position")
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


_PATCH_FILE = re.compile(r"\*\*\*[^\S\n]+(Add|Update|Delete) File:[^\S\n]*(.+?)[^\S\n]*")
_PATCH_MOVE = re.compile(r"\*\*\*[^\S\n]+Move to:[^\S\n]*(.+?)[^\S\n]*")
CONFIG_PATCH_REASON = (
    "BLOCKED: a patch to a git config file must apply exactly to its current "
    "content; re-read the file and send an exact patch."
)
_CONFIG_BYTES = 1024 * 1024


class ConfigPatchRefusal(ValueError):
    """A git config patch whose real result cannot be computed exactly."""


def _patch_files(text):
    """The patch's file sections, parsed the way Codex's apply_patch parses them."""
    files = []
    for raw in text.split("\n"):
        line = raw.rstrip("\r")
        marker = line.strip()
        header = _PATCH_FILE.fullmatch(marker)
        if header:
            files.append({"op": header.group(1), "path": header.group(2), "added": [], "move": None,
                          "chunks": [], "invalid": False})
            continue
        if not files or marker in ("*** Begin Patch", "*** End Patch"):
            continue
        f = files[-1]
        if f["op"] == "Add":
            if line.startswith("+"):
                f["added"].append(line[1:])
            continue
        if f["op"] != "Update":
            continue
        move = _PATCH_MOVE.fullmatch(marker)
        chunk = f["chunks"][-1] if f["chunks"] else None
        if move and not f["chunks"] and f["move"] is None:
            f["move"] = move.group(1)
        elif marker == "@@" or marker.startswith("@@ "):
            f["chunks"].append({"ctx": marker[3:] if marker != "@@" else None, "old": [], "new": [], "eof": False})
        elif marker == "*** End of File" and chunk:
            chunk["eof"] = True
        elif line == "" or line[0] in " +-":
            if chunk is None:
                chunk = {"ctx": None, "old": [], "new": [], "eof": False}
                f["chunks"].append(chunk)
            kind, body = (" ", "") if line == "" else (line[0], line[1:])
            if kind != "+":
                chunk["old"].append(body)
            if kind != "-":
                chunk["new"].append(body)
            f["added"].extend([body] if kind == "+" else [])
        else:
            f["invalid"] = True
    return files


def _seek(lines, pattern, start, eof):
    """Codex's seek_sequence, exact pass only: a looser match is not trusted."""
    if not pattern:
        return start
    if len(pattern) > len(lines):
        return None
    begin = len(lines) - len(pattern) if eof else start
    for i in range(begin, len(lines) - len(pattern) + 1):
        if lines[i:i + len(pattern)] == pattern:
            return i
    return None


def _apply_chunks(text, chunks):
    """The real post-patch text (Codex's compute/apply_replacements), or None."""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    replacements, index = [], 0
    for chunk in chunks:
        if chunk["ctx"] is not None:
            found = _seek(lines, [chunk["ctx"]], index, False)
            if found is None:
                return None
            index = found + 1
        if not chunk["old"]:
            replacements.append((len(lines) - 1 if lines and lines[-1] == "" else len(lines), 0, chunk["new"]))
            continue
        pattern, new = chunk["old"], chunk["new"]
        found = _seek(lines, pattern, index, chunk["eof"])
        if found is None and pattern[-1] == "":
            pattern = pattern[:-1]
            new = new[:-1] if new and new[-1] == "" else new
            found = _seek(lines, pattern, index, chunk["eof"])
        if found is None:
            return None
        replacements.append((found, len(pattern), new))
        index = found + len(pattern)
    for start, length, new in sorted(replacements, key=lambda r: r[0], reverse=True):
        lines[start:start + length] = new
    if not lines or lines[-1] != "":
        lines.append("")
    return "\n".join(lines)


def _read_text(path):
    try:
        with open(path, "rb") as stream:
            data = stream.read(_CONFIG_BYTES + 1)
    except OSError:
        return None
    return None if len(data) > _CONFIG_BYTES else data.decode("utf-8", errors="replace")


def confirm_inputs(payload):
    """Project an apply_patch onto the Write/Edit shapes human-confirm already judges.

    The gate would read a raw patch's text as a shell command, so a patch never
    reaches it as such. Add -> Write of the new file; Delete -> Write of the path
    (the policy-store check is path-based). An Update (and a Move) is applied to
    the current file the way Codex applies it, exactly, and judged as a Write of
    the REAL result: git config policy depends on section context and removed
    lines, not on the added lines alone (#693 R1 F1). An Update that cannot be
    applied exactly is denied when the source or destination is a git config
    file, and otherwise falls back to a path-only projection."""
    if payload["tool_name"] != "apply_patch":
        return [payload]
    cwd = payload["cwd"]
    files = _patch_files(payload["tool_input"]["command"])
    if len(files) > 64:
        raise TimeoutError("patch budget exceeded")
    config = None

    def is_config(target):
        nonlocal config
        if config is None:
            config = load_parser("skills/golem-powers/human-confirm-gate/hooks/git_config.py", "codex_confirm_git_config")
        return config._config_file(os.path.realpath(os.path.join(cwd, target)), cwd)

    write = lambda path, content: {**payload, "tool_name": "Write", "tool_input": {"file_path": path, "content": content}}
    items = []
    for f in files:
        if f["op"] == "Add":
            items.append(write(f["path"], "".join(t + "\n" for t in f["added"])))
            continue
        if f["op"] == "Delete":
            items.append(write(f["path"], ""))
            continue
        current = _read_text(os.path.join(cwd, f["path"]))
        result = None if current is None or f["invalid"] or not f["chunks"] else _apply_chunks(current, f["chunks"])
        if result is None:
            if is_config(f["path"]) or (f["move"] and is_config(f["move"])):
                raise ConfigPatchRefusal("git config patch does not apply exactly")
            added = "".join(t + "\n" for t in f["added"])
            items.append({**payload, "tool_name": "Edit",
                          "tool_input": {"file_path": f["path"], "old_string": "", "new_string": added}})
            if f["move"]:
                items.append(write(f["move"], added))
            continue
        if f["move"]:
            items += [write(f["path"], ""), write(f["move"], result)]
        else:
            items.append(write(f["path"], result))
    return items


def guardian_batch():
    """Amortize imports, retaining the existing entry point for every write."""
    raw = sys.stdin.read(1024 * 1024 + 1)
    items = json.loads(raw)
    if len(raw) > 1024 * 1024 or not isinstance(items, list) or not 1 <= len(items) <= 64:
        raise ValueError("invalid policy batch")
    os.environ.pop("GIT_GUARDIAN_LIB", None)
    gate = load_parser(TARGETS["git-guardian"], "codex_guardian")
    result = {}
    for item in items:
        if (not isinstance(item, dict) or item.get("tool_name") != "Write"
                or not isinstance(item.get("cwd"), str)
                or not os.path.samefile(item["cwd"], ".")):
            raise ValueError("invalid batch item")
        ti = item.get("tool_input")
        if not isinstance(ti, dict) or not isinstance(ti.get("file_path"), str):
            raise ValueError("invalid batch target")
        output, errors = StringIO(), StringIO()
        original_stdin = sys.stdin
        try:
            sys.stdin = StringIO(json.dumps(item))
            with redirect_stdout(output), redirect_stderr(errors):
                try:
                    gate.main()
                except SystemExit as exc:
                    code = exc.code
                else:
                    raise ValueError("gate did not exit")
        finally:
            sys.stdin = original_stdin
        result = gate_result(subprocess.CompletedProcess([], code, output.getvalue(), errors.getvalue()))
        if result.get("hookSpecificOutput", {}).get("permissionDecision") == "deny":
            break
    return result


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
    items = transport_inputs(p)
    if gate == "human-confirm":
        items = [projected for item in items for projected in confirm_inputs(item)]
    for item in items:
        command = [sys.executable, *ISOLATED, str(LAUNCHER), str(ROOT / TARGETS[gate])]
        data = item
        if gate == "git-guardian" and item["tool_name"] == "apply_patch":
            data = guardian_inputs(item)
            if not data:
                continue
            command = [sys.executable, *ISOLATED, str(Path(__file__).resolve()), "--guardian-batch"]
        # Leave a cleanup margin: simultaneous child/global deadlines can throw
        # SIGALRM inside Popen.__del__, leaking an unraisable traceback to stderr.
        remaining = BUDGET_SECONDS - 1 - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("gate budget exceeded")
        proc = subprocess.Popen(command,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=item["cwd"], env=env, start_new_session=True)
        try:
            stdout, stderr = proc.communicate(json.dumps(data), timeout=remaining)
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
        result = guardian_batch() if sys.argv[1:] == ["--guardian-batch"] else evaluate()
    except (TimeoutError, subprocess.TimeoutExpired):
        result = denial(TIMEOUT_REASON)
    except PatchTransportRefusal:
        result = denial(PATCH_TRANSPORT_REASON)
    except ConfigPatchRefusal:
        result = denial(CONFIG_PATCH_REASON)
    except BaseException:
        result = denial()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    print(json.dumps(result, separators=(",", ":")))

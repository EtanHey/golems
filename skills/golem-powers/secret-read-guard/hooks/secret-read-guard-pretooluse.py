#!/usr/bin/env python3
"""Fail-closed PreToolUse gate: refuse tool calls that would print a secret.

Claude runs it on Bash, Monitor, Read and Grep; Codex runs it on Bash through
scripts/hooks/codex-policy-hook.py. The secret list is data
(../secret-files.json); the masked reader (../scripts/masked-read.py) is the
only sanctioned way to look at a listed file.
"""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) != _HERE] + [_HERE]

import fnmatch
import json
import stat
from datetime import datetime
from hashlib import sha256
from pathlib import Path


def masked_reader_hint():
    from secret_paths import MASKED_READER
    return (f"To look at such a file, use the masked reader: python3 {MASKED_READER} <file> "
            "(it prints the file's structure with every value replaced by <redacted len=N sha=...>).")


def deny(reason, text=None, rule="secret-read"):
    entry = {"ts": datetime.now().astimezone().isoformat(),
             "input_sha256": sha256((text or "").encode("utf-8", errors="surrogatepass")).hexdigest(),
             "rule": rule}
    try:
        ledger = os.path.expanduser(os.environ.get(
            "SECRET_READ_GUARD_LEDGER", "~/.claude/logs/secret-read-guard-ledger.jsonl"))
        os.makedirs(os.path.dirname(ledger), exist_ok=True)
        fd = os.open(ledger, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise OSError("ledger must be a regular file")
            line = (json.dumps(entry) + "\n").encode()
            os.write(fd, line)
        finally:
            os.close(fd)
    except OSError:
        pass
    try:
        hint = masked_reader_hint()
    except Exception:
        hint = "Use the golems masked reader (secret-read-guard/scripts/masked-read.py) instead."
    message = f"Blocked: {reason}. {hint}"
    print(json.dumps({"decision": "block", "reason": message, "hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": message}}))
    return 2


def judge_bash(command, cwd, secrets, home):
    sys.path.append(str(Path(_HERE).parents[1] / "_shared"))
    import shell_parse
    import secret_shell
    ctx = secret_shell.Context(shell_parse, secrets, home)
    if shell_parse.policy_command_size_reason(command):
        lowered = command.lower()
        keywords = ["auth.json", ".env", "settings", ".cli-proxy-api", "cliproxyapi", "tokenlayer",
                    ".config/golems", "t3-eval-homes", "environ", "security", "printenv", "launchctl",
                    *secrets.helpers]
        return secret_shell.REASON_SIZE if any(k in lowered for k in keywords) else None
    with shell_parse.policy_evaluation_deadline():
        return secret_shell.judge(ctx, command, [cwd])


def judge_read(path, cwd, secrets):
    absolute = os.path.normpath(os.path.join(cwd, os.path.expanduser(path)))
    if secrets.is_secret(absolute, assume_exists=True):
        return f"it would print a file that holds a secret ({absolute})"
    return None


def judge_grep(tool_input, cwd, secrets, home):
    if (tool_input.get("output_mode") or "files_with_matches") != "content":
        return None  # file names and counts only
    sys.path.append(str(Path(_HERE).parents[1] / "_shared"))
    import shell_parse
    import secret_shell
    ctx = secret_shell.Context(shell_parse, secrets, home)
    path = tool_input.get("path") or cwd
    if not isinstance(path, str):
        raise ValueError("Grep path must be a string")
    absolute = os.path.normpath(os.path.join(cwd, os.path.expanduser(path)))
    if secrets.is_secret(absolute, assume_exists=True):
        return f"it would print lines of a file that holds a secret ({absolute})"
    if secret_shell._search_hits_root(ctx, absolute):
        return secret_shell.REASON_SEARCH.format(path=absolute)
    pattern = tool_input.get("glob")
    if isinstance(pattern, str) and pattern:
        base = os.path.basename(pattern)
        if secrets.name_mentioned(base) or any(fnmatch.fnmatchcase(base, p) or fnmatch.fnmatchcase(p, base)
                                               for p in secrets.json_env_names):
            return f"it would print lines of files matching {pattern}, which hold secrets"
    return None


def main():
    text, stage = None, "payload"
    try:
        raw = sys.stdin.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("payload exceeds inspection limit")
        stage = "JSON"
        payload = json.loads(raw)
        stage = "payload"
        if not isinstance(payload, dict) or not isinstance(payload.get("tool_name"), str):
            raise ValueError("invalid tool payload")
        tool = payload["tool_name"]
        if tool not in ("Bash", "Monitor", "Read", "Grep"):
            print("{}")
            return 0
        tool_input = payload.get("tool_input")
        if not isinstance(tool_input, dict):
            raise ValueError("tool_input must be an object")
        cwd = payload.get("cwd") or tool_input.get("cwd") or os.getcwd()
        if not isinstance(cwd, str) or not os.path.isabs(cwd):
            raise ValueError("cwd must be an absolute path")
        home = os.path.normpath(os.environ.get("HOME") or os.path.expanduser("~"))
        stage = "secret list"
        import secret_paths
        secrets = secret_paths.load(home)
        stage = tool
        if tool in ("Bash", "Monitor"):
            text = tool_input.get("command")
            if not isinstance(text, str):
                raise ValueError("command must be a string")
            reason = judge_bash(text, cwd, secrets, home)
        elif tool == "Read":
            text = tool_input.get("file_path")
            if not isinstance(text, str):
                raise ValueError("file_path must be a string")
            reason = judge_read(text, cwd, secrets)
        else:
            text = json.dumps(tool_input, sort_keys=True)
            reason = judge_grep(tool_input, cwd, secrets, home)
        if reason:
            return deny(reason, text)
        print("{}")
        return 0
    except BaseException as exc:  # noqa: BLE001 - fail closed, including the policy deadline
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        cause = str(exc)[:80] if type(exc) is ValueError else type(exc).__name__
        return deny(f"secret-read-guard could not check this call ({stage}: {cause}), so it fails closed. "
                    "Split the command or name files literally", text, "parse-error")


if __name__ == "__main__":
    sys.exit(main())

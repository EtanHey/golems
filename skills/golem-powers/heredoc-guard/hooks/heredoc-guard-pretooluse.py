#!/usr/bin/env python3
"""Fail-closed Claude PreToolUse gate; Codex uses the shared policy adapter."""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) != _HERE] + [_HERE]

import json
from datetime import datetime
from hashlib import sha256
import stat


def deny(reason, command=None, rule="parse-error", short_reason="invalid payload"):
    entry = {"ts": datetime.now().astimezone().isoformat(),
             "command_sha256": sha256((command or "").encode("utf-8", errors="surrogatepass")).hexdigest(),
             "rule": rule, "reason": short_reason}
    try:
        ledger = os.path.expanduser(os.environ.get(
            "HEREDOC_GUARD_LEDGER", "~/.claude/logs/heredoc-guard-ledger.jsonl"))
        os.makedirs(os.path.dirname(ledger), exist_ok=True)
        fd = os.open(ledger, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise OSError("ledger must be a regular file")
            line = (json.dumps(entry) + "\n").encode()
            if os.write(fd, line) != len(line):
                raise OSError("incomplete ledger record")
        finally:
            os.close(fd)
    except OSError:
        pass
    reason = "Blocked: this command hides a second command inside a here-document, so it can't be checked. Quote the marker (<<'EOF') or run that command on its own."
    print(json.dumps({"decision": "block", "reason": reason, "hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": reason}}))
    return 2


def main():
    command, stage = None, "payload"
    try:
        raw = sys.stdin.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("payload exceeds inspection limit")
        stage = "JSON"
        payload = json.loads(raw)
        stage = "payload"
        if not isinstance(payload, dict) or not isinstance(payload.get("tool_name"), str):
            raise ValueError("invalid tool payload")
        if payload["tool_name"] != "Bash":
            print("{}")
            return 0
        inputs = payload.get("tool_input")
        if not isinstance(inputs, dict) or not isinstance(inputs.get("command"), str):
            raise ValueError("Bash command must be a string")
        command = inputs["command"]
        stage = "parser import"
        from heredoc_parser import unsafe_delimiter

        stage = "shell"
        delimiter = unsafe_delimiter(command)
        if delimiter is not None:
            # JSON spelling keeps even newline/control-bearing delimiters on one line.
            word = json.dumps(delimiter, ensure_ascii=True)[1:-1]
            return deny(f"heredoc-guard: unquoted heredoc <<{word} contains command substitution "
                        f"(` or $( ); quote the delimiter (<<'{word}'); if you need a value, "
                        "compute it first (v=$(cmd)) on its own line before the heredoc, then use $v in the body. "
                        "Incident: a backticked command in a heredoc ran on the host.",
                        command, "command-substitution", "unquoted heredoc command substitution")
        print("{}")
        return 0
    except Exception as exc:
        # Parser ValueErrors contain only static causes, never shell text.
        cause = str(exc)[:80] if type(exc) is ValueError else type(exc).__name__
        detail = f"{stage}: {cause}"
        return deny(f"heredoc-guard: parse error ({detail}); "
                    "Use valid shell syntax and plain quoted heredoc delimiters (<<'EOF').",
                    command, "parse-error", detail)


if __name__ == "__main__":
    sys.exit(main())

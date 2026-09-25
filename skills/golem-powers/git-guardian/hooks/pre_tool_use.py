#!/usr/bin/env python3
"""
PreToolUse hook: permission routing.

GREEN / YELLOW: allow. RED: block (dangerous rm, forced push, railway down,
destructive SQL, writes into secret files).

GO-5 E2 removed the unrotated permissions_audit.jsonl (136.8 MB), the Telegram
`notify` call (never on PATH), the disabled P9 sleep gate, and the Task
tracker (E1: agent_states that nothing read).
"""

import json
import sys
import os
import re

# GO-5 PR-2b: git_safety comes from THIS hook's tree (hooks-live when installed
# by scripts/hooks/install-hooks.sh), never the main checkout, so a pull or a
# branch switch there cannot change a live guard. realpath follows the
# ~/.claude/hooks/pre_tool_use.py symlink. GIT_GUARDIAN_LIB overrides (review sandboxes).
GIT_GUARDIAN_LIB = os.environ.get("GIT_GUARDIAN_LIB") or os.path.dirname(
    os.path.dirname(os.path.realpath(__file__))
)
if GIT_GUARDIAN_LIB not in sys.path:
    sys.path.insert(0, GIT_GUARDIAN_LIB)
from git_safety import dangerous_shell_reason, shell_text_without_heredoc_bodies


# --- Permission Classification ---

# GREEN: safe, read-only operations — no logging needed
GREEN_TOOLS = {"Read", "Grep", "Glob", "WebSearch", "WebFetch", "TaskList", "TaskGet"}

# Commands that are always GREEN
GREEN_COMMANDS = {
    "git status", "git log", "git diff", "git branch", "git show",
    "git fetch", "bun test", "bun --version", "node --version",
    "python3 --version", "ls", "pwd", "which", "notify",
}

# RED: destructive SQL DDL — matched as REAL SQL statements (word-boundaried +
# required object keyword), NOT bare substrings. This stops benign English like
# "truncated"/"dropped" and search/grep text from false-positiving, while still
# catching real `psql -c "TRUNCATE TABLE x"` / `sqlite3 db "DROP TABLE y"`.
RED_SQL_REGEXES = [
    (r"\bdrop\s+table\b", "DROP TABLE"),
    (r"\bdrop\s+database\b", "DROP DATABASE"),
    (r"\btruncate\s+table\b", "TRUNCATE TABLE"),
]


# RED: file access patterns — matched as file paths, not substrings.
# Uses regex to avoid false positives on inline code (e.g. process.env.API_KEY).
RED_FILE_REGEXES = [
    r'(?:^|\s|/|")\.env(?!\.example)(?:\s|$|\.|\b)',  # .env, .env.local — but NOT .env.example
    r'(?:^|\s|/)credentials\.\w+',              # credentials.json (not GOOGLE_CREDENTIALS)
    r'(?:^|\s|/)secrets?\.\w+',                 # secret.yaml, secrets.json
    r'\S+\.pem(?:\s|$|")',                       # *.pem files
    r'\S+\.key(?:\s|$|")',                       # *.key files
]

# A shell redirect (`>`, `>>`) whose target is a secret file, whatever writes it.
# GO-5: `echo x > credentials.json` passed the old substring op check ("echo >").
RED_REDIRECT_RE = re.compile(
    r'>{1,2}\s*["\']?(?:\S*/)?(?:\.env(?!\.example)[\w.-]*|credentials\.\w+|secrets?\.\w+|[\w.-]+\.pem|[\w.-]+\.key)(?:["\'\s;&|)]|$)'
)


def classify_tool(tool_name, tool_input):
    """Classify tool call as GREEN, YELLOW, or RED."""

    # GREEN tools
    if tool_name in GREEN_TOOLS:
        return "GREEN", None

    # Bash commands need deeper inspection
    if tool_name == "Bash":
        raw_command = tool_input.get("command", "")
        guardian_reason = dangerous_shell_reason(raw_command)
        if guardian_reason:
            reason = (
                guardian_reason
                if guardian_reason.startswith("Dangerous command:")
                else f"Dangerous command: {guardian_reason}"
            )
            return "RED", reason
        command = shell_text_without_heredoc_bodies(raw_command)

        # Check destructive SQL DDL (real-SQL-shaped match — avoids 'truncated' etc.)
        for sql_re, label in RED_SQL_REGEXES:
            if re.search(sql_re, command, re.IGNORECASE):
                return "RED", f"Dangerous command: {label}"

        # Check for sensitive file access in write context
        # Skip inline code execution (bun -e, node -e, python -c)
        stripped = command.strip()
        is_inline_code = bool(re.match(
            r'^(bun|node|deno|npx|tsx)\s+(-e|--eval)\s+', stripped
        )) or bool(re.match(r'^python3?\s+-c\s+', stripped))

        if not is_inline_code and RED_REDIRECT_RE.search(command):
            return "RED", f"Sensitive file operation: {command[:80]}"
        if not is_inline_code and any(re.search(p, command) for p in RED_FILE_REGEXES):
            if any(op in command for op in ["cat >", "echo >", "write ", "cp ", "mv ", "rm "]):
                return "RED", f"Sensitive file operation: {command[:80]}"

        # GREEN commands
        for green_cmd in GREEN_COMMANDS:
            if command.strip().startswith(green_cmd):
                return "GREEN", None

        # YELLOW: everything else in Bash
        return "YELLOW", None

    # Edit/Write are YELLOW
    if tool_name in ("Edit", "Write", "NotebookEdit"):
        file_path = tool_input.get("file_path", "")
        basename = os.path.basename(file_path)
        # RED if touching sensitive files
        if any(re.search(p, basename) for p in RED_FILE_REGEXES):
            return "RED", f"Editing sensitive file: {file_path}"
        return "YELLOW", None

    # Default: YELLOW for unknown tools
    return "YELLOW", None


def main():
    if os.environ.get("CLAUDE_WORKER"):
        json.dump({}, sys.stdout)
        sys.exit(0)

    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError:
        json.dump({}, sys.stdout)
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Classify the tool call
    classification, reason = classify_tool(tool_name, tool_input)

    if classification != "RED":
        json.dump({}, sys.stdout)
        sys.exit(0)

    result_reason = (
        f"BLOCKED: {reason or 'Dangerous operation detected'}. FLAG THIS TO THE USER as a "
        "surprise — do NOT retry the same command. Explain what you were trying to do "
        "and ask the user how to proceed."
    )
    json.dump({"decision": "block", "reason": result_reason}, sys.stdout)
    sys.exit(2)


if __name__ == "__main__":
    main()

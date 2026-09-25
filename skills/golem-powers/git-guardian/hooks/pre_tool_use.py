#!/usr/bin/env python3
"""
PreToolUse hook — permission routing + subagent tracking.

GREEN (auto-approve): Read, Grep, Glob, git status/log/diff, bun test
YELLOW (log + allow): Edit, Write, git commit, bun install
RED (block + notify): dangerous rm, git push --force, railway down, .env access

Also tracks when Task (subagent) tools are spawned.
"""

import json
import sys
import os
import re
import time
import fcntl
import subprocess
from datetime import datetime

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

STATE_DIR = os.path.expanduser("~/.claude/agent_states")
AUDIT_LOG = os.path.expanduser("~/.claude/permissions_audit.jsonl")
SLEEP_HISTORY_FILE = "/tmp/claude-pre-tool-use-sleep-history.json"
SLEEP_WINDOW_S = 60
SLEEP_CHAIN_THRESHOLD = 2

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


# P9: Sleep-poll enforcement. Blocks `sleep N` chains and individual `sleep N≥5`.
# Exempts recommended replacement patterns (until-kill PID-watch, nohup-background launch)
# and strips quoted strings to avoid grep/pgrep/echo false positives.
_SLEEP_ANY_RE = re.compile(r'\bsleep\s+\d+(?:\.\d+)?')
_SLEEP_LONG_RE = re.compile(r'\bsleep\s+([5-9]|\d{2,})(?:\.\d+)?\b')
_UNTIL_KILL_RE = re.compile(r'\buntil\b.*\bkill\s+-0\b', re.DOTALL)
# nohup-backgrounded sleep launch: nohup ... sleep N ... &
# - sleep must sit between nohup and &  (same shell statement, no ; | newline separator)
# - the & must be true backgrounding: NOT &&, NOT 2>&1 redirect, NOT &<digit>
_NOHUP_BG_RE = re.compile(
    r'\bnohup\b[^;|\n]*?\bsleep\s+\d+(?:\.\d+)?[^;|\n]*?(?<!&)(?<!>)&(?!&)(?!\d)'
)


def _strip_quoted(cmd):
    """Replace contents of single/double quoted strings with spaces.

    Avoids false positives where the sleep keyword is part of a search pattern
    or log/commit message: `pgrep -af "sleep 90"`, `grep "sleep 5"`, `echo "I
    need sleep 8 hours"`, `git commit -m "fix sleep 60 race"`. Preserves overall
    length so any position-sensitive regex still lines up with the original.
    """
    out = []
    i = 0
    in_quote = None
    while i < len(cmd):
        c = cmd[i]
        if in_quote is not None:
            if c == '\\' and i + 1 < len(cmd):
                out.append('  ')
                i += 2
                continue
            if c == in_quote:
                in_quote = None
                out.append(c)
                i += 1
                continue
            out.append(' ')
            i += 1
        else:
            if c in ('"', "'"):
                in_quote = c
                out.append(c)
                i += 1
                continue
            out.append(c)
            i += 1
    return ''.join(out)


def check_sleep_chain(command):
    """Block bare `sleep N≥5` and 2+ sleep-containing Bash calls within a 60s window.

    Returns (blocked: bool, reason: str | None).

    Strip-quoted-first means quoted matches (pgrep/grep/echo/commit-msg) don't
    trigger. Exemptions skip both detection AND history append, so the
    recommended patterns never pollute the chain counter:
      - `until ... kill -0 ...` (PID-watch — the canonical replacement)
      - `nohup ... sleep N ... &` (background process launch — not a blocking wait;
        & must be true backgrounding, not && and not 2>&1)
    """
    scan = _strip_quoted(command)
    if not _SLEEP_ANY_RE.search(scan):
        return False, None
    if _UNTIL_KILL_RE.search(scan) or _NOHUP_BG_RE.search(scan):
        return False, None

    now = time.time()
    history = []
    if os.path.exists(SLEEP_HISTORY_FILE):
        try:
            with open(SLEEP_HISTORY_FILE) as f:
                history = json.load(f)
            if not isinstance(history, list):
                history = []
        except (OSError, json.JSONDecodeError):
            history = []
    history = [t for t in history if isinstance(t, (int, float)) and now - t < SLEEP_WINDOW_S]
    history.append(now)
    try:
        with open(SLEEP_HISTORY_FILE, "w") as f:
            json.dump(history, f)
    except OSError:
        pass

    alt_guidance = (
        "Use `mcp__cmux__wait_for(agent_id=...)` for cmux workers, `Monitor` for log/PID streams, "
        "`wait $PID` for a backgrounded child process, "
        "or `until ! kill -0 $PID 2>/dev/null; do sleep 2; done` for PID-watch. "
        "Reset history: rm /tmp/claude-pre-tool-use-sleep-history.json"
    )

    if len(history) >= SLEEP_CHAIN_THRESHOLD:
        return True, (
            f"🚨 SLEEP-CHAIN BLOCKED — {len(history)} sleep-containing Bash calls in {SLEEP_WINDOW_S}s. "
            + alt_guidance
        )
    if _SLEEP_LONG_RE.search(scan):
        return True, "🚨 SLEEP ≥5s BLOCKED — bare `sleep N≥5` is never the right wait primitive. " + alt_guidance
    return False, None


# RED: file access patterns — matched as file paths, not substrings.
# Uses regex to avoid false positives on inline code (e.g. process.env.API_KEY).
RED_FILE_REGEXES = [
    r'(?:^|\s|/|")\.env(?!\.example)(?:\s|$|\.|\b)',  # .env, .env.local — but NOT .env.example
    r'(?:^|\s|/)credentials\.\w+',              # credentials.json (not GOOGLE_CREDENTIALS)
    r'(?:^|\s|/)secrets?\.\w+',                 # secret.yaml, secrets.json
    r'\S+\.pem(?:\s|$|")',                       # *.pem files
    r'\S+\.key(?:\s|$|")',                       # *.key files
]


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

        # P9: Sleep-poll enforcement (sliding window + N≥5 threshold)
        # AIDEV-NOTE (orc, 2026-09-24): P9 disabled. Its history file was shared fleet-wide in /tmp, so
        # any 2 sleeps across ALL seats within 60s blocked each other, and it blocked the
        # `until …; do sleep 5; done` loop Claude Code itself recommends. Claude Code already
        # blocks bare long sleeps natively. Etan: "you see why I dont love the hooks that much?"
        # sleep_blocked, sleep_reason = check_sleep_chain(command)
        # if sleep_blocked:
        #     return "RED", sleep_reason

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

    # Task tool — track subagent, classify as YELLOW
    if tool_name == "Task":
        return "YELLOW", None

    # Default: YELLOW for unknown tools
    return "YELLOW", None


def log_audit(tool_name, tool_input, classification, reason, session_id):
    """Append to permissions audit log."""
    entry = {
        "timestamp": datetime.now().isoformat(),
        "session_id": session_id,
        "tool": tool_name,
        "classification": classification,
        "reason": reason,
    }

    # Include command for Bash, file_path for Edit/Write
    if tool_name == "Bash":
        cmd = tool_input.get("command", "")
        entry["command"] = cmd[:200]  # Truncate for log size
    elif tool_name in ("Edit", "Write"):
        entry["file_path"] = tool_input.get("file_path", "")

    try:
        with open(AUDIT_LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError:
        pass


def send_telegram_alert(message):
    """Send Telegram notification for RED blocks."""
    try:
        subprocess.run(
            ["notify", "BLOCKED", message],
            capture_output=True,
            timeout=5,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass


# --- Subagent Tracking (existing functionality) ---

def get_state_file(session_id):
    return os.path.join(STATE_DIR, f"agent_state_{session_id}.json")

def atomic_update_state(session_id, update_fn):
    """Atomically read, modify, and write state using file locking."""
    os.makedirs(STATE_DIR, exist_ok=True)
    lock_path = os.path.join(STATE_DIR, f".lock_{session_id}")
    state_file = get_state_file(session_id)

    with open(lock_path, 'w') as lock_f:
        fcntl.flock(lock_f.fileno(), fcntl.LOCK_EX)
        try:
            try:
                with open(state_file, 'r') as f:
                    state = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                state = {"running": [], "completed": []}
            new_state = update_fn(state)
            with open(state_file, 'w') as f:
                json.dump(new_state, f, indent=2)
            return new_state
        finally:
            pass


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
    session_id = hook_input.get("session_id", "unknown")

    # Classify the tool call
    classification, reason = classify_tool(tool_name, tool_input)

    # GREEN: skip silently
    if classification == "GREEN":
        json.dump({}, sys.stdout)
        sys.exit(0)

    # YELLOW: log and allow
    if classification == "YELLOW":
        log_audit(tool_name, tool_input, "YELLOW", reason, session_id)

        # Track subagent spawning (existing behavior)
        if tool_name == "Task":
            description = tool_input.get("description", "Agent")
            subagent_type = tool_input.get("subagent_type", "")
            agent_id = f"{session_id}_{datetime.now().strftime('%H%M%S%f')}"

            def add_agent(state):
                state["running"].append({
                    "id": agent_id,
                    "description": description,
                    "type": subagent_type,
                    "started": datetime.now().strftime("%H:%M:%S")
                })
                return state

            atomic_update_state(session_id, add_agent)

        json.dump({}, sys.stdout)
        sys.exit(0)

    # RED: block + notify + log
    if classification == "RED":
        log_audit(tool_name, tool_input, "RED", reason, session_id)
        send_telegram_alert(reason or f"Blocked {tool_name}")

        # Sleep blocks are self-correcting — the agent should retry with the alternative.
        # Other RED blocks (rm -rf, .env, force-push) need a surprise-flag to the user.
        reason_str = reason or "Dangerous operation detected"
        if reason_str.startswith("🚨 SLEEP"):
            result_reason = (
                reason_str
                + " SELF-CORRECT: pick one of the alternatives above and retry. Do NOT "
                "ask the user — this is a routine reroute, not a surprise."
            )
        else:
            result_reason = (
                f"BLOCKED: {reason_str}. FLAG THIS TO THE USER as a surprise — "
                "do NOT retry the same command. Explain what you were trying to do "
                "and ask the user how to proceed."
            )

        result = {"decision": "block", "reason": result_reason}
        json.dump(result, sys.stdout)
        sys.exit(2)


if __name__ == "__main__":
    main()

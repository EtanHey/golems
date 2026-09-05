#!/usr/bin/env python3
"""
Golems project hook: block dangerous and incorrect commands.

Deterministic enforcement of rules that were previously in CLAUDE.md / .claude/rules/*.md.
Hooks can't be bypassed by the LLM — they run before the tool executes.

Exit codes:
  0 = allow
  2 = block (with JSON reason on stdout)

Environment:
  AUTONOMOUS=1  — bypasses git push/commit blocks even on main/master

Branch safety:
  Feature branches: git push/commit ALLOWED automatically (agents are autonomous on feature branches)
  main/master: git push/commit BLOCKED unless AUTONOMOUS=1

Rules enforced:
  1. git push on main/master without AUTONOMOUS=1 → BLOCK
  2. git commit on main/master without AUTONOMOUS=1 → BLOCK
  3. npm commands → BLOCK (use bun)
  4. python (not python3) → BLOCK
  5. Chrome/Brave → BLOCK (use Helium; Safari allowed for OAuth popups)
  6. git status -uall → BLOCK
  7. Supabase DDL via execute_sql → BLOCK (use apply_migration)
  8. Kilo in blocked directories → BLOCK

Source rules (now enforced by hook, removed from rule files):
  - ~/.claude/CLAUDE.md: commit rules, tool preferences
  - .claude/rules/tech-supabase.md: DDL rule
  - Kilo safety policy: directory blocks
"""

import json
import sys
import os
import re


AUTONOMOUS = os.environ.get("AUTONOMOUS") == "1"

_branch_cache = {"branch": None, "checked": 0}

def _on_protected_branch():
    """Check if current git branch is main/master (protected). Feature branches are safe.
    Caches result for 30 seconds to avoid spawning git subprocess on every tool call."""
    import time
    now = time.time()
    if _branch_cache["branch"] is not None and (now - _branch_cache["checked"]) < 30:
        return _branch_cache["branch"] in ("main", "master", "")
    try:
        import subprocess
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, timeout=5
        )
        branch = result.stdout.strip()
        _branch_cache["branch"] = branch
        _branch_cache["checked"] = now
        return branch in ("main", "master", "")
    except Exception:
        return True  # If we can't tell, assume protected

# Directories where Kilo is blocked (matches any path component)
KILO_BLOCKED_PATTERNS = [
    "golems", "brainlayer", ".claude", ".golems-zikaron",
    "zikaron", ".local/share/brainlayer",
]


def block(reason):
    """Output block JSON and exit with code 2."""
    json.dump({
        "decision": "block",
        "reason": reason,
    }, sys.stdout)
    sys.exit(2)


def check_bash(command):
    """Check Bash commands for blocked patterns."""
    stripped = command.strip()

    # 1. git push — block on main/master only (feature branches are autonomous)
    if re.match(r"git\s+push\b", stripped) and not AUTONOMOUS and _on_protected_branch():
        block(
            "git push blocked on main/master — need explicit permission or AUTONOMOUS=1. "
            "Feature branches are allowed automatically."
        )

    # 2. git commit — block on main/master only (feature branches are autonomous)
    if re.match(r"git\s+commit\b", stripped) and not AUTONOMOUS and _on_protected_branch():
        block(
            "git commit blocked on main/master — need explicit permission or AUTONOMOUS=1. "
            "Feature branches are allowed automatically."
        )

    # 3. npm commands → use bun
    if re.match(r"npm\s+(install|run|test|ci|init|start|build|exec)\b", stripped):
        bun_cmd = re.sub(r"^npm\b", "bun", stripped, count=1)
        block(f"Use bun instead of npm. Try: {bun_cmd}")

    # 4. python (not python3) — catch both "python script.py" and bare "python"
    if re.match(r"python(\s|$)", stripped) and not stripped.startswith("python3"):
        block("Use python3, not python.")

    # 5. Chrome/Brave → Helium (Etan's standing browser law; Safari allowed for OAuth popups)
    # Anchored to a command boundary — start of string, or after a shell separator
    # (; & | or a newline; the single-char class also covers the last char of && / ||) —
    # so that merely MENTIONING the invocation (commit message, echo, test fixture) is not
    # blocked, while a real launch on any line of a multi-line script still is.
    if re.search(r'(?:^|[;&|\n]\s*)open\s+-a\s+["\']?(Google Chrome|Brave Browser|Brave)\b', stripped):
        block("Use Helium, not Chrome/Brave. Try: open -a Helium")

    # 6. git status -uall (match actual command, not substrings in commit messages)
    if re.match(r"git\s+status\b", stripped) and "-uall" in stripped:
        block("Don't use -uall — can cause memory issues on large repos. Use: git status -u")

    # 8. Kilo in blocked directories
    if re.match(r"kilo\b", stripped) or "run.sh kilo" in stripped:
        cwd = os.getcwd()
        for pattern in KILO_BLOCKED_PATTERNS:
            if pattern in cwd:
                block(
                    f"Kilo blocked in {cwd}. "
                    "Only use Kilo in: songscript, taskowl, union, rudy"
                )


def check_supabase_ddl(tool_input):
    """7. Block DDL statements via execute_sql — must use apply_migration."""
    sql = tool_input.get("sql", "")
    if re.search(r"\b(CREATE|ALTER|DROP|TRUNCATE)\b", sql, re.IGNORECASE):
        block(
            "DDL must use mcp__supabase__apply_migration, not execute_sql. "
            "Migrations are tracked and reversible."
        )


def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError:
        json.dump({}, sys.stdout)
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    is_worker = bool(os.environ.get("CLAUDE_WORKER"))

    # Bash commands — skip for workers (auto-approve-worker.sh handles these)
    if tool_name == "Bash" and not is_worker:
        check_bash(tool_input.get("command", ""))

    # Supabase execute_sql DDL check — ALWAYS active, even for workers
    if tool_name == "mcp__supabase__execute_sql":
        check_supabase_ddl(tool_input)

    # Allow by default
    json.dump({}, sys.stdout)
    sys.exit(0)


if __name__ == "__main__":
    main()

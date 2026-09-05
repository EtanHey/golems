#!/usr/bin/env python3
"""
Collab Guard Hook — blocks collab file writes missing PR Loop or TDD mandate.
Runs as a PreToolUse hook on Write/Edit to collab/**/*.md files.
"""

import json
import os
import re
import sys
from datetime import datetime

REQUIRED_SECTIONS = [
    ("PR Loop", ["PR Loop", "pr loop", "PR loop", "branch → commit → push → PR"]),
    ("TDD Red-Green-Refactor", ["TDD", "Red-Green-Refactor", "red-green-refactor", "RED —", "failing test FIRST"]),
]

SHRINK_OVERRIDE_RE = re.compile(
    r"^<!-- COLLAB-SHRINK-OK: (\S(?:[^\r\n]*\S)?) -->$",
    re.MULTILINE,
)
SHRINK_LOG = "~/.claude/hooks/collab-guard-shrink.log"


def _edit_resulting_size(file_path, tool_input, old_size):
    old_string = tool_input.get("old_string", "")
    new_string = tool_input.get("new_string", "")
    if not isinstance(old_string, str) or not isinstance(new_string, str):
        return old_size
    if not old_string:
        return old_size

    try:
        with open(file_path, encoding="utf-8", newline="") as current_file:
            current = current_file.read()
    except (OSError, UnicodeError):
        return old_size

    matches = current.count(old_string)
    if not matches:
        return old_size
    replacements = matches if tool_input.get("replace_all", False) else 1
    byte_delta = len(new_string.encode("utf-8")) - len(old_string.encode("utf-8"))
    return old_size + (replacements * byte_delta)


def _write_override_log(file_path, old_size, new_size, reason):
    log_path = os.path.expanduser(SHRINK_LOG)
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    event = {
        "timestamp": datetime.now().astimezone().isoformat(timespec="seconds"),
        "file": file_path,
        "old_bytes": old_size,
        "new_bytes": new_size,
        "reason": reason,
    }
    with open(log_path, "a", encoding="utf-8") as log_file:
        json.dump(event, log_file, ensure_ascii=False)
        log_file.write("\n")


def _check_shrink(file_path, incoming_content, new_size):
    if not os.path.isfile(file_path):
        return

    old_size = os.path.getsize(file_path)
    if new_size >= old_size:
        return

    match = SHRINK_OVERRIDE_RE.search(incoming_content)
    if match:
        reason = match.group(1)
        try:
            _write_override_log(file_path, old_size, new_size, reason)
        except OSError as error:
            print(
                "BLOCKED: Collab shrink override could not be logged to "
                f"{os.path.expanduser(SHRINK_LOG)}: {error}",
                file=sys.stderr,
            )
            sys.exit(2)
        return

    delta = old_size - new_size
    print(
        f"BLOCKED: Collab file shrink refused: {file_path}\n"
        f"Size would change {old_size}→{new_size} bytes ({delta} bytes smaller).\n"
        "To allow a deliberate shrink, include this marker line in the incoming content:\n"
        "<!-- COLLAB-SHRINK-OK: <one-line reason> -->",
        file=sys.stderr,
    )
    sys.exit(2)


def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    if tool_name not in ("Write", "Edit"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "")

    # Only check collab files (not the template itself)
    if "/collab/" not in file_path or not file_path.endswith(".md"):
        sys.exit(0)
    if file_path.endswith("TEMPLATE.md"):
        sys.exit(0)

    # Get the content being written. Preserve the existing section validation
    # for Write; Edit remains exempt from that validation.
    if tool_name == "Write":
        content = tool_input.get("content", "")
    elif tool_name == "Edit":
        content = tool_input.get("new_string", "")
    else:
        sys.exit(0)

    if tool_name == "Write":
        # Check for required sections
        missing = []
        for section_name, keywords in REQUIRED_SECTIONS:
            found = any(kw in content for kw in keywords)
            if not found:
                missing.append(section_name)

        if missing:
            missing_str = ", ".join(missing)
            print(
                f"BLOCKED: Collab file missing mandatory sections: {missing_str}\n"
                f"Copy from $ORCHESTRATOR_REPO/collab/TEMPLATE.md first.\n"
                f"Every collab MUST include PR Loop and TDD mandate.",
                file=sys.stderr,
            )
            sys.exit(2)

    old_size = os.path.getsize(file_path) if os.path.isfile(file_path) else 0
    if tool_name == "Write":
        new_size = len(content.encode("utf-8"))
    else:
        new_size = _edit_resulting_size(file_path, tool_input, old_size)
    _check_shrink(file_path, content, new_size)

    sys.exit(0)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Claude PermissionRequest hook: an unattended T3 worker never waits on a person.

Claude Code runs PermissionRequest hooks when it is about to show a permission
dialog. T3 Code turns that dialog into an approval card that waits with no time
limit, so an unattended worker stalls until someone notices. In a worker thread
this hook denies with a message the model can act on; everywhere else it prints
nothing, and Claude asks a person as it does without the hook.

Who counts as a worker (T3CODE_THREAD_ID, set by T3 for every Claude session):
  - an id starting "thread:delegated-task:" is a delegated child;
  - any other id is looked up read-only in T3's state DB. The thread is a
    worker when it has a `delegatedFrom` record, or a `lineage.parentThreadId`
    and was not created by the user (a fork or side chat the owner opened is
    attended).
No id, a missing DB, a missing row or any lookup error means "not a worker".

AIDEV-NOTE: this hook fails OPEN on purpose. A failure here must restore
today's behaviour (a person is asked), never deny a lead's or terminal
session's request. It is registered through golems-fail-open.py without
--fail-closed. Read-only, no writes, no network. See
docs/claude-worker-permission.md.
"""
import os
import sys

# AIDEV-NOTE: no hook dir is ever FIRST on sys.path, even when this file runs
# without the launcher: the stdlib must win over anything planted beside it.
_HOOK_DIR = os.path.dirname(os.path.realpath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.realpath(p) != _HOOK_DIR] + [_HOOK_DIR]

import json
import sqlite3
from pathlib import Path
from urllib.parse import quote

DELEGATED_PREFIX = "thread:delegated-task:"
DEFAULT_DB = Path.home() / ".t3" / "userdata" / "statev2.sqlite"
# Test seam: a fixture DB path. Not a policy switch: any value that fails to
# open falls back to "not a worker".
DB_ENV = "GOLEMS_T3_STATE_DB"
# General on purpose: the hook has no matcher, so this also answers non-shell
# prompts (MCP tools, questions, plan-mode exits).
MESSAGE = (
    "This step needs a person's approval, and this worker runs unattended. "
    "Do it another way that needs no approval (for a shell step: Edit/Write tools, "
    "or one plain literal command, or a script file you run), or report BLOCKED to "
    "your lead with exactly what you needed."
)
QUERY = (
    "SELECT json_type(payload_json, '$.delegatedFrom'),"
    " json_extract(payload_json, '$.lineage.parentThreadId'),"
    " json_extract(payload_json, '$.createdBy')"
    " FROM orchestration_v2_projection_threads WHERE thread_id = ?"
)


def thread_row(db_path, thread_id):
    # immutable=1: never take a lock or touch the WAL of T3's live database.
    # The cost: a thread written only to the WAL so far is not visible yet,
    # which reads as "not a worker" (fail open).
    uri = f"file:{quote(str(db_path))}?mode=ro&immutable=1"
    con = sqlite3.connect(uri, uri=True, timeout=1)
    try:
        return con.execute(QUERY, (thread_id,)).fetchone()
    finally:
        con.close()


def is_worker(thread_id, db_path):
    if not isinstance(thread_id, str) or not thread_id:
        return False
    if thread_id.startswith(DELEGATED_PREFIX):
        return True
    if not Path(db_path).is_file():
        return False
    try:
        row = thread_row(db_path, thread_id)
    except sqlite3.Error:
        return False
    if row is None:
        return False
    delegated_type, parent, created_by = row
    if delegated_type == "object":
        return True
    return isinstance(parent, str) and bool(parent) and created_by != "user"


def decision(thread_id, db_path):
    if not is_worker(thread_id, db_path):
        return None
    return {"hookSpecificOutput": {"hookEventName": "PermissionRequest",
            "decision": {"behavior": "deny", "message": MESSAGE}}}


def main():
    # The payload is not needed for the decision; drain it so the writer never
    # blocks, and ignore its content (any tool, any shape).
    sys.stdin.read(1024 * 1024)
    db_path = os.environ.get(DB_ENV) or DEFAULT_DB
    result = decision(os.environ.get("T3CODE_THREAD_ID"), db_path)
    if result is not None:
        print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())

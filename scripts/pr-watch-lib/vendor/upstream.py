"""Unmodified helper subset from OpenAI Codex gh_pr_watch.py (Apache-2.0).
Extracted for golems pr-watch; gh_json is supplied by the caller.
See LICENSE, NOTICE, and README.md in this directory.
"""
import json
import os
import tempfile
from pathlib import Path

REVIEW_BOT_LOGIN_KEYWORDS = {"codex"}
TRUSTED_AUTHOR_ASSOCIATIONS = {"OWNER", "MEMBER", "COLLABORATOR"}

def load_state(path):
    if path.exists():
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError as err:
            raise RuntimeError(f"State file is not valid JSON: {path}") from err
        if not isinstance(data, dict):
            raise RuntimeError(f"State file must contain an object: {path}")
        return data, False
    return {
        "pr": {},
        "started_at": None,
        "last_seen_head_sha": None,
        "retries_by_sha": {},
        "seen_issue_comment_ids": [],
        "seen_review_comment_ids": [],
        "seen_review_ids": [],
        "last_snapshot_at": None,
    }, True


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(state, indent=2, sort_keys=True) + "\n"
    fd, tmp_name = tempfile.mkstemp(
        prefix=f"{path.name}.", suffix=".tmp", dir=path.parent
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp_file:
            tmp_file.write(payload)
        os.replace(tmp_path, path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def gh_api_list_paginated(endpoint, repo=None, per_page=100):
    items = []
    page = 1
    while True:
        sep = "&" if "?" in endpoint else "?"
        page_endpoint = f"{endpoint}{sep}per_page={per_page}&page={page}"
        payload = gh_json(["api", page_endpoint], repo=repo)
        if payload is None:
            break
        if not isinstance(payload, list):
            raise GhCommandError(f"Unexpected paginated payload from gh api {endpoint}")
        items.extend(payload)
        if len(payload) < per_page:
            break
        page += 1
    return items


def extract_login(user_obj):
    if isinstance(user_obj, dict):
        return str(user_obj.get("login") or "")
    return ""


def is_bot_login(login):
    return bool(login) and login.endswith("[bot]")


def is_actionable_review_bot_login(login):
    if not is_bot_login(login):
        return False
    lower_login = login.lower()
    return any(keyword in lower_login for keyword in REVIEW_BOT_LOGIN_KEYWORDS)


def is_trusted_human_review_author(item, authenticated_login):
    author = str(item.get("author") or "")
    if not author:
        return False
    if authenticated_login and author == authenticated_login:
        return True
    association = str(item.get("author_association") or "").upper()
    return association in TRUSTED_AUTHOR_ASSOCIATIONS


def current_retry_count(state, head_sha):
    retries = state.get("retries_by_sha") or {}
    value = retries.get(head_sha, 0)
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def set_retry_count(state, head_sha, count):
    retries = state.get("retries_by_sha")
    if not isinstance(retries, dict):
        retries = {}
    retries[head_sha] = int(count)
    state["retries_by_sha"] = retries

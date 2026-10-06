"""deepsource-issues against a local fake DeepSource GraphQL server."""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/deepsource-issues"
TOKEN = "synthetic-deepsource-token-not-a-secret"


def occurrence(code, line, message, title, category="BUG_RISK", suppressed=False):
    return {"node": {"shortcode": code, "title": message, "category": category, "severity": "MINOR",
                     "path": "src/app.py", "beginLine": line, "endLine": line, "explanation": None,
                     "isSuppressed": suppressed, "source": "STATIC", "issue": {"title": title}}}


def page(edges, cursor=None):
    return {"totalCount": None, "pageInfo": {"hasNextPage": cursor is not None, "endCursor": cursor},
            "edges": edges}


def check(shortcode, status, issues):
    return {"node": {"id": f"check-{shortcode}", "status": status,
                     "analyzer": {"shortcode": shortcode, "name": shortcode.title()},
                     "summary": {"occurrencesIntroduced": 0, "occurrencesResolved": 0,
                                 "occurrencesSuppressed": 0},
                     "issues": issues}}


def pr_payload(checks, status="FAILURE"):
    run = None if checks is None else {"runUid": "run-1", "status": status, "commitOid": "abc123",
                                       "branchName": "topic", "checks": {"edges": checks}}
    return {"data": {"repository": {"pullRequest": {
        "number": 7, "title": "t", "state": "OPEN",
        "summary": {"issuesRaised": 3, "issuesResolved": 0, "issuesSuppressed": 0},
        "latestAnalysisRun": run}}}}


class Fake:
    """Answers by query shape; records every request's auth header and body."""

    def __init__(self):
        self.requests = []
        self.status = 200
        self.body = None
        self.second_page = None
        self.ps_snapshots = []

    def respond(self, payload):
        if self.status != 200:
            return self.status, self.body or {"errors": [{"message": "bad"}]}
        if "after" in (payload.get("variables") or {}):
            return 200, {"data": {"node": {"issues": self.second_page}}}
        return 200, self.body


@pytest.fixture
def fake():
    state = Fake()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state.requests.append({"auth": self.headers.get("Authorization"), "payload": payload,
                                   "ua": self.headers.get("User-Agent")})
            state.ps_snapshots.append(subprocess.run(["ps", "-axww", "-o", "pid=,ppid=,command="],
                                                     capture_output=True, text=True).stdout)
            code, body = state.respond(payload)
            raw = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state.url = f"http://127.0.0.1:{server.server_address[1]}/graphql/"
    yield state
    server.shutdown()


def run(fake, *args, token=TOKEN, extra=None, path=None):
    env = {"PATH": path or os.environ["PATH"], "HOME": os.environ.get("HOME", "/nonexistent"),
           "DEEPSOURCE_API_URL": fake.url}
    if token is not None:
        env["DEEPSOURCE_TOKEN"] = token
    env.update(extra or {})
    proc = subprocess.Popen([sys.executable, str(SCRIPT), *args], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env=env)
    fake.helper_pid = proc.pid
    stdout, stderr = proc.communicate(timeout=30)
    return subprocess.CompletedProcess(proc.args, proc.returncode, stdout, stderr)


def helper_tree(snapshot, root):
    """Command lines of the helper and its descendants, from one `ps` snapshot."""
    rows = [line.strip().split(None, 2) for line in snapshot.splitlines() if line.strip()]
    tree, grew = {root}, True
    while grew:
        grew = False
        for row in rows:
            if len(row) >= 2 and int(row[1]) in tree and int(row[0]) not in tree:
                tree.add(int(row[0]))
                grew = True
    return [row[2] for row in rows if len(row) == 3 and int(row[0]) in tree]


def test_parses_failing_checks_and_paginated_issues_exit_1(fake):
    fake.body = pr_payload([
        check("python", "FAILURE", page([occurrence("PYL-W0212", 4, "Access to a protected member _x",
                                                     "Protected member accessed")], cursor="c1")),
        check("shell", "SUCCESS", page([])),
    ])
    fake.second_page = page([occurrence("BAN-B108", 9, "Probable insecure usage of temp file.",
                                        "Insecure temp file", category="SECURITY")])
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 1, r.stderr
    out = json.loads(r.stdout)
    assert out["repo"] == "EtanHey/app" and out["pr"] == 7
    assert out["run"]["status"] == "FAILURE" and out["run"]["commit"] == "abc123"
    assert out["failing_checks"] == [{"analyzer": "python", "status": "FAILURE", "issues": 2}]
    assert out["total_issues"] == 2
    python = next(a for a in out["analyzers"] if a["analyzer"] == "python")
    assert python["issues"] == [
        {"code": "PYL-W0212", "title": "Protected member accessed", "category": "BUG_RISK",
         "severity": "MINOR", "file": "src/app.py", "line": 4, "location": "src/app.py:4",
         "message": "Access to a protected member _x"},
        {"code": "BAN-B108", "title": "Insecure temp file", "category": "SECURITY",
         "severity": "MINOR", "file": "src/app.py", "line": 9, "location": "src/app.py:9",
         "message": "Probable insecure usage of temp file."},
    ]
    query = fake.requests[0]["payload"]
    assert query["variables"] == {"login": "EtanHey", "name": "app", "number": 7, "provider": "GITHUB"}
    assert fake.requests[1]["payload"]["variables"]["id"] == "check-python"
    assert all(req["auth"] == f"Bearer {TOKEN}" for req in fake.requests)
    assert all(req["ua"] and "urllib" not in req["ua"].lower() for req in fake.requests)


def test_clean_pr_exits_0(fake):
    fake.body = pr_payload([check("python", "SUCCESS", page([]))], status="SUCCESS")
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["total_issues"] == 0 and out["failing_checks"] == []


def test_suppressed_occurrences_do_not_count(fake):
    fake.body = pr_payload([check("python", "SUCCESS",
                                  page([occurrence("PYL-1", 1, "m", "t", suppressed=True)]))],
                           status="SUCCESS")
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["total_issues"] == 0 and out["suppressed_issues"] == 1


def test_no_analysis_run_is_not_green(fake):
    fake.body = pr_payload(None)
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 3
    assert json.loads(r.stdout)["run"] is None


def test_pending_run_is_not_green(fake):
    fake.body = pr_payload([check("python", "PENDING", page([]))], status="PENDING")
    assert run(fake, "EtanHey/app", "7").returncode == 3


def test_missing_token_fails_loud_without_a_request(fake):
    r = run(fake, "EtanHey/app", "7", token=None)
    assert r.returncode == 2
    assert "DEEPSOURCE_TOKEN" in r.stderr
    assert fake.requests == []


def test_empty_token_counts_as_missing(fake):
    r = run(fake, "EtanHey/app", "7", token="  ")
    assert r.returncode == 2 and fake.requests == []


@pytest.mark.parametrize("args", [(), ("EtanHey/app",), ("app", "7"), ("EtanHey/app", "seven"),
                                  ("EtanHey/app", "0"), ("a/b/c", "7")])
def test_usage_errors_exit_2(fake, args):
    r = run(fake, *args)
    assert r.returncode == 2
    assert fake.requests == []


@pytest.mark.parametrize("code", [401, 403])
def test_http_auth_error_exits_2(fake, code):
    fake.status = code
    fake.body = {"detail": f"bad token {TOKEN}"}
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 2
    assert "auth" in r.stderr.lower()
    assert TOKEN not in r.stdout + r.stderr


def test_graphql_error_that_echoes_the_token_is_redacted(fake):
    fake.body = {"errors": [{"message": f"Invalid token {TOKEN} for viewer"}]}
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 2
    assert TOKEN not in r.stdout + r.stderr
    assert "[REDACTED]" in r.stderr


def test_unknown_pr_exits_2(fake):
    fake.body = {"data": {"repository": {"pullRequest": None}}}
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 2 and "not found" in r.stderr.lower()


def test_token_never_in_argv_or_output(fake, tmp_path):
    # A curl on PATH that records any call: the helper must not shell out.
    shim = tmp_path / "bin"
    shim.mkdir()
    log = tmp_path / "curl.log"
    (shim / "curl").write_text(f"#!/bin/sh\necho \"$@\" >> {log}\nexit 1\n")
    (shim / "curl").chmod(0o755)
    fake.body = pr_payload([check("python", "FAILURE", page([occurrence("PYL-1", 1, "m", "t")]))])
    r = run(fake, "EtanHey/app", "7", path=f"{shim}:{os.environ['PATH']}")
    assert r.returncode == 1, r.stderr
    assert not log.exists()
    trees = [helper_tree(snap, fake.helper_pid) for snap in fake.ps_snapshots]
    assert trees and all(tree for tree in trees)  # the helper itself was seen mid-request
    assert all(TOKEN not in command for tree in trees for command in tree)
    assert TOKEN not in r.stdout + r.stderr


def test_remote_plain_http_override_is_refused(fake):
    r = run(fake, "EtanHey/app", "7", extra={"DEEPSOURCE_API_URL": "http://example.com/graphql/"})
    assert r.returncode == 2
    assert fake.requests == []

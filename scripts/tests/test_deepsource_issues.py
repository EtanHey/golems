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
        self.pages = None  # cursor -> issues connection, for multi-page runs
        self.raw = None  # (bytes, Content-Length) sent verbatim instead of JSON
        self.ps_snapshots = []
        self.snapshot_ps = False  # `ps` per request costs ~0.5s; only the argv test needs it

    def respond(self, payload):
        if self.status != 200:
            return self.status, self.body or {"errors": [{"message": "bad"}]}
        variables = payload.get("variables") or {}
        if "after" in variables:
            issues = self.second_page if self.pages is None else self.pages.get(variables["after"])
            return 200, {"data": {"node": {"issues": issues}}}
        return 200, self.body


@pytest.fixture
def fake():
    state = Fake()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state.requests.append({"auth": self.headers.get("Authorization"), "payload": payload,
                                   "ua": self.headers.get("User-Agent")})
            if state.snapshot_ps:
                state.ps_snapshots.append(subprocess.run(["ps", "-axww", "-o", "pid=,ppid=,command="],
                                                         capture_output=True, text=True).stdout)
            code, body = state.respond(payload)
            raw, length = state.raw or (json.dumps(body).encode(), None)
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw) if length is None else length))
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
    fake.snapshot_ps = True
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


# --- R1 (B1-B5) -------------------------------------------------------------

def one_line_error(r):
    assert r.stdout == "" and "Traceback" not in r.stderr
    assert len(r.stderr.strip().splitlines()) == 1, r.stderr
    return r.stderr


@pytest.mark.parametrize("run_status, checks, expected", [
    # B1: 0 issues is green only on a SUCCESS run whose every check is SUCCESS.
    ("FAILURE", [check("python", "TIMEOUT", page([]))], 1),
    ("FAILURE", [check("python", "FAILURE", page([]))], 1),
    ("SUCCESS", [check("python", "ARTIFACT_TIMEOUT", page([]))], 1),
    ("FAILURE", [], 1),
    ("TIMEOUT", [], 1),
    ("CANCEL", [], 3),
    ("SKIPPED", [], 3),
    ("CANCELLED", [], 3),  # an unknown status is never green
    ("SUCCESS", [], 3),  # no checks ran
    ("SUCCESS", [check("python", "SKIPPED", page([]))], 3),
    ("SUCCESS", [check("python", "CANCEL", page([]))], 3),
    ("SUCCESS", [check("python", "NEUTRAL", page([]))], 3),
    ("SUCCESS", [check("python", "SUCCESS", page([])), check("go", "WAITING", page([]))], 3),
    ("SUCCESS", [check("python", "SUCCESS", page([])), check("go", "SUCCESS", page([]))], 0),
])
def test_zero_issues_is_green_only_on_a_fully_successful_run(fake, run_status, checks, expected):
    fake.body = pr_payload(checks, status=run_status)
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == expected, r.stderr
    out = json.loads(r.stdout)
    assert out["verdict"] == {0: "clean", 1: "failing", 3: "no_verdict"}[expected]


def test_failed_check_is_listed_even_with_zero_issues(fake):
    fake.body = pr_payload([check("python", "TIMEOUT", page([]))], status="FAILURE")
    out = json.loads(run(fake, "EtanHey/app", "7").stdout)
    assert out["failing_checks"] == [{"analyzer": "python", "status": "TIMEOUT", "issues": 0}]


def test_three_pages_are_collected_and_match_total_count(fake):
    first = page([occurrence("A-1", 1, "m1", "t")], cursor="c1")
    first["totalCount"] = 3
    fake.body = pr_payload([check("python", "FAILURE", first)])
    fake.pages = {"c1": page([occurrence("A-2", 2, "m2", "t")], cursor="c2"),
                  "c2": page([occurrence("A-3", 3, "m3", "t")])}
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 1, r.stderr
    out = json.loads(r.stdout)
    assert [i["code"] for i in out["analyzers"][0]["issues"]] == ["A-1", "A-2", "A-3"]
    assert [req["payload"]["variables"].get("after") for req in fake.requests] == [None, "c1", "c2"]


@pytest.mark.parametrize("pages, first_cursor, total", [
    ({"c1": None}, "c1", None),  # B2: a null follow-up page
    ({}, "c1", None),  # the page never arrives
    ({"c1": page([occurrence("A-2", 2, "m", "t")], cursor="c1")}, "c1", None),  # cursor does not advance
    ({"c1": {"pageInfo": {"hasNextPage": True, "endCursor": None}, "edges": []}}, "c1", None),
    ({"c1": page([occurrence("A-2", 2, "m", "t")])}, "c1", 250),  # totalCount mismatch
    ({"c1": {"pageInfo": {"hasNextPage": False}, "edges": "nope"}}, "c1", None),
])
def test_incomplete_pagination_exits_2(fake, pages, first_cursor, total):
    first = page([occurrence("A-1", 1, "m", "t")], cursor=first_cursor)
    first["totalCount"] = total
    fake.body = pr_payload([check("python", "FAILURE", first)])
    fake.pages = pages
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 2
    error = one_line_error(r).lower()
    assert "pagination" in error or "malformed" in error


def test_single_page_total_count_mismatch_exits_2(fake):
    first = page([occurrence("A-1", 1, "m", "t")])
    first["totalCount"] = 250
    fake.body = pr_payload([check("python", "FAILURE", first)])
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 2
    assert "pagination" in one_line_error(r).lower()


@pytest.mark.parametrize("body", [
    ["not", "a", "dict"],  # B3
    {"errors": ["plain string"]},
    {"errors": "flat"},
    {"data": None},
    {"data": {"repository": "x"}},
    {"data": {"repository": {"pullRequest": {"latestAnalysisRun": {"status": "SUCCESS", "checks": "x"}}}}},
    {"data": {"repository": {"pullRequest": {"latestAnalysisRun": {
        "status": "SUCCESS", "checks": {"edges": [{"node": {"status": "SUCCESS", "issues": 5}}]}}}}}},
])
def test_malformed_responses_exit_2_with_one_line_error(fake, body):
    fake.body = body
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 2
    one_line_error(r)


def test_non_object_body_names_the_malformed_shape(fake):
    fake.body = ["not", "a", "dict"]
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 2
    assert "malformed DeepSource response: top level is list" in one_line_error(r)


def test_an_unforeseen_shape_still_exits_2_not_1(fake):
    # Passes every structural check, then breaks shape(): only the catch-all stands between it and exit 1.
    weird = occurrence("PYL-1", 1, "m", "t")
    weird["node"]["issue"] = "not-an-object"
    fake.body = pr_payload([check("python", "FAILURE", page([weird]))])
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 2
    assert "unexpected failure: AttributeError" in one_line_error(r)


@pytest.mark.parametrize("raw", [(b"<html>gateway</html>", None), (b'{"data": {"repo', 400)])
def test_non_json_and_truncated_bodies_exit_2(fake, raw):
    fake.raw = raw
    r = run(fake, "EtanHey/app", "7")
    assert r.returncode == 2
    one_line_error(r)


@pytest.mark.parametrize("number", ["\u00b2", "\u0663", "+7", " 7"])
def test_non_ascii_digit_pr_number_is_usage_error(fake, number):
    r = run(fake, "EtanHey/app", number)
    assert r.returncode == 2 and fake.requests == []
    assert r.stdout == "" and "Traceback" not in r.stderr and "pr-number" in r.stderr


@pytest.mark.parametrize("token", ["partA-secret\npartB-secret", "partA-secret partB-secret",
                                   "partA-secret\tpartB-secret", "partA-secret\x00partB-secret",
                                   "partA-secret\x7fpartB", " partA-secret", "partA-secret\n"])
def test_token_with_whitespace_or_control_chars_is_rejected_unechoed(fake, token):
    if "\x00" in token:
        pytest.skip("execve cannot carry NUL in an env value")
    r = run(fake, "EtanHey/app", "7", token=token)
    assert r.returncode == 2 and fake.requests == []
    assert "partA-secret" not in r.stdout + r.stderr
    assert "DEEPSOURCE_TOKEN" in one_line_error(r)


def load_helper():
    from importlib.machinery import SourceFileLoader
    from importlib.util import module_from_spec, spec_from_loader
    loader = SourceFileLoader("deepsource_issues", str(SCRIPT))
    module = module_from_spec(spec_from_loader("deepsource_issues", loader))
    loader.exec_module(module)
    return module


def test_scrub_redacts_raw_repr_and_json_forms():
    helper = load_helper()
    token = "tok\\en'\"x"
    for leaked in (token, repr(token)[1:-1], json.dumps(token)[1:-1], repr(token.encode())[2:-1]):
        assert token not in helper.scrub(f"before {leaked} after", token)
        assert leaked not in helper.scrub(f"before {leaked} after", token)


def test_redirect_is_refused_and_never_reaches_the_other_host(fake):
    seen = []

    class Other(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.headers.get("Authorization"))
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

        do_POST = do_GET

        def log_message(self, *args):
            pass

    other = ThreadingHTTPServer(("127.0.0.1", 0), Other)
    threading.Thread(target=other.serve_forever, daemon=True).start()
    target = f"http://localhost:{other.server_address[1]}/elsewhere"

    class Redirect(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(302)
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args):
            pass

    redirect = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    threading.Thread(target=redirect.serve_forever, daemon=True).start()
    try:
        fake.url = f"http://127.0.0.1:{redirect.server_address[1]}/graphql/"
        r = run(fake, "EtanHey/app", "7")
        assert r.returncode == 2
        assert "redirect" in one_line_error(r).lower()
        assert seen == []
    finally:
        other.shutdown()
        redirect.shutdown()

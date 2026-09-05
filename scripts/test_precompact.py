#!/usr/bin/env python3
"""Self-contained unit tests for precompact-checkpoint.py (PR-K1).

Runs on a tiny synthetic JSONL fixture so the five root-cause fixes are verifiable
without the 7.6MB gen-15 transcript. Run: `python3 scripts/test_precompact.py`
(plain stdlib, no pytest needed). Exit 0 = all pass.
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "precompact-checkpoint.py"
spec = importlib.util.spec_from_file_location("ckpt_hook", HOOK)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

FIXTURE = [
    # real user text turn in orchestrator cwd
    {"type": "user", "cwd": "/Users/x/Gits/orchestrator",
     "message": {"role": "user", "content": "You're wrong, stop doing that. I told you to use the ledger."}},
    # tool_result user turn (content is a list) — MUST be skipped
    {"type": "user", "cwd": "/Users/x/Gits/golems",
     "message": {"role": "user", "content": [{"type": "tool_result", "content": "2026 IDT"}]}},
    # isMeta user turn — MUST be skipped
    {"type": "user", "isMeta": True, "cwd": "/Users/x/Gits/golems",
     "message": {"role": "user", "content": "meta noise"}},
    # queue-delivered enqueue turn (cloudflare-pushback class) — counts
    {"type": "queue-operation", "operation": "enqueue",
     "content": "Actually never mind, do not push that branch."},
    # cron tick — noise, MUST be filtered out
    {"type": "queue-operation", "operation": "enqueue",
     "content": "Fleet-monitor tick (orcClaude). LEAN — if nothing changed END SILENTLY."},
    # task-notification user turn — MUST be filtered
    {"type": "user", "cwd": "/Users/x/Gits/orchestrator",
     "message": {"role": "user", "content": "<task-notification><task-id>abc</task-id></task-notification>"}},
    # remember-request turn
    {"type": "user", "cwd": "/Users/x/Gits/orchestrator",
     "message": {"role": "user", "content": "Remember for tonight: run the eval on the MVP."}},
    # assistant text — excluded from user sections
    {"type": "assistant",
     "message": {"role": "assistant", "content": [{"type": "text", "text": "Okay, I will."}]}},
]


def write_fixture():
    d = Path(tempfile.mkdtemp())
    p = d / "fixture.jsonl"
    p.write_text("\n".join(json.dumps(o) for o in FIXTURE) + "\n", encoding="utf-8")
    return p


def main():
    failures = []

    def check(name, cond):
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
        if not cond:
            failures.append(name)

    p = write_fixture()
    records, cwd, err = m.parse_transcript(str(p))

    # fix #1 — JSONL parsing: 1 user-str + 1 remember-user + 2 queue + 1 assistant = 5;
    # tool_result/isMeta/task-notif-as-user are still parsed as records but filtered later.
    kinds = [r["kind"] for r in records]
    check("parse skips tool_result list turns", all(
        not (r["kind"] == "user" and isinstance(r["text"], list)) for r in records))
    check("parse skips isMeta turns", all("meta noise" not in r["text"] for r in records))
    check("parse keeps queue enqueue turns", "queue" in kinds)
    check("parse keeps assistant text turns", "assistant" in kinds)

    # fix #2 — project from cwd, not grep (golems appears in cwds but orchestrator wins)
    check("project == orchestrator (from cwd majority)", m.project_from_cwd(cwd) == "orchestrator")

    # corrections: the "wrong/stop/told you" turn + the queued "never mind/do not" turn
    corrections = m.extract_corrections(records)
    check("corrections capture real user correction", any("wrong" in c.lower() for c in corrections))
    check("corrections capture queue-delivered correction", any("never mind" in c.lower() for c in corrections))
    check("corrections exclude cron tick", not any("fleet-monitor" in c.lower() for c in corrections))
    check("corrections exclude task-notification", not any("task-notification" in c.lower() for c in corrections))

    # REMEMBER-LIST
    remember = m.extract_remember_list(records)
    check("remember-list captures remember turn", any("for tonight" in r.lower() for r in remember))

    # fix #3 — line cap at 500 chars
    long_text = "x" * 2000
    check("clean_line caps at <=500 chars", len(m.clean_line(long_text)) <= m.MAX_LINE_CHARS)

    # fix #4 — cooldown dedup
    now = datetime.now().astimezone()
    digest = m.content_hash("same markdown")
    # no state file yet -> not blocked
    m.STATE_PATH = Path(tempfile.mkdtemp()) / "state.json"
    check("cooldown not blocked when no prior state", not m.cooldown_blocks("sess-1", digest, now))
    m.record_state("sess-1", digest, now)
    check("cooldown blocks identical same-session <10min", m.cooldown_blocks("sess-1", digest, now))
    check("cooldown allows different content hash", not m.cooldown_blocks("sess-1", m.content_hash("other"), now))
    check("cooldown allows different session", not m.cooldown_blocks("sess-2", digest, now))

    # fix #5 — markdown has FIRST-ACTION CONTRACT heading + REMEMBER-LIST section
    md, project, _ = m.build_markdown(
        {"session_id": "t", "trigger": "replay"}, records, cwd, str(p), None)
    check("markdown has FIRST-ACTION CONTRACT heading", "## FIRST-ACTION CONTRACT" in md)
    check("markdown has REMEMBER-LIST section", "## REMEMBER-LIST" in md)

    # --- Bugbot round-1 regression tests ---------------------------------------

    # Bugbot #1 (HIGH) — content_hash must ignore the timestamp line so the same
    # transcript rendered at two different times yields the same digest, and the
    # second run is blocked by cooldown.
    md1, _, _ = m.build_markdown({"session_id": "bb1", "trigger": "auto"}, records, cwd, str(p), None)
    md2, _, _ = m.build_markdown({"session_id": "bb1", "trigger": "auto"}, records, cwd, str(p), None)
    check("bugbot#1: markdowns differ only by timestamp", md1 != md2 or "**Timestamp:**" in md1)
    check("bugbot#1: digest identical despite different timestamps",
          m.content_hash(md1) == m.content_hash(md2))
    check("bugbot#1: digest still changes when content changes",
          m.content_hash(md1) != m.content_hash(md1 + "\n- new correction"))
    m.STATE_PATH = Path(tempfile.mkdtemp()) / "state.json"
    now2 = datetime.now().astimezone()
    m.record_state("bb1", m.content_hash(md1), now2)
    check("bugbot#1: same transcript twice -> second blocked by cooldown",
          m.cooldown_blocks("bb1", m.content_hash(md2), now2))

    # Bugbot #2 (MED) — failed write must NOT record cooldown state.
    m.STATE_PATH = Path(tempfile.mkdtemp()) / "state.json"
    orig_write, orig_brain, orig_oklog = m.write_checkpoint, m.brain_store_via_socket, m.append_ok_log
    m.write_checkpoint = lambda *a, **k: None  # simulate write failure
    m.brain_store_via_socket = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("offline"))
    m.append_ok_log = lambda *a, **k: True
    try:
        rc = m.run({"session_id": "bb2", "trigger": "auto", "transcript_path": str(p)}, str(p))
    finally:
        m.write_checkpoint, m.brain_store_via_socket, m.append_ok_log = orig_write, orig_brain, orig_oklog
    check("bugbot#2: failed write -> no cooldown state recorded", not m.STATE_PATH.exists())
    check("bugbot#2: run still returns 0 on failed write (non-crash path)", rc == 0)
    # and a successful write DOES record state
    m.STATE_PATH = Path(tempfile.mkdtemp()) / "state.json"
    out_md = Path(tempfile.mkdtemp()) / "ok.md"
    m.brain_store_via_socket = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("offline"))
    m.append_ok_log = lambda *a, **k: True
    try:
        m.run({"session_id": "bb2b", "trigger": "auto", "transcript_path": str(p)}, str(p), out_path=str(out_md))
    finally:
        m.brain_store_via_socket, m.append_ok_log = orig_brain, orig_oklog
    check("bugbot#2: successful write -> cooldown state recorded", m.STATE_PATH.exists())

    # Bugbot #3 (MED) — unexpected failure exits non-zero + writes failure marker.
    m.FAIL_MARKER_PATH = Path(tempfile.mkdtemp()) / "precompact-FAILED.marker"
    rc = m.handle_unexpected_failure(RuntimeError("boom"))
    check("bugbot#3: handle_unexpected_failure returns non-zero", rc == 1)
    check("bugbot#3: failure marker file written", m.FAIL_MARKER_PATH.exists())
    check("bugbot#3: marker records the error",
          "boom" in m.FAIL_MARKER_PATH.read_text(encoding="utf-8"))

    # Bugbot #4 (MED) — --replay without --out must hard-error (never touch live dir).
    proc = subprocess.run(
        [sys.executable, str(HOOK), "--replay", str(p)],
        capture_output=True, text=True)
    check("bugbot#4: --replay without --out exits non-zero", proc.returncode != 0)
    check("bugbot#4: error names the --out requirement", "--out" in proc.stderr)
    proc_ok = subprocess.run(
        [sys.executable, str(HOOK), "--replay", str(p), "--out",
         str(Path(tempfile.mkdtemp()) / "replay.md")],
        capture_output=True, text=True)
    check("bugbot#4: --replay with --out succeeds", proc_ok.returncode == 0)

    # Bugbot #5 (LOW) — socket ack validation.
    def raises(fn):
        try:
            fn()
            return False
        except RuntimeError:
            return True
    check("bugbot#5: empty response rejected", raises(lambda: m.validate_brainbar_ack(b"")))
    check("bugbot#5: unparseable response rejected", raises(lambda: m.validate_brainbar_ack(b"not json\n")))
    check("bugbot#5: error response rejected", raises(
        lambda: m.validate_brainbar_ack(b'{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"nope"}}\n')))
    check("bugbot#5: ack missing result rejected", raises(
        lambda: m.validate_brainbar_ack(b'{"jsonrpc":"2.0","id":1}\n')))
    check("bugbot#5: valid result ack accepted",
          m.validate_brainbar_ack(b'{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"stored"}]}}\n').get("result") is not None)

    # --- M1 path-seizure regressions ------------------------------------------

    # M1's empty checkpoints came from Codex rollout JSONL. Codex stores cwd in
    # session_meta.payload.cwd rather than on top-level Claude user records.
    codex_repo = Path(tempfile.mkdtemp()) / "mimir"
    codex_repo.mkdir()
    (codex_repo / ".git").mkdir()
    codex_transcript = codex_repo / "rollout.jsonl"
    codex_transcript.write_text(
        json.dumps({
            "type": "session_meta",
            "payload": {"session_id": "codex-1", "cwd": str(codex_repo)},
        }) + "\n" +
        json.dumps({
            "type": "response_item",
            "payload": {"type": "message", "role": "user", "content": []},
        }) + "\n",
        encoding="utf-8",
    )
    codex_records, codex_cwd, codex_err = m.parse_transcript(str(codex_transcript))
    check("m1#1: Codex session_meta cwd is discovered", codex_cwd == str(codex_repo))
    check("m1#1: unsupported Codex content remains zero records", codex_records == [] and codex_err is None)

    nested_cwd = codex_repo / "src" / "pkg"
    nested_cwd.mkdir(parents=True)
    has_repo_resolver = hasattr(m, "repo_root_from_cwd")
    check("m1#2: cwd resolves to its working repository",
          has_repo_resolver and m.repo_root_from_cwd(str(nested_cwd)) == codex_repo.resolve())
    has_checkpoint_resolver = hasattr(m, "checkpoint_dir_from_cwd")
    check("m1#2: checkpoint directory is repository-local",
          has_checkpoint_resolver and
          m.checkpoint_dir_from_cwd(str(nested_cwd)) ==
          codex_repo.resolve() / "docs.local" / "handoffs")
    check("m1#2: unknown cwd uses HOME-relative fallback",
          has_checkpoint_resolver and
          m.checkpoint_dir_from_cwd(None) == Path.home() / ".claude" / "precompact-checkpoints")
    known_nonrepo = Path(tempfile.mkdtemp()) / "scratch-session"
    known_nonrepo.mkdir()
    check("m1#2: known non-repo cwd stays cwd-local",
          has_checkpoint_resolver and
          m.checkpoint_dir_from_cwd(str(known_nonrepo)) ==
          known_nonrepo.resolve() / "docs.local" / "handoffs")
    check("m1#2: missing cwd is never labeled orchestrator",
          m.project_from_cwd(None) == "unknown")

    # Project tagging should use the canonical repository name even when the
    # active checkout is a linked worktree with an unrelated branch directory.
    canonical_repo = Path(tempfile.mkdtemp()) / "mimir"
    git_worktree_dir = canonical_repo / ".git" / "worktrees" / "branch-checkout"
    git_worktree_dir.mkdir(parents=True)
    worktree_root = Path(tempfile.mkdtemp()) / "branch-checkout"
    worktree_root.mkdir()
    (worktree_root / ".git").write_text(
        f"gitdir: {git_worktree_dir}\n", encoding="utf-8")
    check("m1#2: linked worktree keeps canonical project name",
          m.project_from_cwd(str(worktree_root)) == "mimir")
    check("m1#2: linked worktree checkpoint stays in active checkout",
          has_checkpoint_resolver and
          m.checkpoint_dir_from_cwd(str(worktree_root)) ==
          worktree_root.resolve() / "docs.local" / "handoffs")

    # The live write path must accept cwd and place the checkpoint below that
    # repository. Keep the write inside the synthetic temporary repository.
    routed_path = None
    try:
        routed_path = m.write_checkpoint("checkpoint", "m1-route", now, cwd=str(nested_cwd))
    except TypeError:
        pass
    check("m1#2: write_checkpoint routes by cwd",
          routed_path is not None and
          routed_path.parent == codex_repo.resolve() / "docs.local" / "handoffs")

    # Degenerate parses must return before checkpoint, BrainLayer, or cooldown
    # persistence. Exercise zero-record, noise-only, and read-error variants.
    orig_parse = m.parse_transcript
    orig_write = m.write_checkpoint
    orig_brain = m.brain_store_via_socket
    orig_oklog = m.append_ok_log
    orig_record = m.record_state
    calls = {"write": 0, "brain": 0, "state": 0}
    m.write_checkpoint = lambda *a, **k: calls.__setitem__("write", calls["write"] + 1)
    m.brain_store_via_socket = lambda *a, **k: calls.__setitem__("brain", calls["brain"] + 1)
    m.append_ok_log = lambda *a, **k: True
    m.record_state = lambda *a, **k: calls.__setitem__("state", calls["state"] + 1)
    degenerate_cases = [
        ([], str(codex_repo), None),
        ([{"kind": "queue", "text": "Fleet-monitor tick (test)", "line": 1}], str(codex_repo), None),
        ([], None, "transcript missing"),
    ]
    try:
        for parsed in degenerate_cases:
            m.parse_transcript = lambda _path, result=parsed: result
            check("m1#3: degenerate checkpoint skip is non-blocking",
                  m.run({"session_id": "m1-empty", "trigger": "auto"}, "ignored") == 0)
    finally:
        m.parse_transcript = orig_parse
        m.write_checkpoint = orig_write
        m.brain_store_via_socket = orig_brain
        m.append_ok_log = orig_oklog
        m.record_state = orig_record
    check("m1#3: degenerate parses never persist checkpoints", calls["write"] == 0)
    check("m1#3: degenerate parses never persist to BrainLayer", calls["brain"] == 0)
    check("m1#3: degenerate parses never persist cooldown state", calls["state"] == 0)

    print(f"\n{'ALL PASS' if not failures else f'{len(failures)} FAILED: {failures}'}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())

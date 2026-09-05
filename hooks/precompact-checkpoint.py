#!/usr/bin/env python3
"""PreCompact safety-net checkpoint hook (JSONL-aware, PR-K1).

Fires on Claude Code's PreCompact event (live mode: payload on stdin) OR on demand
to replay a past transcript (`--replay <jsonl> --out <md>`). Both paths share one
code body. Writes a structured handoff markdown so compaction stops destroying state.

Gen-15 measured the prior version at 0/34 corrections captured: it parsed `<user>`
XML, but Claude Code transcripts are JSONL. This version fixes all five root causes
from gen16 PLAN §3a:

  1. Parse transcripts as JSONL — type:"user" string turns (skip tool_result/isMeta)
     PLUS type:"queue-operation",operation:"enqueue" content (queue-delivered turns).
  2. Derive project from the transcript `cwd` field, never full-text grep.
  3. Cap extracted lines (500 chars); skip skill_listing / task-notification /
     command-message attachments (kills 500KB dumps).
  4. Cooldown/dedup: skip if a same-session checkpoint <10min old has equal content
     hash (kills double-write). Replay mode bypasses cooldown.
  5. Emit a FIRST-ACTION CONTRACT header (raw transcript + newest gen*-boot.md +
     live collab channel) and a REMEMBER-LIST section.
"""
import argparse
import hashlib
import json
import re
import socket
import sys
from datetime import datetime
from pathlib import Path

HOME_DIR = Path.home()
FALLBACK_CHECKPOINT_DIR = HOME_DIR / ".claude/precompact-checkpoints"
OK_LOG_PATH = HOME_DIR / ".claude/hooks/logs/precompact.jsonl"
STATE_PATH = HOME_DIR / ".claude/hooks/logs/precompact-state.json"
SOCKET_PATH = "/tmp/brainbar.sock"
SOCKET_TIMEOUT = 10

MAX_LINE_CHARS = 500          # fix #3 — cap any extracted line
COOLDOWN_SECONDS = 10 * 60    # fix #4 — 10 min same-session dedup
MAX_CORRECTIONS = 60          # generous — gen-15 had ~34; we want >=30 to survive
MAX_ITEMS = 12                # cap for the lighter sections

# --- classifiers --------------------------------------------------------------
NOISE_RE = re.compile(r"^\s*(Convergence-watch tick|Fleet-monitor tick)", re.I)
TASK_NOTIF_RE = re.compile(r"<task-notification>|</task-notification>", re.I)
COMMAND_WRAP_RE = re.compile(r"<command-(message|name|args)>", re.I)
SKILL_LISTING_RE = re.compile(r"skill_listing|available[- ]skills", re.I)
BOOT_RE = re.compile(r"\bBOOT\b", re.I)
RELAY_RE = re.compile(r"^\s*@[A-Za-z0-9_-]+")

# A correction/intent turn: frustration, negation, directive, or steering signal.
CORRECTION_RE = re.compile(
    r"\b(wrong|don'?t|do not|stop|not that|i said|i told you|told you|"
    r"must|never|should|shouldn'?t|instead|why are|why is|why does|why do|"
    r"actually|no,|no\.|fix this|already|repeat myself|for fuck|fucking|"
    r"f\*ck|shit|trash|absolute|confused|i mean|i meant|you need to|"
    r"supposed to|that'?s not|isn'?t|aren'?t|can'?t|won'?t)\b",
    re.I,
)
# A remember-me turn: explicit memory request or idea-to-carry-forward.
REMEMBER_RE = re.compile(
    r"\b(remember|don'?t forget|do not forget|for tonight|for the weave|"
    r"for later|keep in mind|make sure|note that|make a note|i had an idea|"
    r"i wonder if|so i don'?t forget|carry forward|hold onto)\b",
    re.I,
)


def warn(message):
    print(f"[precompact-checkpoint] {message}", file=sys.stderr)


def clean_line(text):
    text = re.sub(r"`+", "", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > MAX_LINE_CHARS:
        text = text[: MAX_LINE_CHARS - 1] + "…"
    return text


def safe_load_payload():
    try:
        raw = sys.stdin.read()
        return json.loads(raw or "{}") if raw else {}
    except Exception as exc:
        warn(f"stdin payload unreadable: {exc}")
        return {}


# --- JSONL parsing (fix #1) ---------------------------------------------------
def parse_transcript(path_value):
    """Stream the JSONL transcript into structured turn records.

    Returns (records, cwd, read_error). Each record is a dict:
      {kind: 'user'|'queue'|'assistant', text: str, line: int}
    Tool-result user turns (content is a list) and isMeta turns are skipped.
    Reads line-by-line so a multi-MB file never lands in memory whole.
    """
    path = Path(path_value).expanduser() if path_value else None
    if not path:
        return [], None, "missing transcript_path"
    records = []
    cwds = {}
    try:
        with path.open(encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                t = obj.get("type")
                # Claude stores cwd on user records. Codex rollout JSONL stores
                # it in session_meta/turn_context payloads, independently from
                # the conversation record format.
                payload = obj.get("payload")
                if t in {"session_meta", "turn_context"} and isinstance(payload, dict):
                    metadata_cwd = payload.get("cwd")
                    if metadata_cwd:
                        cwds[metadata_cwd] = cwds.get(metadata_cwd, 0) + 1
                if t == "user":
                    if obj.get("isMeta"):
                        continue
                    msg = obj.get("message")
                    content = msg.get("content") if isinstance(msg, dict) else None
                    # Real text turns only; list content == tool_result(s), skip.
                    if not isinstance(content, str) or not content.strip():
                        continue
                    cwd = obj.get("cwd")
                    if cwd:
                        cwds[cwd] = cwds.get(cwd, 0) + 1
                    records.append({"kind": "user", "text": content, "line": i})
                elif t == "queue-operation" and obj.get("operation") == "enqueue":
                    content = obj.get("content")
                    if isinstance(content, str) and content.strip():
                        records.append({"kind": "queue", "text": content, "line": i})
                elif t == "assistant":
                    msg = obj.get("message")
                    content = msg.get("content") if isinstance(msg, dict) else None
                    if isinstance(content, list):
                        texts = [
                            b.get("text", "")
                            for b in content
                            if isinstance(b, dict) and b.get("type") == "text"
                        ]
                        joined = " ".join(x for x in texts if x).strip()
                        if joined:
                            records.append({"kind": "assistant", "text": joined, "line": i})
    except Exception as exc:
        return [], None, str(exc)
    cwd = max(cwds, key=cwds.get) if cwds else None
    return records, cwd, None


def is_noise(text):
    """Cron ticks, task-notifications, command wrappers, skill listings — not content."""
    head = text[:80]
    return bool(
        NOISE_RE.match(text)
        or TASK_NOTIF_RE.search(head)
        or COMMAND_WRAP_RE.search(head)
        or SKILL_LISTING_RE.search(text[:400])
    )


def repo_root_from_cwd(cwd):
    """Return the nearest repository containing cwd, or None when unknown."""
    if not cwd:
        return None
    path = Path(cwd).expanduser().resolve()
    if path.is_file():
        path = path.parent
    for candidate in (path, *path.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def checkpoint_dir_from_cwd(cwd):
    """Route to the session repo/cwd; use HOME only when cwd is unknown."""
    repo_root = repo_root_from_cwd(cwd)
    if repo_root:
        return repo_root / "docs.local/handoffs"
    if cwd:
        path = Path(cwd).expanduser().resolve()
        if path.is_file():
            path = path.parent
        return path / "docs.local/handoffs"
    return FALLBACK_CHECKPOINT_DIR


def canonical_repo_root(repo_root):
    """Resolve a linked worktree's .git file back to its canonical repo."""
    marker = repo_root / ".git"
    if not marker.is_file():
        return repo_root
    try:
        marker_text = marker.read_text(encoding="utf-8").strip()
    except Exception:
        return repo_root
    if not marker_text.startswith("gitdir:"):
        return repo_root
    git_dir = Path(marker_text.removeprefix("gitdir:").strip()).expanduser()
    if not git_dir.is_absolute():
        git_dir = (repo_root / git_dir).resolve()
    if git_dir.parent.name != "worktrees":
        return repo_root
    return git_dir.parent.parent.parent


def project_from_cwd(cwd):
    """fix #2 — project comes from cwd and never defaults to orchestrator."""
    repo_root = repo_root_from_cwd(cwd)
    if repo_root:
        return canonical_repo_root(repo_root).name
    if not cwd:
        return "unknown"
    return Path(cwd).name or "unknown"


def dedupe(items, limit):
    seen = set()
    out = []
    for item in items:
        key = item.lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def _skip_for_user_section(rec):
    """Common gate: only real user/queue turns that are not noise / relay / boot."""
    if rec["kind"] == "assistant":
        return True
    text = rec["text"]
    if is_noise(text) or RELAY_RE.match(text):
        return True
    if BOOT_RE.search(text[:40]):
        return True
    return False


def extract_corrections(records):
    out = [
        clean_line(rec["text"])
        for rec in records
        if not _skip_for_user_section(rec) and CORRECTION_RE.search(rec["text"])
    ]
    return dedupe(out, MAX_CORRECTIONS)


def extract_remember_list(records):
    out = [
        clean_line(rec["text"])
        for rec in records
        if not _skip_for_user_section(rec) and REMEMBER_RE.search(rec["text"])
    ]
    return dedupe(out, MAX_ITEMS)


def extract_session_intent(records):
    """First few real user turns (boot + earliest steering)."""
    out = []
    for rec in records:
        if rec["kind"] == "assistant":
            continue
        text = rec["text"]
        if is_noise(text) or RELAY_RE.match(text):
            continue
        out.append(clean_line(text))
        if len(out) >= 5:
            break
    return dedupe(out, 5)


def extract_pattern_lines(records, pattern, limit=MAX_ITEMS):
    rx = re.compile(pattern, re.I)
    out = []
    for rec in records:
        text = rec["text"]
        if is_noise(text):
            continue
        if rx.search(text):
            out.append(clean_line(text))
    return dedupe(out, limit)


# --- FIRST-ACTION CONTRACT (fix #5) -------------------------------------------
def newest_match(glob_dir, pattern, exclude=()):
    try:
        candidates = [
            p for p in glob_dir.glob(pattern)
            if p.is_file() and p.name not in exclude
        ]
    except Exception:
        return None
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def first_action_contract(transcript_path, cwd):
    repo_root = repo_root_from_cwd(cwd)
    handoff_dir = checkpoint_dir_from_cwd(cwd)
    boot = newest_match(handoff_dir, "*/gen*-boot.md")
    channel = None
    if repo_root:
        for collab_dir in (repo_root / "docs.local/collab", repo_root / "collab"):
            channel = newest_match(collab_dir, "2026-*.md", exclude={"TEMPLATE.md"})
            if channel:
                break
    trio = [
        str(transcript_path or "(transcript path missing)"),
        str(boot) if boot else "(no gen*-boot.md found)",
        str(channel) if channel else "(no live collab channel found)",
    ]
    lines = [
        "## FIRST-ACTION CONTRACT",
        "",
        "Successor MUST Read these ≤3 files before acting:",
        f"1. Raw transcript: `{trio[0]}`",
        f"2. Newest boot doc: `{trio[1]}`",
        f"3. Live collab channel: `{trio[2]}`",
    ]
    return "\n".join(lines)


def render_bullets(items, empty_message):
    if not items:
        return empty_message
    return "\n".join(f"- {item}" for item in items)


def build_markdown(payload, records, cwd, transcript_path, read_error):
    now = datetime.now().astimezone()
    session_id = payload.get("session_id") or "unknown"
    trigger = payload.get("trigger") or "unknown"
    project = project_from_cwd(cwd)

    corrections = extract_corrections(records)
    remember = extract_remember_list(records)
    intent = extract_session_intent(records)
    pr_state = extract_pattern_lines(records, r"\bPR\s*#\d+|github\.com/.*/pull/\d+|\bmerged\b|\bci failing\b")
    decisions = extract_pattern_lines(records, r"\bdecision:|\bdecided\b|\bchose\b|\brationale\b|\bRESOLVED:")
    next_steps = extract_pattern_lines(records, r"^- \[ \]|\bTODO:|\bNext:|\bPending:|\bBlocked:|\bfollow-up\b")

    current_state = [f"Transcript unreadable: {read_error}"] if read_error else []

    markdown = [
        f"# PreCompact Checkpoint — {session_id}",
        "",
        f"**Timestamp:** {now.isoformat()}",
        f"**Trigger:** {trigger}",
        f"**Transcript path:** {transcript_path or '(missing)'}",
        f"**Transcript turns:** {len(records)} parsed records",
        f"**Project:** {project}",
        "",
        first_action_contract(transcript_path, cwd),
        "",
        "## Session Intent",
        render_bullets(intent, "_No clear user intent captured._"),
        "",
        "## User Corrections",
        render_bullets(corrections, "_No direct user corrections captured._"),
        "",
        "## REMEMBER-LIST",
        render_bullets(remember, "_No explicit remember-requests captured._"),
        "",
        "## PR State",
        render_bullets(pr_state, "_No PR or collab state captured._"),
        "",
        "## Decisions",
        render_bullets(decisions, "_No explicit decisions captured._"),
        "",
        "## Next Steps",
        render_bullets(next_steps, "_No next steps captured._"),
        "",
    ]
    if current_state:
        markdown += ["## Current State", render_bullets(current_state, ""), ""]
    return "\n".join(markdown), project, now


# --- cooldown/dedup (fix #4) --------------------------------------------------
# Bugbot round-1 (HIGH): the rendered markdown embeds a fresh `**Timestamp:**`
# every run, so hashing it raw means back-to-back checkpoints of the SAME
# transcript never share a digest and the cooldown never blocks. Hash a
# normalized rendering with the timestamp line stripped.
TIMESTAMP_LINE_RE = re.compile(r"^\*\*Timestamp:\*\* .*$", re.M)


def content_hash(markdown):
    stable = TIMESTAMP_LINE_RE.sub("**Timestamp:** (normalized)", markdown)
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def cooldown_blocks(session_id, digest, now):
    """True if a same-session checkpoint <10min old has the same content hash."""
    try:
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return False
    if state.get("session") != session_id or state.get("hash") != digest:
        return False
    try:
        prev = datetime.fromisoformat(state["ts"])
    except Exception:
        return False
    return (now - prev).total_seconds() < COOLDOWN_SECONDS


def record_state(session_id, digest, now):
    try:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(
            json.dumps({"session": session_id, "hash": digest, "ts": now.isoformat()}),
            encoding="utf-8",
        )
    except Exception as exc:
        warn(f"state write failed: {exc}")


def write_checkpoint(markdown, session_id, now, cwd=None, out_path=None):
    if out_path:
        target = Path(out_path).expanduser()
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(markdown, encoding="utf-8")
            return target
        except Exception as exc:
            warn(f"--out write failed: {exc}")
            return None
    stem = f"{now.strftime('%Y-%m-%d-%H%M')}-{(session_id or 'unknown')[:8]}"
    target = checkpoint_dir_from_cwd(cwd) / f"{stem}.md"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(markdown, encoding="utf-8")
        return target
    except Exception as exc:
        warn(f"checkpoint write failed: {exc}")
        return None


def has_meaningful_content(records):
    """True when parsed records contain at least one non-noise text turn."""
    return any(
        isinstance(rec.get("text"), str)
        and rec["text"].strip()
        and not is_noise(rec["text"])
        for rec in records
    )


def append_ok_log(session_id, handoff_path, project, now, n_records, brainlayer_ok):
    record = {
        "ts": now.isoformat(),
        "session": session_id or "unknown",
        "handoff": str(handoff_path) if handoff_path else None,
        "project": project,
        "records": n_records,
        "brainlayer": brainlayer_ok,
    }
    try:
        OK_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with OK_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        return True
    except Exception as exc:
        warn(f"ok-log append failed: {exc}")
        return False


def validate_brainbar_ack(response):
    """Bugbot round-1 (LOW): an empty/unparseable socket reply is NOT success.

    Raises RuntimeError unless the response bytes parse as a JSON-RPC ack with a
    `result` field; callers only set brainlayer_ok=True when this returns.
    """
    if not response:
        raise RuntimeError("empty response from brainbar socket (no ack)")
    decoded = response.decode("utf-8", errors="replace").strip()
    first_line = decoded.splitlines()[0] if decoded else ""
    try:
        parsed = json.loads(first_line)
    except Exception:
        raise RuntimeError(f"unparseable brainbar ack: {decoded[:200]!r}")
    if not isinstance(parsed, dict):
        raise RuntimeError(f"brainbar ack is not a JSON object: {decoded[:200]!r}")
    if parsed.get("error"):
        raise RuntimeError(f"brainbar error: {decoded[:300]}")
    if "result" not in parsed:
        raise RuntimeError(f"brainbar ack missing result: {decoded[:200]!r}")
    return parsed


def brain_store_via_socket(content, project, now):
    date_tag = now.strftime("%Y-%m-%d")
    request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "brain_store",
            "arguments": {
                "content": content,
                "tags": ["pre-compact", "session-checkpoint", project, f"date-{date_tag}"],
                "importance": 9,
                "project": project,
                "type": "note",
            },
        },
    }
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(SOCKET_TIMEOUT)
    try:
        sock.connect(SOCKET_PATH)
        sock.sendall((json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"))
        response = b""
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            response += chunk
            if b"\n" in response:
                break
        validate_brainbar_ack(response)
    finally:
        sock.close()


def run(payload, transcript_path, out_path=None, replay=False):
    session_id = payload.get("session_id") or "unknown"
    records, cwd, read_error = parse_transcript(transcript_path)
    markdown, project, now = build_markdown(payload, records, cwd, transcript_path, read_error)

    if read_error or not has_meaningful_content(records):
        reason = f"read_error={read_error}" if read_error else "no meaningful parsed records"
        if not replay:
            append_ok_log(session_id, None, project, now, len(records), False)
        warn(
            f"PRECOMPACT_SKIP degenerate session={session_id} project={project} "
            f"records={len(records)} reason={reason}"
        )
        return 0

    digest = content_hash(markdown)
    if not replay and cooldown_blocks(session_id, digest, now):
        warn(f"PRECOMPACT_SKIP cooldown session={session_id} (identical <10min checkpoint)")
        return 0

    output_path = write_checkpoint(markdown, session_id, now, cwd=cwd, out_path=out_path)
    if output_path:
        warn(f"checkpoint written: {output_path}")

    brainlayer_ok = False
    if not replay:  # replay is offline analysis — don't pollute BrainLayer
        try:
            brain_store_via_socket(markdown, project, now)
            brainlayer_ok = True
        except Exception as exc:
            warn(f"BrainLayer store skipped: {exc}")
        append_ok_log(session_id, output_path, project, now, len(records), brainlayer_ok)
        # Bugbot round-1 (MED): only record cooldown state after a SUCCESSFUL
        # write — otherwise dedup state can reflect a never-persisted checkpoint
        # and suppress a later legitimate write.
        if output_path:
            record_state(session_id, digest, now)

    warn(
        f"PRECOMPACT_OK session={session_id} handoff={output_path or 'none'} "
        f"project={project} records={len(records)} brainlayer={'ok' if brainlayer_ok else 'fail'}"
    )
    return 0


def main():
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--replay", help="path to a past JSONL transcript to checkpoint")
    parser.add_argument("--out", help="write the checkpoint markdown to this path")
    args, _ = parser.parse_known_args()

    if args.replay:
        # Bugbot round-1 (MED): replay is offline analysis — it must NEVER write
        # into a live handoff directory, where it could overwrite real handoffs.
        if not args.out:
            parser.error("--replay requires --out <path> (refusing to write into the live handoff dir)")
        payload = {"session_id": "replay", "trigger": "replay", "transcript_path": args.replay}
        return run(payload, args.replay, out_path=args.out, replay=True)

    payload = safe_load_payload()
    return run(payload, payload.get("transcript_path"), out_path=args.out, replay=False)


FAIL_MARKER_PATH = OK_LOG_PATH.parent / "precompact-FAILED.marker"


def handle_unexpected_failure(exc):
    """Bugbot round-1 (MED): a crashed checkpoint must not look like success.

    Per Claude Code hook semantics (docs: hooks — exit-code table), PreCompact
    exit 2 BLOCKS compaction, which would harmfully wedge a high-context session;
    exit 1 is a non-blocking error (stderr shown, compaction proceeds). So we:
    exit 1 (non-zero for monitoring, never blocks), emit a loud structured
    stderr marker, AND drop a failure-marker file — consistent with the
    no-silent-degradation law: a lost handoff must always leave loud evidence.
    """
    warn(f"PRECOMPACT_FAIL unexpected failure — handoff NOT guaranteed: {exc}")
    try:
        FAIL_MARKER_PATH.parent.mkdir(parents=True, exist_ok=True)
        FAIL_MARKER_PATH.write_text(
            json.dumps({"ts": datetime.now().astimezone().isoformat(), "error": str(exc)}) + "\n",
            encoding="utf-8",
        )
    except Exception as marker_exc:
        warn(f"failure-marker write failed: {marker_exc}")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:
        sys.exit(handle_unexpected_failure(exc))

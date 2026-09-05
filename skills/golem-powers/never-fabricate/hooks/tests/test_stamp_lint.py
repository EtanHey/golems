"""RED/GREEN tests for the stamp/status lint hook (Phase-2 Fix-5, weave 2026-06-07).

Specimens come from docs.local/weave-2026-06-07/CORRECTIONS.md §4 (the run's own
rule-break ledger): the future-stamp class (#0/F45 19:05-stamped/18:49-written,
B1-F1 20:45/<=20:34, B1-F2 21:35/21:04, F44 ALL-ANSWERED-19:00/18:48, F48
MINE-FIRED-19:30/18:58, B1-F6 board "19:20"/18:53) plus the S22/#0
invented-staging artifact-existence class ("staging DONE 18:04: 47 sessions...").

SCOPE (honest, per B-taxonomy-adversary CH4): this lint covers the STAMP subclass
(~10 specimens) + the artifact-existence subclass (S22) ONLY. It does NOT cover
measurement errors (S28/B1-F3), laundering propagation (S31/B1-F7), stale cites
(B1-F9), or compressed quotes (B1-F11) — those need different mechanisms.

Each test pins the clock via STAMP_LINT_NOW so the specimen's real write-time is
reproduced exactly (stamps from CORRECTIONS.md, write times from its raw cites).
"""

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "stamp-lint.py"


def run_hook(tmp_path, file_path, now, tool_name="Write", tool_input=None,
             tool_response=None, content=None, write_file=True):
    """Simulate a PostToolUse event: put the post-tool file state on disk,
    then invoke the hook with the tool payload and a pinned clock."""
    file_path = Path(file_path)
    if write_file and content is not None:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content)
    if tool_input is None:
        tool_input = {"file_path": str(file_path), "content": content or ""}
    payload = {
        "hook_event_name": "PostToolUse",
        "session_id": "test-stamp-lint",
        "cwd": str(tmp_path),
        "tool_name": tool_name,
        "tool_input": tool_input,
        "tool_response": tool_response or {},
    }
    env = {
        "STAMP_LINT_NOW": now,
        "STAMP_LINT_STATE_DIR": str(tmp_path / "state"),
        "PATH": "/usr/bin:/bin",
    }
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=5,
        check=False,
        env=env,
    )


def warning_text(result):
    """Extract additionalContext from hook stdout; '' if no warning."""
    assert result.returncode == 0, (
        f"hook must NEVER deny/fail (advisory only); rc={result.returncode} "
        f"stderr={result.stderr}"
    )
    if not result.stdout.strip():
        return ""
    data = json.loads(result.stdout)
    out = data.get("hookSpecificOutput", {})
    assert "decision" not in data and "permissionDecision" not in out, (
        "advisory only — must never carry a deny/block decision"
    )
    return out.get("additionalContext", "")


def collab(tmp_path, name="2026-06-07-gen13-weave.md"):
    return tmp_path / "collab" / name


# --------------------------------------------------------------------------
# STAMP SUBCLASS — future-stamped status/headers (CORRECTIONS §4, ~10 cases)
# --------------------------------------------------------------------------

def test_s0_correction_header_stamped_1905_written_1849(tmp_path):
    """Specimen #0/F45: the anti-fabrication CORRECTION itself stamped 19:05,
    actually written 18:49 (15:49:17Z) — +16 min future stamp."""
    r = run_hook(tmp_path, collab(tmp_path), now="18:49",
                 tool_response={"type": "create"},
                 content="### orc — STRIKE + CORRECTION (19:05)\nspecimen #0 numbers were invented.\n")
    w = warning_text(r)
    assert "19:05" in w and "18:49" in w, f"expected future-stamp warning, got: {w!r}"


def test_f45_staging_numbers_paren_stamped_1920_posted_1853(tmp_path):
    """F45: real staging numbers stamped '(19:20)', posted 18:53 (15:53:50Z)."""
    r = run_hook(tmp_path, collab(tmp_path), now="18:53",
                 tool_response={"type": "create"},
                 content="real staging numbers (19:20): 41 units + 4 cursor clusters = 45\n")
    w = warning_text(r)
    assert "19:20" in w and "18:53" in w


def test_b1f1_2045_message_on_disk_by_2034(tmp_path):
    """B1-F1: '20:45' collab message on disk by 20:34:55 mtime — >=10 min early."""
    r = run_hook(tmp_path, collab(tmp_path), now="20:34",
                 tool_response={"type": "create"},
                 content="### orc (20:45)\nledger block: 661 raw / 45 files / 79 converged\n")
    w = warning_text(r)
    assert "20:45" in w and "20:34" in w


def test_b1f2_2135_message_existed_at_2104(tmp_path):
    """B1-F2: '21:35' message existed at 21:04 real clock — 31 min planned-ahead."""
    r = run_hook(tmp_path, collab(tmp_path), now="21:04",
                 tool_response={"type": "create"},
                 content="### orc (21:35)\nwrap status: re-score green\n")
    w = warning_text(r)
    assert "21:35" in w and "21:04" in w


def test_f44_all_answered_1900_written_1848(tmp_path):
    """F44: 'ALL ANSWERED 19:00' written 15:48:58Z = 18:48 IDT."""
    r = run_hook(tmp_path, collab(tmp_path), now="18:49",
                 tool_response={"type": "create"},
                 content="ALL ANSWERED (19:00) — three weave-seat answers posted\n")
    w = warning_text(r)
    assert "19:00" in w and "18:49" in w


def test_f48_mine_fired_1930_actual_1858(tmp_path):
    """F48: 'MINE FIRED 19:30' vs actual fire 15:57:48Z = 18:58 IDT."""
    r = run_hook(tmp_path, collab(tmp_path), now="18:58",
                 tool_response={"type": "create"},
                 content="MINE FIRED (19:30) — sttfix re-mine launched\n")
    w = warning_text(r)
    assert "19:30" in w and "18:58" in w


def test_b1f6_status_board_label_1920_posted_1854(tmp_path):
    """B1-F6 (resolved §2.10): the status board's '19:20' is the false stamp;
    real post 18:53-18:54."""
    r = run_hook(tmp_path, collab(tmp_path, "status-board.md"), now="18:54",
                 tool_response={"type": "create"},
                 content="board updated (19:20): staging numbers final\n")
    w = warning_text(r)
    assert "19:20" in w and "18:54" in w


def test_edit_new_string_future_stamped_header(tmp_path):
    """Edit path: only the tool input's NEW text is linted — a future-stamped
    header appended via Edit fires."""
    path = collab(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("### orc (22:55)\nold message.\n### weave-seat (23:50)\nnew status.\n")
    r = run_hook(tmp_path, path, now="23:00", tool_name="Edit",
                 tool_input={
                     "file_path": str(path),
                     "old_string": "old message.\n",
                     "new_string": "old message.\n### weave-seat (23:50)\nnew status.\n",
                 },
                 write_file=False)
    w = warning_text(r)
    assert "23:50" in w and "23:00" in w
    assert "22:55" not in w, "old lines must not be re-linted"


def test_append_write_with_cache_warns_only_on_new_line(tmp_path):
    """The C4 anti-false-fire design: append-style collab re-Writes lint only
    NEW lines (cache diff) — earlier messages' legitimately-past stamps stay
    silent, so the hook never trains seats to discount it (A5 cross-cutting #7)."""
    path = collab(tmp_path)
    first = "### orc (14:00)\nmorning kickoff.\n"
    r1 = run_hook(tmp_path, path, now="14:00",
                  tool_response={"type": "create"}, content=first)
    assert warning_text(r1) == ""
    # one hour later, the seat appends a future-stamped message
    r2 = run_hook(tmp_path, path, now="15:00",
                  tool_response={"type": "update"},
                  content=first + "### orc (15:45)\nafternoon status.\n")
    w = warning_text(r2)
    assert "15:45" in w and "15:00" in w
    assert "14:00" not in w.split("clock is")[0], (
        "the cached old line's stamp must not fire on append"
    )


def test_backfilled_header_past_stamp_warns_as_retro(tmp_path):
    """R13 retro class: a NEW message header stamped 4h in the past claims a
    write-time that never was — advisory warn (label it retro)."""
    r = run_hook(tmp_path, collab(tmp_path), now="18:00",
                 tool_response={"type": "create"},
                 content="### orc (14:00)\nbackfilled as if live.\n")
    w = warning_text(r)
    assert "14:00" in w and "18:00" in w


# --------------------------------------------------------------------------
# ARTIFACT-EXISTENCE SUBCLASS — S22 / specimen #0 invented staging
# --------------------------------------------------------------------------

def test_s22_invented_done_line_nonexistent_path(tmp_path):
    """Specimen #0 (S22 class): 'staging DONE 18:04: 47 sessions... 8 batches'
    written BEFORE any staging ran — the referenced artifact does not exist."""
    missing = tmp_path / "mine-context" / "batches"
    r = run_hook(tmp_path, collab(tmp_path), now="18:46",
                 tool_response={"type": "create"},
                 content=f"staging DONE 18:04: 47 sessions staged to {missing} (8 batches)\n")
    w = warning_text(r)
    assert str(missing) in w, f"expected artifact-existence warning, got: {w!r}"
    assert "does not exist" in w


def test_done_line_existing_path_silent(tmp_path):
    """A DONE line pointing at a real artifact is an output, not a plan — silent."""
    real = tmp_path / "mine-context" / "batches"
    real.mkdir(parents=True)
    r = run_hook(tmp_path, collab(tmp_path), now="18:46",
                 tool_response={"type": "create"},
                 content=f"staging DONE: 41 units staged to {real} (8 batches)\n")
    assert warning_text(r) == ""


# --------------------------------------------------------------------------
# NEGATIVE CONTROLS — precision (the C4 discount guard)
# --------------------------------------------------------------------------

def test_legit_stamp_at_write_time_silent(tmp_path):
    r = run_hook(tmp_path, collab(tmp_path), now="18:49",
                 tool_response={"type": "create"},
                 content="### orc (18:49)\nstamped from date at write time.\n")
    assert warning_text(r) == ""


def test_stamp_within_10min_tolerance_silent(tmp_path):
    r = run_hook(tmp_path, collab(tmp_path), now="18:49",
                 tool_response={"type": "create"},
                 content="### orc (18:55)\nsix minutes ahead — inside tolerance.\n")
    assert warning_text(r) == ""


def test_historical_quote_in_non_header_line_silent(tmp_path):
    """Quoting history is legitimate: past-divergence applies to message-header
    stamps only, never to prose/status mentions of past times."""
    r = run_hook(tmp_path, collab(tmp_path), now="22:00",
                 tool_response={"type": "create"},
                 content="vl #250 MERGED at (15:59) IDT — gh-verified, 6h ago\n")
    assert warning_text(r) == ""


def test_iso_utc_timestamps_not_treated_as_stamps(tmp_path):
    """gh/JSONL quotes like 2026-06-07T16:57:41Z must never be read as wall-clock
    stamps (they are UTC evidence, not write-time claims)."""
    r = run_hook(tmp_path, collab(tmp_path), now="14:00",
                 tool_response={"type": "create"},
                 content="merged 2026-06-07T16:57:41Z (16:57:41Z) per gh pr view\n")
    assert warning_text(r) == ""


def test_unknown_provenance_rewrite_past_stamps_silent(tmp_path):
    """A full re-Write of a never-seen pre-existing collab (no cache, type=update):
    line provenance is unknown, so only FUTURE stamps may fire — old past-stamped
    messages stay silent."""
    r = run_hook(tmp_path, collab(tmp_path, "old-collab.md"), now="22:00",
                 tool_response={"type": "update"},
                 content="### orc (09:15)\nancient message.\n### orc (13:40)\nlater message.\n")
    assert warning_text(r) == ""


def test_non_target_path_silent(tmp_path):
    r = run_hook(tmp_path, tmp_path / "README.md", now="18:49",
                 tool_response={"type": "create"},
                 content="### notes (19:30)\nnot a collab/weave/handoff file.\n")
    assert warning_text(r) == ""


def test_weaves_and_handoffs_paths_are_targeted(tmp_path):
    """docs.local/weaves/*.md and docs.local/handoffs/**.md are in scope."""
    weave = tmp_path / "docs.local" / "weaves" / "2026-06-07-weave.md"
    r = run_hook(tmp_path, weave, now="18:49",
                 tool_response={"type": "create"},
                 content="### weave-seat (19:05)\nfuture-stamped weave entry.\n")
    assert "19:05" in warning_text(r)
    handoff = tmp_path / "docs.local" / "handoffs" / "gen14" / "boot.md"
    r = run_hook(tmp_path, handoff, now="18:49",
                 tool_response={"type": "create"},
                 content="### orc (19:05)\nfuture-stamped handoff entry.\n")
    assert "19:05" in warning_text(r)


def test_appended_duplicate_of_cached_line_still_linted(tmp_path):
    """Codex review (PR #502): the cache is a multiset — appending an exact
    duplicate of an already-cached stamped header is still a NEW line and must
    be linted (here: a backfilled duplicate posted 115 min later)."""
    path = collab(tmp_path)
    first = "### orc (19:05)\nevening status.\n"
    r1 = run_hook(tmp_path, path, now="19:05",
                  tool_response={"type": "create"}, content=first)
    assert warning_text(r1) == ""
    r2 = run_hook(tmp_path, path, now="21:00",
                  tool_response={"type": "update"},
                  content=first + "### orc (19:05)\nevening status.\n")
    w = warning_text(r2)
    assert "19:05" in w and "21:00" in w, (
        f"duplicate appended line must still be linted, got: {w!r}"
    )


def test_create_inferred_from_response_text_without_type_field(tmp_path):
    """Codex review (PR #502): documented Write tool_response has no create/update
    type field — infer creation from the 'File created successfully' response
    text so backfilled headers in brand-new files still warn."""
    path = collab(tmp_path, "fresh-collab.md")
    r = run_hook(tmp_path, path, now="18:00",
                 tool_response={"filePath": str(path), "success": True,
                                "message": f"File created successfully at: {path}"},
                 content="### orc (14:00)\nbackfilled as if live.\n")
    w = warning_text(r)
    assert "14:00" in w and "18:00" in w


def test_empty_or_corrupted_cache_treated_as_unknown_provenance(tmp_path):
    """Bugbot review (PR #502): a cache file that parses to zero entries must
    behave like a MISSING cache (future-only), never 'everything is new'."""
    import hashlib
    path = collab(tmp_path, "empty-cache.md")
    state = tmp_path / "state"
    state.mkdir(parents=True, exist_ok=True)
    cache = state / (hashlib.sha1(str(path).encode()).hexdigest() + ".lines")
    cache.write_text("")  # empty/corrupted cache on disk
    r = run_hook(tmp_path, path, now="18:00",
                 tool_response={"type": "update"},
                 content="### orc (09:00)\nold message, past stamp.\n")
    assert warning_text(r) == ""


def test_unknown_provenance_skips_artifact_check(tmp_path):
    """Codex review (PR #502): NEW-lines-only applies to the artifact check too —
    an old DONE line whose artifact expired must not warn on an
    unknown-provenance rewrite."""
    r = run_hook(tmp_path, collab(tmp_path, "old-status.md"), now="18:00",
                 tool_response={"type": "update"},
                 content=f"staging DONE: 41 units staged to {tmp_path}/gone/batches (8 batches)\n")
    assert warning_text(r) == ""


def test_relative_target_path_resolved_against_cwd(tmp_path):
    """Codex review (PR #502): relative docs.local paths must still be in scope,
    resolved against the payload cwd."""
    abs_path = tmp_path / "docs.local" / "weaves" / "2026-06-07-weave.md"
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text("### weave-seat (19:05)\nfuture-stamped weave entry.\n")
    r = run_hook(tmp_path, abs_path, now="18:49",
                 tool_input={"file_path": "docs.local/weaves/2026-06-07-weave.md",
                             "content": ""},
                 tool_response={"type": "create"}, write_file=False)
    assert "19:05" in warning_text(r)


def test_malformed_payload_failsafe(tmp_path):
    env = {"STAMP_LINT_STATE_DIR": str(tmp_path / "state"), "PATH": "/usr/bin:/bin"}
    r = subprocess.run([sys.executable, str(HOOK)], input="not json", text=True,
                       capture_output=True, timeout=5, check=False, env=env)
    assert r.returncode == 0, "hook must fail open-and-silent on bad input (advisory)"

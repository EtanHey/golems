"""Regression tests for the collab PreToolUse guard.

The RED specimen is the recorded 2026-08-01 destructive rewrite of
``2026-08-01-voicelayer-worktree-census.md``: one Write reduced the file from
14,529 bytes to 5,072 bytes and the installed guard allowed it.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path


HOOK = Path(
    os.environ.get(
        "COLLAB_GUARD_HOOK_UNDER_TEST",
        str(Path(__file__).resolve().parent.parent / "collab-guard.py"),
    )
).expanduser()


def run_hook(payload, home):
    env = os.environ.copy()
    env["HOME"] = str(home)
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
        timeout=5,
        check=False,
    )


def sized_collab_content(size):
    prefix = "## PR Loop\n\n## TDD Red-Green-Refactor\n\n"
    padding = size - len(prefix.encode("utf-8"))
    assert padding >= 0
    return prefix + ("x" * padding)


def write_payload(file_path, content):
    return {
        "tool_name": "Write",
        "tool_input": {"file_path": str(file_path), "content": content},
        "session_id": "collab-guard-test",
    }


def edit_payload(file_path, old_string, new_string, replace_all=False):
    return {
        "tool_name": "Edit",
        "tool_input": {
            "file_path": str(file_path),
            "old_string": old_string,
            "new_string": new_string,
            "replace_all": replace_all,
        },
        "session_id": "collab-guard-test",
    }


def assert_shrink_refused(result, old_size, new_size):
    assert result.returncode == 2, (
        f"expected shrink refusal, got exit {result.returncode}; "
        f"stdout={result.stdout!r}, stderr={result.stderr!r}"
    )
    assert str(old_size) in result.stderr
    assert str(new_size) in result.stderr
    assert str(old_size - new_size) in result.stderr
    assert "COLLAB-SHRINK-OK" in result.stderr


def read_log(home):
    log = home / ".claude" / "hooks" / "collab-guard-shrink.log"
    assert log.exists(), "a deliberate shrink override must be logged"
    lines = log.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    return json.loads(lines[0])


def test_voicelayer_census_replay_refuses_14529_to_5072_write(tmp_path):
    collab = tmp_path / "collab" / "msgs" / "2026-08-01-voicelayer-worktree-census.md"
    collab.parent.mkdir(parents=True)
    collab.write_bytes(b"x" * 14_529)
    incoming = sized_collab_content(5_072)
    result = run_hook(write_payload(collab, incoming), tmp_path)

    assert_shrink_refused(result, 14_529, 5_072)


def test_arm_monitors_replay_refuses_6784_to_6519_write(tmp_path):
    collab = tmp_path / "collab" / "ARM-MONITORS.md"
    collab.parent.mkdir(parents=True)
    collab.write_bytes(b"x" * 6_784)
    incoming = sized_collab_content(6_519)

    result = run_hook(write_payload(collab, incoming), tmp_path)

    assert_shrink_refused(result, 6_784, 6_519)


def test_write_shrink_marker_allows_and_logs_override(tmp_path):
    collab = tmp_path / "collab" / "msgs" / "deliberate-correction.md"
    collab.parent.mkdir(parents=True)
    collab.write_bytes(b"x" * 1_000)
    marker = "<!-- COLLAB-SHRINK-OK: remove duplicated stale census -->"
    incoming = sized_collab_content(400 - len((marker + "\n").encode("utf-8")))
    incoming = marker + "\n" + incoming

    result = run_hook(write_payload(collab, incoming), tmp_path)

    assert result.returncode == 0, result.stderr
    event = read_log(tmp_path)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", event["timestamp"])
    assert event == {
        "timestamp": event["timestamp"],
        "file": str(collab),
        "old_bytes": 1_000,
        "new_bytes": 400,
        "reason": "remove duplicated stale census",
    }


def test_write_shrink_rejects_inline_or_empty_override_marker(tmp_path):
    collab = tmp_path / "collab" / "invalid-marker.md"
    collab.parent.mkdir(parents=True)
    collab.write_bytes(b"x" * 1_000)
    invalid_markers = (
        "prefix <!-- COLLAB-SHRINK-OK: inline is not a marker line -->",
        "<!-- COLLAB-SHRINK-OK:  -->",
    )

    for marker in invalid_markers:
        incoming = marker + "\n" + sized_collab_content(400)
        result = run_hook(write_payload(collab, incoming), tmp_path)
        assert result.returncode == 2


def test_new_equal_and_growing_writes_are_not_shrinks(tmp_path):
    new_file = tmp_path / "collab" / "new.md"
    new_file.parent.mkdir(parents=True)
    assert run_hook(write_payload(new_file, sized_collab_content(120)), tmp_path).returncode == 0

    existing = tmp_path / "collab" / "existing.md"
    existing.write_bytes(b"x" * 120)
    assert run_hook(write_payload(existing, sized_collab_content(120)), tmp_path).returncode == 0
    assert run_hook(write_payload(existing, sized_collab_content(121)), tmp_path).returncode == 0


def test_write_size_comparison_uses_utf8_bytes_not_character_count(tmp_path):
    collab = tmp_path / "collab" / "unicode.md"
    collab.parent.mkdir(parents=True)
    collab.write_bytes(b"x" * 80)
    incoming = "## PR Loop\n## TDD Red-Green-Refactor\n" + ("🙂" * 16)
    assert len(incoming) < 80
    assert len(incoming.encode("utf-8")) > 80

    result = run_hook(write_payload(collab, incoming), tmp_path)

    assert result.returncode == 0, result.stderr


def test_edit_refuses_net_file_shrink(tmp_path):
    collab = tmp_path / "collab" / "edit.md"
    collab.parent.mkdir(parents=True)
    old_string = "obsolete census row\n" * 20
    current = "## PR Loop\n## TDD\n" + old_string + "tail\n"
    collab.write_text(current, encoding="utf-8")
    new_string = "corrected row\n"
    expected = current.replace(old_string, new_string, 1)

    result = run_hook(edit_payload(collab, old_string, new_string), tmp_path)

    assert_shrink_refused(
        result,
        len(current.encode("utf-8")),
        len(expected.encode("utf-8")),
    )


def test_edit_replace_all_uses_net_file_size(tmp_path):
    collab = tmp_path / "collab" / "replace-all.md"
    collab.parent.mkdir(parents=True)
    current = "## PR Loop\n## TDD\n" + ("long repeated row\n" * 4)
    collab.write_text(current, encoding="utf-8")
    expected = current.replace("long repeated row", "row")

    result = run_hook(
        edit_payload(collab, "long repeated row", "row", replace_all=True),
        tmp_path,
    )

    assert_shrink_refused(
        result,
        len(current.encode("utf-8")),
        len(expected.encode("utf-8")),
    )


def test_edit_shrink_marker_in_new_string_allows_and_logs(tmp_path):
    collab = tmp_path / "collab" / "edit-override.md"
    collab.parent.mkdir(parents=True)
    old_string = "obsolete row\n" * 20
    current = "## PR Loop\n## TDD\n" + old_string + "tail\n"
    collab.write_text(current, encoding="utf-8")
    new_string = "<!-- COLLAB-SHRINK-OK: replace obsolete rows -->\ncorrected row\n"
    expected = current.replace(old_string, new_string, 1)

    result = run_hook(edit_payload(collab, old_string, new_string), tmp_path)

    assert result.returncode == 0, result.stderr
    event = read_log(tmp_path)
    assert event["old_bytes"] == len(current.encode("utf-8"))
    assert event["new_bytes"] == len(expected.encode("utf-8"))
    assert event["reason"] == "replace obsolete rows"


def test_edit_requires_marker_in_incoming_new_string(tmp_path):
    collab = tmp_path / "collab" / "old-marker.md"
    collab.parent.mkdir(parents=True)
    old_string = "obsolete row\n" * 10
    current = (
        "<!-- COLLAB-SHRINK-OK: an earlier deliberate edit -->\n"
        "## PR Loop\n## TDD\n"
        + old_string
    )
    collab.write_text(current, encoding="utf-8")
    new_string = "short row\n"
    expected = current.replace(old_string, new_string, 1)

    result = run_hook(edit_payload(collab, old_string, new_string), tmp_path)

    assert_shrink_refused(
        result,
        len(current.encode("utf-8")),
        len(expected.encode("utf-8")),
    )


def test_a_new_collab_without_the_pr_loop_and_tdd_keywords_is_allowed(tmp_path):
    # GO-5 E2: the PR-Loop/TDD keyword check is gone (hooks-audit: it only ever
    # saw Write, and `cat >>` posts never reach it). The shrink guard stays.
    collab = tmp_path / "collab" / "missing-sections.md"
    result = run_hook(write_payload(collab, "notes only"), tmp_path)

    assert result.returncode == 0, result.stderr
    assert "missing mandatory sections" not in result.stderr + result.stdout


def _advisory(result):
    out = json.loads(result.stdout or "{}")
    return out.get("hookSpecificOutput", {}).get("additionalContext", "")


def test_rewriting_an_existing_collab_in_place_is_flagged_even_with_identical_content(tmp_path):
    # GO-5: a collab rewritten in place (≈22:55Z) made every `tail -F` watcher
    # replay, even though nothing shrank. Collabs are append-only (`cat >>`), so
    # ANY Write/Edit of an existing collab is flagged -- identical bytes included.
    collab = tmp_path / "collab" / "live.md"
    collab.parent.mkdir(parents=True)
    content = sized_collab_content(120)
    collab.write_text(content, encoding="utf-8")

    for payload in (
        write_payload(collab, content),                      # identical rewrite
        write_payload(collab, content + "more\n"),          # growing rewrite
        edit_payload(collab, "x", "y"),                      # in-place edit
    ):
        result = run_hook(payload, tmp_path)
        assert result.returncode == 0, result.stderr
        assert "COLLAB-GUARD advisory" in _advisory(result), result.stdout
        assert "cat >>" in _advisory(result)


def test_a_brand_new_collab_file_is_not_flagged(tmp_path):
    collab = tmp_path / "collab" / "brand-new.md"
    result = run_hook(write_payload(collab, "fresh collab\n"), tmp_path)
    assert result.returncode == 0
    assert _advisory(result) == ""


def test_existing_edit_section_validation_behavior_is_preserved(tmp_path):
    collab = tmp_path / "collab" / "legacy-edit.md"
    collab.parent.mkdir(parents=True)
    collab.write_text("notes", encoding="utf-8")

    result = run_hook(edit_payload(collab, "notes", "notes expanded"), tmp_path)

    assert result.returncode == 0, result.stderr

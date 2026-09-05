from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import importlib.util
import json
import os
import sys
import types
from pathlib import Path

import pytest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "cmux_batch"


@pytest.fixture(scope="session")
def cmux_capture_batch_module():
    module_path = SCRIPTS_DIR / "cmux_capture_batch.py"
    if not module_path.exists():
        pytest.fail(f"cmux_capture_batch module must exist at {module_path}")
    scripts_dir = str(SCRIPTS_DIR)
    inserted_path = False
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
        inserted_path = True
    old_module = sys.modules.get("cmux_capture_batch")
    spec = importlib.util.spec_from_file_location("cmux_capture_batch", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["cmux_capture_batch"] = module
    spec.loader.exec_module(module)
    yield module
    if old_module is None:
        sys.modules.pop("cmux_capture_batch", None)
    else:
        sys.modules["cmux_capture_batch"] = old_module
    if inserted_path:
        try:
            sys.path.remove(scripts_dir)
        except ValueError:
            pass


def capture_fixture_batch(module):
    return module.capture_batch(
        [FIXTURE_DIR / "good_session.jsonl", FIXTURE_DIR / "bad_session.jsonl"],
        surface="cmux-mcp",
        condition="test",
        model_version="claude-opus-4-8-1m",
        catalog_context="test-fixtures",
        suite_version="cmux-live-v1",
        intent="fixture cmux batch",
        gold_call_budget=12,
    )


def rows_by_key(batch):
    return {row["metadata"]["session_key"]: row for row in batch["rows"]}


ALL_USAGE_SCORE_NAMES = (
    "executed_not_relayed",
    "focus_before_send",
    "docked_le2_columns",
    "reenumerated_after_change",
    "verified_after_action",
    "menu_confirmed_before_enter",
    "routed_by_agent",
    "model_tier_correct",
    "spawn_discipline",
    "call_economy",
    "success",
)


def complete_scores(**overrides):
    scores = {name: 1 for name in ALL_USAGE_SCORE_NAMES}
    scores.update(overrides)
    return scores


def starter_candidate(session_key: str, **score_overrides):
    scores = complete_scores(**score_overrides)
    return {
        "session_key": session_key,
        "source": f"/tmp/{session_key}.jsonl",
        "input": {
            "repo": "golems",
            "agent_name": "golemsClaude",
            "model": "opus",
            "agent_role": "lead",
            "reports_to": "lead-under-orc",
            "task_summary": session_key,
            "focus_before_send": scores["focus_before_send"],
            "executed_not_relayed": scores["executed_not_relayed"],
            "model_tier_correct": scores["model_tier_correct"],
            "docked_le2_columns": scores["docked_le2_columns"],
            "agent_type": "claude",
            "session_duration_ms": 1000,
        },
        "output": {"gold_primary": "cmux usage behavior"},
        "metadata": {
            "session_key": session_key,
            "scores": scores,
            "action_count": 1 if scores["executed_not_relayed"] else 0,
            "details": {"session_id": session_key, "source": f"/tmp/{session_key}.jsonl"},
        },
        "scores": scores,
        "evidence": {},
        "actions": [{}] if scores["executed_not_relayed"] else [],
    }


def make_cursor_jsonl(path: Path, *, mtime: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        '{"type":"assistant","message":{"content":[{"type":"tool_use",'
        '"name":"mcp__cmuxlayer__read_screen","input":{"surface":"surface:1"}}]}}\n'
    )
    os.utime(path, (mtime, mtime))
    return path


def make_catalog_only_jsonl(path: Path, *, mtime: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        '{"type":"system","deferred_tools_delta":[{"name":"mcp__cmuxlayer__read_screen"}]}\n'
        '{"type":"assistant","message":{"content":[{"type":"text",'
        '"text":"I can use cmux if needed."}]}}\n'
    )
    os.utime(path, (mtime, mtime))
    return path


def make_claude_jsonl(path: Path, *, session_id: str, mtime: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        '{"type":"user","timestamp":"2026-06-04T10:00:00.000Z",'
        '"sessionId":'
        f'{session_id!r}'.replace("'", '"')
        + ',"cwd":"/Users/example/Gits/golems",'
        '"message":{"role":"user","content":"You are a worker."}}\n'
        '{"type":"assistant","timestamp":"2026-06-04T10:00:01.000Z",'
        '"message":{"model":"claude-opus-4-8","role":"assistant",'
        '"content":[{"type":"tool_use","id":"toolu_1","name":"mcp__cmuxlayer__read_screen",'
        '"input":{"surface":"surface:110"}}]}}\n'
    )
    os.utime(path, (mtime, mtime))
    return path


def patch_mtime_lookup(monkeypatch, module, paths):
    monkeypatch.setattr(
        module,
        "find_jsonl_by_mtime",
        lambda _root, contains=None: [str(path) for path in paths],
    )


def test_since_last_cursor_skips_unchanged_and_selects_advanced_mtime(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    now = 10_000.0
    unchanged = make_cursor_jsonl(tmp_path / "unchanged.jsonl", mtime=7_000.0)
    advanced = make_cursor_jsonl(tmp_path / "advanced.jsonl", mtime=8_000.0)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [advanced, unchanged])

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={"unchanged": 7_000.0, "advanced": 7_900.0},
        idle_min=10,
        now=now,
    )

    assert [item.session_key for item in selected] == ["advanced"]
    assert selected[0].mtime == 8_000.0


def test_since_last_idle_gate_skips_recent_sessions(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    now = 10_000.0
    recent = make_cursor_jsonl(tmp_path / "recent.jsonl", mtime=now - 120)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [recent])

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={},
        idle_min=10,
        now=now,
    )

    assert selected == []


def test_default_idle_gate_is_five_minutes_and_selects_six_minute_old_sessions(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    now = 10_000.0
    six_min_old = make_cursor_jsonl(tmp_path / "six_min_old.jsonl", mtime=now - 360)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [six_min_old])

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={},
        now=now,
    )

    assert cmux_capture_batch_module.DEFAULT_IDLE_MIN == 5.0
    assert [item.session_key for item in selected] == ["six_min_old"]


def test_since_last_empty_cursor_selects_all_eligible_sessions(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    now = 10_000.0
    older = make_cursor_jsonl(tmp_path / "older.jsonl", mtime=7_000.0)
    newer = make_cursor_jsonl(tmp_path / "newer.jsonl", mtime=8_000.0)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [newer, older])

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={},
        idle_min=10,
        now=now,
    )

    assert [item.session_key for item in selected] == ["newer", "older"]


def test_since_last_skips_catalog_only_cmux_matches_with_zero_actions(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    now = 10_000.0
    catalog_only = make_catalog_only_jsonl(tmp_path / "catalog_only.jsonl", mtime=8_000.0)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [catalog_only])

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={},
        idle_min=10,
        now=now,
    )

    assert selected == []


def test_manual_discover_skips_catalog_only_cmux_matches_with_zero_actions(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    catalog_only = make_catalog_only_jsonl(tmp_path / "catalog_only.jsonl", mtime=8_000.0)
    active = make_cursor_jsonl(tmp_path / "active.jsonl", mtime=7_000.0)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [catalog_only, active])

    selected = cmux_capture_batch_module.discover_sessions([str(tmp_path)], limit=20)

    assert selected == [active]


def test_since_last_is_uncapped_unless_limit_is_explicit(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    now = 10_000.0
    paths = [
        make_cursor_jsonl(tmp_path / f"session_{idx:02d}.jsonl", mtime=7_000.0 + idx)
        for idx in range(21)
    ]
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, list(reversed(paths)))

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={},
        idle_min=10,
        now=now,
    )
    limited = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={},
        idle_min=10,
        now=now,
        limit=20,
    )

    assert len(selected) == 21
    assert len(limited) == 20


def test_since_last_zero_limit_selects_no_sessions(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    now = 10_000.0
    session = make_cursor_jsonl(tmp_path / "session.jsonl", mtime=7_000.0)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [session])

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={},
        idle_min=10,
        now=now,
        limit=0,
    )

    assert selected == []


def test_since_last_duplicate_stems_with_same_mtime_get_distinct_keys(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    now = 10_000.0
    first = make_cursor_jsonl(tmp_path / "one" / "duplicate.jsonl", mtime=7_000.0)
    second = make_cursor_jsonl(tmp_path / "two" / "duplicate.jsonl", mtime=7_000.0)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [first, second])

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={},
        idle_min=10,
        now=now,
    )

    keys = [item.session_key for item in selected]
    assert len(keys) == 2
    assert len(set(keys)) == 2


def test_since_last_duplicate_stems_honor_legacy_mtime_cursor_keys(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    now = 10_000.0
    first = make_cursor_jsonl(tmp_path / "one" / "duplicate.jsonl", mtime=7_000.0)
    second = make_cursor_jsonl(tmp_path / "two" / "duplicate.jsonl", mtime=8_000.0)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [first, second])
    cursor = {
        f"duplicate-{first.stat().st_mtime_ns}": first.stat().st_mtime,
        f"duplicate-{second.stat().st_mtime_ns}": second.stat().st_mtime,
    }

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor=cursor,
        idle_min=10,
        now=now,
    )

    assert selected == []


def test_since_last_honors_legacy_filename_stem_cursor_key_after_real_session_ids(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    session = make_claude_jsonl(
        tmp_path / "legacy-stem.jsonl",
        session_id="real-jsonl-session",
        mtime=7_000.0,
    )
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [session])

    selected = cmux_capture_batch_module.select_since_last_sessions(
        [str(tmp_path)],
        cursor={"legacy-stem": session.stat().st_mtime},
        idle_min=10,
        now=10_000.0,
    )

    assert selected == []


def test_since_last_main_holds_lock_while_selecting_sessions(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    events = []

    class FakeLock:
        def __init__(self, _path):
            pass

        def __enter__(self):
            events.append("enter")

        def __exit__(self, *_args):
            events.append("exit")

    def fake_select(*_args, **_kwargs):
        events.append("select")
        return []

    monkeypatch.setattr(cmux_capture_batch_module, "since_last_lock", FakeLock)
    monkeypatch.setattr(cmux_capture_batch_module, "load_since_last_cursor", lambda _path: {})
    monkeypatch.setattr(cmux_capture_batch_module, "select_since_last_sessions", fake_select)

    result = cmux_capture_batch_module.main(
        [
            "--since-last",
            "--cursor-path",
            str(tmp_path / "cursor.json"),
        ]
    )

    assert result == 0
    assert events == ["enter", "select", "exit"]


def test_capture_batch_honors_since_last_session_key_override(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    first = make_cursor_jsonl(tmp_path / "one" / "duplicate.jsonl", mtime=7_000.0)
    second = make_cursor_jsonl(tmp_path / "two" / "duplicate.jsonl", mtime=8_000.0)
    selected_key = cmux_capture_batch_module._session_keys([first, second])[first]

    def fake_capture_usage_run(src, **_kwargs):
        return {
            "source": src,
            "parse_errors": 0,
            "booted_model": "claude-opus-4-8",
            "actions": [{"action": "read_screen"}],
            "scores": {"executed_not_relayed": 1},
            "evidence": {"executed_not_relayed": [1]},
            "metadata": {},
        }

    monkeypatch.setattr(cmux_capture_batch_module, "capture_usage_run", fake_capture_usage_run)

    batch = cmux_capture_batch_module.capture_batch(
        [first],
        surface="cmux-mcp",
        condition="test",
        model_version="observed-live",
        session_keys={first: selected_key},
    )

    assert batch["rows"][0]["session_key"] == selected_key
    assert "session_key" not in batch["rows"][0]["input"]
    assert batch["rows"][0]["metadata"]["session_key"] == selected_key


def test_capture_batch_promotes_agent_identity_to_visible_row_input(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    session = make_cursor_jsonl(tmp_path / "session.jsonl", mtime=7_000.0)

    def fake_capture_usage_run(src, **_kwargs):
        return {
            "source": src,
            "parse_errors": 0,
            "booted_model": "claude-opus-4-8",
            "actions": [{"action": "read_screen"}],
            "scores": {"executed_not_relayed": 1},
            "evidence": {"executed_not_relayed": [1]},
            "metadata": {
                "agent_name": "voicelayer-LEAD",
                "agent_type": "claude",
                "agent_role": "lead",
                "repo": "voicelayer",
            },
        }

    monkeypatch.setattr(cmux_capture_batch_module, "capture_usage_run", fake_capture_usage_run)

    batch = cmux_capture_batch_module.capture_batch(
        [session],
        surface="cmux-mcp",
        condition="test",
        model_version="observed-live",
    )
    row = batch["rows"][0]

    assert row["input"]["agent_name"] == "voicelayer-LEAD"
    assert row["input"]["agent_type"] == "claude"
    assert row["input"]["agent_role"] == "lead"
    assert row["input"]["repo"] == "voicelayer"
    assert row["input"]["model"] == "opus"
    assert row["metadata"]["agent_name"] == "voicelayer-LEAD"


def test_capture_batch_uses_real_cli_session_id_not_cmux_filename(
    tmp_path,
    cmux_capture_batch_module,
):
    session = make_claude_jsonl(
        tmp_path / "surface-110.jsonl",
        session_id="claude-real-session-abc",
        mtime=7_000.0,
    )

    batch = cmux_capture_batch_module.capture_batch(
        [session],
        surface="cmux-mcp",
        condition="test",
        model_version="observed-live",
    )
    row = batch["rows"][0]

    assert row["session_key"] == "claude-real-session-abc"
    assert "session_key" not in row["input"]
    assert "session_id" not in row["input"]
    assert "source" not in row["input"]
    assert row["metadata"]["session_id"] == "claude-real-session-abc"
    assert row["metadata"]["details"]["session_id"] == "claude-real-session-abc"


def test_capture_batch_keeps_duration_timestamp_and_full_io_visible(
    tmp_path,
    cmux_capture_batch_module,
):
    session = make_claude_jsonl(
        tmp_path / "timed-session.jsonl",
        session_id="claude-timed-session",
        mtime=7_000.0,
    )

    batch = cmux_capture_batch_module.capture_batch(
        [session],
        surface="cmux-mcp",
        condition="test",
        model_version="observed-live",
    )
    row = batch["rows"][0]

    assert row["input"]["session_duration_ms"] == 1_000
    assert row["metadata"]["session_end_ts"] == "2026-06-04T10:00:01.000Z"
    assert "You are a worker." in row["output"]["user_input"]
    assert "agent_output" in row["output"]


def test_capture_batch_primary_input_columns_are_human_first(
    tmp_path,
    cmux_capture_batch_module,
):
    session = make_claude_jsonl(
        tmp_path / "human-first.jsonl",
        session_id="claude-human-first-session",
        mtime=7_000.0,
    )

    batch = cmux_capture_batch_module.capture_batch(
        [session],
        surface="cmux-mcp",
        condition="test",
        model_version="observed-live",
    )
    row = batch["rows"][0]

    assert list(row["input"])[:12] == [
        "repo",
        "agent_name",
        "model",
        "agent_role",
        "reports_to",
        "task_summary",
        "focus_before_send",
        "executed_not_relayed",
        "model_tier_correct",
        "docked_le2_columns",
        "agent_type",
        "session_duration_ms",
    ]
    assert "session_end_ts" not in row["input"]
    assert not {"session_key", "session_id", "source"}.intersection(row["input"])
    assert row["metadata"]["details"]["source"] == str(session)


def test_batch_leads_with_varying_evaluators_but_stores_all_scores(
    tmp_path,
    cmux_capture_batch_module,
):
    session = make_claude_jsonl(
        tmp_path / "scored-session.jsonl",
        session_id="claude-scored-session",
        mtime=7_000.0,
    )

    batch = cmux_capture_batch_module.capture_batch(
        [session],
        surface="cmux-mcp",
        condition="test",
        model_version="observed-live",
    )
    row = batch["rows"][0]

    assert list(row["input"])[6:10] == [
        "focus_before_send",
        "executed_not_relayed",
        "model_tier_correct",
        "docked_le2_columns",
    ]
    assert "call_economy" not in row["input"]
    assert "menu_confirmed_before_enter" not in row["input"]
    assert "call_economy" not in batch["evaluator_names"]
    assert "menu_confirmed_before_enter" not in batch["evaluator_names"]
    assert set(ALL_USAGE_SCORE_NAMES).issubset(row["metadata"]["scores"])
    assert row["metadata"]["score_call_economy"] == row["scores"]["call_economy"]
    assert row["metadata"]["score_menu_confirmed_before_enter"] == row["scores"][
        "menu_confirmed_before_enter"
    ]


def test_row_from_capture_keeps_surface_in_metadata_not_primary_input(
    cmux_capture_batch_module,
):
    scores = complete_scores()
    row = cmux_capture_batch_module._row_from_capture(
        {
            "source": "/tmp/session.jsonl",
            "session_id": "real-session",
            "actions": [{}],
            "scores": scores,
            "evidence": {},
            "metadata": {
                "agent_name": "golemsClaude",
                "agent_type": "claude",
                "agent_role": "standalone",
                "repo": "golems",
                "reports_to": "standalone",
                "task_summary": "test task",
                "session_duration_ms": 1000,
            },
        },
        session_key="real-session",
        surface="cmux-mcp",
        intent="test task",
        gold_call_budget=None,
    )

    assert "surface" not in row["input"]
    assert row["metadata"]["surface"] == "cmux-mcp"
    assert row["metadata"]["details"]["surface"] == "cmux-mcp"


def test_starter_selection_picks_four_diverse_rows_and_tags_metadata(
    cmux_capture_batch_module,
):
    rows = [
        starter_candidate("relay", executed_not_relayed=0, success=0),
        starter_candidate("dock0", docked_le2_columns=0),
        starter_candidate("focus0", focus_before_send=0),
        starter_candidate("clean"),
        starter_candidate("extra"),
    ]

    starter = cmux_capture_batch_module.select_starter_rows(rows)

    assert [row["metadata"]["session_key"] for row in starter] == [
        "clean",
        "focus0",
        "dock0",
        "relay",
    ]
    assert [row["metadata"]["starter_variant"] for row in starter] == [
        "clean_high",
        "focus_before_send_0",
        "docked_le2_columns_0",
        "relay_zero_exec",
    ]
    assert all("starter_reason" in row["metadata"] for row in starter)
    assert rows[0]["metadata"].get("starter_variant") is None


def test_starter_selection_prefers_isolated_focus_and_dock_contrasts(
    cmux_capture_batch_module,
):
    rows = [
        starter_candidate("clean"),
        starter_candidate("focus-and-dock", focus_before_send=0, docked_le2_columns=0),
        starter_candidate(
            "focus-only",
            focus_before_send=0,
            success=0,
            verified_after_action=0,
        ),
        starter_candidate("dock-only", docked_le2_columns=0),
        starter_candidate("relay", executed_not_relayed=0, success=0),
    ]

    starter = cmux_capture_batch_module.select_starter_rows(rows)

    assert [row["metadata"]["session_key"] for row in starter] == [
        "clean",
        "focus-only",
        "dock-only",
        "relay",
    ]
    assert [row["metadata"]["starter_variant"] for row in starter] == [
        "clean_high",
        "focus_before_send_0",
        "docked_le2_columns_0",
        "relay_zero_exec",
    ]


def test_starter_examples_use_stable_non_raw_example_ids(
    cmux_capture_batch_module,
):
    starter = cmux_capture_batch_module.select_starter_rows(
        [
            starter_candidate("clean"),
            starter_candidate("focus0", focus_before_send=0),
            starter_candidate("dock0", docked_le2_columns=0),
            starter_candidate("relay", executed_not_relayed=0, success=0),
        ]
    )

    examples = cmux_capture_batch_module._examples_from_rows(
        starter,
        stable_example_ids=True,
        dataset_name=cmux_capture_batch_module.STARTER_DATASET_NAME,
    )

    assert [example["example_id"] for example in examples] == [
        "cmux-usage-starter:clean_high",
        "cmux-usage-starter:focus_before_send_0",
        "cmux-usage-starter:docked_le2_columns_0",
        "cmux-usage-starter:relay_zero_exec",
    ]
    assert all("session_key" not in example["input"] for example in examples)


def test_capture_starter_batch_is_new_dataset_alongside_live_dataset(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    sessions = [
        make_claude_jsonl(
            tmp_path / f"session-{idx}.jsonl",
            session_id=f"starter-session-{idx}",
            mtime=7_000.0 + idx,
        )
        for idx in range(4)
    ]
    captured_dataset_names = []

    def fake_capture_batch(sources, **kwargs):
        captured_dataset_names.append(kwargs["dataset_name"])
        return {
            "dataset": {"name": kwargs["dataset_name"]},
            "rows": [
                starter_candidate("clean"),
                starter_candidate("focus0", focus_before_send=0),
                starter_candidate("dock0", docked_le2_columns=0),
                starter_candidate("relay", executed_not_relayed=0, success=0),
            ],
            "evaluator_names": list(cmux_capture_batch_module.USAGE_EVALUATORS),
            "summary": {},
        }

    monkeypatch.setattr(cmux_capture_batch_module, "capture_batch", fake_capture_batch)

    batch = cmux_capture_batch_module.capture_starter_batch(
        sessions,
        surface="cmux-mcp",
        condition="test",
        model_version="observed-live",
    )

    assert cmux_capture_batch_module.DEFAULT_DATASET_NAME == "cmux-mcp-usage-live"
    assert cmux_capture_batch_module.STARTER_DATASET_NAME == "cmux-usage-starter"
    assert captured_dataset_names == ["cmux-usage-starter"]
    assert batch["dataset"]["name"] == "cmux-usage-starter"
    assert len(batch["rows"]) == 4


def test_gold_sequence_is_configurable_and_documented_as_not_settled(
    tmp_path,
    cmux_capture_batch_module,
):
    session = make_claude_jsonl(
        tmp_path / "gold-config.jsonl",
        session_id="gold-config-session",
        mtime=7_000.0,
    )

    batch = cmux_capture_batch_module.capture_batch(
        [session],
        surface="cmux-mcp",
        condition="test",
        model_version="observed-live",
        gold_sequence=("send",),
        gold_sequence_note="Etan challenge: ideal may be send-only.",
    )
    row = batch["rows"][0]

    assert row["output"]["gold_sequence"] == ["send"]
    assert row["metadata"]["gold_sequence_note"] == "Etan challenge: ideal may be send-only."
    assert "virtue" not in row["metadata"]["gold_sequence_note"].lower()


def test_push_uses_human_readable_experiment_name_and_description(
    monkeypatch,
    cmux_capture_batch_module,
):
    batch = capture_fixture_batch(cmux_capture_batch_module)
    captured = {}

    class Dataset:
        id = "dataset-id"
        name = "cmux-mcp-usage-live"
        examples = []

    class Datasets:
        def get_dataset(self, **_kwargs):
            return Dataset()

        def add_examples_to_dataset(self, *, dataset, examples, **_kwargs):
            dataset.examples = examples
            return dataset

    class Experiments:
        def run_experiment(self, **kwargs):
            captured.update(kwargs)
            return {"task_runs": []}

    class Client:
        def __init__(self, **_kwargs):
            self.datasets = Datasets()
            self.experiments = Experiments()

    phoenix_module = types.ModuleType("phoenix")
    phoenix_client_module = types.ModuleType("phoenix.client")
    phoenix_client_module.Client = Client
    monkeypatch.setitem(sys.modules, "phoenix", phoenix_module)
    monkeypatch.setitem(sys.modules, "phoenix.client", phoenix_client_module)

    cmux_capture_batch_module.push_to_phoenix(batch)

    assert captured["experiment_name"].startswith("cmux-usage")
    assert "real sessions" in captured["experiment_name"]
    assert captured["experiment_description"].startswith("Per-session cmux MCP usage")
    assert "Replay precomputed" not in captured["experiment_description"]


def test_push_builds_missing_starter_dataset_once(
    monkeypatch,
    cmux_capture_batch_module,
):
    starter_rows = cmux_capture_batch_module.select_starter_rows(
        [
            starter_candidate("clean"),
            starter_candidate("focus0", focus_before_send=0),
            starter_candidate("dock0", docked_le2_columns=0),
            starter_candidate("relay", executed_not_relayed=0, success=0),
        ]
    )
    batch = {
        "dataset": {
            "name": cmux_capture_batch_module.STARTER_DATASET_NAME,
            "description": cmux_capture_batch_module.STARTER_EXPERIMENT_DESCRIPTION,
        },
        "rows": starter_rows,
    }
    calls = []

    class Dataset:
        id = "dataset-id"
        name = cmux_capture_batch_module.STARTER_DATASET_NAME
        examples = []

    class Datasets:
        def get_dataset(self, **_kwargs):
            raise RuntimeError("dataset missing")

        def create_dataset(self, **kwargs):
            calls.append(("create", kwargs))
            dataset = Dataset()
            dataset.examples = kwargs["examples"]
            return dataset

        def add_examples_to_dataset(self, **kwargs):
            calls.append(("add", kwargs))
            raise AssertionError("starter dataset should be refreshed, not append-deduped")

    class Experiments:
        def list(self, *, dataset_id, **_kwargs):
            assert dataset_id == "dataset-id"
            return []

        def run_experiment(self, **_kwargs):
            calls.append(("run", _kwargs))
            return {"task_runs": [], "experiment_id": "starter-exp"}

        def get_experiment_url(self, dataset_id, experiment_id):
            return f"/datasets/{dataset_id}/compare?experimentId={experiment_id}"

        def get_dataset_experiments_url(self, dataset_id):
            return f"/datasets/{dataset_id}/experiments"

    class Client:
        def __init__(self, **_kwargs):
            self.datasets = Datasets()
            self.experiments = Experiments()

    phoenix_module = types.ModuleType("phoenix")
    phoenix_client_module = types.ModuleType("phoenix.client")
    phoenix_client_module.Client = Client
    monkeypatch.setitem(sys.modules, "phoenix", phoenix_module)
    monkeypatch.setitem(sys.modules, "phoenix.client", phoenix_client_module)

    result = cmux_capture_batch_module.push_to_phoenix(
        batch,
        dataset_name=cmux_capture_batch_module.STARTER_DATASET_NAME,
        experiment_name="starter-test",
    )

    assert result["dataset_action"] == "created"
    assert result["examples_added"] == 4
    assert [kind for kind, _kwargs in calls] == ["create", "run"]
    assert calls[0][1]["name"] == cmux_capture_batch_module.STARTER_DATASET_NAME
    assert calls[0][1]["example_id_key"] == "example_id"
    assert len(calls[0][1]["examples"]) == 4
    assert [example["example_id"] for example in calls[0][1]["examples"]] == [
        "cmux-usage-starter:clean_high",
        "cmux-usage-starter:focus_before_send_0",
        "cmux-usage-starter:docked_le2_columns_0",
        "cmux-usage-starter:relay_zero_exec",
    ]


def test_push_existing_starter_dataset_is_frozen_and_does_not_write(
    monkeypatch,
    cmux_capture_batch_module,
):
    starter_rows = cmux_capture_batch_module.select_starter_rows(
        [
            starter_candidate("clean"),
            starter_candidate("focus0", focus_before_send=0),
            starter_candidate("dock0", docked_le2_columns=0),
            starter_candidate("relay", executed_not_relayed=0, success=0),
        ]
    )
    batch = {
        "dataset": {
            "name": cmux_capture_batch_module.STARTER_DATASET_NAME,
            "description": cmux_capture_batch_module.STARTER_EXPERIMENT_DESCRIPTION,
        },
        "rows": starter_rows,
    }
    calls = []

    class Dataset:
        id = "starter-dataset-id"
        name = cmux_capture_batch_module.STARTER_DATASET_NAME
        examples = [{"id": f"example-{idx}", "input": {"repo": "golems"}} for idx in range(4)]

    class Datasets:
        def get_dataset(self, **_kwargs):
            calls.append(("get", _kwargs))
            return Dataset()

        def create_dataset(self, **kwargs):
            calls.append(("create", kwargs))
            raise AssertionError("frozen starter rerun must not recreate examples")

        def add_examples_to_dataset(self, **kwargs):
            calls.append(("add", kwargs))
            raise AssertionError("frozen starter rerun must not append examples")

    class Experiments:
        def list(self, *, dataset_id, **_kwargs):
            assert dataset_id == "starter-dataset-id"
            return [{"id": "starter-exp"}]

        def run_experiment(self, **kwargs):
            calls.append(("run", kwargs))
            raise AssertionError("frozen starter rerun must not add experiments")

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return [
                {
                    "example_id": f"example-{idx}",
                    "repetition_number": 1,
                    "annotations": [
                        {"name": name}
                        for name in cmux_capture_batch_module.USAGE_EVALUATORS
                    ],
                }
                for idx in range(4)
            ]

    class Rest:
        def get(self, *_args, **_kwargs):
            return Response()

        def post(self, *_args, **_kwargs):
            return Response()

    class Client:
        def __init__(self, **_kwargs):
            self.datasets = Datasets()
            self.experiments = Experiments()
            self._client = Rest()

    phoenix_module = types.ModuleType("phoenix")
    phoenix_client_module = types.ModuleType("phoenix.client")
    phoenix_client_module.Client = Client
    monkeypatch.setitem(sys.modules, "phoenix", phoenix_module)
    monkeypatch.setitem(sys.modules, "phoenix.client", phoenix_client_module)

    result = cmux_capture_batch_module.push_to_phoenix(
        batch,
        dataset_name=cmux_capture_batch_module.STARTER_DATASET_NAME,
        experiment_name="starter-test",
    )

    assert result["pushed"] is True
    assert result["dataset_action"] == "frozen"
    assert result["examples_added"] == 0
    assert result["dataset_example_count"] == 4
    assert result["experiment_count"] == 1
    assert [kind for kind, _kwargs in calls] == ["get"]


def test_since_last_live_feed_never_writes_to_frozen_starter_dataset(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    session = make_claude_jsonl(
        tmp_path / "live-session.jsonl",
        session_id="live-session",
        mtime=7_000.0,
    )
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [session])
    posted_names: list[str] = []

    class Response:
        def __init__(self, payload=None):
            self._payload = payload if payload is not None else []

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class Dataset:
        def __init__(self, *, name, dataset_id, examples):
            self.name = name
            self.id = dataset_id
            self.examples = list(examples)

    starter_examples = [{"input": {"repo": "golems"}} for _idx in range(4)]
    datasets = {
        cmux_capture_batch_module.STARTER_DATASET_NAME: Dataset(
            name=cmux_capture_batch_module.STARTER_DATASET_NAME,
            dataset_id="starter-dataset-id",
            examples=starter_examples,
        ),
        cmux_capture_batch_module.DEFAULT_DATASET_NAME: Dataset(
            name=cmux_capture_batch_module.DEFAULT_DATASET_NAME,
            dataset_id="live-dataset-id",
            examples=[],
        ),
    }
    experiments = {
        "starter-dataset-id": [{"id": "starter-exp"}],
        "live-dataset-id": [],
    }

    class Datasets:
        def get_dataset(self, *, dataset, **_kwargs):
            return datasets[dataset]

        def create_dataset(self, **kwargs):
            if kwargs["name"] == cmux_capture_batch_module.STARTER_DATASET_NAME:
                raise AssertionError("live feed must not create or refresh starter")
            dataset = Dataset(
                name=kwargs["name"],
                dataset_id=f"{kwargs['name']}-id",
                examples=kwargs["examples"],
            )
            datasets[kwargs["name"]] = dataset
            return dataset

        def add_examples_to_dataset(self, *, dataset, examples, **_kwargs):
            if dataset.name == cmux_capture_batch_module.STARTER_DATASET_NAME:
                raise AssertionError("live feed must not append to starter")
            dataset.examples.extend(examples)
            return dataset

    class Experiments:
        def list(self, *, dataset_id, **_kwargs):
            return experiments[dataset_id]

        def run_experiment(self, *, dataset, **kwargs):
            if dataset.name == cmux_capture_batch_module.STARTER_DATASET_NAME:
                raise AssertionError("live feed must not add starter experiments")
            experiment_id = f"live-exp-{len(experiments[dataset.id]) + 1}"
            experiments[dataset.id].append({"id": experiment_id, "name": kwargs["experiment_name"]})
            return {
                "task_runs": [
                    {
                        "id": f"{experiment_id}-run-1",
                        "dataset_example_id": "live-example-1",
                        "repetition_number": 1,
                        "output": {"scores": {}},
                    }
                ],
                "experiment_id": experiment_id,
            }

        def get_experiment_url(self, dataset_id, experiment_id):
            return f"/datasets/{dataset_id}/compare?experimentId={experiment_id}"

        def get_dataset_experiments_url(self, dataset_id):
            return f"/datasets/{dataset_id}/experiments"

    class Client:
        def __init__(self, **_kwargs):
            self.datasets = Datasets()
            self.experiments = Experiments()
            self._client = self

        def get(self, *args, **_kwargs):
            path = str(args[0]) if args else ""
            if "experiments/" in path and path.endswith("/json"):
                return Response(
                    [
                        {
                            "example_id": "live-example-1",
                            "repetition_number": 1,
                            "annotations": [{"name": name} for name in posted_names],
                        }
                    ]
                )
            return Response()

        def post(self, *_args, json=None, **_kwargs):
            if isinstance(json, dict) and json.get("name"):
                posted_names.append(str(json["name"]))
            return Response()

    phoenix_module = types.ModuleType("phoenix")
    phoenix_client_module = types.ModuleType("phoenix.client")
    phoenix_client_module.Client = Client
    monkeypatch.setitem(sys.modules, "phoenix", phoenix_module)
    monkeypatch.setitem(sys.modules, "phoenix.client", phoenix_client_module)

    result = cmux_capture_batch_module.main(
        [
            "--since-last",
            "--push",
            "--dataset-name",
            cmux_capture_batch_module.STARTER_DATASET_NAME,
            "--find-root",
            str(tmp_path),
            "--cursor-path",
            str(tmp_path / "cursor.json"),
            "--lock-path",
            str(tmp_path / "cursor.lock"),
            "--limit",
            "1",
        ]
    )

    assert result == 0
    assert len(datasets[cmux_capture_batch_module.STARTER_DATASET_NAME].examples) == 4
    assert len(experiments["starter-dataset-id"]) == 1
    assert len(datasets[cmux_capture_batch_module.DEFAULT_DATASET_NAME].examples) == 1
    assert len(experiments["live-dataset-id"]) == 1


def test_manual_main_honors_zero_limit(
    monkeypatch,
    cmux_capture_batch_module,
):
    limits = []

    def fake_discover_sessions(*_args, **kwargs):
        limits.append(kwargs["limit"])
        return []

    monkeypatch.setattr(cmux_capture_batch_module, "discover_sessions", fake_discover_sessions)

    result = cmux_capture_batch_module.main(["--limit", "0"])

    assert result == 1
    assert limits == [0]


def test_batch_scores_each_session_with_non_identical_vectors(cmux_capture_batch_module):
    batch = capture_fixture_batch(cmux_capture_batch_module)
    rows = rows_by_key(batch)

    good_vector = cmux_capture_batch_module.score_vector(rows["good_session"])
    bad_vector = cmux_capture_batch_module.score_vector(rows["bad_session"])

    assert len(batch["rows"]) == 2
    assert good_vector != bad_vector
    assert cmux_capture_batch_module.composite_pass_rate(
        rows["good_session"]
    ) > cmux_capture_batch_module.composite_pass_rate(rows["bad_session"])


def test_summary_action_count_uses_metadata_not_primary_input(
    cmux_capture_batch_module,
):
    batch = capture_fixture_batch(cmux_capture_batch_module)
    rows = rows_by_key(batch)

    summary = cmux_capture_batch_module.summarize_rows([rows["good_session"]])

    assert "action_count" not in rows["good_session"]["input"]
    assert summary["per_session_composite"][0]["action_count"] == rows["good_session"]["metadata"]["action_count"]


def test_batch_task_uses_the_examples_own_scores_without_cross_contamination(
    cmux_capture_batch_module,
):
    batch = capture_fixture_batch(cmux_capture_batch_module)
    rows = rows_by_key(batch)
    task = cmux_capture_batch_module.make_score_task(batch["rows"])

    good_output = task({"input": {"session_key": "good_session"}})
    bad_output = task({"input": {"session_key": "bad_session"}})

    assert good_output["scores"] == rows["good_session"]["scores"]
    assert bad_output["scores"] == rows["bad_session"]["scores"]
    assert good_output["scores"] != bad_output["scores"]
    assert "session_key" not in good_output
    assert "source" not in good_output
    assert "session_key" not in bad_output
    assert "source" not in bad_output


def test_phoenix_examples_do_not_override_server_dataset_ids(cmux_capture_batch_module):
    batch = capture_fixture_batch(cmux_capture_batch_module)

    examples = cmux_capture_batch_module._examples_from_rows(batch["rows"])

    assert examples
    assert all("id" not in example for example in examples)
    assert all("session_key" not in example["input"] for example in examples)
    assert {example["metadata"]["session_key"] for example in examples} == {
        "good_session",
        "bad_session",
    }


def test_manual_evaluation_payloads_use_each_task_runs_own_scores(
    cmux_capture_batch_module,
):
    batch = capture_fixture_batch(cmux_capture_batch_module)
    rows = rows_by_key(batch)
    task = cmux_capture_batch_module.make_score_task(batch["rows"])
    good_run = {
        "id": "run-good",
        "dataset_example_id": "node-good",
        "repetition_number": 1,
        "output": task({"input": {"session_key": "good_session"}}),
    }
    bad_run = {
        "id": "run-bad",
        "dataset_example_id": "node-bad",
        "repetition_number": 1,
        "output": task({"input": {"session_key": "bad_session"}}),
    }

    good_payload = cmux_capture_batch_module.evaluation_payloads_for_run(
        good_run,
        evaluator_names=("success",),
        now="2026-06-04T00:00:00+00:00",
    )[0]
    bad_payload = cmux_capture_batch_module.evaluation_payloads_for_run(
        bad_run,
        evaluator_names=("success",),
        now="2026-06-04T00:00:00+00:00",
    )[0]

    assert good_payload["result"]["score"] == float(rows["good_session"]["scores"]["success"])
    assert bad_payload["result"]["score"] == float(rows["bad_session"]["scores"]["success"])
    assert "session_key" not in good_run["output"]
    assert "session_key" not in bad_run["output"]


def test_manual_evaluation_payloads_use_hidden_run_metadata(
    cmux_capture_batch_module,
):
    batch = capture_fixture_batch(cmux_capture_batch_module)
    rows = rows_by_key(batch)
    task = cmux_capture_batch_module.make_score_task(batch["rows"])
    run = {
        "id": "run-good",
        "dataset_example_id": "node-good",
        "repetition_number": 1,
        "metadata": rows["good_session"]["metadata"],
        "output": task({"metadata": {"session_key": "good_session"}}),
    }

    payload = cmux_capture_batch_module.evaluation_payloads_for_run(
        run,
        evaluator_names=("success",),
        now="2026-06-04T00:00:00+00:00",
    )[0]

    assert "session_key" not in run["output"]
    assert payload["metadata"]["session_key"] == "good_session"
    assert payload["metadata"]["source"] == rows["good_session"]["metadata"]["source"]
    assert "for session_key=good_session" in payload["result"]["explanation"]


def test_ensure_precomputed_evaluations_uses_dataset_example_metadata(
    cmux_capture_batch_module,
):
    posted = []

    class Response:
        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

        def raise_for_status(self):
            return None

    class RestClient:
        def get(self, *_args, **_kwargs):
            return Response([])

        def post(self, *_args, json=None, **_kwargs):
            posted.append(json)
            return Response({})

    class Client:
        _client = RestClient()

    cmux_capture_batch_module.ensure_precomputed_evaluations(
        Client(),
        experiment_id="experiment-1",
        task_runs=[
            {
                "id": "run-good",
                "dataset_example_id": "example-good",
                "repetition_number": 1,
                "output": {
                    "scores": {"success": 1},
                    "action_count": 1,
                },
            }
        ],
        evaluator_names=("success",),
        example_metadata_by_id={
            "example-good": {
                "session_key": "good-session",
                "source": "/tmp/good.jsonl",
                "agent_name": "golemsClaude",
            }
        },
    )

    assert posted[0]["metadata"]["session_key"] == "good-session"
    assert posted[0]["metadata"]["source"] == "/tmp/good.jsonl"
    assert posted[0]["metadata"]["agent_name"] == "golemsClaude"


def test_visible_evaluators_include_descriptions_in_results(cmux_capture_batch_module):
    payload = cmux_capture_batch_module.evaluation_payloads_for_run(
        {
            "id": "run-focus",
            "dataset_example_id": "node-focus",
            "repetition_number": 1,
            "output": {
                "session_key": "focus-session",
                "scores": {"focus_before_send": 1},
            },
        },
        evaluator_names=("focus_before_send",),
        now="2026-06-04T00:00:00+00:00",
    )[0]
    evaluator = cmux_capture_batch_module.make_evaluators()["focus_before_send"]
    result = evaluator(output={"scores": {"focus_before_send": 1}})

    assert "target surface before sending" in payload["result"]["explanation"]
    assert "target surface before sending" in payload["metadata"]["evaluator_description"]
    assert result["score"] == 1.0
    assert "target surface before sending" in result["metadata"]["evaluator_description"]


def test_json_safe_converts_phoenix_dataclass_results(cmux_capture_batch_module):
    @dataclass
    class FakeEvaluationRun:
        name: str
        start_time: datetime

    payload = {
        "phoenix_push": {
            "ran": {
                "evaluation_runs": [
                    FakeEvaluationRun(
                        name="success",
                        start_time=datetime(2026, 6, 4, tzinfo=timezone.utc),
                    )
                ]
            }
        }
    }

    safe = cmux_capture_batch_module.json_safe(payload)

    assert safe["phoenix_push"]["ran"]["evaluation_runs"][0] == {
        "name": "success",
        "start_time": "2026-06-04T00:00:00+00:00",
    }


def test_duplicate_session_key_fallback_uses_stable_16_char_hash(
    tmp_path,
    cmux_capture_batch_module,
):
    first = tmp_path / "one" / "duplicate.jsonl"
    second = tmp_path / "two" / "duplicate.jsonl"

    keys = cmux_capture_batch_module._session_keys([first, second])

    suffixes = [key.removeprefix("duplicate-") for key in keys.values()]
    assert {len(suffix) for suffix in suffixes} == {16}
    assert keys == cmux_capture_batch_module._session_keys([first, second])


def test_experiment_annotation_names_reports_missing_private_client(
    cmux_capture_batch_module,
):
    class ClientWithoutRest:
        pass

    with pytest.raises(RuntimeError, match="Phoenix client internal API changed"):
        cmux_capture_batch_module._experiment_annotation_names(ClientWithoutRest(), "exp")


def test_create_or_update_dataset_preserves_create_and_get_errors(
    cmux_capture_batch_module,
):
    class Datasets:
        def create_dataset(self, **_kwargs):
            raise ValueError("create failed")

        def get_dataset(self, **_kwargs):
            raise RuntimeError("get failed")

    class Client:
        datasets = Datasets()

    with pytest.raises(RuntimeError, match="create failed.*get failed"):
        cmux_capture_batch_module._create_or_update_dataset(Client(), "dataset", [])


def test_create_or_update_dataset_gets_existing_before_create(
    cmux_capture_batch_module,
):
    class Dataset:
        name = "dataset"
        id = "dataset-id"
        examples = [
            {
                "input": {
                    "session_key": "existing",
                }
            }
        ]

    class Datasets:
        def __init__(self):
            self.create_called = False
            self.added = []

        def create_dataset(self, **_kwargs):
            self.create_called = True
            raise AssertionError("create_dataset should not be called for an existing dataset")

        def get_dataset(self, **_kwargs):
            return Dataset()

        def add_examples_to_dataset(self, *, dataset, examples, **_kwargs):
            self.added = examples
            dataset.examples = list(dataset.examples) + examples
            return dataset

    class Client:
        def __init__(self):
            self.datasets = Datasets()

    client = Client()

    dataset, action, examples_added = cmux_capture_batch_module._create_or_update_dataset(
        client,
        "dataset",
        [
            {"input": {"session_key": "existing"}},
            {"input": {"session_key": "new"}},
        ],
    )

    assert action == "reused"
    assert examples_added == 1
    assert client.datasets.create_called is False
    assert [example["input"]["session_key"] for example in client.datasets.added] == ["new"]
    assert len(dataset.examples) == 2


def test_ensure_precomputed_evaluations_collects_upload_errors(
    cmux_capture_batch_module,
):
    class Response:
        def __init__(self, data=None):
            self._data = data

        def raise_for_status(self):
            return None

        def json(self):
            return self._data

    class Rest:
        def __init__(self):
            self.posts = []

        def get(self, _path, **_kwargs):
            annotations = [{"name": payload["name"]} for payload in self.posts]
            return Response(
                [
                    {
                        "example_id": "node-good",
                        "repetition_number": 1,
                        "annotations": annotations,
                    }
                ]
            )

        def post(self, _path, *, json, **_kwargs):
            if json["name"] == "focus_before_send":
                raise RuntimeError("post failed")
            self.posts.append(json)
            return Response({"data": {"id": "eval-1"}})

    class Client:
        _client = Rest()

    run = {
        "id": "run-good",
        "dataset_example_id": "node-good",
        "repetition_number": 1,
        "output": {
            "session_key": "good_session",
            "scores": {"success": 1, "focus_before_send": 0},
        },
    }

    result = cmux_capture_batch_module.ensure_precomputed_evaluations(
        Client(),
        experiment_id="exp",
        task_runs=[run],
        evaluator_names=("success", "focus_before_send"),
    )

    assert result["expected"] == 2
    assert result["uploaded"] == 1
    assert result["annotation_count_after"] == 1
    assert result["complete"] is False
    assert result["errors"][0]["name"] == "focus_before_send"
    assert "post failed" in result["errors"][0]["error"]


def test_ensure_precomputed_evaluations_marks_empty_runs_incomplete(
    cmux_capture_batch_module,
):
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return []

    class Rest:
        def get(self, _path, **_kwargs):
            return Response()

        def post(self, *_args, **_kwargs):
            raise AssertionError("empty task runs should not upload evaluations")

    class Client:
        _client = Rest()

    result = cmux_capture_batch_module.ensure_precomputed_evaluations(
        Client(),
        experiment_id="exp",
        task_runs=[],
        evaluator_names=("success",),
    )

    assert result["expected"] == 0
    assert result["annotation_count_after"] == 0
    assert result["complete"] is False


def test_json_safe_handles_bytes_frozenset_and_dict_objects(cmux_capture_batch_module):
    class Bag:
        def __init__(self):
            self.value = b"ok"

    safe = cmux_capture_batch_module.json_safe(
        {"bytes": b"hello", "items": frozenset(["one"]), "object": Bag()}
    )

    assert safe == {
        "bytes": "hello",
        "items": ["one"],
        "object": {"value": "ok"},
    }


def test_json_safe_does_not_asdict_dataclass_classes(cmux_capture_batch_module):
    @dataclass
    class DataClassType:
        value: str

    safe = cmux_capture_batch_module.json_safe({"class": DataClassType})

    assert "DataClassType" in safe["class"]


def test_rows_by_key_handles_missing_metadata_gracefully(cmux_capture_batch_module):
    rows = [
        {"session_key": "key1", "scores": {"success": 1}, "evidence": {}, "input": {}},
        {
            "metadata": {"session_key": "key2"},
            "scores": {"success": 0},
            "evidence": {},
            "input": {},
        },
    ]
    task = cmux_capture_batch_module.make_score_task(rows)

    output1 = task({"input": {"session_key": "key1"}})
    output2 = task({"input": {"session_key": "key2"}})

    assert output1["scores"] == {"success": 1}
    assert output2["scores"] == {"success": 0}


def test_push_falls_back_to_rows_when_dataset_examples_empty(
    monkeypatch,
    cmux_capture_batch_module,
):
    batch = capture_fixture_batch(cmux_capture_batch_module)
    posted_names: list[str] = []

    class Dataset:
        id = "dataset-id"
        name = "test-dataset"
        examples = []

    class Datasets:
        def get_dataset(self, **_kwargs):
            return Dataset()

        def add_examples_to_dataset(self, *, dataset, examples, **_kwargs):
            dataset.examples = []
            return dataset

    class Experiments:
        def run_experiment(self, **kwargs):
            return {
                "task_runs": [
                    {
                        "id": "exp-id-run-1",
                        "dataset_example_id": "example-1",
                        "repetition_number": 1,
                        "output": {"scores": {}},
                    }
                ],
                "experiment_id": "exp-id",
            }

        def get_experiment_url(self, *args):
            return "http://example.com/exp"

        def get_dataset_experiments_url(self, *args):
            return "http://example.com/dataset"

    class Response:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self._payload

    class Client:
        def __init__(self, **_kwargs):
            self.datasets = Datasets()
            self.experiments = Experiments()
            self._client = self

        def get(self, *args, **kwargs):
            path = str(args[0]) if args else ""
            if "experiments/" in path and path.endswith("/json"):
                return Response(
                    [
                        {
                            "example_id": "example-1",
                            "repetition_number": 1,
                            "annotations": [{"name": name} for name in posted_names],
                        }
                    ]
                )
            # Dataset example hydration stays empty so push falls back to rows.
            return Response([])

        def post(self, *args, json=None, **kwargs):
            if isinstance(json, dict) and json.get("name"):
                posted_names.append(str(json["name"]))
            return Response({})

    phoenix_module = types.ModuleType("phoenix")
    phoenix_client_module = types.ModuleType("phoenix.client")
    phoenix_client_module.Client = Client
    monkeypatch.setitem(sys.modules, "phoenix", phoenix_module)
    monkeypatch.setitem(sys.modules, "phoenix.client", phoenix_client_module)

    result = cmux_capture_batch_module.push_to_phoenix(batch)

    assert result["pushed"] is True


def test_bash_cmux_sessions_counted_for_discovery(tmp_path, cmux_capture_batch_module):
    bash_cmux_path = tmp_path / "bash_cmux.jsonl"
    bash_cmux_path.write_text(
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash",'
        '"input":{"command":"cmux list-panes --workspace workspace:1"}}]}}\n'
    )

    count = cmux_capture_batch_module.cmux_tool_use_count(bash_cmux_path)

    assert count == 1


def test_discover_sessions_returns_empty_for_zero_limit(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    session = make_claude_jsonl(tmp_path / "zero-limit.jsonl", session_id="zero-limit", mtime=7_000.0)
    patch_mtime_lookup(monkeypatch, cmux_capture_batch_module, [session])

    assert cmux_capture_batch_module.discover_sessions([str(tmp_path)], limit=0) == []
    assert cmux_capture_batch_module.discover_sessions([str(tmp_path)], limit=1) == [session]


def test_manual_mode_honors_custom_dataset_name(
    tmp_path,
    monkeypatch,
    cmux_capture_batch_module,
):
    fixture = FIXTURE_DIR / "good_session.jsonl"
    monkeypatch.setattr(
        cmux_capture_batch_module,
        "discover_sessions",
        lambda *_args, **_kwargs: [fixture],
    )
    out = tmp_path / "batch.json"

    result = cmux_capture_batch_module.main(
        ["--out", str(out), "--dataset-name", "custom-dataset"]
    )

    assert result == 0
    batch = json.loads(out.read_text())
    assert batch["dataset"]["name"] == "custom-dataset"

def test_since_last_and_starter_flags_are_mutually_exclusive(cmux_capture_batch_module):
    with pytest.raises(SystemExit):
        cmux_capture_batch_module.main(["--since-last", "--starter"])

def test_starter_push_with_no_task_runs_is_not_pushed(
    monkeypatch,
    cmux_capture_batch_module,
):
    starter_rows = cmux_capture_batch_module.select_starter_rows(
        [
            starter_candidate("clean"),
            starter_candidate("focus0", focus_before_send=0),
            starter_candidate("dock0", docked_le2_columns=0),
            starter_candidate("relay", executed_not_relayed=0, success=0),
        ]
    )
    batch = {
        "dataset": {
            "name": cmux_capture_batch_module.STARTER_DATASET_NAME,
            "description": cmux_capture_batch_module.STARTER_EXPERIMENT_DESCRIPTION,
        },
        "rows": starter_rows,
    }

    class Dataset:
        id = "dataset-id"
        name = cmux_capture_batch_module.STARTER_DATASET_NAME
        examples = []

    class Datasets:
        def get_dataset(self, **_kwargs):
            raise RuntimeError("dataset missing")

        def create_dataset(self, **kwargs):
            dataset = Dataset()
            dataset.examples = kwargs["examples"]
            return dataset

    class Experiments:
        def list(self, **_kwargs):
            return []

        def run_experiment(self, **_kwargs):
            return {"task_runs": [], "experiment_id": "starter-exp"}

        def get_experiment_url(self, dataset_id, experiment_id):
            return f"/datasets/{dataset_id}/compare?experimentId={experiment_id}"

        def get_dataset_experiments_url(self, dataset_id):
            return f"/datasets/{dataset_id}/experiments"

    class Client:
        def __init__(self, **_kwargs):
            self.datasets = Datasets()
            self.experiments = Experiments()

    phoenix_module = types.ModuleType("phoenix")
    phoenix_client_module = types.ModuleType("phoenix.client")
    phoenix_client_module.Client = Client
    monkeypatch.setitem(sys.modules, "phoenix", phoenix_module)
    monkeypatch.setitem(sys.modules, "phoenix.client", phoenix_client_module)

    result = cmux_capture_batch_module.push_to_phoenix(
        batch,
        dataset_name=cmux_capture_batch_module.STARTER_DATASET_NAME,
        experiment_name="starter-test",
    )

    assert result["pushed"] is False
    assert result["evaluation_upload"]["complete"] is False

def test_starter_flag_targets_starter_dataset_by_default(
    monkeypatch,
    cmux_capture_batch_module,
):
    fixture = FIXTURE_DIR / "good_session.jsonl"
    monkeypatch.setattr(
        cmux_capture_batch_module,
        "discover_starter_sessions",
        lambda *_args, **_kwargs: [fixture],
    )
    captured = {}
    original = cmux_capture_batch_module.capture_batch

    def spy_capture_batch(*args, **kwargs):
        captured["dataset_name"] = kwargs.get("dataset_name")
        return original(*args, **kwargs)

    monkeypatch.setattr(cmux_capture_batch_module, "capture_batch", spy_capture_batch)
    cmux_capture_batch_module.main(["--starter"])

    assert captured["dataset_name"] == cmux_capture_batch_module.STARTER_DATASET_NAME


def test_push_existing_starter_with_missing_evaluations_repairs_experiment_without_dataset_write(
    monkeypatch,
    cmux_capture_batch_module,
):
    starter_rows = cmux_capture_batch_module.select_starter_rows(
        [
            starter_candidate("clean"),
            starter_candidate("focus0", focus_before_send=0),
            starter_candidate("dock0", docked_le2_columns=0),
            starter_candidate("relay", executed_not_relayed=0, success=0),
        ]
    )
    batch = {
        "dataset": {
            "name": cmux_capture_batch_module.STARTER_DATASET_NAME,
            "description": cmux_capture_batch_module.STARTER_EXPERIMENT_DESCRIPTION,
        },
        "rows": starter_rows,
    }
    posted_names: list[str] = []
    deleted_experiments: list[str] = []
    reran: list[str] = []

    class Dataset:
        id = "starter-dataset-id"
        name = cmux_capture_batch_module.STARTER_DATASET_NAME
        # No example ids: per-example verification is impossible, so the
        # frozen short-circuit must stay conservative and trigger repair.
        examples = [{"input": {"repo": "golems"}} for _idx in range(4)]

    class Datasets:
        def get_dataset(self, **_kwargs):
            return Dataset()

        def create_dataset(self, **_kwargs):
            raise AssertionError("frozen starter repair must not rewrite examples")

        def add_examples_to_dataset(self, **_kwargs):
            raise AssertionError("frozen starter repair must not append examples")

    class Experiments:
        def list(self, *, dataset_id, **_kwargs):
            assert dataset_id == "starter-dataset-id"
            return [{"id": "starter-exp"}]

        def delete(self, *, experiment_id):
            deleted_experiments.append(experiment_id)

        def run_experiment(self, **kwargs):
            reran.append(kwargs.get("experiment_name"))
            return {
                "task_runs": [
                    {
                        "id": f"run-{idx}",
                        "dataset_example_id": f"example-{idx}",
                        "repetition_number": 1,
                        "output": {"scores": {}},
                    }
                    for idx in range(4)
                ],
                "experiment_id": "starter-exp-repaired",
            }

        def get_experiment_url(self, dataset_id, experiment_id):
            return f"/datasets/{dataset_id}/compare?experimentId={experiment_id}"

        def get_dataset_experiments_url(self, dataset_id):
            return f"/datasets/{dataset_id}/experiments"

    class Response:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class Rest:
        def get(self, *_args, **_kwargs):
            names = sorted(set(posted_names))
            return Response(
                [
                    {
                        "example_id": f"example-{idx}",
                        "repetition_number": 1,
                        "annotations": [{"name": name} for name in names],
                    }
                    for idx in range(4)
                ]
            )

        def post(self, *_args, json=None, **_kwargs):
            if isinstance(json, dict) and json.get("name"):
                posted_names.append(str(json["name"]))
            return Response({})

    class Client:
        def __init__(self, **_kwargs):
            self.datasets = Datasets()
            self.experiments = Experiments()
            self._client = Rest()

    phoenix_module = types.ModuleType("phoenix")
    phoenix_client_module = types.ModuleType("phoenix.client")
    phoenix_client_module.Client = Client
    monkeypatch.setitem(sys.modules, "phoenix", phoenix_module)
    monkeypatch.setitem(sys.modules, "phoenix.client", phoenix_client_module)

    result = cmux_capture_batch_module.push_to_phoenix(
        batch,
        dataset_name=cmux_capture_batch_module.STARTER_DATASET_NAME,
        experiment_name="starter-test",
    )

    assert deleted_experiments == ["starter-exp"]
    assert reran == ["starter-test"]
    assert result["examples_added"] == 0
    assert result["pushed"] is True
    assert result["evaluation_upload"]["complete"] is True

def test_frozen_evaluation_status_requires_each_frozen_example(cmux_capture_batch_module):
    full = [{"name": name} for name in cmux_capture_batch_module.USAGE_EVALUATORS]

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return [
                {"example_id": "example-0", "repetition_number": 1, "annotations": full},
                {"example_id": "example-1", "repetition_number": 1, "annotations": full},
                {"example_id": "example-2", "repetition_number": 1, "annotations": full},
                {"example_id": "extra-example", "repetition_number": 1, "annotations": full},
            ]

    class Rest:
        def get(self, *_args, **_kwargs):
            return Response()

        def post(self, *_args, **_kwargs):
            return Response()

    class Client:
        _client = Rest()

    status = cmux_capture_batch_module._frozen_experiment_evaluation_status(
        Client(),
        "starter-exp",
        row_count=4,
        expected_example_ids=[f"example-{idx}" for idx in range(4)],
    )

    assert status["complete"] is False
    assert status["complete_example_count"] == 3
    assert status["missing_examples"][0]["example_id"] == "example-3"


def test_frozen_evaluation_status_without_example_ids_is_never_complete(
    cmux_capture_batch_module,
):
    full = [{"name": name} for name in cmux_capture_batch_module.USAGE_EVALUATORS]

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return [
                {"example_id": f"example-{idx}", "repetition_number": 1, "annotations": full}
                for idx in range(4)
            ]

    class Rest:
        def get(self, *_args, **_kwargs):
            return Response()

        def post(self, *_args, **_kwargs):
            return Response()

    class Client:
        _client = Rest()

    status = cmux_capture_batch_module._frozen_experiment_evaluation_status(
        Client(),
        "starter-exp",
        row_count=4,
        expected_example_ids=(),
    )

    # Aggregate counts alone must never mark the frozen starter complete.
    assert status["complete"] is False


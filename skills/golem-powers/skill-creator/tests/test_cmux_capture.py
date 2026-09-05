from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
S48_BASELINE_SESSION_ID = "755e7f3a-c8d7-4597-b315-18795db65e1e"


def find_real_s48_baseline() -> Path | None:
    override = os.environ.get("CMUX_TEST_BASELINE_PATH")
    if override:
        return Path(override)
    root = Path.home() / ".claude" / "projects"
    matches = list(root.glob(f"**/{S48_BASELINE_SESSION_ID}.jsonl"))
    if not matches:
        return None
    return max(matches, key=lambda path: path.stat().st_mtime)


@pytest.fixture(scope="session")
def cmux_capture_module():
    module_path = SCRIPTS_DIR / "cmux_capture.py"
    if not module_path.exists():
        pytest.fail(f"cmux_capture module must exist at {module_path}")
    scripts_dir = str(SCRIPTS_DIR)
    inserted_path = False
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
        inserted_path = True
    old_module = sys.modules.get("cmux_capture")
    spec = importlib.util.spec_from_file_location("cmux_capture", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["cmux_capture"] = module
    spec.loader.exec_module(module)
    yield module
    if old_module is None:
        sys.modules.pop("cmux_capture", None)
    else:
        sys.modules["cmux_capture"] = old_module
    if inserted_path:
        try:
            sys.path.remove(scripts_dir)
        except ValueError:
            pass


def write_jsonl(path: Path, rows: list[dict]) -> Path:
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
    return path


def assistant_tool(idx: int, name: str, tool_input: dict, *, model: str = "claude-opus-4-8") -> dict:
    return {
        "type": "assistant",
        "timestamp": f"2026-06-03T00:00:{idx:02d}.000Z",
        "message": {
            "model": model,
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": f"toolu_{idx}",
                    "name": name,
                    "input": tool_input,
                }
            ],
        },
    }


def assistant_text(
    idx: int,
    text: str,
    *,
    model: str = "claude-opus-4-8",
    timestamp: str | None = None,
) -> dict:
    return {
        "type": "assistant",
        "timestamp": timestamp or f"2026-06-03T00:00:{idx:02d}.000Z",
        "message": {
            "model": model,
            "role": "assistant",
            "content": [{"type": "text", "text": text}],
        },
    }


def user_tool_result(idx: int, tool_id: str, content: str) -> dict:
    return {
        "type": "user",
        "timestamp": f"2026-06-03T00:00:{idx:02d}.000Z",
        "message": {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": content,
                }
            ],
        },
    }


def user_text(
    idx: int,
    text: str,
    *,
    cwd: str | None = None,
    session_id: str | None = None,
    timestamp: str | None = None,
) -> dict:
    row = {
        "type": "user",
        "timestamp": timestamp or f"2026-06-03T00:00:{idx:02d}.000Z",
        "message": {
            "role": "user",
            "content": text,
        },
    }
    if cwd:
        row["cwd"] = cwd
    if session_id:
        row["sessionId"] = session_id
    return row


def capture(module, path: Path, **kwargs):
    return module.capture_usage_run(
        str(path),
        surface="cmux-mcp",
        condition="control",
        model_version=kwargs.pop("model_version", "claude-opus-4-8-1m"),
        catalog_context="full-fleet-live",
        suite_version="cmux-v1",
        intent="test intent",
        case_id="test-case",
        gold_call_budget=kwargs.pop("gold_call_budget", 12),
        **kwargs,
    )


def test_relayed_fenced_json_scores_execute_not_relayed_zero(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "relay.jsonl",
        [
            assistant_text(
                1,
                'I would call:\n```json\n{"name":"mcp__cmuxlayer__send_command",'
                '"input":{"surface":"surface:999","command":"echo hi"}}\n```',
            )
        ],
    )

    result = capture(cmux_capture_module, path)

    assert result["scores"]["executed_not_relayed"] == 0
    assert result["evidence"]["executed_not_relayed"] == []
    assert result["actions"] == []


def test_bash_cmux_new_surface_is_counted_as_canonical_action(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "bash-new-surface.jsonl",
        [
            assistant_tool(
                1,
                "Bash",
                {
                    "command": "cmux new-surface --type terminal --pane pane:20 --focus true 2>&1",
                    "description": "Create stacked tab",
                },
            ),
            user_tool_result(2, "toolu_1", "OK surface:999 pane:20 workspace:1"),
        ],
    )

    result = capture(cmux_capture_module, path)

    assert result["actions"][0]["transport"] == "bash_cli"
    assert result["actions"][0]["action"] == "new_surface"
    assert result["actions"][0]["target_surface"] == "surface:999"
    assert result["actions"][0]["target_pane"] == "pane:20"


def test_real_s48_usage_baseline_reproduces_locked_six_of_six(cmux_capture_module):
    baseline = find_real_s48_baseline()
    if baseline is None or not baseline.exists():
        pytest.skip(f"real s:48 baseline JSONL unavailable: {S48_BASELINE_SESSION_ID}")

    result = capture(cmux_capture_module, baseline, gold_call_budget=12)

    expected = {
        "executed_not_relayed": 1,
        "focus_before_send": 1,
        "reenumerated_after_change": 1,
        "verified_after_action": 1,
        "docked_le2_columns": 1,
        "success": 1,
    }
    assert {name: result["scores"][name] for name in expected} == expected


def test_burst_spawns_before_ready_fail_spawn_discipline(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "burst.jsonl",
        [
            assistant_tool(
                1,
                "mcp__cmuxlayer__spawn_agent",
                {"repo": "golems", "cli": "claude", "prompt": "one"},
            ),
            assistant_tool(
                2,
                "mcp__cmuxlayer__spawn_agent",
                {"repo": "golems", "cli": "codex", "prompt": "two"},
            ),
        ],
    )

    result = capture(cmux_capture_module, path)

    assert result["scores"]["spawn_discipline"] == 0
    assert result["evidence"]["spawn_discipline"] == [0, 1]


def test_all_spawn_shapes_are_normalized(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "spawn-shapes.jsonl",
        [
            assistant_tool(
                1,
                "mcp__cmuxlayer__spawn_agent",
                {"repo": "golems", "cli": "claude", "prompt": "one"},
            ),
            assistant_tool(
                2,
                "mcp__cmuxlayer__spawn_in_workspace",
                {"workspace": "workspace:1", "agents": [{"repo": "golems", "cli": "codex"}]},
            ),
            assistant_tool(3, "mcp__cmuxlayer__new_split", {"workspace": "workspace:1"}),
            assistant_tool(
                4,
                "mcp__cmuxlayer__send_command",
                {"surface": "surface:999", "command": "golemsCodex -s"},
            ),
            assistant_tool(
                5,
                "Bash",
                {"command": "orchestratorCursor -s", "description": "raw launcher"},
            ),
        ],
    )

    result = capture(cmux_capture_module, path)
    spawn_shapes = [a["spawn_shape"] for a in result["actions"] if a["is_spawn"]]

    assert "spawn_agent" in spawn_shapes
    assert "spawn_in_workspace" in spawn_shapes
    assert "new_split_send_command" in spawn_shapes
    assert "raw_launcher" in spawn_shapes


def test_model_tier_uses_booted_jsonl_model_not_requested_spawn_param(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "model-tier.jsonl",
        [
            assistant_tool(
                1,
                "mcp__cmuxlayer__spawn_agent",
                {"repo": "golems", "cli": "claude", "model": "haiku", "prompt": "run"},
                model="claude-opus-4-8",
            )
        ],
    )

    result = capture(cmux_capture_module, path, intended_model="claude-opus-4-8-1m")

    assert result["booted_model"] == "claude-opus-4-8"
    assert result["scores"]["model_tier_correct"] == 1


def test_agent_identity_extracts_domain_lead_from_boot_prompt(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "lead.jsonl",
        [
            user_text(
                1,
                "You are the VoiceLayer DOMAIN LEAD reporting to orcClaude gen-10.",
                cwd="/Users/example/Gits/voicelayer",
            ),
            assistant_tool(2, "mcp__cmuxlayer__read_screen", {"surface": "surface:999"}),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="claude")
    row = result["phoenix_rows"][0]

    assert row["input"]["agent_type"] == "claude"
    assert row["input"]["agent_role"] == "lead"
    assert row["input"]["agent_name"] == "VL-LEAD"
    assert row["input"]["repo"] == "voicelayer"
    assert row["input"]["model"] == "opus"
    assert row["input"]["reports_to"] == "lead-under-orc"
    assert row["metadata"]["agent_name"] == "VL-LEAD"


def test_agent_identity_extracts_worker_reporting_to_phx_lead(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "worker.jsonl",
        [
            user_text(
                1,
                (
                    "You are the Phoenix identity-implement worker reporting to PHX-LEAD. "
                    "Repo: golems."
                ),
                cwd="/Users/example/Gits/golems",
            ),
            assistant_tool(2, "mcp__cmuxlayer__read_screen", {"surface": "surface:999"}),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="codex")
    row = result["phoenix_rows"][0]

    assert row["input"]["agent_type"] == "codex"
    assert row["input"]["agent_role"] == "worker"
    assert row["input"]["agent_name"] == "golemsCodex"
    assert row["input"]["repo"] == "golems"
    assert row["input"]["reports_to"] == "worker-of PHX-LEAD"
    assert row["metadata"]["agent_role"] == "worker"


def test_agent_identity_defaults_orc_to_lead_and_decodes_repo_from_project_slug(
    tmp_path,
    cmux_capture_module,
):
    project_dir = tmp_path / "-Users-example-Gits-coordination-hub"
    project_dir.mkdir()
    path = write_jsonl(
        project_dir / "orc.jsonl",
        [
            user_text(1, "You are orcClaude gen-10 orchestrator. Coordinate the sprint."),
            assistant_tool(2, "mcp__cmuxlayer__list_surfaces", {"workspace": "workspace:1"}),
        ],
    )

    result = capture(cmux_capture_module, path)
    row = result["phoenix_rows"][0]

    assert row["input"]["agent_type"] == "claude"
    assert row["input"]["agent_role"] == "lead"
    assert row["input"]["agent_name"] == "orcClaude-gen10"
    assert row["input"]["repo"] == "coordination-hub"
    assert row["metadata"]["repo"] == "coordination-hub"


def test_agent_identity_marks_boot_sequence_without_reporting_as_standalone(
    tmp_path,
    cmux_capture_module,
):
    path = write_jsonl(
        tmp_path / "standalone.jsonl",
        [
            user_text(
                1,
                "Boot sequence - run these steps in order. Load context, then greet with concrete context.",
                cwd="/opt/private/coach",
            ),
            assistant_tool(2, "mcp__cmuxlayer__read_screen", {"surface": "surface:999"}),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="claude")
    row = result["phoenix_rows"][0]

    assert row["input"]["agent_name"] == "coachClaude"
    assert row["input"]["agent_role"] == "standalone"
    assert row["input"]["reports_to"] == "standalone"
    assert row["metadata"]["agent_role"] == "standalone"


def test_agent_identity_worker_wording_without_reporting_stays_standalone(
    tmp_path,
    cmux_capture_module,
):
    path = write_jsonl(
        tmp_path / "worker-wording-standalone.jsonl",
        [
            user_text(
                1,
                "You are a worker. Boot sequence - run these steps in order.",
                cwd="/Users/example/Gits/golems",
            ),
            assistant_tool(2, "mcp__cmuxlayer__read_screen", {"surface": "surface:999"}),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="claude")
    row = result["phoenix_rows"][0]

    assert row["input"]["agent_name"] == "golemsClaude"
    assert row["input"]["agent_role"] == "standalone"
    assert row["input"]["reports_to"] == "standalone"


def test_agent_identity_reporting_to_orc_is_lead_under_orc(
    tmp_path,
    cmux_capture_module,
):
    path = write_jsonl(
        tmp_path / "orc-reporter.jsonl",
        [
            user_text(
                1,
                "You are coachClaude reporting to orcClaude gen-10. Coordinate the coach workstream.",
                cwd="/opt/private/coach",
            ),
            assistant_tool(2, "mcp__cmuxlayer__list_agents", {"surface": "surface:999"}),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="claude")
    row = result["phoenix_rows"][0]

    assert row["input"]["agent_name"] == "coachClaude"
    assert row["input"]["agent_role"] == "lead"
    assert row["input"]["reports_to"] == "lead-under-orc"


def test_usability_pr_keeps_full_session_io_out_of_primary_input(
    tmp_path,
    cmux_capture_module,
):
    path = write_jsonl(
        tmp_path / "multi-turn.jsonl",
        [
            user_text(1, "Boot prompt: run the capture audit.", cwd="/Users/example/Gits/golems"),
            assistant_text(2, "I will inspect the capture code."),
            user_text(3, "Follow-up: include the final transcript fields."),
            assistant_text(4, "Implemented the transcript extraction."),
            assistant_text(5, "TASK_DONE"),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="codex")
    row = result["phoenix_rows"][0]

    assert "user_input" not in row["input"]
    assert "Boot prompt: run the capture audit." in row["output"]["user_input"]
    assert "Follow-up: include the final transcript fields." in row["output"]["user_input"]
    assert "Implemented the transcript extraction." in row["output"]["agent_output"]


def test_session_timing_uses_first_and_last_jsonl_event_timestamps(
    tmp_path,
    cmux_capture_module,
):
    path = write_jsonl(
        tmp_path / "duration.jsonl",
        [
            user_text(
                1,
                "You are a worker.",
                session_id="real-claude-session-123",
                timestamp="2026-06-04T10:00:00.000Z",
            ),
            assistant_text(
                2,
                "Done.",
                timestamp="2026-06-04T10:02:30.000Z",
            ),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="claude")
    row = result["phoenix_rows"][0]

    assert row["input"]["session_duration_ms"] == 150_000
    assert "session_end_ts" not in row["input"]
    assert row["metadata"]["session_duration_ms"] == 150_000
    assert row["metadata"]["session_end_ts"] == "2026-06-04T10:02:30.000Z"


def test_session_id_rejects_cmux_id_and_falls_back_to_cli_jsonl_filename(
    tmp_path,
    cmux_capture_module,
):
    path = write_jsonl(
        tmp_path / "real-cli-fallback.jsonl",
        [
            user_text(
                1,
                "You are a worker.",
                session_id="surface:999",
                timestamp="2026-06-04T10:00:00.000Z",
            ),
            assistant_text(2, "Done.", timestamp="2026-06-04T10:00:01.000Z"),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="claude")
    row = result["phoenix_rows"][0]

    assert result["session_id"] == "real-cli-fallback"
    assert "session_id" not in row["input"]
    assert "session_key" not in row["input"]
    assert "source" not in row["input"]
    assert row["metadata"]["session_id"] == "real-cli-fallback"
    assert row["metadata"]["details"]["session_id"] == "real-cli-fallback"
    assert "surface:999" in row["metadata"]["details"]["cmux_ids"]


def test_model_display_normalizes_agent_specific_models(cmux_capture_module):
    assert cmux_capture_module.normalize_model_display("claude-opus-4-8") == "opus"
    assert cmux_capture_module.normalize_model_display("gpt-5.1", agent_type="codex") == "gpt-5.1-codex"
    assert cmux_capture_module.normalize_model_display(None, agent_type="cursor") == "cursor"


def test_repo_from_project_slug_never_returns_empty_repo(cmux_capture_module):
    repo = cmux_capture_module._repo_from_project_slug(
        "/tmp/-Users-example-Gits--weird-session/session.jsonl"
    )

    assert repo == "weird"


def test_repo_from_project_slug_preserves_hyphenated_repo_name(cmux_capture_module):
    repo = cmux_capture_module._repo_from_project_slug(
        "/tmp/-Users-example-Gits-example-service/session.jsonl"
    )

    assert repo == "example-service"


def test_task_summary_uses_plain_language_first_user_turn(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "summary.jsonl",
        [
            user_text(
                1,
                (
                    "You are the Phoenix DOMAIN LEAD reporting to orcClaude gen-10. "
                    "Read the handoff and execute it now: Phoenix eval harness - make it useful today."
                ),
                cwd="/opt/private/coordination",
            ),
            assistant_tool(2, "mcp__cmuxlayer__read_screen", {"surface": "surface:999"}),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="claude")
    row = result["phoenix_rows"][0]

    assert row["input"]["agent_name"] == "PHX-LEAD"
    assert row["input"]["task_summary"] == "Phoenix eval harness - make it useful today"
    assert len(row["input"]["task_summary"]) < 120


def test_task_summary_skips_handoff_path_boilerplate(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "handoff-summary.jsonl",
        [
            user_text(
                1,
                (
                    "Read /opt/private/coordination/docs.local/handoffs/lead.md "
                    "IN FULL and execute it now. Mission: fix the cmuxlayer TOOL-level bugs today."
                ),
                cwd="/Users/example/Gits/cmuxlayer",
            ),
            assistant_tool(2, "mcp__cmuxlayer__read_screen", {"surface": "surface:999"}),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="claude")
    row = result["phoenix_rows"][0]

    assert row["input"]["task_summary"] == "fix the cmuxlayer TOOL-level bugs today"
    assert "/Users/" not in row["input"]["task_summary"]


def test_task_summary_skips_tmp_file_execute_boilerplate(tmp_path, cmux_capture_module):
    path = write_jsonl(
        tmp_path / "tmp-execute-summary.jsonl",
        [
            user_text(
                1,
                (
                    "Read /tmp/usage-eval-demo-boot.md and execute it exactly - "
                    "the cmux usage sequence, real tool calls, then print USAGE_DEMO_DONE"
                ),
                cwd="/Users/example/Gits/golems",
            ),
            assistant_tool(2, "mcp__cmuxlayer__read_screen", {"surface": "surface:999"}),
        ],
    )

    result = capture(cmux_capture_module, path, agent_type="claude")
    row = result["phoenix_rows"][0]

    assert row["input"]["task_summary"] == (
        "the cmux usage sequence, real tool calls, then print USAGE_DEMO_DONE"
    )
    assert "/tmp/" not in row["input"]["task_summary"]

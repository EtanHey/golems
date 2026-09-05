from __future__ import annotations

import importlib.util
import json
import socket
import sys
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

import pytest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"


@pytest.fixture()
def mobile_module():
    module_path = SCRIPTS_DIR / "phoenix_mobile.py"
    if not module_path.exists():
        pytest.fail(f"mobile Phoenix module must exist at {module_path}")
    scripts_dir = str(SCRIPTS_DIR)
    inserted_path = False
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
        inserted_path = True
    old_module = sys.modules.get("phoenix_mobile")
    spec = importlib.util.spec_from_file_location("phoenix_mobile", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["phoenix_mobile"] = module
    spec.loader.exec_module(module)
    yield module
    if old_module is None:
        sys.modules.pop("phoenix_mobile", None)
    else:
        sys.modules["phoenix_mobile"] = old_module
    if inserted_path:
        try:
            sys.path.remove(scripts_dir)
        except ValueError:
            pass


def sample_events() -> list[dict]:
    return [
        {
            "type": "user",
            "timestamp": "2026-06-04T10:00:00.000Z",
            "message": {"role": "user", "content": "First user prompt"},
        },
        {
            "type": "assistant",
            "timestamp": "2026-06-04T10:00:01.000Z",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "Need to inspect cmux surfaces first."},
                    {"type": "text", "text": "First assistant reply"},
                ],
            },
        },
        {
            "type": "assistant",
            "timestamp": "2026-06-04T10:00:02.000Z",
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_list",
                        "name": "mcp__cmuxlayer__list_surfaces",
                        "input": {"workspace": "workspace:9"},
                    }
                ],
            },
        },
        {
            "type": "user",
            "timestamp": "2026-06-04T10:00:03.000Z",
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "toolu_list",
                        "content": json.dumps({"column_count": 2, "surfaces": []}),
                    }
                ],
            },
        },
        {
            "type": "user",
            "timestamp": "2026-06-04T10:00:04.000Z",
            "message": {"role": "user", "content": "Second user prompt"},
        },
    ]


def sample_trace() -> dict:
    root_span_id = "1111111111111111"
    return {
        "trace_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "token_count_total": 0,
        "token_count_prompt": 0,
        "token_count_completion": 0,
        "start_time": "2026-06-04T10:00:00.000000+00:00",
        "end_time": "2026-06-04T13:00:14.000000+00:00",
        "spans": [
            {
                "name": "root",
                "span_kind": "CHAIN",
                "parent_id": None,
                "context": {"span_id": root_span_id, "trace_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                "start_time": "2026-06-04T10:00:00.000000+00:00",
                "end_time": "2026-06-04T13:00:14.000000+00:00",
                "attributes": {
                    "session.id": "session-1",
                    "source.path": "/tmp/session-1.jsonl",
                    "input.value": "turn 1 @ ts\nFirst user prompt\n\n---\n\nturn 2 @ ts\nSecond user prompt",
                    "output.value": "turn 1 @ ts\nFirst assistant reply\n\n---\n\nturn 2 @ ts\nSecond assistant reply",
                },
            },
            {
                "name": "assistant text 1",
                "span_kind": "LLM",
                "parent_id": root_span_id,
                "context": {"span_id": "2222222222222222", "trace_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                "start_time": "2026-06-04T10:00:01.000000+00:00",
                "end_time": "2026-06-04T10:00:02.000000+00:00",
                "attributes": {"event.index": 1, "output.value": "First assistant reply"},
            },
            {
                "name": "mcp__cmuxlayer__list_surfaces",
                "span_kind": "TOOL",
                "parent_id": root_span_id,
                "context": {"span_id": "3333333333333333", "trace_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                "start_time": "2026-06-04T10:00:02.000000+00:00",
                "end_time": "2026-06-04T10:00:03.000000+00:00",
                "attributes": {
                    "event.index": 2,
                    "event.result_index": 3,
                    "tool.name": "mcp__cmuxlayer__list_surfaces",
                    "tool.use_id": "toolu_list",
                    "input.value": json.dumps({"workspace": "workspace:9"}),
                    "output.value": json.dumps({"column_count": 2, "surfaces": []}),
                    "cmux.geometry": json.dumps({"column_count": 2}),
                },
            },
        ],
    }


def test_jsonl_events_render_as_coherent_turn_cards_instead_of_chunk_cards(mobile_module):
    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=[sample_trace()],
        jsonl_events=sample_events(),
    )

    labels = [(card["kind"], card["title"]) for card in view["cards"]]
    assert labels == [
        ("user", "🧑 USER"),
        ("assistant", "🤖 ASSISTANT turn"),
        ("user", "🧑 USER"),
    ]
    assert [card["span_id"] for card in view["cards"]] == [
        "1111111111111111",
        "2222222222222222",
        "1111111111111111",
    ]
    assert view["cards"][0]["text"] == "First user prompt"
    assistant = view["cards"][1]
    assert assistant["text"] == "First assistant reply"
    assert assistant["thinking"] == ["Need to inspect cmux surfaces first."]
    assert len(assistant["tool_calls"]) == 1
    tool_call = assistant["tool_calls"][0]
    assert tool_call["kind_label"] == "🔧 TOOL CALL"
    assert tool_call["tool_name"] == "mcp__cmuxlayer__list_surfaces"
    assert tool_call["span_id"] == "3333333333333333"
    assert tool_call["input_label"] == "INPUT — args"
    assert tool_call["output_label"] == "OUTPUT — result"
    assert tool_call["tool_input"] == {"workspace": "workspace:9"}
    assert tool_call["tool_output"] == {"column_count": 2, "surfaces": []}
    assert tool_call["cmux_geometry"] == {"column_count": 2}
    assert view["cards"][2]["text"] == "Second user prompt"
    assert not any(card["kind"] == "tool" for card in view["cards"])
    for card in view["cards"]:
        serialized = json.dumps(card)
        assert "turn 1 @ ts" not in serialized
        assert not ("First user prompt" in serialized and "Second user prompt" in serialized)


def test_driver_prompts_are_labeled_orchestrator_not_human_user(mobile_module):
    trace = sample_trace()
    trace["spans"][0]["attributes"]["agent.reports_to"] = "lead-under-orc"
    trace["spans"][0]["attributes"]["agent.name"] = "phoenixLead"

    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=[trace],
        jsonl_events=sample_events(),
    )

    assert view["agent"]["reports_to"] == "lead-under-orc"
    assert view["cards"][0]["role"] == "orchestrator"
    assert view["cards"][0]["title"] == "🤖 ORCHESTRATOR"
    assert view["cards"][0]["kind"] == "driver"
    assert view["cards"][2]["role"] == "orchestrator"


def test_boot_prompt_content_fallback_labels_orchestrator_without_metadata(mobile_module):
    events = [
        {
            "type": "user",
            "timestamp": "2026-06-04T10:00:00.000Z",
            "message": {
                "role": "user",
                "content": "You are the PHOENIX EVAL DOMAIN LEAD reporting to orcClaude gen-10. Read /tmp/lead-phoenix.md IN FULL and execute it now.",
            },
        },
        {
            "type": "user",
            "timestamp": "2026-06-04T10:00:01.000Z",
            "message": {"role": "user", "content": "What? Wait, what do you mean send command is unreliable?"},
        },
    ]

    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=[sample_trace()],
        jsonl_events=events,
    )

    assert view["cards"][0]["role"] == "orchestrator"
    assert view["cards"][0]["title"] == "🤖 ORCHESTRATOR"
    assert view["cards"][1]["role"] == "human"
    assert view["cards"][1]["title"] == "🧑 USER"


def test_boot_handoff_patterns_label_orchestrator_even_without_parent_metadata(mobile_module):
    cases = [
        "You are orcClaude gen-9, succeeding gen-8. Read /opt/private/coordination/docs.local/handoffs/2026-06-04-orc-gen9-boot.md IN FULL and execute it.",
        "You are cmuxlayerClaude-LEAD, spun up by orcClaude (surface:1) to investigate + fix tonight's cmux incident. Read /tmp/cmuxlayer-lead-incident.md and execute it.",
    ]
    for text in cases:
        role = mobile_module.classify_user_turn(text, {})
        assert role["role"] == "orchestrator"
        assert role["kind"] == "driver"
        assert role["title"] == "🤖 ORCHESTRATOR"


def test_plain_human_coach_turn_stays_user(mobile_module):
    role = mobile_module.classify_user_turn(
        "how's my recovery looking today, and can you draft a message to the coach?",
        {},
    )

    assert role["role"] == "human"
    assert role["kind"] == "user"
    assert role["title"] == "🧑 USER"


def test_session_identity_prefers_golem_repo_then_specific_agent_name(mobile_module):
    coach = mobile_module.resolve_session_identity(
        {"agent.name": "coachClaude", "repo": "coach"},
        source_path="/Users/example/.claude/projects/-Users-example-Gits-example-assistant/example-session.jsonl",
    )
    lead = mobile_module.resolve_session_identity(
        {"agent.name": "CMUX-LEAD", "repo": "cmuxlayer"},
        source_path="/Users/example/.claude/projects/-Users-etanheyman-Gits-cmuxlayer/lead.jsonl",
    )
    orc = mobile_module.resolve_session_identity(
        {"agent.name": "orcClaude-gen10", "repo": "orchestrator"},
        source_path="/Users/example/.claude/projects/-Users-example-Gits-example-coordinator/example-session.jsonl",
    )

    assert coach == {
        "label": "coach",
        "display": "coach",
        "repo": "coach",
        "agent_name": "coachClaude",
    }
    assert lead == {
        "label": "CMUX-LEAD",
        "display": "CMUX-LEAD (cmuxlayer)",
        "repo": "cmuxlayer",
        "agent_name": "CMUX-LEAD",
    }
    assert orc["label"] == "orcClaude-gen10"
    assert orc["display"] == "orcClaude-gen10"


def test_participant_chips_cover_coach_lead_and_mixed_all_three(mobile_module):
    coach_identity = {"label": "coach", "display": "coach", "repo": "coach", "agent_name": "coachClaude"}
    lead_identity = {"label": "CMUX-LEAD", "display": "CMUX-LEAD (cmuxlayer)", "repo": "cmuxlayer"}

    coach = mobile_module.participant_chips(coach_identity, {"human"})
    lead = mobile_module.participant_chips(lead_identity, {"orchestrator"})
    mixed = mobile_module.participant_chips(lead_identity, {"orchestrator", "human"})

    assert [chip["label"] for chip in coach["chips"]] == ["🤖 coach", "+ 🧑 you"]
    assert coach["mixed"] is False
    assert [chip["label"] for chip in lead["chips"]] == ["🤖 CMUX-LEAD", "+ 🤖 orc"]
    assert lead["mixed"] is False
    assert [chip["label"] for chip in mixed["chips"]] == ["🤖 CMUX-LEAD", "+ 🤖 orc", "+ 🧑 you"]
    assert mixed["mixed"] is True


def test_session_view_exposes_identity_and_participant_chips(mobile_module):
    trace = sample_trace()
    trace["spans"][0]["attributes"].update(
        {
            "agent.name": "CMUX-LEAD",
            "agent.reports_to": "lead-under-orc",
            "repo": "cmuxlayer",
        }
    )

    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=[trace],
        jsonl_events=sample_events(),
    )

    assert view["identity"]["display"] == "CMUX-LEAD (cmuxlayer)"
    assert [chip["label"] for chip in view["participants"]["chips"]] == [
        "🤖 CMUX-LEAD",
        "+ 🤖 orc",
    ]
    assert view["participants"]["mixed"] is False


def test_metrics_omit_zero_cost_tokens_and_wall_clock_latency(mobile_module):
    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=[sample_trace()],
        jsonl_events=sample_events(),
    )

    assert view["metrics"] == {
        "spans": 3,
        "tool_calls": 1,
        "cmux_geometry": 1,
    }
    assert all("latency" not in key.lower() for key in view["metrics"])
    assert "total_tokens" not in view["metrics"]
    assert "total_cost" not in view["metrics"]


def test_metrics_sum_nonzero_per_span_tokens_and_cost(mobile_module):
    trace = sample_trace()
    trace["spans"][1]["attributes"].update(
        {
            "llm.token_count.prompt": 100,
            "llm.token_count.completion": 25,
            "llm.token_count.total": 125,
            "llm.cost.total": 0.012345,
        }
    )

    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=[trace],
        jsonl_events=sample_events(),
    )

    assert view["metrics"] == {
        "spans": 3,
        "tool_calls": 1,
        "cmux_geometry": 1,
        "total_tokens": 125,
        "prompt_tokens": 100,
        "completion_tokens": 25,
        "total_cost_usd": 0.0123,
    }


def test_session_view_aggregates_single_span_traces_for_per_turn_span_ids(mobile_module):
    trace = sample_trace()
    split_traces = [
        {
            "trace_id": f"trace-{idx}",
            "start_time": span["start_time"],
            "end_time": span["end_time"],
            "spans": [span],
        }
        for idx, span in enumerate(trace["spans"])
    ]

    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=split_traces,
        jsonl_events=sample_events(),
    )

    assert [card["span_id"] for card in view["cards"][:3]] == [
        "1111111111111111",
        "2222222222222222",
        "1111111111111111",
    ]
    assert view["cards"][1]["tool_calls"][0]["span_id"] == "3333333333333333"
    assert view["metrics"] == {
        "spans": 3,
        "tool_calls": 1,
        "cmux_geometry": 1,
    }


def test_span_fallback_renders_flat_prompt_spans_with_driver_role(mobile_module):
    trace = sample_trace()
    root_span = trace["spans"][0]
    root_span["attributes"].pop("input.value", None)
    root_span["attributes"].pop("output.value", None)
    root_span["attributes"]["agent.reports_to"] = "lead-under-orc"
    prompt_span = {
        "name": "orchestrator prompt 1",
        "span_kind": "CHAIN",
        "parent_id": None,
        "context": {"span_id": "4444444444444444", "trace_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
        "start_time": "2026-06-04T10:00:00.000000+00:00",
        "end_time": "2026-06-04T10:00:01.000000+00:00",
        "attributes": {
            "event.index": 0,
            "input.value": "You are the PHOENIX EVAL DOMAIN LEAD reporting to orcClaude gen-10.",
            "turn.kind": "driver",
            "turn.role": "orchestrator",
        },
    }
    trace["spans"].append(prompt_span)

    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=[trace],
        jsonl_events=None,
    )

    first, second = view["cards"][:2]
    assert first["title"] == "🤖 ORCHESTRATOR"
    assert first["kind"] == "driver"
    assert first["role"] == "orchestrator"
    assert first["span_id"] == "4444444444444444"
    assert first["text"].startswith("You are the PHOENIX EVAL DOMAIN LEAD")
    assert second["title"] == "🤖 ASSISTANT turn"
    assert second["text"] == "First assistant reply"
    assert "turn 1" not in json.dumps(view["cards"]).lower()


def test_card_metrics_are_consistent_by_turn_type(mobile_module):
    trace = sample_trace()
    trace["spans"][1]["attributes"].update(
        {
            "llm.token_count.prompt": 100,
            "llm.token_count.completion": 25,
            "llm.token_count.total": 125,
            "llm.cost.total": 0.012345,
        }
    )

    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=[trace],
        jsonl_events=sample_events(),
    )

    user_card, assistant_card, next_user_card = view["cards"]
    assert "metrics" not in user_card
    assert assistant_card["metrics"] == [
        {"label": "Tokens", "value": "125"},
        {"label": "Cost", "value": "$0.0123"},
    ]
    assert "metrics" not in next_user_card
    assert assistant_card["tool_calls"][0]["metrics"] == [{"label": "Latency", "value": "1.0 s"}]


def test_span_annotation_payload_uses_rest_schema_with_otel_span_id(mobile_module):
    payload = mobile_module.span_annotation_payload(
        span_id="3333333333333333",
        label="bad",
        explanation="The tool call used the wrong surface.",
        score=0,
        metadata={"session_id": "session-1", "card_id": "event-2-tool"},
    )

    assert payload == {
        "data": [
            {
                "span_id": "3333333333333333",
                "name": "quality",
                "annotator_kind": "HUMAN",
                "result": {
                    "label": "bad",
                    "score": 0,
                    "explanation": "The tool call used the wrong surface.",
                },
                "identifier": "mobile-curator",
                "metadata": {
                    "session_id": "session-1",
                    "card_id": "event-2-tool",
                    "source": "phoenix-mobile",
                },
            }
        ]
    }


def test_session_annotation_payload_uses_rest_schema(mobile_module):
    payload = mobile_module.session_annotation_payload(
        session_id="session-1",
        label="good",
        explanation="Usable golden session.",
        score=1,
        metadata={"curator": "etan"},
    )

    assert payload == {
        "data": [
            {
                "session_id": "session-1",
                "name": "quality",
                "annotator_kind": "HUMAN",
                "result": {
                    "label": "good",
                    "score": 1,
                    "explanation": "Usable golden session.",
                },
                "identifier": "mobile-curator",
                "metadata": {
                    "curator": "etan",
                    "source": "phoenix-mobile",
                },
            }
        ]
    }


def test_auto_critic_annotations_attach_to_root_and_turn_cards_with_human_supersedes(mobile_module):
    view = mobile_module.build_session_view_from_traces(
        session_id="session-1",
        traces=[sample_trace()],
        jsonl_events=sample_events(),
    )
    annotations = [
        {
            "span_id": "4444444444444444",
            "name": "quality",
            "identifier": "auto-critic",
            "annotator_kind": "LLM",
            "result": {
                "label": "good",
                "score": 1,
                "explanation": "The session recovered after tool issues.",
            },
            "metadata": {"target": "session"},
        },
        {
            "span_id": "2222222222222222",
            "name": "quality",
            "identifier": "auto-critic",
            "annotator_kind": "LLM",
            "result": {
                "label": "bad",
                "score": 0,
                "explanation": "Ignored a tool result.",
            },
            "metadata": {"category": "ignored_tool_result"},
        },
        {
            "span_id": "3333333333333333",
            "name": "quality",
            "identifier": "auto-critic",
            "annotator_kind": "LLM",
            "result": {
                "label": "bad",
                "score": 0,
                "explanation": "Tool call used the wrong surface.",
            },
            "metadata": {"category": "tool_misuse"},
        },
        {
            "span_id": "3333333333333333",
            "name": "quality",
            "identifier": "mobile-curator",
            "annotator_kind": "HUMAN",
            "result": {
                "label": "good",
                "score": 1,
                "explanation": "Human reviewed this tool call.",
            },
        },
    ]

    mobile_module.apply_quality_annotations(view, annotations)

    assert view["annotations"]["auto_critic"] == {
        "label": "good",
        "score": 1.0,
        "explanation": "The session recovered after tool issues.",
    }
    assert "human" not in view["annotations"]
    assistant = view["cards"][1]
    assert assistant["annotations"]["auto_critic"] == {
        "label": "bad",
        "score": 0.0,
        "explanation": "Ignored a tool result.",
        "category": "ignored_tool_result",
    }
    tool_call = assistant["tool_calls"][0]
    assert "auto_critic" not in tool_call["annotations"]
    assert tool_call["annotations"]["human"]["label"] == "good"


def test_gateway_session_view_fetches_quality_annotations_for_rendering(mobile_module):
    trace = sample_trace()
    trace["spans"].append(
        {
            "name": "session quality target",
            "span_kind": "CHAIN",
            "parent_id": None,
            "context": {"span_id": "4444444444444444", "trace_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
            "start_time": "2026-06-04T10:00:00.000000+00:00",
            "end_time": "2026-06-04T10:00:00.100000+00:00",
            "attributes": {},
        }
    )

    class FakeClient:
        class Spans:
            def __init__(self):
                self.annotation_span_ids = None

            def get_span_annotations(self, *, span_ids, **_kwargs):
                self.annotation_span_ids = list(span_ids)
                return [
                    {
                        "span_id": "4444444444444444",
                        "name": "quality",
                        "identifier": "auto-critic",
                        "annotator_kind": "LLM",
                        "result": {"label": "good", "score": 1, "explanation": "Good session."},
                        "metadata": {"target": "session"},
                    },
                    {
                        "span_id": "2222222222222222",
                        "name": "quality",
                        "identifier": "auto-critic",
                        "annotator_kind": "LLM",
                        "result": {"label": "bad", "score": 0, "explanation": "Bad turn."},
                    },
                ]

        def __init__(self):
            self.spans = self.Spans()

    gateway = object.__new__(mobile_module.PhoenixGateway)
    gateway.config = mobile_module.ServerConfig(project_name="cmux-sessions")
    gateway.client = FakeClient()
    gateway._session_traces_with_spans = lambda _session_id: [trace]

    view = gateway.get_session_view("session-1")

    assert gateway.client.spans.annotation_span_ids[0] == "1111111111111111"
    assert set(gateway.client.spans.annotation_span_ids) == {
        "1111111111111111",
        "2222222222222222",
        "3333333333333333",
        "4444444444444444",
    }
    assert view["annotations"]["auto_critic"]["label"] == "good"
    bad_card = next(card for card in view["cards"] if card["span_id"] == "2222222222222222")
    assert bad_card["annotations"]["auto_critic"]["label"] == "bad"


def test_session_list_row_prefers_real_session_id_over_phoenix_node_id(mobile_module):
    session = {
        "id": "UHJvamVjdFNlc3Npb246MQ==",
        "session_id": "62517efa-007b-4580-a64e-937c0251db77",
        "project_id": "UHJvamVjdDo0OA==",
        "start_time": "2026-06-04T12:52:45.181000+00:00",
        "end_time": "2026-06-04T17:24:52.433000+00:00",
        "traces": [{"trace_id": "abc"}, {"trace_id": "def"}],
    }
    row = mobile_module.session_list_row(
        session
    )

    assert row == {
        "session_id": "62517efa-007b-4580-a64e-937c0251db77",
        "project_session_id": "UHJvamVjdFNlc3Npb246MQ==",
        "project_id": "UHJvamVjdDo0OA==",
        "start_time": "2026-06-04T12:52:45.181000+00:00",
        "end_time": "2026-06-04T17:24:52.433000+00:00",
        "trace_count": 2,
    }
    assert mobile_module.session_trace_ids(session) == ["abc", "def"]


def test_session_limit_query_rejects_invalid_values(mobile_module):
    assert mobile_module.session_limit_from_query({}) == 20
    assert mobile_module.session_limit_from_query({"limit": ["10"]}) == 10

    with pytest.raises(mobile_module.PhoenixMobileError, match="limit parameter"):
        mobile_module.session_limit_from_query({"limit": ["many"]})


def test_turn_note_writer_appends_exact_jsonl_rows(mobile_module, tmp_path, monkeypatch):
    path = tmp_path / "annotations.jsonl"
    monkeypatch.setenv("PHOENIX_ANNOTATIONS_PATH", str(path))

    first = mobile_module.persist_turn_note(
        {
            "turn_id": "event-1-assistant",
            "session": "session-1",
            "note": "Should have picked a different brain search result.",
        }
    )
    second = mobile_module.persist_turn_note(
        {
            "turn_id": "event-2-tool",
            "session": "session-1",
            "note": "Tool result was ignored.",
        }
    )

    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert rows == [first, second]
    assert [list(row) for row in rows] == [["turn_id", "session", "note", "ts"], ["turn_id", "session", "note", "ts"]]
    assert rows[0]["turn_id"] == "event-1-assistant"
    assert rows[0]["session"] == "session-1"
    assert rows[0]["note"] == "Should have picked a different brain search result."
    assert rows[0]["ts"].endswith("Z")


def test_turn_note_endpoint_persists_append_only_jsonl(mobile_module, tmp_path, monkeypatch):
    path = tmp_path / "annotations.jsonl"
    monkeypatch.setenv("PHOENIX_ANNOTATIONS_PATH", str(path))

    class Handler(mobile_module.PhoenixMobileHandler):
        gateway = None
        config = mobile_module.ServerConfig()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        body = json.dumps(
            {
                "turn_id": "event-1-assistant",
                "session": "session-1",
                "note": "The missing memory should be in the reply.",
            }
        ).encode("utf-8")
        request = Request(
            f"http://127.0.0.1:{server.server_port}/api/annotations/note",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=3) as response:
            payload = json.loads(response.read().decode("utf-8"))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)

    row = json.loads(path.read_text(encoding="utf-8").strip())
    assert payload == {"ok": True, "annotation": row}
    assert row["turn_id"] == "event-1-assistant"
    assert row["session"] == "session-1"
    assert row["note"] == "The missing memory should be in the reply."


@pytest.mark.parametrize("host", ["::", "::1", "[::1]", "2001:db8::1"])
def test_mobile_server_uses_ipv6_address_family_for_ipv6_hosts(mobile_module, host):
    assert mobile_module.server_address_family(host) == socket.AF_INET6


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("[::1]", "::1"),
        ("[2001:db8::1]", "2001:db8::1"),
        ("::1", "::1"),
        ("127.0.0.1", "127.0.0.1"),
    ],
)
def test_mobile_bind_host_normalizes_bracketed_ipv6_literals(mobile_module, host, expected):
    assert mobile_module.normalize_bind_host(host) == expected


@pytest.mark.parametrize("host", ["0.0.0.0", "127.0.0.1", "localhost"])
def test_mobile_server_uses_ipv4_address_family_for_ipv4_hosts(mobile_module, host):
    assert mobile_module.server_address_family(host) == socket.AF_INET


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("::", "localhost"),
        ("::1", "[::1]"),
        ("[::1]", "[::1]"),
        ("2001:db8::1", "[2001:db8::1]"),
        ("0.0.0.0", "localhost"),
        ("127.0.0.1", "127.0.0.1"),
    ],
)
def test_mobile_display_host_handles_wildcards_and_ipv6_literals(mobile_module, host, expected):
    assert mobile_module.mobile_display_host(host) == expected


def test_static_mobile_assets_exist_and_wire_annotation_ui():
    static_dir = Path(__file__).resolve().parents[1] / "static" / "phoenix-mobile"
    index = (static_dir / "index.html").read_text()
    script = (static_dir / "app.js").read_text()
    styles = (static_dir / "styles.css").read_text()

    assert 'href="/styles.css"' in index
    assert 'src="/app.js"' in index
    assert "postSessionAnnotation" in script
    assert "postSpanAnnotation" in script
    assert "postTurnNote" in script
    assert "Promise.allSettled" in script
    assert "/api/annotations/session" in script
    assert "/api/annotations/span" in script
    assert "/api/annotations/note" in script
    assert "renderAutoCriticBadge" in script
    assert "appendAutoCriticFlag" in script
    assert "detailAutoCritic" in script
    assert "auto: BAD" in script
    assert "detail-auto-critic" in index
    assert "toolbar-auto-critic" in styles
    assert "auto-critic-badge" in styles
    assert "auto-critic-flag" in styles
    assert "cmux_geometry" in script
    assert "Session replay for eval" in index
    assert "detail-participants" in index
    assert "session-identity" in index
    assert "INPUT — args" in script
    assert "OUTPUT — result" in script
    assert "renderParticipantChips" in script
    assert "mixed-participants" in script
    assert "mark-wrong" in styles
    assert "participant-chip" in styles
    assert "mixed-participants" in styles
    assert "min-height: 44px" in styles
    assert "max-width: 430px" not in styles
    assert "@media (min-width: 900px)" in styles
    assert "grid-template-columns: minmax(280px, 360px) minmax(0, 1fr)" in styles

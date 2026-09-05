from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"


@pytest.fixture()
def critic_module():
    module_path = SCRIPTS_DIR / "phoenix_auto_critic.py"
    if not module_path.exists():
        pytest.fail(f"auto critic module must exist at {module_path}")
    scripts_dir = str(SCRIPTS_DIR)
    inserted_path = False
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
        inserted_path = True
    old_module = sys.modules.get("phoenix_auto_critic")
    spec = importlib.util.spec_from_file_location("phoenix_auto_critic", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["phoenix_auto_critic"] = module
    spec.loader.exec_module(module)
    yield module
    if old_module is None:
        sys.modules.pop("phoenix_auto_critic", None)
    else:
        sys.modules["phoenix_auto_critic"] = old_module
    if inserted_path:
        try:
            sys.path.remove(scripts_dir)
        except ValueError:
            pass


def test_backend_policy_allows_groq_for_cmux_and_refuses_cloud_for_coach(critic_module):
    critic_module.validate_backend_policy("cmux-sessions", "groq")
    critic_module.validate_backend_policy("coach-sessions", "ollama")
    critic_module.validate_backend_policy(
        "coach-sessions",
        "trusted",
        trusted_cloud_allowed=True,
    )

    with pytest.raises(critic_module.PrivacyError, match="coach-sessions.*private") as excinfo:
        critic_module.validate_backend_policy("coach-sessions", "groq")
    assert "groq" in str(excinfo.value)

    with pytest.raises(critic_module.PrivacyError, match="trusted"):
        critic_module.validate_backend_policy("coach-sessions", "trusted")


def test_session_context_uses_root_span_for_session_score_and_turn_spans_for_flags(critic_module):
    spans = [
        {
            "name": "root",
            "span_kind": "CHAIN",
            "parent_id": None,
            "context": {"span_id": "aaaaaaaaaaaaaaaa"},
            "attributes": {
                "session.id": "session-1",
                "input.value": "User asked to grade sessions.",
                "output.value": "I ignored a tool result.",
            },
        },
        {
            "name": "assistant text 1",
            "span_kind": "LLM",
            "parent_id": "aaaaaaaaaaaaaaaa",
            "context": {"span_id": "bbbbbbbbbbbbbbbb"},
            "attributes": {
                "event.index": 3,
                "output.value": "The agent claimed success without reading test output.",
            },
        },
        {
            "name": "mcp__cmuxlayer__send_input",
            "span_kind": "TOOL",
            "parent_id": "aaaaaaaaaaaaaaaa",
            "context": {"span_id": "cccccccccccccccc"},
            "attributes": {
                "event.index": 4,
                "tool.name": "mcp__cmuxlayer__send_input",
                "input.value": "{\"surface\":\"surface:23\",\"text\":\"go\"}",
                "output.value": "{\"ok\":true}",
            },
        },
    ]

    context = critic_module.build_session_context(
        project_name="cmux-sessions",
        session_id="session-1",
        spans=spans,
    )

    assert context.root_span_id == "aaaaaaaaaaaaaaaa"
    assert {turn.span_id for turn in context.turns} == {
        "bbbbbbbbbbbbbbbb",
        "cccccccccccccccc",
    }
    assert "User asked to grade sessions" in context.transcript_for_judge()
    assert "mcp__cmuxlayer__send_input" in context.transcript_for_judge()


def test_session_context_prefers_chain_root_over_parentless_llm_span(critic_module):
    spans = [
        {
            "name": "assistant text 7",
            "span_kind": "LLM",
            "parent_id": None,
            "context": {"span_id": "bbbbbbbbbbbbbbbb"},
            "attributes": {"output.value": "A later assistant response."},
        },
        {
            "name": "root",
            "span_kind": "CHAIN",
            "parent_id": None,
            "context": {"span_id": "aaaaaaaaaaaaaaaa"},
            "attributes": {
                "input.value": "Full session input.",
                "output.value": "Full session output.",
            },
        },
    ]

    context = critic_module.build_session_context(
        project_name="cmux-sessions",
        session_id="session-1",
        spans=spans,
    )

    assert context.root_span_id == "aaaaaaaaaaaaaaaa"
    assert {turn.span_id for turn in context.turns} == {"bbbbbbbbbbbbbbbb"}


def test_parse_judge_result_normalizes_labels_and_filters_unknown_spans(critic_module):
    context = critic_module.SessionContext(
        project_name="cmux-sessions",
        session_id="session-1",
        root_span_id="aaaaaaaaaaaaaaaa",
        turns=[
            critic_module.Turn(
                span_id="bbbbbbbbbbbbbbbb",
                event_index=2,
                kind="assistant",
                text="Ignored the read-back result.",
            )
        ],
    )

    result = critic_module.parse_judge_result(
        {
            "session": {
                "label": "BAD",
                "score": 99,
                "explanation": "The agent ignored tool output and did not recover.",
            },
            "flags": [
                {
                    "span_id": "bbbbbbbbbbbbbbbb",
                    "label": "bad",
                    "score": 0,
                    "explanation": "Ignored the failed tool result.",
                    "category": "ignored_tool_result",
                },
                {
                    "span_id": "dddddddddddddddd",
                    "label": "bad",
                    "score": 0,
                    "explanation": "Unknown span must not be written.",
                },
            ],
        },
        context,
    )

    assert result.session.label == "bad"
    assert result.session.score == 0
    assert len(result.flags) == 1
    assert result.flags[0].span_id == "bbbbbbbbbbbbbbbb"
    assert result.flags[0].category == "ignored_tool_result"


def test_annotation_payloads_use_auto_critic_llm_identifier(critic_module):
    verdict = critic_module.Verdict(
        span_id="aaaaaaaaaaaaaaaa",
        label="good",
        score=1,
        explanation="The agent used tools correctly and recovered from errors.",
        metadata={"session_id": "session-1", "target": "session"},
    )

    payload = critic_module.span_annotation_payload(verdict)

    assert payload == {
        "data": [
            {
                "span_id": "aaaaaaaaaaaaaaaa",
                "name": "quality",
                "annotator_kind": "LLM",
                "identifier": "auto-critic",
                "result": {
                    "label": "good",
                    "score": 1,
                    "explanation": "The agent used tools correctly and recovered from errors.",
                },
                "metadata": {
                    "session_id": "session-1",
                    "target": "session",
                    "source": "phoenix-auto-critic",
                },
            }
        ]
    }


def test_writer_skips_human_quality_annotations_and_verifies_auto_writes(critic_module):
    class FakeGateway:
        def __init__(self):
            self.posts = []
            self.annotations = {
                "aaaaaaaaaaaaaaaa": [
                    {
                        "name": "quality",
                        "identifier": "mobile-curator",
                        "annotator_kind": "HUMAN",
                        "result": {"label": "good", "score": 1},
                    }
                ],
                "bbbbbbbbbbbbbbbb": [],
            }

        def get_span_annotations(self, span_id):
            return list(self.annotations.get(span_id, []))

        def post_span_annotations(self, payload):
            row = payload["data"][0]
            self.posts.append(payload)
            self.annotations.setdefault(row["span_id"], []).append(row)
            return {"ok": True}

    gateway = FakeGateway()
    verdicts = [
        critic_module.Verdict(
            span_id="aaaaaaaaaaaaaaaa",
            label="bad",
            score=0,
            explanation="Would be skipped because human annotation exists.",
            metadata={"session_id": "session-1", "target": "session"},
        ),
        critic_module.Verdict(
            span_id="bbbbbbbbbbbbbbbb",
            label="bad",
            score=0,
            explanation="Ignored tool output.",
            metadata={"session_id": "session-1", "target": "turn"},
        ),
    ]

    summary = critic_module.write_verdicts_with_readback(gateway, verdicts)

    assert summary["posted"] == 1
    assert summary["skipped_human"] == 1
    assert summary["verified"] == 1
    assert gateway.posts[0]["data"][0]["span_id"] == "bbbbbbbbbbbbbbbb"

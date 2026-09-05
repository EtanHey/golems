from __future__ import annotations

from datetime import datetime
import importlib.util
import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("opentelemetry")
pytest.importorskip("opentelemetry.sdk")
pytest.importorskip("openinference.semconv")


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"


@pytest.fixture()
def trace_module():
    module_path = SCRIPTS_DIR / "jsonl_to_phoenix_traces.py"
    if not module_path.exists():
        pytest.fail(f"trace exporter module must exist at {module_path}")
    scripts_dir = str(SCRIPTS_DIR)
    inserted_path = False
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
        inserted_path = True
    old_module = sys.modules.get("jsonl_to_phoenix_traces")
    spec = importlib.util.spec_from_file_location("jsonl_to_phoenix_traces", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["jsonl_to_phoenix_traces"] = module
    spec.loader.exec_module(module)
    yield module
    if old_module is None:
        sys.modules.pop("jsonl_to_phoenix_traces", None)
    else:
        sys.modules["jsonl_to_phoenix_traces"] = old_module
    if inserted_path:
        try:
            sys.path.remove(scripts_dir)
        except ValueError:
            pass


def write_jsonl(path: Path, rows: list[dict]) -> Path:
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
    return path


def ts_ns(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1_000_000_000)


def attrs(span):
    return dict(span.attributes or {})


def span_by_name(spans, name: str):
    matches = [span for span in spans if span.name == name]
    assert len(matches) == 1, [span.name for span in spans]
    return matches[0]


def test_session_jsonl_exports_openinference_spans_with_identity_tool_io_and_geometry(
    tmp_path,
    trace_module,
):
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    session = write_jsonl(
        tmp_path / "path-stem-is-not-the-session-id.jsonl",
        [
            {
                "type": "user",
                "timestamp": "2026-06-04T10:00:00.000Z",
                "sessionId": "real-cli-session-123",
                "cwd": "/Users/example/Gits/golems",
                "message": {
                    "role": "user",
                    "content": "You are the Phoenix BUILD-#1 worker reporting to PHX-LEAD. Repo: golems.",
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-06-04T10:00:01.000Z",
                "message": {
                    "model": "claude-opus-4-8",
                    "role": "assistant",
                    "content": [{"type": "text", "text": "I will inspect cmux state."}],
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 20,
                        "cache_read_input_tokens": 50,
                        "cache_creation_input_tokens": 10,
                        "cache_creation": {
                            "ephemeral_5m_input_tokens": 4,
                            "ephemeral_1h_input_tokens": 6,
                        },
                    },
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-06-04T10:00:02.000Z",
                "message": {
                    "model": "claude-opus-4-8",
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
                "timestamp": "2026-06-04T10:00:04.500Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "toolu_list",
                            "content": json.dumps(
                                {
                                    "panes": [
                                        {"pixel_frame": {"x": 0, "y": 0, "width": 600}},
                                        {"pixel_frame": {"x": 600, "y": 0, "width": 600}},
                                    ]
                                }
                            ),
                        }
                    ],
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-06-04T10:00:05.000Z",
                "message": {
                    "model": "claude-opus-4-8",
                    "role": "assistant",
                    "content": [{"type": "text", "text": "Done."}],
                },
            },
        ],
    )
    exporter = InMemorySpanExporter()

    summary = trace_module.export_jsonl_sessions(
        [session],
        exporter=exporter,
        project_name="cmux-sessions",
        agent_type="codex",
    )

    spans = list(exporter.get_finished_spans())
    root = span_by_name(spans, "golemsCodex: Repo: golems")
    first_prompt = span_by_name(spans, "orchestrator prompt 1")
    tool = span_by_name(spans, "mcp__cmuxlayer__list_surfaces")
    first_text = span_by_name(spans, "assistant text 1")

    assert summary["sessions_exported"] == 1
    assert summary["spans_exported"] == len(spans) == 5
    assert {attrs(span)["session.id"] for span in spans} == {"real-cli-session-123"}
    assert all(attrs(span)["agent.name"] == "golemsCodex" for span in spans)
    assert all(attrs(span)["agent.type"] == "codex" for span in spans)
    assert all(attrs(span)["agent.role"] == "worker" for span in spans)
    assert all(attrs(span)["agent.reports_to"] == "worker-of PHX-LEAD" for span in spans)
    assert all(attrs(span)["repo"] == "golems" for span in spans)
    assert all(span.resource.attributes["openinference.project.name"] == "cmux-sessions" for span in spans)

    assert attrs(root)["openinference.span.kind"] == "CHAIN"
    assert root.start_time == ts_ns("2026-06-04T10:00:00.000Z")
    assert root.end_time - root.start_time == 1_000_000
    assert attrs(root)["session.duration_ms"] == 5000
    assert attrs(root).get("input.value") is None
    assert attrs(root).get("output.value") is None

    assert attrs(first_prompt)["openinference.span.kind"] == "CHAIN"
    assert attrs(first_prompt)["input.value"] == (
        "You are the Phoenix BUILD-#1 worker reporting to PHX-LEAD. Repo: golems."
    )
    assert attrs(first_prompt)["turn.role"] == "orchestrator"
    assert attrs(first_prompt)["turn.kind"] == "driver"
    assert first_prompt.parent is None
    assert first_prompt.context.trace_id != root.context.trace_id

    assert tool.parent is None
    assert tool.context.trace_id != root.context.trace_id
    assert attrs(tool)["openinference.span.kind"] == "TOOL"
    assert attrs(tool)["tool.name"] == "mcp__cmuxlayer__list_surfaces"
    assert json.loads(attrs(tool)["input.value"]) == {"workspace": "workspace:9"}
    assert "pixel_frame" in attrs(tool)["output.value"]
    assert tool.start_time == ts_ns("2026-06-04T10:00:02.000Z")
    assert tool.end_time == ts_ns("2026-06-04T10:00:04.500Z")
    assert json.loads(attrs(tool)["cmux.geometry"]) == {"column_count": 2}

    assert attrs(first_text)["openinference.span.kind"] == "LLM"
    assert attrs(first_text)["output.value"] == "I will inspect cmux state."
    assert attrs(first_text)["llm.model_name"] == "claude-opus-4-8"
    assert attrs(first_text)["llm.token_count.prompt"] == 160
    assert attrs(first_text)["llm.token_count.completion"] == 20
    assert attrs(first_text)["llm.token_count.total"] == 180
    assert attrs(first_text)["llm.token_count.prompt_details.cache_read"] == 50
    assert attrs(first_text)["llm.token_count.prompt_details.cache_write"] == 10
    assert attrs(first_text)["llm.cost.prompt"] == pytest.approx(0.00061)
    assert attrs(first_text)["llm.cost.completion"] == pytest.approx(0.0005)
    assert attrs(first_text)["llm.cost.total"] == pytest.approx(0.00111)
    assert first_text.parent is None
    assert first_text.context.trace_id != root.context.trace_id


def test_first_turn_segments_flat_prompt_and_assistant_spans_without_root_turn_blob(
    tmp_path,
    trace_module,
):
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    session = write_jsonl(
        tmp_path / "flat-first-turn.jsonl",
        [
            {
                "type": "user",
                "timestamp": "2026-06-04T10:00:00.000Z",
                "sessionId": "flat-first-turn-session",
                "cwd": "/Users/example/Gits/golems",
                "message": {
                    "role": "user",
                    "content": "You are the PHOENIX EVAL DOMAIN LEAD reporting to orcClaude gen-10. Read /tmp/lead.md IN FULL and execute it now.",
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-06-04T10:00:01.000Z",
                "message": {
                    "model": "claude-opus-4-8",
                    "role": "assistant",
                    "content": [{"type": "text", "text": "I will inspect the trace shape."}],
                    "usage": {"input_tokens": 20, "output_tokens": 8},
                },
            },
            {
                "type": "user",
                "timestamp": "2026-06-04T10:00:02.000Z",
                "message": {
                    "role": "user",
                    "content": "Continue with the same gate and report back to PHX-LEAD.",
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-06-04T10:00:03.000Z",
                "message": {
                    "model": "claude-opus-4-8",
                    "role": "assistant",
                    "content": [{"type": "text", "text": "Continuing."}],
                },
            },
        ],
    )
    exporter = InMemorySpanExporter()

    trace_module.export_jsonl_sessions(
        [session],
        exporter=exporter,
        project_name="cmux-sessions",
        agent_type="claude",
    )

    spans = list(exporter.get_finished_spans())
    roots = [
        span
        for span in spans
        if attrs(span).get("session.duration_ms") is not None
        and attrs(span).get("openinference.span.kind") == "CHAIN"
    ]
    assert len(roots) == 1, [span.name for span in spans]
    root = roots[0]
    first_prompt = span_by_name(spans, "orchestrator prompt 1")
    second_prompt = span_by_name(spans, "orchestrator prompt 2")
    first_reply = span_by_name(spans, "assistant text 1")

    assert attrs(root).get("input.value") is None
    assert attrs(root).get("output.value") is None
    assert "turn 1" not in json.dumps(attrs(root)).lower()

    assert attrs(first_prompt)["openinference.span.kind"] == "CHAIN"
    assert attrs(first_prompt)["input.value"].startswith("You are the PHOENIX EVAL DOMAIN LEAD")
    assert attrs(first_prompt)["turn.role"] == "orchestrator"
    assert attrs(first_prompt)["turn.kind"] == "driver"
    assert attrs(first_prompt)["event.index"] == 0
    assert first_prompt.parent is None
    assert first_prompt.context.trace_id != root.context.trace_id

    assert attrs(second_prompt)["turn.role"] == "orchestrator"
    assert attrs(second_prompt)["turn.kind"] == "driver"
    assert attrs(second_prompt)["event.index"] == 2
    assert second_prompt.parent is None
    assert second_prompt.context.trace_id != root.context.trace_id

    assert first_reply.parent is None
    assert first_reply.context.trace_id != root.context.trace_id
    assert all("turn 1" not in span.name.lower() for span in spans)


def test_prompt_role_classifier_uses_boot_handoff_content_without_parent_metadata(trace_module):
    boot_cases = [
        "You are orcClaude gen-9, succeeding gen-8. Read /opt/private/coordination/docs.local/handoffs/2026-06-04-orc-gen9-boot.md IN FULL and execute it.",
        "You are cmuxlayerClaude-LEAD, spun up by orcClaude (surface:1) to investigate + fix tonight's cmux incident. Read /tmp/cmuxlayer-lead-incident.md and execute it.",
    ]
    for text in boot_cases:
        assert trace_module._prompt_role(text, {"reports_to": "standalone"}) == (
            "orchestrator",
            "heuristic",
        )

    assert trace_module._prompt_role(
        "how's my recovery looking today, and can you draft a message to the coach?",
        {"reports_to": "standalone"},
    ) == ("human", "default")


def test_idle_gaps_are_not_exported_as_multi_hour_span_latency(tmp_path, trace_module):
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    session = write_jsonl(
        tmp_path / "idle-gap.jsonl",
        [
            {
                "type": "user",
                "timestamp": "2026-06-04T10:00:00.000Z",
                "sessionId": "idle-gap-session",
                "cwd": "/Users/example/Gits/golems",
                "message": {"role": "user", "content": "Repo: golems."},
            },
            {
                "type": "assistant",
                "timestamp": "2026-06-04T10:00:02.000Z",
                "message": {
                    "model": "claude-opus-4-8",
                    "role": "assistant",
                    "content": [{"type": "text", "text": "First turn."}],
                    "usage": {"input_tokens": 10, "output_tokens": 2},
                },
            },
            {
                "type": "user",
                "timestamp": "2026-06-04T13:00:00.000Z",
                "message": {"role": "user", "content": "Continue after idle."},
            },
        ],
    )
    exporter = InMemorySpanExporter()

    trace_module.export_jsonl_sessions(
        [session],
        exporter=exporter,
        project_name="cmux-sessions",
        agent_type="codex",
    )

    spans = list(exporter.get_finished_spans())
    root = span_by_name(spans, "golemsCodex: Repo: golems")
    first_text = span_by_name(spans, "assistant text 1")

    assert root.end_time - root.start_time == 1_000_000
    assert first_text.end_time - first_text.start_time == 1_000_000
    assert attrs(first_text)["latency.nominalized"] is True
    assert attrs(first_text)["latency.original_duration_ms"] > 10_000_000


def test_sessions_url_uses_phoenix_project_id_when_available(trace_module):
    assert (
        trace_module.phoenix_sessions_url(
            base_url="http://phoenix.local:6006",
            project_name="cmux-sessions",
            project_id="UHJvamVjdDo0OA==",
        )
        == "http://phoenix.local:6006/projects/UHJvamVjdDo0OA==/sessions"
    )


def test_geometry_attr_reads_column_count_from_list_surfaces_output(trace_module):
    geometry = trace_module._geometry_attr(
        "mcp__cmuxlayer__list_surfaces",
        {"verbose": True},
        '{"column_count": 2, "surfaces": []}',
    )

    assert json.loads(geometry) == {"column_count": 2}


def test_since_last_recent_export_falls_back_to_full_discovery(tmp_path, monkeypatch, trace_module):
    session = tmp_path / "recent-session.jsonl"
    session.write_text("{}\n")
    calls = {}

    def fake_discover_sessions(find_roots, *, contains=None, limit=20):
        calls["find_roots"] = find_roots
        calls["contains"] = contains
        calls["limit"] = limit
        return [session]

    def fake_export_jsonl_sessions(paths, **kwargs):
        calls["export_paths"] = list(paths)
        return {"sessions_exported": len(calls["export_paths"]), "spans_exported": 0}

    monkeypatch.setattr(trace_module, "discover_sessions", fake_discover_sessions)
    monkeypatch.setattr(trace_module, "export_jsonl_sessions", fake_export_jsonl_sessions)

    args = trace_module.parse_args(["--recent", "--since-last", "--find-root", "/tmp/cmux-root", "--limit", "3"])
    summary = trace_module.export_recent_sessions(
        args.find_roots,
        limit=args.limit,
        since_last=args.since_last,
    )

    assert calls == {
        "find_roots": ["/tmp/cmux-root"],
        "contains": trace_module.DEFAULT_CONTAINS,
        "limit": 3,
        "export_paths": [session],
    }
    assert summary == {"sessions_exported": 1, "spans_exported": 0}

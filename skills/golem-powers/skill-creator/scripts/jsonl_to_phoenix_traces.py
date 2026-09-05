#!/usr/bin/env python3
"""
jsonl_to_phoenix_traces - replay Claude/Codex session JSONL as OpenInference spans.

Unlike cmux_capture_batch.py, this emits native OTEL spans so Phoenix's Sessions
waterfall can group complete CLI sessions by the real JSONL session id.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import urlparse
from urllib.request import urlopen

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, SpanExporter

from openinference.semconv.resource import ResourceAttributes
from openinference.semconv.trace import OpenInferenceSpanKindValues, SpanAttributes

from cmux_capture import (
    DEFAULT_PHOENIX_BASE_URL,
    _extract_column_count,
    extract_agent_identity,
    extract_booted_model,
    extract_session_id,
    extract_session_timing,
    load_session_events,
    normalize_model_display,
    session_miner,
)
from cmux_capture_batch import (
    DEFAULT_CONTAINS,
    DEFAULT_FIND_ROOT,
    discover_sessions,
)


DEFAULT_PROJECT_NAME = "cmux-sessions"
DEFAULT_OTLP_ENDPOINT = f"{DEFAULT_PHOENIX_BASE_URL}/v1/traces"
GEOMETRY_TOOL_SUFFIXES = ("list_surfaces", "list_panes")
NOMINAL_SPAN_DURATION_NS = 1_000_000
MAX_INTERACTIVE_SPAN_DURATION_NS = 10 * 60 * 1_000_000_000


@dataclass(frozen=True)
class ModelPricing:
    input_per_mtok: float
    output_per_mtok: float
    cache_write_5m_per_mtok: float
    cache_write_1h_per_mtok: float
    cache_read_per_mtok: float


@dataclass(frozen=True)
class ToolResult:
    event_index: int
    timestamp: str
    content: str


@dataclass(frozen=True)
class TraceToolCall:
    event_index: int
    timestamp: str
    name: str
    input: dict[str, Any]
    tool_use_id: str
    result: ToolResult | None


@dataclass(frozen=True)
class TraceUserPrompt:
    event_index: int
    timestamp: str
    text: str
    ordinal: int
    role: str
    role_source: str


@dataclass(frozen=True)
class TraceAssistantText:
    event_index: int
    timestamp: str
    text: str
    ordinal: int
    model: str
    usage: Mapping[str, Any] | None


def _parse_timestamp_ns(value: Any) -> int | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1_000_000_000)


def _timestamp_ns_or(value: Any, fallback: int) -> int:
    parsed = _parse_timestamp_ns(value)
    return parsed if parsed is not None else fallback


def _nondecreasing_end(start_ns: int, end_ns: int | None) -> int:
    if end_ns is None:
        return start_ns
    return end_ns if end_ns >= start_ns else start_ns


def _sane_span_end_attrs(start_ns: int, candidate_end_ns: int | None) -> tuple[int, dict[str, Any]]:
    if candidate_end_ns is None or candidate_end_ns < start_ns:
        return start_ns + NOMINAL_SPAN_DURATION_NS, {"latency.nominalized": True}
    duration_ns = candidate_end_ns - start_ns
    if duration_ns <= MAX_INTERACTIVE_SPAN_DURATION_NS:
        return candidate_end_ns, {}
    return (
        start_ns + NOMINAL_SPAN_DURATION_NS,
        {
            "latency.nominalized": True,
            "latency.original_duration_ms": int(duration_ns / 1_000_000),
        },
    )


def _int_usage(usage: Mapping[str, Any], key: str) -> int:
    value = usage.get(key)
    try:
        return max(0, int(value))
    except Exception:
        return 0


def _cache_creation_parts(usage: Mapping[str, Any]) -> tuple[int, int, int]:
    total = _int_usage(usage, "cache_creation_input_tokens")
    nested = usage.get("cache_creation")
    five_min = 0
    one_hour = 0
    if isinstance(nested, Mapping):
        five_min = _int_usage(nested, "ephemeral_5m_input_tokens")
        one_hour = _int_usage(nested, "ephemeral_1h_input_tokens")
    if total == 0:
        total = five_min + one_hour
    remainder = max(0, total - five_min - one_hour)
    five_min += remainder
    return total, five_min, one_hour


def _usage_token_counts(usage: Mapping[str, Any]) -> dict[str, int]:
    input_tokens = _int_usage(usage, "input_tokens")
    output_tokens = _int_usage(usage, "output_tokens")
    cache_read = _int_usage(usage, "cache_read_input_tokens")
    cache_creation_total, cache_creation_5m, cache_creation_1h = _cache_creation_parts(usage)
    prompt_total = input_tokens + cache_read + cache_creation_total
    return {
        "input": input_tokens,
        "output": output_tokens,
        "cache_read": cache_read,
        "cache_creation": cache_creation_total,
        "cache_creation_5m": cache_creation_5m,
        "cache_creation_1h": cache_creation_1h,
        "prompt": prompt_total,
        "completion": output_tokens,
        "total": prompt_total + output_tokens,
    }


def _pricing_for_model(model: str) -> ModelPricing | None:
    normalized = re.sub(r"[^a-z0-9]+", "-", (model or "").lower()).strip("-")
    if re.search(r"opus-4-(?:5|6|7|8)", normalized):
        return ModelPricing(5.0, 25.0, 6.25, 10.0, 0.50)
    if re.search(r"sonnet-4(?:-(?:5|6))?(?:$|-)", normalized):
        return ModelPricing(3.0, 15.0, 3.75, 6.0, 0.30)
    if "haiku-4-5" in normalized:
        return ModelPricing(1.0, 5.0, 1.25, 2.0, 0.10)
    if "haiku-3-5" in normalized:
        return ModelPricing(0.80, 4.0, 1.0, 1.60, 0.08)
    if re.search(r"opus-4(?:$|-)", normalized) or "opus-4-1" in normalized:
        return ModelPricing(15.0, 75.0, 18.75, 30.0, 1.50)
    return None


def _usage_cost_attrs(counts: Mapping[str, int], model: str) -> dict[str, float]:
    pricing = _pricing_for_model(model)
    if pricing is None:
        return {}
    input_cost = counts["input"] * pricing.input_per_mtok / 1_000_000
    cache_read_cost = counts["cache_read"] * pricing.cache_read_per_mtok / 1_000_000
    cache_write_cost = (
        counts["cache_creation_5m"] * pricing.cache_write_5m_per_mtok
        + counts["cache_creation_1h"] * pricing.cache_write_1h_per_mtok
    ) / 1_000_000
    prompt_cost = input_cost + cache_read_cost + cache_write_cost
    completion_cost = counts["completion"] * pricing.output_per_mtok / 1_000_000
    return {
        SpanAttributes.LLM_COST_PROMPT: prompt_cost,
        SpanAttributes.LLM_COST_PROMPT_DETAILS_INPUT: input_cost,
        SpanAttributes.LLM_COST_PROMPT_DETAILS_CACHE_READ: cache_read_cost,
        SpanAttributes.LLM_COST_PROMPT_DETAILS_CACHE_WRITE: cache_write_cost,
        SpanAttributes.LLM_COST_COMPLETION: completion_cost,
        SpanAttributes.LLM_COST_TOTAL: prompt_cost + completion_cost,
    }


def _usage_attrs(usage: Mapping[str, Any] | None, model: str) -> dict[str, Any]:
    attrs: dict[str, Any] = {SpanAttributes.LLM_MODEL_NAME: model} if model else {}
    if not isinstance(usage, Mapping):
        return attrs
    counts = _usage_token_counts(usage)
    if counts["total"] <= 0:
        return attrs
    attrs.update(
        {
            SpanAttributes.LLM_TOKEN_COUNT_PROMPT: counts["prompt"],
            SpanAttributes.LLM_TOKEN_COUNT_COMPLETION: counts["completion"],
            SpanAttributes.LLM_TOKEN_COUNT_TOTAL: counts["total"],
            SpanAttributes.LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ: counts["cache_read"],
            SpanAttributes.LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_WRITE: counts["cache_creation"],
            SpanAttributes.LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_INPUT: counts["cache_creation"],
            "llm.token_count.prompt_details.input": counts["input"],
        }
    )
    attrs.update(_usage_cost_attrs(counts, model))
    return attrs


def _text_from_tool_result_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
                elif item.get("type") == "text" and item.get("content"):
                    parts.append(str(item["content"]))
            elif item is not None:
                parts.append(str(item))
        return "\n".join(parts)
    if content is None:
        return ""
    return json.dumps(content, sort_keys=True)


def _event_message_content(obj: Mapping[str, Any]) -> Any:
    message = obj.get("message")
    if isinstance(message, Mapping):
        return message.get("content")
    return obj.get("content")


def _user_prompt_text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return "" if content is None else str(content).strip()
    parts: list[str] = []
    for item in content:
        if not isinstance(item, Mapping):
            if item is not None:
                parts.append(str(item))
            continue
        if item.get("type") == "tool_result":
            continue
        text = item.get("text")
        if isinstance(text, str):
            parts.append(text)
        elif item.get("content") is not None:
            parts.append(_text_from_tool_result_content(item.get("content")))
    return "\n".join(part for part in parts if part).strip()


def _has_driver_parent(identity: Mapping[str, str]) -> bool:
    value = str(identity.get("reports_to") or "").strip().lower()
    return bool(value and value not in {"standalone", "human", "none", "null", "self"})


def _looks_like_driver_prompt(text: str) -> bool:
    normalized = " ".join(text.split())
    if not normalized:
        return False
    patterns = [
        r"^\s*you are\b",
        r"\bspun up by\b",
        r"\bsucceeding gen-?\d+\b",
        r"\byou are\b.+\breporting to\b",
        r"\bread\b.+\bin full\b.+\bexecute (?:it )?(?:now|exactly)?\b",
        r"\bread\b.+\bhandoffs?/\S+.+\bexecute (?:it )?(?:now|exactly)?\b",
        r"\bread\b.+\bboot\.md\b.+\bexecute\b",
        r"\bexecute it\b.+\borient\b",
        r"\breporting to orcclaude\b",
        r"\breporting to\s+[A-Za-z][A-Za-z0-9_-]*(?:\s+gen-?\d+)?\b",
        r"\btask:\b.+\bexecute\b",
        r"\bmission:\b.+\breport milestones/blockers\b",
        r"\bspawn your own\b.+\bworkers?\b",
    ]
    return any(re.search(pattern, normalized, flags=re.IGNORECASE) for pattern in patterns)


def _prompt_role(text: str, identity: Mapping[str, str]) -> tuple[str, str]:
    if _has_driver_parent(identity):
        return "orchestrator", "metadata"
    if _looks_like_driver_prompt(text):
        return "orchestrator", "heuristic"
    return "human", "default"


def collect_user_prompts(
    events: Sequence[tuple[int, dict[str, Any]]],
    identity: Mapping[str, str],
) -> list[TraceUserPrompt]:
    prompts: list[TraceUserPrompt] = []
    for idx, obj in events:
        if obj.get("type") != "user":
            continue
        text = _user_prompt_text_from_content(_event_message_content(obj))
        if not text:
            continue
        role, role_source = _prompt_role(text, identity)
        prompts.append(
            TraceUserPrompt(
                event_index=idx,
                timestamp=str(obj.get("timestamp") or ""),
                text=text,
                ordinal=len(prompts) + 1,
                role=role,
                role_source=role_source,
            )
        )
    return prompts


def collect_tool_results(events: Sequence[tuple[int, dict[str, Any]]]) -> dict[str, ToolResult]:
    results: dict[str, ToolResult] = {}
    for idx, obj in events:
        if obj.get("type") != "user":
            continue
        message = obj.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "tool_result":
                continue
            tool_use_id = item.get("tool_use_id")
            if not tool_use_id:
                continue
            results[str(tool_use_id)] = ToolResult(
                event_index=idx,
                timestamp=str(obj.get("timestamp") or ""),
                content=_text_from_tool_result_content(item.get("content")),
            )
    return results


def collect_trace_items(
    events: Sequence[tuple[int, dict[str, Any]]],
) -> tuple[list[TraceAssistantText], list[TraceToolCall]]:
    (
        _user_msgs,
        assistant_texts,
        tool_calls,
        _tool_results_text,
        _queue_ops,
        _sys_events,
    ) = session_miner.categorize(list(events))
    result_records = collect_tool_results(events)
    event_lookup = {idx: obj for idx, obj in events}
    seen_usage_messages: set[str] = set()
    text_items: list[TraceAssistantText] = []
    for ordinal, (idx, ts, text) in enumerate(assistant_texts, start=1):
        obj = event_lookup.get(idx) or {}
        message = obj.get("message") if isinstance(obj, Mapping) else None
        model = ""
        usage: Mapping[str, Any] | None = None
        if isinstance(message, Mapping):
            model = str(message.get("model") or "")
            candidate_usage = message.get("usage")
            usage_key = str(message.get("id") or f"event:{idx}")
            if isinstance(candidate_usage, Mapping) and usage_key not in seen_usage_messages:
                usage = candidate_usage
                seen_usage_messages.add(usage_key)
        text_items.append(
            TraceAssistantText(
                event_index=idx,
                timestamp=ts,
                text=text,
                ordinal=ordinal,
                model=model,
                usage=usage,
            )
        )
    tool_items = [
        TraceToolCall(
            event_index=idx,
            timestamp=ts,
            name=name,
            input=inp or {},
            tool_use_id=tool_use_id,
            result=result_records.get(tool_use_id),
        )
        for idx, ts, name, inp, tool_use_id in tool_calls
    ]
    return text_items, tool_items


def _session_bounds(events: Sequence[tuple[int, dict[str, Any]]]) -> tuple[int, int]:
    stamped = [
        parsed
        for _idx, obj in events
        if (parsed := _parse_timestamp_ns(obj.get("timestamp"))) is not None
    ]
    if not stamped:
        now = int(datetime.now(tz=timezone.utc).timestamp() * 1_000_000_000)
        return now, now
    return stamped[0], stamped[-1]


def _next_event_start_ns(
    events: Sequence[tuple[int, dict[str, Any]]],
    event_index: int,
    fallback: int,
) -> int:
    for idx, obj in events:
        if idx <= event_index:
            continue
        parsed = _parse_timestamp_ns(obj.get("timestamp"))
        if parsed is not None:
            return parsed
    return fallback


def _json_value(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def _set_attrs(span: trace.Span, attrs: Mapping[str, Any]) -> None:
    cleaned = {
        key: value
        for key, value in attrs.items()
        if value is not None and isinstance(value, (str, bool, int, float, tuple, list))
    }
    span.set_attributes(cleaned)


def _identity_attrs(identity: Mapping[str, str]) -> dict[str, str]:
    return {
        "agent.name": identity.get("agent_name", ""),
        "agent.type": identity.get("agent_type", ""),
        "agent.role": identity.get("agent_role", ""),
        "agent.reports_to": identity.get("reports_to", ""),
        "agent.task_summary": identity.get("task_summary", ""),
        "repo": identity.get("repo", ""),
    }


def _root_name(identity: Mapping[str, str]) -> str:
    agent_name = identity.get("agent_name") or "agent"
    summary = (identity.get("task_summary") or "session").strip()
    return f"{agent_name}: {summary}" if summary else str(agent_name)


def _column_count_from_output(output: str) -> int | None:
    try:
        payload = json.loads(output)
    except Exception:
        payload = None
    candidates: list[Any] = []
    if isinstance(payload, Mapping):
        candidates.append(payload.get("column_count"))
        data = payload.get("data")
        if isinstance(data, Mapping):
            candidates.append(data.get("column_count"))
    for candidate in candidates:
        try:
            if candidate is not None:
                return int(candidate)
        except Exception:
            pass
    match = re.search(r'"column_count"\s*:\s*(\d+)', output or "")
    return int(match.group(1)) if match else None


def _geometry_attr(tool_name: str, tool_input: Mapping[str, Any], output: str) -> str | None:
    normalized = tool_name.replace("-", "_")
    is_geometry_tool = normalized.endswith(GEOMETRY_TOOL_SUFFIXES)
    if tool_name == "Bash":
        command = str(tool_input.get("command") or "")
        is_geometry_tool = "cmux list-surfaces" in command or "cmux list-panes" in command
    if not is_geometry_tool:
        return None
    column_count = _column_count_from_output(output)
    if column_count is None:
        column_count = _extract_column_count(output)
    if column_count is None:
        return None
    return _json_value({"column_count": column_count})


def _prompt_span_name(item: TraceUserPrompt) -> str:
    prefix = "orchestrator" if item.role == "orchestrator" else "user"
    return f"{prefix} prompt {item.ordinal}"


def _prompt_turn_kind(item: TraceUserPrompt) -> str:
    return "driver" if item.role == "orchestrator" else "user"


def build_tracer_provider(
    *,
    project_name: str = DEFAULT_PROJECT_NAME,
    endpoint: str = DEFAULT_OTLP_ENDPOINT,
    exporter: SpanExporter | None = None,
    batch: bool = True,
) -> TracerProvider:
    resource = Resource.create(
        {
            "service.name": project_name,
            ResourceAttributes.PROJECT_NAME: project_name,
        }
    )
    provider = TracerProvider(resource=resource)
    if exporter is None:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        exporter = OTLPSpanExporter(endpoint=endpoint)
    processor = BatchSpanProcessor(exporter) if batch else SimpleSpanProcessor(exporter)
    provider.add_span_processor(processor)
    return provider


def emit_session_spans(
    src: str | Path,
    *,
    tracer_provider: TracerProvider,
    project_name: str = DEFAULT_PROJECT_NAME,
    agent_type: str | None = None,
) -> dict[str, Any]:
    path = Path(src).expanduser()
    events, parse_errors = load_session_events(str(path))
    if not events:
        return {
            "source": str(path),
            "session_id": path.stem,
            "spans_exported": 0,
            "parse_errors": parse_errors,
            "skipped": "empty session",
        }

    root_start_ns, session_end_ns = _session_bounds(events)
    root_end_ns = root_start_ns + NOMINAL_SPAN_DURATION_NS
    session_id = extract_session_id(str(path), events)
    identity = extract_agent_identity(str(path), events, agent_type=agent_type)
    user_items = collect_user_prompts(events, identity)
    text_items, tool_items = collect_trace_items(events)
    booted_model, _booted_model_idx = extract_booted_model(events)
    model_display = normalize_model_display(booted_model, agent_type=identity["agent_type"])
    timing = extract_session_timing(events)
    common_attrs = {
        SpanAttributes.SESSION_ID: session_id,
        **_identity_attrs(identity),
        "source.path": str(path),
        "project.name": project_name,
        "model": model_display,
    }
    tracer = tracer_provider.get_tracer(__name__)
    root = tracer.start_span(_root_name(identity), start_time=root_start_ns)
    spans_exported = 1
    try:
        _set_attrs(
            root,
            {
                **common_attrs,
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                "session.start_ts": timing.get("session_start_ts"),
                "session.end_ts": timing.get("session_end_ts"),
                "session.duration_ms": timing.get("session_duration_ms"),
                "session.event_count": len(events),
                "latency.nominalized": True,
                "latency.original_duration_ms": int((session_end_ns - root_start_ns) / 1_000_000),
            },
        )

        for item in sorted([*user_items, *text_items, *tool_items], key=lambda row: row.event_index):
            if isinstance(item, TraceUserPrompt):
                start_ns = _timestamp_ns_or(item.timestamp, root_start_ns)
                end_ns, latency_attrs = _sane_span_end_attrs(
                    start_ns,
                    _next_event_start_ns(events, item.event_index, start_ns),
                )
                span = tracer.start_span(
                    _prompt_span_name(item),
                    start_time=start_ns,
                )
                try:
                    _set_attrs(
                        span,
                        {
                            **common_attrs,
                            SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                            SpanAttributes.INPUT_VALUE: item.text,
                            "event.index": item.event_index,
                            "event.role": "user",
                            "turn.kind": _prompt_turn_kind(item),
                            "turn.role": item.role,
                            "turn.role_source": item.role_source,
                            **latency_attrs,
                        },
                    )
                finally:
                    span.end(end_time=end_ns)
                spans_exported += 1
                continue

            if isinstance(item, TraceAssistantText):
                start_ns = _timestamp_ns_or(item.timestamp, root_start_ns)
                end_ns, latency_attrs = _sane_span_end_attrs(
                    start_ns,
                    _next_event_start_ns(events, item.event_index, start_ns),
                )
                span = tracer.start_span(
                    f"assistant text {item.ordinal}",
                    start_time=start_ns,
                )
                try:
                    _set_attrs(
                        span,
                        {
                            **common_attrs,
                            SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.LLM.value,
                            SpanAttributes.OUTPUT_VALUE: item.text,
                            "event.index": item.event_index,
                            **_usage_attrs(item.usage, item.model or model_display),
                            **latency_attrs,
                        },
                    )
                finally:
                    span.end(end_time=end_ns)
                spans_exported += 1
                continue

            output = item.result.content if item.result else ""
            start_ns = _timestamp_ns_or(item.timestamp, root_start_ns)
            result_end_ns = _parse_timestamp_ns(item.result.timestamp) if item.result else None
            end_ns, latency_attrs = _sane_span_end_attrs(
                start_ns,
                result_end_ns or _next_event_start_ns(events, item.event_index, start_ns),
            )
            span = tracer.start_span(item.name, start_time=start_ns)
            try:
                geometry = _geometry_attr(item.name, item.input, output)
                _set_attrs(
                    span,
                    {
                        **common_attrs,
                        SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.TOOL.value,
                        SpanAttributes.TOOL_NAME: item.name,
                        SpanAttributes.INPUT_VALUE: _json_value(item.input),
                        SpanAttributes.OUTPUT_VALUE: output,
                        "tool.use_id": item.tool_use_id,
                        "event.index": item.event_index,
                        "event.result_index": item.result.event_index if item.result else None,
                        "cmux.geometry": geometry,
                        **latency_attrs,
                    },
                )
            finally:
                span.end(end_time=end_ns)
            spans_exported += 1
    finally:
        root.end(end_time=root_end_ns)

    return {
        "source": str(path),
        "session_id": session_id,
        "spans_exported": spans_exported,
        "parse_errors": parse_errors,
        "agent": identity,
        "model": model_display,
    }


def export_jsonl_sessions(
    sources: Iterable[str | Path],
    *,
    endpoint: str = DEFAULT_OTLP_ENDPOINT,
    project_name: str = DEFAULT_PROJECT_NAME,
    exporter: SpanExporter | None = None,
    tracer_provider: TracerProvider | None = None,
    agent_type: str | None = None,
) -> dict[str, Any]:
    paths = [Path(source).expanduser() for source in sources]
    owns_provider = tracer_provider is None
    provider = tracer_provider or build_tracer_provider(
        project_name=project_name,
        endpoint=endpoint,
        exporter=exporter,
        batch=exporter is None,
    )
    results = [
        emit_session_spans(
            path,
            tracer_provider=provider,
            project_name=project_name,
            agent_type=agent_type,
        )
        for path in paths
    ]
    provider.force_flush()
    if owns_provider and exporter is None:
        provider.shutdown()
    spans_exported = sum(int(result.get("spans_exported") or 0) for result in results)
    sessions_exported = sum(1 for result in results if int(result.get("spans_exported") or 0) > 0)
    project_id = None if exporter is not None else resolve_project_id(endpoint, project_name)
    return {
        "project_name": project_name,
        "project_id": project_id,
        "endpoint": endpoint,
        "sessions_exported": sessions_exported,
        "spans_exported": spans_exported,
        "results": results,
        "phoenix_sessions_url": phoenix_sessions_url(
            base_url=phoenix_base_url(endpoint),
            project_name=project_name,
            project_id=project_id,
        ),
    }


def phoenix_base_url(endpoint: str = DEFAULT_OTLP_ENDPOINT) -> str:
    parsed = urlparse(endpoint)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return DEFAULT_PHOENIX_BASE_URL


def resolve_project_id(
    endpoint: str = DEFAULT_OTLP_ENDPOINT,
    project_name: str = DEFAULT_PROJECT_NAME,
    *,
    timeout: float = 5.0,
) -> str | None:
    base_url = phoenix_base_url(endpoint)
    try:
        with urlopen(f"{base_url.rstrip('/')}/v1/projects", timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return None
    rows = payload.get("data") if isinstance(payload, Mapping) else None
    if not isinstance(rows, list):
        return None
    for row in rows:
        if isinstance(row, Mapping) and row.get("name") == project_name and row.get("id"):
            return str(row["id"])
    return None


def phoenix_sessions_url(
    *,
    base_url: str = DEFAULT_PHOENIX_BASE_URL,
    project_name: str = DEFAULT_PROJECT_NAME,
    project_id: str | None = None,
) -> str:
    if project_id:
        return f"{base_url.rstrip('/')}/projects/{project_id}/sessions"
    return f"{base_url.rstrip('/')}/projects/{project_name}/sessions"


def recent_session_paths(
    find_roots: Sequence[str] | None = None,
    *,
    limit: int = 20,
    contains: str | None = DEFAULT_CONTAINS,
) -> list[Path]:
    return discover_sessions(find_roots or [DEFAULT_FIND_ROOT], contains=contains, limit=limit)


def export_recent_sessions(
    find_roots: Sequence[str] | None = None,
    *,
    limit: int = 20,
    since_last: bool = False,
    endpoint: str = DEFAULT_OTLP_ENDPOINT,
    project_name: str = DEFAULT_PROJECT_NAME,
    agent_type: str | None = None,
) -> dict[str, Any]:
    roots = find_roots or [DEFAULT_FIND_ROOT]
    _ = since_last
    paths = recent_session_paths(roots, limit=limit)
    return export_jsonl_sessions(
        paths,
        endpoint=endpoint,
        project_name=project_name,
        agent_type=agent_type,
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export Claude/Codex JSONL sessions as OpenInference OTEL traces for Phoenix Sessions."
    )
    parser.add_argument("sources", nargs="*", help="Session JSONL path(s).")
    parser.add_argument("--recent", action="store_true", help="Discover recent real cmux sessions.")
    parser.add_argument(
        "--find-root",
        action="append",
        dest="find_roots",
        default=[],
        help="Root to scan for recent JSONLs. Can be repeated.",
    )
    parser.add_argument("--limit", type=int, default=20, help="Recent session limit.")
    parser.add_argument(
        "--since-last",
        action="store_true",
        help="Accepted for compatibility; recent export now performs full re-ingest.",
    )
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("PHOENIX_OTLP_ENDPOINT", DEFAULT_OTLP_ENDPOINT),
        help="Phoenix OTLP HTTP traces endpoint.",
    )
    parser.add_argument(
        "--project-name",
        default=os.environ.get("PHOENIX_PROJECT_NAME", DEFAULT_PROJECT_NAME),
        help="Phoenix/OpenInference project name.",
    )
    parser.add_argument("--agent-type", choices=("claude", "codex", "cursor"), default=None)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.recent:
        summary = export_recent_sessions(
            args.find_roots or None,
            limit=args.limit,
            since_last=args.since_last,
            endpoint=args.endpoint,
            project_name=args.project_name,
            agent_type=args.agent_type,
        )
    else:
        if not args.sources:
            print("error: provide JSONL sources or use --recent", file=sys.stderr)
            return 2
        summary = export_jsonl_sessions(
            args.sources,
            endpoint=args.endpoint,
            project_name=args.project_name,
            agent_type=args.agent_type,
        )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

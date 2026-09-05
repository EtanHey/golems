#!/usr/bin/env python3
"""
phoenix_mobile - mobile-first Phoenix session viewer and annotation proxy.

The native Phoenix Sessions page stores full user/assistant transcripts on root
spans as concatenated "turn N" blobs. This server reconstructs separate cards
from the original JSONL when available and uses Phoenix spans only for ids,
metadata, and annotation write-back.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen


DEFAULT_PHOENIX_BASE_URL = "http://127.0.0.1:6006"
DEFAULT_PROJECT_NAME = "cmux-sessions"
DEFAULT_IDENTIFIER = "mobile-curator"
AUTO_CRITIC_IDENTIFIER = "auto-critic"
QUALITY_ANNOTATION_NAME = "quality"
DEFAULT_ANNOTATIONS_PATH = Path("~/.local/share/brainlayer-phoenix/annotations.jsonl")
STATIC_DIR = Path(__file__).resolve().parents[1] / "static" / "phoenix-mobile"


class PhoenixMobileError(RuntimeError):
    pass


@dataclass(frozen=True)
class ServerConfig:
    phoenix_base_url: str = DEFAULT_PHOENIX_BASE_URL
    project_name: str = DEFAULT_PROJECT_NAME
    default_session_id: str | None = None


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: Mapping[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_request_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("content-length") or "0")
    if length <= 0:
        return {}
    body = handler.rfile.read(length).decode("utf-8")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise PhoenixMobileError(f"invalid JSON body: {exc}") from exc
    if not isinstance(payload, dict):
        raise PhoenixMobileError("request JSON body must be an object")
    return payload


def read_jsonl_events(path: str | Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with Path(path).expanduser().open("r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                obj = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                rows.append(obj)
    return rows


def annotation_log_path() -> Path:
    configured = os.environ.get("PHOENIX_ANNOTATIONS_PATH")
    return Path(configured).expanduser() if configured else DEFAULT_ANNOTATIONS_PATH.expanduser()


def _required_payload_text(payload: Mapping[str, Any], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        raise PhoenixMobileError(f"{key} is required")
    return value


def persist_turn_note(payload: Mapping[str, Any]) -> dict[str, str]:
    row = {
        "turn_id": _required_payload_text(payload, "turn_id"),
        "session": _required_payload_text(payload, "session"),
        "note": _required_payload_text(payload, "note"),
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    path = annotation_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def _span_context(span: Mapping[str, Any]) -> Mapping[str, Any]:
    context = span.get("context")
    return context if isinstance(context, Mapping) else {}


def _span_id(span: Mapping[str, Any]) -> str:
    context = _span_context(span)
    value = context.get("span_id") or span.get("span_id")
    return str(value or "")


def _trace_id(span: Mapping[str, Any], trace: Mapping[str, Any] | None = None) -> str:
    context = _span_context(span)
    value = context.get("trace_id") or (trace or {}).get("trace_id")
    return str(value or "")


def _attrs(span: Mapping[str, Any]) -> dict[str, Any]:
    attrs = span.get("attributes")
    return dict(attrs) if isinstance(attrs, Mapping) else {}


def _jsonish(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return ""
    if not (stripped.startswith("{") or stripped.startswith("[") or stripped.startswith('"')):
        return value
    try:
        return json.loads(stripped)
    except Exception:
        return value


def _text_from_tool_result_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, Mapping):
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
    return json.dumps(content, ensure_ascii=False, sort_keys=True)


def _message_content(obj: Mapping[str, Any]) -> Any:
    message = obj.get("message")
    if isinstance(message, Mapping):
        return message.get("content")
    return obj.get("content")


def _user_text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
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
    if content is None:
        return ""
    return str(content)


def _tool_results(events: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    for idx, obj in enumerate(events):
        if obj.get("type") != "user":
            continue
        content = _message_content(obj)
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, Mapping) or item.get("type") != "tool_result":
                continue
            tool_use_id = item.get("tool_use_id")
            if not tool_use_id:
                continue
            raw_text = _text_from_tool_result_content(item.get("content"))
            results[str(tool_use_id)] = {
                "event_index": idx,
                "timestamp": str(obj.get("timestamp") or ""),
                "text": raw_text,
                "value": _jsonish(raw_text),
            }
    return results


def _content_items(content: Any) -> list[Any]:
    if isinstance(content, list):
        return content
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return []


def _first_root_span(spans: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    for span in spans:
        attrs = _attrs(span)
        if attrs.get("session.duration_ms") is not None or attrs.get("source.path"):
            return span
    for span in spans:
        attrs = _attrs(span)
        if attrs.get("event.index") is None and span.get("parent_id") is None:
            return span
    for span in spans:
        if span.get("parent_id") is None or span.get("span_kind") == "CHAIN":
            return span
    return spans[0] if spans else None


def _spans_by_event(spans: Sequence[Mapping[str, Any]]) -> dict[int, list[Mapping[str, Any]]]:
    rows: dict[int, list[Mapping[str, Any]]] = {}
    for span in spans:
        attrs = _attrs(span)
        value = attrs.get("event.index")
        try:
            idx = int(value)
        except Exception:
            continue
        rows.setdefault(idx, []).append(span)
    for candidates in rows.values():
        candidates.sort(key=lambda span: str(span.get("start_time") or ""))
    return rows


def _pop_span_for_event(
    rows: dict[int, list[Mapping[str, Any]]],
    event_index: int,
    *,
    kind: str | None = None,
    tool_use_id: str | None = None,
) -> Mapping[str, Any] | None:
    candidates = rows.get(event_index) or []
    for idx, span in enumerate(candidates):
        attrs = _attrs(span)
        if kind and str(span.get("span_kind") or "").upper() != kind.upper():
            continue
        if tool_use_id and str(attrs.get("tool.use_id") or "") != tool_use_id:
            continue
        return candidates.pop(idx)
    return None


def _duration_ms(start: Any, end: Any) -> int | None:
    if not isinstance(start, str) or not isinstance(end, str):
        return None
    try:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except ValueError:
        return None
    delta = int((end_dt - start_dt).total_seconds() * 1000)
    return delta if delta >= 0 else None


def _duration_label(duration_ms: int | None) -> str | None:
    if duration_ms is None:
        return None
    if duration_ms < 1000:
        return f"{duration_ms} ms"
    seconds = duration_ms / 1000
    if seconds < 60:
        return f"{seconds:.1f} s"
    minutes = seconds / 60
    if minutes < 60:
        return f"{minutes:.1f} min"
    hours = minutes / 60
    return f"{hours:.1f} h"


def _cmux_geometry(attrs: Mapping[str, Any]) -> Any:
    if "cmux.geometry" not in attrs:
        return None
    return _jsonish(attrs.get("cmux.geometry"))


def _is_cmux_tool(name: str) -> bool:
    return "cmux" in name.lower()


def _agent_reports_to(attrs: Mapping[str, Any]) -> str:
    for key in ("agent.reports_to", "reports_to", "parent_agent", "agent.parent", "agent.parent_name"):
        value = attrs.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def _has_driver_parent(attrs: Mapping[str, Any]) -> bool:
    value = _agent_reports_to(attrs).strip().lower()
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


def classify_user_turn(text: str, root_attrs: Mapping[str, Any]) -> dict[str, str]:
    if _has_driver_parent(root_attrs) or _looks_like_driver_prompt(text):
        return {
            "kind": "driver",
            "role": "orchestrator",
            "title": "🤖 ORCHESTRATOR",
            "role_label": "ORCHESTRATOR",
        }
    return {
        "kind": "user",
        "role": "human",
        "title": "🧑 USER",
        "role_label": "USER",
    }


def _repo_from_source_path(source_path: str | None) -> str:
    if not source_path:
        return ""
    normalized = str(Path(source_path).expanduser())
    match = re.search(r"/Gits/([^/]+)", normalized)
    if match:
        return match.group(1)
    match = re.search(r"-Users-.+?-Gits-([^/]+)", normalized)
    if match:
        return match.group(1)
    return ""


def _repo_from_events(events: Sequence[Mapping[str, Any]]) -> str:
    for obj in events:
        cwd = obj.get("cwd")
        if cwd:
            name = Path(str(cwd)).expanduser().name
            if name:
                return name
        payload = obj.get("payload")
        if isinstance(payload, Mapping) and payload.get("cwd"):
            name = Path(str(payload.get("cwd"))).expanduser().name
            if name:
                return name
    return ""


def _compact_agent_name(agent_name: str) -> str:
    if not agent_name:
        return ""
    if re.search(r"orcClaude-gen\d+", agent_name, flags=re.IGNORECASE):
        match = re.search(r"orcClaude-gen\d+", agent_name, flags=re.IGNORECASE)
        return match.group(0) if match else agent_name
    if agent_name.endswith("-LEAD"):
        return agent_name
    return re.sub(r"(?:Claude|Codex|Cursor)$", "", agent_name).strip("-_ ") or agent_name


def resolve_session_identity(
    attrs: Mapping[str, Any],
    *,
    source_path: str | None = None,
    events: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, str]:
    agent_name = str(attrs.get("agent.name") or attrs.get("agent_name") or "").strip()
    repo = str(attrs.get("repo") or "").strip() or _repo_from_events(events or []) or _repo_from_source_path(source_path)
    compact_agent = _compact_agent_name(agent_name)
    if re.search(r"orcClaude-gen\d+", agent_name, flags=re.IGNORECASE):
        label = compact_agent
    elif agent_name.endswith("-LEAD"):
        label = agent_name
    elif repo:
        label = repo
    else:
        label = compact_agent or "unknown golem"

    display = label
    if agent_name.endswith("-LEAD") and repo and repo.lower() not in agent_name.lower():
        display = f"{label} ({repo})"

    return {
        "label": label,
        "display": display,
        "repo": repo,
        "agent_name": agent_name,
    }


def participant_chips(identity: Mapping[str, str], roles: Iterable[str]) -> dict[str, Any]:
    role_set = {str(role) for role in roles if role}
    golem = identity.get("label") or identity.get("display") or "golem"
    chips = [{"kind": "golem", "label": f"🤖 {golem}"}]
    has_orchestrator = "orchestrator" in role_set
    has_human = "human" in role_set
    if has_orchestrator:
        chips.append({"kind": "orc", "label": "+ 🤖 orc"})
    if has_human:
        chips.append({"kind": "human", "label": "+ 🧑 you"})
    return {
        "chips": chips,
        "mixed": has_orchestrator and has_human,
        "roles": sorted(role_set),
    }


def participant_roles_from_cards(cards: Sequence[Mapping[str, Any]]) -> set[str]:
    roles: set[str] = set()
    for card in cards:
        role = card.get("role")
        if role in {"orchestrator", "human"}:
            roles.add(str(role))
    return roles


def _base_card(
    *,
    card_id: str,
    kind: str,
    title: str,
    timestamp: str,
    span: Mapping[str, Any] | None,
    root_span: Mapping[str, Any] | None,
    trace: Mapping[str, Any],
    event_index: int | None,
) -> dict[str, Any]:
    target_span = span or root_span or {}
    duration = _duration_ms(
        span.get("start_time") if span else None,
        span.get("end_time") if span else None,
    )
    card: dict[str, Any] = {
        "card_id": card_id,
        "kind": kind,
        "title": title,
        "timestamp": timestamp,
        "event_index": event_index,
        "span_id": _span_id(target_span),
        "span_node_id": target_span.get("id"),
        "trace_id": _trace_id(target_span, trace),
    }
    label = _duration_label(duration)
    if label:
        card["duration"] = label
        card["duration_ms"] = duration
    return card


def _copy_span_target(card: dict[str, Any], span: Mapping[str, Any], trace: Mapping[str, Any]) -> None:
    span_id = _span_id(span)
    if not span_id:
        return
    card["span_id"] = span_id
    card["span_node_id"] = span.get("id")
    card["trace_id"] = _trace_id(span, trace)


def _metric_value(label: str, value: str) -> dict[str, str]:
    return {"label": label, "value": value}


def _span_token_total(span: Mapping[str, Any]) -> int:
    attrs = _attrs(span)
    return int(_positive_number(attrs.get("llm.token_count.total")))


def _span_cost_total(span: Mapping[str, Any]) -> float:
    attrs = _attrs(span)
    return _positive_number(attrs.get("llm.cost.total"))


def _add_assistant_metrics_from_span(card: dict[str, Any], span: Mapping[str, Any] | None) -> None:
    if not span:
        return
    tokens = _span_token_total(span)
    cost = _span_cost_total(span)
    if tokens <= 0 and cost <= 0:
        return
    metric_values = card.setdefault("_assistant_metric_values", {"tokens": 0, "cost": 0.0})
    metric_values["tokens"] += tokens
    metric_values["cost"] += cost


def _finalize_assistant_card(card: dict[str, Any]) -> None:
    card.pop("_has_primary_span", None)
    text_parts = card.pop("_text_parts", [])
    thinking_parts = card.get("thinking") or []
    if text_parts:
        card["text"] = "\n\n".join(part for part in text_parts if part)
    else:
        card["text"] = ""
    if not thinking_parts:
        card.pop("thinking", None)
    metrics = card.pop("_assistant_metric_values", None)
    if isinstance(metrics, Mapping):
        rows: list[dict[str, str]] = []
        tokens = int(metrics.get("tokens") or 0)
        cost = float(metrics.get("cost") or 0.0)
        if tokens > 0:
            rows.append(_metric_value("Tokens", str(tokens)))
        if cost > 0:
            rows.append(_metric_value("Cost", f"${cost:.4f}"))
        if rows:
            card["metrics"] = rows


def _normalize_turn_metrics(cards: Sequence[dict[str, Any]]) -> None:
    assistant_cards = [card for card in cards if card.get("kind") == "assistant"]
    if assistant_cards and not all(card.get("metrics") for card in assistant_cards):
        for card in assistant_cards:
            card.pop("metrics", None)

    tool_calls = [
        tool_call
        for card in assistant_cards
        for tool_call in card.get("tool_calls") or []
        if isinstance(tool_call, dict)
    ]
    if tool_calls and not all(tool_call.get("metrics") for tool_call in tool_calls):
        for tool_call in tool_calls:
            tool_call.pop("metrics", None)


def _new_assistant_card(
    *,
    event_index: int | None,
    timestamp: str,
    trace: Mapping[str, Any],
    root_span: Mapping[str, Any] | None,
) -> dict[str, Any]:
    card = _base_card(
        card_id=f"event-{event_index}-assistant" if event_index is not None else "assistant-turn",
        kind="assistant",
        title="🤖 ASSISTANT turn",
        timestamp=timestamp,
        span=None,
        root_span=root_span,
        trace=trace,
        event_index=event_index,
    )
    card["_text_parts"] = []
    card["_has_primary_span"] = False
    card["thinking"] = []
    card["tool_calls"] = []
    return card


def _set_assistant_primary_span(card: dict[str, Any], span: Mapping[str, Any] | None, trace: Mapping[str, Any]) -> None:
    if not span or card.get("_has_primary_span"):
        return
    _copy_span_target(card, span, trace)
    card["_has_primary_span"] = True


def _thinking_text_from_item(item: Mapping[str, Any]) -> str:
    for key in ("thinking", "text", "content"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, Mapping) or isinstance(value, list):
            text = text_for_jsonish(value)
            if text:
                return text
    return ""


def text_for_jsonish(value: Any) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)


def _annotation_to_dict(row: Any) -> dict[str, Any]:
    if isinstance(row, Mapping):
        return dict(row)
    try:
        values = vars(row)
    except TypeError:
        return {"value": str(row)}
    return {str(key): value for key, value in values.items()}


def _annotation_value(row: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def _annotation_result(row: Mapping[str, Any]) -> Mapping[str, Any]:
    result = row.get("result")
    return result if isinstance(result, Mapping) else {}


def _annotation_metadata(row: Mapping[str, Any]) -> Mapping[str, Any]:
    metadata = row.get("metadata")
    return metadata if isinstance(metadata, Mapping) else {}


def _annotation_name(row: Mapping[str, Any]) -> str:
    return str(_annotation_value(row, "name", "annotation_name") or "")


def _annotation_span_id(row: Mapping[str, Any]) -> str:
    return str(_annotation_value(row, "span_id", "spanId", "span_id_") or "")


def _compact_quality_annotation(row: Mapping[str, Any]) -> dict[str, Any]:
    result = _annotation_result(row)
    metadata = _annotation_metadata(row)
    compact = {
        "label": str(result.get("label") or "").lower(),
        "score": float(result.get("score") or 0),
        "explanation": str(result.get("explanation") or ""),
    }
    category = metadata.get("category")
    if category:
        compact["category"] = str(category)
    return compact


def _is_human_quality_annotation(row: Mapping[str, Any]) -> bool:
    if _annotation_name(row) != QUALITY_ANNOTATION_NAME:
        return False
    identifier = str(row.get("identifier") or "")
    kind = str(row.get("annotator_kind") or "").upper()
    return identifier != AUTO_CRITIC_IDENTIFIER and kind in {"", "HUMAN"}


def _is_auto_quality_annotation(row: Mapping[str, Any]) -> bool:
    return (
        _annotation_name(row) == QUALITY_ANNOTATION_NAME
        and str(row.get("identifier") or "") == AUTO_CRITIC_IDENTIFIER
    )


def _annotation_target_map(annotations: Sequence[Any]) -> dict[str, dict[str, dict[str, Any]]]:
    grouped: dict[str, dict[str, dict[str, Any]]] = {}
    for raw_row in annotations:
        row = _annotation_to_dict(raw_row)
        span_id = _annotation_span_id(row)
        if not span_id:
            continue
        bucket = grouped.setdefault(span_id, {})
        if _is_human_quality_annotation(row):
            bucket["human"] = _compact_quality_annotation(row)
            bucket.pop("auto_critic", None)
            continue
        if _is_auto_quality_annotation(row) and "human" not in bucket:
            bucket["auto_critic"] = _compact_quality_annotation(row)
    return grouped


def _is_session_quality_annotation(row: Mapping[str, Any]) -> bool:
    return _annotation_metadata(row).get("target") == "session"


def _session_quality_bucket(annotations: Sequence[Any]) -> dict[str, dict[str, Any]]:
    bucket: dict[str, dict[str, Any]] = {}
    for raw_row in annotations:
        row = _annotation_to_dict(raw_row)
        if not _is_session_quality_annotation(row):
            continue
        if _is_human_quality_annotation(row):
            bucket["human"] = _compact_quality_annotation(row)
            bucket.pop("auto_critic", None)
            continue
        if _is_auto_quality_annotation(row) and "human" not in bucket:
            bucket["auto_critic"] = _compact_quality_annotation(row)
    return bucket


def _all_span_ids(spans: Sequence[Mapping[str, Any]]) -> list[str]:
    seen: set[str] = set()
    span_ids: list[str] = []
    for span in spans:
        span_id = _span_id(span)
        if not span_id or span_id in seen:
            continue
        seen.add(span_id)
        span_ids.append(span_id)
    return span_ids


def collect_annotation_span_ids(view: Mapping[str, Any]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []

    def add(span_id: Any) -> None:
        value = str(span_id or "")
        if not value or value in seen:
            return
        seen.add(value)
        ordered.append(value)

    add(view.get("root_span_id"))
    for span_id in view.get("annotation_span_ids") or []:
        add(span_id)
    for card in view.get("cards") or []:
        if not isinstance(card, Mapping):
            continue
        add(card.get("span_id"))
        for tool_call in card.get("tool_calls") or []:
            if isinstance(tool_call, Mapping):
                add(tool_call.get("span_id"))
    return ordered


def apply_quality_annotations(view: dict[str, Any], annotations: Sequence[Any]) -> dict[str, Any]:
    by_span = _annotation_target_map(annotations)
    root_annotations = by_span.get(str(view.get("root_span_id") or ""), {})
    session_annotations = _session_quality_bucket(annotations)
    view["annotations"] = (session_annotations or root_annotations).copy()

    for card in view.get("cards") or []:
        if not isinstance(card, dict):
            continue
        card_annotations = by_span.get(str(card.get("span_id") or ""), {})
        if card_annotations:
            card["annotations"] = card_annotations.copy()
        for tool_call in card.get("tool_calls") or []:
            if not isinstance(tool_call, dict):
                continue
            tool_annotations = by_span.get(str(tool_call.get("span_id") or ""), {})
            if tool_annotations:
                tool_call["annotations"] = tool_annotations.copy()
    return view


def _tool_call_from_item(
    *,
    item: Mapping[str, Any],
    event_index: int,
    item_ordinal: int,
    result: Mapping[str, Any],
    span: Mapping[str, Any] | None,
    root_span: Mapping[str, Any] | None,
    trace: Mapping[str, Any],
) -> dict[str, Any]:
    tool_use_id = str(item.get("id") or "")
    tool_name = str(item.get("name") or "tool")
    span_attrs = _attrs(span or {})
    raw_output = result.get("value")
    if raw_output in (None, ""):
        raw_output = _jsonish(span_attrs.get("output.value", ""))
    duration = _duration_ms(
        span.get("start_time") if span else None,
        span.get("end_time") if span else None,
    )
    tool_call: dict[str, Any] = {
        "card_id": f"event-{event_index}-tool-{tool_use_id or item_ordinal}",
        "kind": "tool_call",
        "kind_label": "🔧 TOOL CALL",
        "tool_name": tool_name,
        "tool_use_id": tool_use_id,
        "span_id": _span_id(span or root_span or {}),
        "span_node_id": (span or {}).get("id"),
        "trace_id": _trace_id(span or {}, trace),
        "event_index": event_index,
        "result_event_index": result.get("event_index"),
        "input_label": "INPUT — args",
        "output_label": "OUTPUT — result",
        "tool_input": _jsonish(item.get("input") or {}),
        "tool_output": raw_output,
        "is_cmux": _is_cmux_tool(tool_name),
    }
    label = _duration_label(duration)
    if label:
        tool_call["duration"] = label
        tool_call["duration_ms"] = duration
        tool_call["metrics"] = [_metric_value("Latency", label)]
    geometry = _cmux_geometry(span_attrs)
    if geometry is not None:
        tool_call["cmux_geometry"] = geometry
    return tool_call


def _trace_with_most_spans(traces: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
    if not traces:
        raise PhoenixMobileError("no traces found for session")
    return max(
        traces,
        key=lambda trace: (
            len(trace.get("spans") or []),
            str(trace.get("end_time") or ""),
            str(trace.get("trace_id") or ""),
        ),
    )


def _aggregate_session_trace(traces: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
    if not traces:
        raise PhoenixMobileError("no traces found for session")
    selected = _trace_with_most_spans(traces)
    spans = [
        span
        for trace in traces
        for span in trace.get("spans") or []
        if isinstance(span, Mapping)
    ]
    if not spans:
        return selected
    root_trace = next(
        (
            trace
            for trace in traces
            for span in trace.get("spans") or []
            if isinstance(span, Mapping)
            and (span.get("parent_id") is None or str(span.get("span_kind") or "").upper() == "CHAIN")
        ),
        selected,
    )
    start_values = [str(trace.get("start_time")) for trace in traces if trace.get("start_time")]
    end_values = [str(trace.get("end_time")) for trace in traces if trace.get("end_time")]
    spans.sort(
        key=lambda span: (
            str(span.get("start_time") or ""),
            int(_attrs(span).get("event.index") or -1),
            str(span.get("name") or ""),
        )
    )
    return {
        **root_trace,
        "trace_id": str(root_trace.get("trace_id") or selected.get("trace_id") or ""),
        "trace_ids": [str(trace.get("trace_id")) for trace in traces if trace.get("trace_id")],
        "start_time": min(start_values) if start_values else root_trace.get("start_time"),
        "end_time": max(end_values) if end_values else root_trace.get("end_time"),
        "spans": spans,
    }


def _positive_number(value: Any) -> float:
    try:
        number = float(value)
    except Exception:
        return 0.0
    return number if number > 0 else 0.0


def _sum_span_attr(spans: Sequence[Mapping[str, Any]], key: str) -> float:
    return sum(_positive_number(_attrs(span).get(key)) for span in spans)


def _metrics_for_trace(trace: Mapping[str, Any], spans: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "spans": len(spans),
        "tool_calls": sum(1 for span in spans if str(span.get("span_kind") or "").upper() == "TOOL"),
        "cmux_geometry": sum(1 for span in spans if _cmux_geometry(_attrs(span)) is not None),
    }
    token_total = _sum_span_attr(spans, "llm.token_count.total")
    prompt_tokens = _sum_span_attr(spans, "llm.token_count.prompt")
    completion_tokens = _sum_span_attr(spans, "llm.token_count.completion")
    total_cost = _sum_span_attr(spans, "llm.cost.total")
    if token_total > 0:
        metrics["total_tokens"] = int(token_total)
    if prompt_tokens > 0:
        metrics["prompt_tokens"] = int(prompt_tokens)
    if completion_tokens > 0:
        metrics["completion_tokens"] = int(completion_tokens)
    if total_cost > 0:
        metrics["total_cost_usd"] = round(total_cost, 4)

    trace_token_total = trace.get("token_count_total")
    try:
        if "total_tokens" not in metrics and trace_token_total and int(trace_token_total) > 0:
            metrics["total_tokens"] = int(trace_token_total)
    except Exception:
        pass
    return {key: value for key, value in metrics.items() if value not in (None, "", 0)}


def build_session_view_from_traces(
    *,
    session_id: str,
    traces: Sequence[Mapping[str, Any]],
    jsonl_events: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    trace = _aggregate_session_trace(traces)
    spans = list(trace.get("spans") or [])
    root_span = _first_root_span(spans)
    root_attrs = _attrs(root_span or {})
    source_path = None
    if root_span:
        source_path = root_attrs.get("source.path")
    events = list(jsonl_events or [])
    if not events and source_path and Path(str(source_path)).expanduser().exists():
        events = read_jsonl_events(str(source_path))

    cards = (
        _cards_from_jsonl_events(events, trace, spans, root_span)
        if events
        else _cards_from_spans(trace, spans, root_span)
    )
    identity = resolve_session_identity(root_attrs, source_path=str(source_path or ""), events=events)
    participants = participant_chips(identity, participant_roles_from_cards(cards))
    return {
        "session_id": session_id,
        "trace_id": str(trace.get("trace_id") or ""),
        "project_id": trace.get("project_id"),
        "root_span_id": _span_id(root_span or {}),
        "annotation_span_ids": _all_span_ids(spans),
        "source_path": source_path,
        "identity": identity,
        "participants": participants,
        "agent": {
            "name": root_attrs.get("agent.name"),
            "type": root_attrs.get("agent.type"),
            "role": root_attrs.get("agent.role"),
            "reports_to": _agent_reports_to(root_attrs),
            "repo": root_attrs.get("repo"),
            "task_summary": root_attrs.get("agent.task_summary"),
        },
        "metrics": _metrics_for_trace(trace, spans),
        "cards": cards,
        "used_jsonl": bool(events),
    }


def _cards_from_jsonl_events(
    events: Sequence[Mapping[str, Any]],
    trace: Mapping[str, Any],
    spans: Sequence[Mapping[str, Any]],
    root_span: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    results = _tool_results(events)
    by_event = _spans_by_event(spans)
    root_attrs = _attrs(root_span or {})
    cards: list[dict[str, Any]] = []
    current_assistant: dict[str, Any] | None = None

    def flush_assistant() -> None:
        nonlocal current_assistant
        if current_assistant is None:
            return
        _finalize_assistant_card(current_assistant)
        if current_assistant.get("text") or current_assistant.get("thinking") or current_assistant.get("tool_calls"):
            cards.append(current_assistant)
        current_assistant = None

    for event_index, obj in enumerate(events):
        timestamp = str(obj.get("timestamp") or "")
        content = _message_content(obj)
        if obj.get("type") == "user":
            text = _user_text_from_content(content)
            if not text:
                continue
            flush_assistant()
            role = classify_user_turn(text, root_attrs)
            card = _base_card(
                card_id=f"event-{event_index}-user",
                kind=role["kind"],
                title=role["title"],
                timestamp=timestamp,
                span=None,
                root_span=root_span,
                trace=trace,
                event_index=event_index,
            )
            card["role"] = role["role"]
            card["role_label"] = role["role_label"]
            card["text"] = text
            cards.append(card)
            continue

        if obj.get("type") != "assistant":
            continue

        if current_assistant is None:
            current_assistant = _new_assistant_card(
                event_index=event_index,
                timestamp=timestamp,
                trace=trace,
                root_span=root_span,
            )

        item_ordinal = 0
        for item in _content_items(content):
            if not isinstance(item, Mapping):
                continue
            item_ordinal += 1
            if item.get("type") in {"thinking", "redacted_thinking"} or item.get("thinking"):
                thinking_text = _thinking_text_from_item(item)
                if thinking_text:
                    current_assistant.setdefault("thinking", []).append(thinking_text)
                continue

            if item.get("type") == "text":
                text = str(item.get("text") or "")
                if not text:
                    continue
                span = _pop_span_for_event(by_event, event_index, kind="LLM")
                _set_assistant_primary_span(current_assistant, span, trace)
                _add_assistant_metrics_from_span(current_assistant, span)
                current_assistant.setdefault("_text_parts", []).append(text)
                continue

            if item.get("type") != "tool_use":
                continue
            tool_use_id = str(item.get("id") or "")
            span = _pop_span_for_event(
                by_event,
                event_index,
                kind="TOOL",
                tool_use_id=tool_use_id or None,
            )
            _set_assistant_primary_span(current_assistant, span, trace)
            result = results.get(tool_use_id, {})
            current_assistant.setdefault("tool_calls", []).append(
                _tool_call_from_item(
                    item=item,
                    event_index=event_index,
                    item_ordinal=item_ordinal,
                    result=result,
                    span=span,
                    root_span=root_span,
                    trace=trace,
                )
            )
    flush_assistant()
    _normalize_turn_metrics(cards)
    return cards


def _cards_from_spans(
    trace: Mapping[str, Any],
    spans: Sequence[Mapping[str, Any]],
    root_span: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    root_attrs = _attrs(root_span or {})

    def is_prompt_span(span: Mapping[str, Any]) -> bool:
        if span is root_span:
            return False
        attrs = _attrs(span)
        if str(span.get("span_kind") or "").upper() != "CHAIN":
            return False
        if not attrs.get("input.value"):
            return False
        return bool(
            attrs.get("turn.role")
            or attrs.get("turn.kind") in {"driver", "user"}
            or str(span.get("name") or "").lower().endswith("prompt")
        )

    rows = [
        span
        for span in spans
        if span is not root_span
        and (str(span.get("span_kind") or "").upper() in {"LLM", "TOOL"} or is_prompt_span(span))
    ]
    rows.sort(key=lambda span: (str(span.get("start_time") or ""), int(_attrs(span).get("event.index") or 0)))
    cards: list[dict[str, Any]] = []
    current_assistant: dict[str, Any] | None = None
    current_event_index: int | None = None

    def flush_assistant() -> None:
        nonlocal current_assistant
        if current_assistant is None:
            return
        _finalize_assistant_card(current_assistant)
        if current_assistant.get("text") or current_assistant.get("tool_calls"):
            cards.append(current_assistant)
        current_assistant = None

    for idx, span in enumerate(rows, start=1):
        attrs = _attrs(span)
        if is_prompt_span(span):
            flush_assistant()
            text = str(attrs.get("input.value") or "")
            role = attrs.get("turn.role")
            if role == "orchestrator" or attrs.get("turn.kind") == "driver":
                role_info = {
                    "kind": "driver",
                    "role": "orchestrator",
                    "title": "🤖 ORCHESTRATOR",
                    "role_label": "ORCHESTRATOR",
                }
            else:
                role_info = classify_user_turn(text, root_attrs)
            event_index = int(attrs.get("event.index")) if attrs.get("event.index") is not None else idx
            card = _base_card(
                card_id=f"event-{event_index}-{role_info['kind']}",
                kind=role_info["kind"],
                title=role_info["title"],
                timestamp=str(span.get("start_time") or ""),
                span=span,
                root_span=root_span,
                trace=trace,
                event_index=event_index,
            )
            card["role"] = role_info["role"]
            card["role_label"] = role_info["role_label"]
            card["text"] = text
            cards.append(card)
            current_event_index = None
            continue

        kind = "tool" if str(span.get("span_kind") or "").upper() == "TOOL" else "assistant"
        event_index = int(attrs.get("event.index")) if attrs.get("event.index") is not None else idx
        if current_assistant is None or event_index != current_event_index:
            flush_assistant()
            current_event_index = event_index
            current_assistant = _new_assistant_card(
                event_index=event_index,
                timestamp=str(span.get("start_time") or ""),
                trace=trace,
                root_span=root_span,
            )
        _set_assistant_primary_span(current_assistant, span, trace)
        if kind == "assistant":
            text = str(attrs.get("output.value") or "")
            if text:
                current_assistant.setdefault("_text_parts", []).append(text)
            _add_assistant_metrics_from_span(current_assistant, span)
        else:
            tool_name = str(attrs.get("tool.name") or span.get("name") or "tool")
            current_assistant.setdefault("tool_calls", []).append(
                _tool_call_from_item(
                    item={
                        "id": attrs.get("tool.use_id"),
                        "name": tool_name,
                        "input": _jsonish(attrs.get("input.value") or {}),
                    },
                    event_index=event_index,
                    item_ordinal=idx,
                    result={
                        "event_index": attrs.get("event.result_index"),
                        "value": _jsonish(attrs.get("output.value") or ""),
                    },
                    span=span,
                    root_span=root_span,
                    trace=trace,
                )
            )
    flush_assistant()
    _normalize_turn_metrics(cards)
    return cards


def span_annotation_payload(
    *,
    span_id: str,
    label: str,
    explanation: str = "",
    score: float | int | None = None,
    metadata: Mapping[str, Any] | None = None,
    identifier: str = DEFAULT_IDENTIFIER,
    name: str = "quality",
) -> dict[str, Any]:
    result: dict[str, Any] = {"label": label}
    if score is not None:
        result["score"] = score
    if explanation:
        result["explanation"] = explanation
    row = {
        "span_id": span_id,
        "name": name,
        "annotator_kind": "HUMAN",
        "result": result,
        "identifier": identifier,
        "metadata": {**dict(metadata or {}), "source": "phoenix-mobile"},
    }
    return {"data": [row]}


def session_annotation_payload(
    *,
    session_id: str,
    label: str,
    explanation: str = "",
    score: float | int | None = None,
    metadata: Mapping[str, Any] | None = None,
    identifier: str = DEFAULT_IDENTIFIER,
    name: str = "quality",
) -> dict[str, Any]:
    result: dict[str, Any] = {"label": label}
    if score is not None:
        result["score"] = score
    if explanation:
        result["explanation"] = explanation
    row = {
        "session_id": session_id,
        "name": name,
        "annotator_kind": "HUMAN",
        "result": result,
        "identifier": identifier,
        "metadata": {**dict(metadata or {}), "source": "phoenix-mobile"},
    }
    return {"data": [row]}


def session_list_row(session: Mapping[str, Any]) -> dict[str, Any] | None:
    session_id = str(session.get("session_id") or session.get("id") or "")
    if not session_id:
        return None
    traces = session.get("traces")
    trace_count = session.get("trace_count")
    if trace_count is None and isinstance(traces, Sequence) and not isinstance(traces, (str, bytes)):
        trace_count = len(traces)
    return {
        "session_id": session_id,
        "project_session_id": session.get("id"),
        "project_id": session.get("project_id"),
        "start_time": session.get("start_time"),
        "end_time": session.get("end_time"),
        "trace_count": trace_count,
    }


def session_trace_ids(session: Mapping[str, Any]) -> list[str]:
    traces = session.get("traces")
    if not isinstance(traces, Sequence) or isinstance(traces, (str, bytes)):
        return []
    trace_ids: list[str] = []
    for trace in traces:
        if not isinstance(trace, Mapping):
            continue
        trace_id = trace.get("trace_id")
        if trace_id:
            trace_ids.append(str(trace_id))
    return trace_ids


def session_limit_from_query(query: Mapping[str, Sequence[str]], *, default: int = 20) -> int:
    values = query.get("limit") or [str(default)]
    try:
        limit = int(values[0])
    except (ValueError, TypeError, IndexError) as exc:
        raise PhoenixMobileError("limit parameter must be a valid integer") from exc
    if limit <= 0:
        raise PhoenixMobileError("limit parameter must be positive")
    return limit


def _chunked(values: Sequence[str], size: int) -> Iterable[list[str]]:
    for idx in range(0, len(values), size):
        yield list(values[idx : idx + size])


class PhoenixGateway:
    def __init__(self, config: ServerConfig):
        self.config = config
        try:
            from phoenix.client import Client
        except Exception as exc:
            raise PhoenixMobileError(f"phoenix.client import failed: {exc}") from exc
        self.client = Client(base_url=config.phoenix_base_url)

    def list_sessions(self, *, limit: int = 20) -> list[dict[str, Any]]:
        sessions = self.client.sessions.list(project_name=self.config.project_name, limit=limit, timeout=10)
        rows: list[dict[str, Any]] = []
        for session in sessions:
            if not isinstance(session, Mapping):
                continue
            row = session_list_row(session)
            if row:
                try:
                    view = self.get_session_view(str(row["session_id"]))
                except Exception as exc:
                    row["identity_error"] = f"{type(exc).__name__}: {exc}"
                else:
                    row["identity"] = view.get("identity")
                    row["participants"] = view.get("participants")
                rows.append(row)
        return rows

    def get_session_view(self, session_id: str) -> dict[str, Any]:
        traces = self._session_traces_with_spans(session_id)
        if not traces:
            raise PhoenixMobileError(f"no traces found for session {session_id}")
        view = build_session_view_from_traces(session_id=session_id, traces=traces)
        span_ids = collect_annotation_span_ids(view)
        if span_ids:
            apply_quality_annotations(view, self.get_quality_annotations(span_ids))
        else:
            view["annotations"] = {}
        return view

    def _session_traces_with_spans(self, session_id: str) -> list[dict[str, Any]]:
        session_record = self._find_session_record(session_id)
        if session_record:
            trace_ids = session_trace_ids(session_record)
            if trace_ids:
                return self._fetch_trace_spans(trace_ids, session_record=session_record)

        traces = self.client.traces.get_traces(
            project_identifier=self.config.project_name,
            session_id=session_id,
            include_spans=True,
            limit=1000,
            timeout=20,
        )
        trace_ids = [str(trace.get("trace_id")) for trace in traces if isinstance(trace, Mapping) and trace.get("trace_id")]
        if trace_ids and any(not trace.get("spans") for trace in traces if isinstance(trace, Mapping)):
            return self._fetch_trace_spans(trace_ids)
        return [dict(trace) for trace in traces if isinstance(trace, Mapping)]

    def _find_session_record(self, session_id: str) -> Mapping[str, Any] | None:
        sessions = self.client.sessions.list(project_name=self.config.project_name, limit=1000, timeout=20)
        for session in sessions:
            if not isinstance(session, Mapping):
                continue
            if str(session.get("session_id") or "") == session_id or str(session.get("id") or "") == session_id:
                return session
        return None

    def _fetch_trace_spans(
        self,
        trace_ids: Sequence[str],
        *,
        session_record: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        trace_info_by_id: dict[str, dict[str, Any]] = {}
        if session_record:
            traces = session_record.get("traces")
            if isinstance(traces, Sequence) and not isinstance(traces, (str, bytes)):
                trace_info_by_id = {
                    str(trace.get("trace_id")): dict(trace)
                    for trace in traces
                    if isinstance(trace, Mapping) and trace.get("trace_id")
                }

        spans_by_trace: dict[str, list[Mapping[str, Any]]] = {trace_id: [] for trace_id in trace_ids}
        for chunk in _chunked(list(trace_ids), 200):
            spans = self.client.spans.get_spans(
                project_identifier=self.config.project_name,
                trace_ids=chunk,
                limit=5000,
                timeout=30,
            )
            for span in spans:
                if not isinstance(span, Mapping):
                    continue
                trace_id = _trace_id(span)
                if trace_id:
                    spans_by_trace.setdefault(trace_id, []).append(span)

        return [
            {
                **trace_info_by_id.get(trace_id, {}),
                "trace_id": trace_id,
                "spans": spans_by_trace.get(trace_id, []),
            }
            for trace_id in trace_ids
            if spans_by_trace.get(trace_id)
        ]

    def post_span_annotation(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        span_id = str(payload.get("span_id") or "")
        label = str(payload.get("label") or "")
        if not span_id or not re.fullmatch(r"[0-9a-fA-F]{16}", span_id):
            raise PhoenixMobileError("span_id must be a 16-character OTel hex span id")
        if label not in {"good", "bad", "fail"}:
            raise PhoenixMobileError("label must be one of good, bad, fail")
        score = payload.get("score")
        if score is None:
            score = 1 if label == "good" else 0
        body = span_annotation_payload(
            span_id=span_id,
            label=label,
            score=score,
            explanation=str(payload.get("explanation") or ""),
            metadata=payload.get("metadata") if isinstance(payload.get("metadata"), Mapping) else {},
        )
        return self._post_rest_json("/v1/span_annotations?sync=true", body)

    def post_session_annotation(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        session_id = str(payload.get("session_id") or "")
        label = str(payload.get("label") or "")
        if not session_id:
            raise PhoenixMobileError("session_id is required")
        if label not in {"good", "bad", "fail"}:
            raise PhoenixMobileError("label must be one of good, bad, fail")
        score = payload.get("score")
        if score is None:
            score = 1 if label == "good" else 0
        body = session_annotation_payload(
            session_id=session_id,
            label=label,
            score=score,
            explanation=str(payload.get("explanation") or ""),
            metadata=payload.get("metadata") if isinstance(payload.get("metadata"), Mapping) else {},
        )
        return self._post_rest_json("/v1/session_annotations?sync=true", body)

    def get_span_annotations(self, span_id: str) -> list[dict[str, Any]]:
        return self.get_quality_annotations([span_id])

    def get_quality_annotations(self, span_ids: Sequence[str]) -> list[dict[str, Any]]:
        rows = self.client.spans.get_span_annotations(
            span_ids=span_ids,
            project_identifier=self.config.project_name,
            include_annotation_names=[QUALITY_ANNOTATION_NAME],
            limit=100,
            timeout=10,
        )
        return [_annotation_to_dict(row) for row in rows]

    def _post_rest_json(self, path: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        url = f"{self.config.phoenix_base_url.rstrip('/')}{path}"
        body = json.dumps(payload).encode("utf-8")
        request = Request(url, data=body, headers={"content-type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=15) as response:
                text = response.read().decode("utf-8")
                if not text:
                    return {"ok": True, "status": response.status}
                parsed = json.loads(text)
                return parsed if isinstance(parsed, dict) else {"data": parsed}
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise PhoenixMobileError(f"Phoenix REST {exc.code}: {detail}") from exc
        except URLError as exc:
            raise PhoenixMobileError(f"Phoenix REST failed: {exc}") from exc


class PhoenixMobileHandler(BaseHTTPRequestHandler):
    gateway: PhoenixGateway
    config: ServerConfig

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def do_GET(self) -> None:  # noqa: N802
        try:
            self._handle_get()
        except PhoenixMobileError as exc:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(exc).__name__}: {exc}"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            self._handle_post()
        except PhoenixMobileError as exc:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(exc).__name__}: {exc}"})

    def _handle_get(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path in {"", "/"}:
            return self._serve_static("index.html")
        if path in {"/app.js", "/styles.css"}:
            return self._serve_static(path.lstrip("/"))
        if path == "/api/health":
            return json_response(
                self,
                HTTPStatus.OK,
                {
                    "ok": True,
                    "phoenix_base_url": self.config.phoenix_base_url,
                    "project_name": self.config.project_name,
                    "default_session_id": self.config.default_session_id,
                },
            )
        if path == "/api/sessions":
            query = parse_qs(parsed.query)
            limit = session_limit_from_query(query)
            return json_response(
                self,
                HTTPStatus.OK,
                {
                    "sessions": self.gateway.list_sessions(limit=limit),
                    "default_session_id": self.config.default_session_id,
                },
            )
        if path.startswith("/api/sessions/"):
            session_id = unquote(path.removeprefix("/api/sessions/"))
            return json_response(self, HTTPStatus.OK, self.gateway.get_session_view(session_id))
        if path.startswith("/api/annotations/span/"):
            span_id = unquote(path.removeprefix("/api/annotations/span/"))
            return json_response(self, HTTPStatus.OK, {"annotations": self.gateway.get_span_annotations(span_id)})
        self.send_error(HTTPStatus.NOT_FOUND)

    def _handle_post(self) -> None:
        parsed = urlparse(self.path)
        payload = read_request_json(self)
        if parsed.path == "/api/annotations/note":
            return json_response(self, HTTPStatus.OK, {"ok": True, "annotation": persist_turn_note(payload)})
        if parsed.path == "/api/annotations/span":
            return json_response(self, HTTPStatus.OK, self.gateway.post_span_annotation(payload))
        if parsed.path == "/api/annotations/session":
            return json_response(self, HTTPStatus.OK, self.gateway.post_session_annotation(payload))
        self.send_error(HTTPStatus.NOT_FOUND)

    def _serve_static(self, name: str) -> None:
        safe_name = Path(name).name
        path = STATIC_DIR / safe_name
        if not path.exists():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
        }.get(path.suffix, "application/octet-stream")
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def make_handler(config: ServerConfig) -> type[PhoenixMobileHandler]:
    gateway = PhoenixGateway(config)

    class ConfiguredPhoenixMobileHandler(PhoenixMobileHandler):
        pass

    ConfiguredPhoenixMobileHandler.gateway = gateway
    ConfiguredPhoenixMobileHandler.config = config
    return ConfiguredPhoenixMobileHandler


def format_url_host(host: str) -> str:
    if ":" in host and not host.startswith("["):
        return f"[{host}]"
    return host


def normalize_bind_host(host: str) -> str:
    if host.startswith("[") and host.endswith("]"):
        return host[1:-1]
    return host


def mobile_display_host(host: str) -> str:
    return "localhost" if host in {"0.0.0.0", "::"} else format_url_host(host)


def server_address_family(host: str) -> socket.AddressFamily:
    host = normalize_bind_host(host)
    return socket.AF_INET6 if ":" in host else socket.AF_INET


def make_server(host: str, port: int, handler: type[BaseHTTPRequestHandler]) -> ThreadingHTTPServer:
    host = normalize_bind_host(host)

    class PhoenixMobileHTTPServer(ThreadingHTTPServer):
        address_family = server_address_family(host)

    return PhoenixMobileHTTPServer((host, port), handler)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the Phoenix mobile session annotation UI.")
    parser.add_argument("--host", default=os.environ.get("PHOENIX_MOBILE_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PHOENIX_MOBILE_PORT", "6042")))
    parser.add_argument("--phoenix-url", default=os.environ.get("PHOENIX_BASE_URL", DEFAULT_PHOENIX_BASE_URL))
    parser.add_argument("--project-name", default=os.environ.get("PHOENIX_PROJECT_NAME", DEFAULT_PROJECT_NAME))
    parser.add_argument("--session-id", default=os.environ.get("PHOENIX_SESSION_ID"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    tailnet_hub_host = os.environ.get("TAILNET_HUB_HOST")
    config = ServerConfig(
        phoenix_base_url=args.phoenix_url,
        project_name=args.project_name,
        default_session_id=args.session_id,
    )
    host = normalize_bind_host(args.host)
    server = make_server(host, args.port, make_handler(config))
    print(
        json.dumps(
            {
                "serving": f"http://{mobile_display_host(host)}:{args.port}",
                "tailscale_hint": f"http://{tailnet_hub_host}:{args.port}" if tailnet_hub_host else None,
                "phoenix_base_url": config.phoenix_base_url,
                "project_name": config.project_name,
                "default_session_id": config.default_session_id,
            },
            indent=2,
        )
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

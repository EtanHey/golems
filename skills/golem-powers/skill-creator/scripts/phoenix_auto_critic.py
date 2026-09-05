#!/usr/bin/env python3
"""
phoenix_auto_critic - LLM-as-judge pre-grades for Phoenix session spans.

The critic writes only `identifier=auto-critic` span annotations. Human
annotations such as `mobile-curator` are treated as authoritative and skipped.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_PHOENIX_BASE_URL = "http://127.0.0.1:6006"
DEFAULT_PROJECT_NAME = "cmux-sessions"
DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"
DEFAULT_OLLAMA_MODEL = "llama3.1:8b"
ANNOTATION_IDENTIFIER = "auto-critic"
ANNOTATION_NAME = "quality"
PERSONAL_PROJECTS = {"coach-sessions"}
PRIVATE_BACKENDS = {"local", "mlx", "ollama"}
CLOUD_BACKENDS = {"groq", "openai", "anthropic"}
HEX_SPAN_RE = re.compile(r"^[0-9a-fA-F]{16}$")
SUSPICIOUS_TURN_RE = re.compile(
    r"\b(error|failed|failure|wrong|ignored|timeout|blocked|fabricat|stuck|"
    r"traceback|invalid|refused|misuse|unrecovered|spawn_agent)\b",
    re.IGNORECASE,
)


class AutoCriticError(RuntimeError):
    pass


class PrivacyError(AutoCriticError):
    pass


@dataclass(frozen=True)
class Turn:
    span_id: str
    event_index: int | None
    kind: str
    text: str
    tool_name: str | None = None


@dataclass(frozen=True)
class SessionContext:
    project_name: str
    session_id: str
    root_span_id: str
    turns: list[Turn]
    root_input: str = ""
    root_output: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def transcript_for_judge(self, *, max_chars: int = 12000) -> str:
        rows = [
            f"project={self.project_name}",
            f"session_id={self.session_id}",
            f"root_span_id={self.root_span_id}",
        ]
        if self.root_input:
            rows.append("ROOT INPUT:\n" + _limit_text(self.root_input, 1200))
        if self.root_output:
            rows.append("ROOT OUTPUT:\n" + _limit_text(self.root_output, 1200))
        rows.append("TURNS:")
        selected_turns = _select_turns_for_judge(self.turns)
        omitted = len(self.turns) - len(selected_turns)
        if omitted > 0:
            rows.append(
                f"[transcript compacted: showing {len(selected_turns)} turns, "
                f"omitting {omitted}; suspicious/error turns are prioritized]"
            )
        for turn in selected_turns:
            label = f"[span={turn.span_id} event={turn.event_index} kind={turn.kind}]"
            if turn.tool_name:
                label += f" tool={turn.tool_name}"
            rows.append(label + "\n" + _limit_text(turn.text, 1200))
        return _limit_text("\n\n".join(rows), max_chars)


@dataclass(frozen=True)
class Verdict:
    span_id: str
    label: str
    score: int
    explanation: str
    metadata: dict[str, Any] = field(default_factory=dict)
    category: str | None = None


@dataclass(frozen=True)
class JudgeResult:
    session: Verdict
    flags: list[Verdict]


def validate_backend_policy(
    project_name: str,
    backend_kind: str,
    *,
    trusted_cloud_allowed: bool = False,
) -> None:
    backend = (backend_kind or "").strip().lower()
    if project_name in PERSONAL_PROJECTS:
        if backend in PRIVATE_BACKENDS:
            return
        if backend == "trusted" and trusted_cloud_allowed:
            return
        if backend == "trusted":
            raise PrivacyError(
                f"{project_name} requires a private backend; trusted cloud requires "
                "PHOENIX_CRITIC_TRUSTED_BACKEND=1 or --trusted-cloud."
            )
        raise PrivacyError(
            f"{project_name} is personal and requires a private backend "
            f"(local/mlx/ollama or explicitly trusted); refused backend={backend!r}."
        )
    if backend in CLOUD_BACKENDS | PRIVATE_BACKENDS | {"trusted", "fixture"}:
        return
    raise PrivacyError(f"unknown judge backend {backend_kind!r}")


def default_backend_for_project(project_name: str) -> str:
    return "ollama" if project_name in PERSONAL_PROJECTS else "groq"


def _attrs(span: Mapping[str, Any]) -> dict[str, Any]:
    attrs = span.get("attributes")
    return dict(attrs) if isinstance(attrs, Mapping) else {}


def _span_context(span: Mapping[str, Any]) -> Mapping[str, Any]:
    context = span.get("context")
    return context if isinstance(context, Mapping) else {}


def _span_id(span: Mapping[str, Any]) -> str:
    value = _span_context(span).get("span_id") or span.get("span_id")
    return str(value or "")


def _span_kind(span: Mapping[str, Any]) -> str:
    attrs = _attrs(span)
    value = span.get("span_kind") or attrs.get("openinference.span.kind")
    return str(value or "").upper()


def _jsonish_text(value: Any) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return ""
        try:
            parsed = json.loads(stripped)
        except Exception:
            return stripped
        return json.dumps(parsed, ensure_ascii=False, sort_keys=True, indent=2)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)


def _limit_text(value: str, max_chars: int = 4000) -> str:
    text = value if isinstance(value, str) else str(value)
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 40].rstrip() + "\n...[truncated]"


def _select_turns_for_judge(turns: Sequence[Turn]) -> list[Turn]:
    selected: list[Turn] = []

    def add(candidates: Sequence[Turn]) -> None:
        seen = {id(turn) for turn in selected}
        for turn in candidates:
            if id(turn) not in seen:
                selected.append(turn)
                seen.add(id(turn))

    add(list(turns[:4]))
    high_signal = [
        turn
        for turn in turns
        if "spawn_agent" in f"{turn.tool_name or ''}\n{turn.text}"
        or '"ok": false' in turn.text
        or '"error":' in turn.text
        or "timed out" in turn.text.lower()
    ]
    suspicious = [
        turn
        for turn in turns
        if SUSPICIOUS_TURN_RE.search(f"{turn.tool_name or ''}\n{turn.text}")
    ]
    add(high_signal[:10])
    add(suspicious[:8])
    add(suspicious[-8:])
    add(list(turns[-6:]))
    selected.sort(key=lambda turn: (turn.event_index if turn.event_index is not None else 10**9, turn.span_id))
    return selected


def _event_index(span: Mapping[str, Any]) -> int | None:
    try:
        return int(_attrs(span).get("event.index"))
    except Exception:
        return None


def _first_root_span(spans: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    for span in spans:
        if _span_kind(span) == "CHAIN":
            return span
    for span in spans:
        if span.get("parent_id") is None:
            return span
    return spans[0] if spans else None


def _turn_from_span(span: Mapping[str, Any], root_span_id: str) -> Turn | None:
    span_id = _span_id(span)
    if not span_id or span_id == root_span_id:
        return None
    attrs = _attrs(span)
    kind = "tool" if _span_kind(span) == "TOOL" else "assistant"
    tool_name = str(attrs.get("tool.name") or span.get("name") or "") if kind == "tool" else None
    pieces: list[str] = []
    if kind == "tool":
        pieces.append(f"TOOL {tool_name or span.get('name') or ''}".strip())
        if attrs.get("input.value") not in (None, ""):
            pieces.append("input:\n" + _jsonish_text(attrs.get("input.value")))
        if attrs.get("output.value") not in (None, ""):
            pieces.append("output:\n" + _jsonish_text(attrs.get("output.value")))
    else:
        text = attrs.get("output.value") or attrs.get("input.value") or span.get("name") or ""
        pieces.append(_jsonish_text(text))
    text = "\n".join(part for part in pieces if part).strip()
    if not text:
        return None
    return Turn(
        span_id=span_id,
        event_index=_event_index(span),
        kind=kind,
        text=text,
        tool_name=tool_name or None,
    )


def build_session_context(
    *,
    project_name: str,
    session_id: str,
    spans: Sequence[Mapping[str, Any]],
) -> SessionContext:
    if not spans:
        raise AutoCriticError(f"no spans found for session {session_id}")
    root = _first_root_span(spans)
    if root is None:
        raise AutoCriticError(f"no root span found for session {session_id}")
    root_span_id = _span_id(root)
    if not root_span_id:
        raise AutoCriticError(f"root span missing OTel span_id for session {session_id}")
    root_attrs = _attrs(root)
    turns = [
        turn
        for turn in (_turn_from_span(span, root_span_id) for span in spans)
        if turn is not None
    ]
    turns.sort(key=lambda turn: (turn.event_index if turn.event_index is not None else 10**9, turn.span_id))
    return SessionContext(
        project_name=project_name,
        session_id=session_id,
        root_span_id=root_span_id,
        root_input=_jsonish_text(root_attrs.get("input.value")),
        root_output=_jsonish_text(root_attrs.get("output.value")),
        turns=turns,
        metadata={
            "agent.name": root_attrs.get("agent.name"),
            "agent.type": root_attrs.get("agent.type"),
            "agent.role": root_attrs.get("agent.role"),
            "repo": root_attrs.get("repo"),
        },
    )


def _normalize_label_score(label: Any, score: Any = None) -> tuple[str, int]:
    raw_label = str(label or "").strip().lower()
    if raw_label not in {"good", "bad"}:
        try:
            raw_label = "good" if float(score) >= 0.5 else "bad"
        except Exception:
            raw_label = "bad"
    normalized_score = 1 if raw_label == "good" else 0
    return raw_label, normalized_score


def _require_mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise AutoCriticError(f"judge returned invalid JSON: {exc}") from exc
    if not isinstance(value, Mapping):
        raise AutoCriticError("judge result must be a JSON object")
    return value


def parse_judge_result(value: Any, context: SessionContext) -> JudgeResult:
    payload = _require_mapping(value)
    session_payload = payload.get("session")
    if not isinstance(session_payload, Mapping):
        raise AutoCriticError("judge result missing session object")
    label, score = _normalize_label_score(session_payload.get("label"), session_payload.get("score"))
    explanation = str(session_payload.get("explanation") or "").strip()
    if not explanation:
        explanation = "Auto-critic did not provide a session rationale."
    session_verdict = Verdict(
        span_id=context.root_span_id,
        label=label,
        score=score,
        explanation=explanation,
        metadata={
            "project_name": context.project_name,
            "session_id": context.session_id,
            "target": "session",
        },
    )

    known_span_ids = {turn.span_id for turn in context.turns}
    flags: list[Verdict] = []
    for flag in payload.get("flags") or []:
        if not isinstance(flag, Mapping):
            continue
        span_id = str(flag.get("span_id") or "")
        if span_id not in known_span_ids:
            continue
        flag_label, flag_score = _normalize_label_score(flag.get("label") or "bad", flag.get("score"))
        if flag_label != "bad":
            continue
        category = str(flag.get("category") or "quality_flag").strip() or "quality_flag"
        explanation = str(flag.get("explanation") or "").strip()
        if not explanation:
            explanation = category.replace("_", " ")
        flags.append(
            Verdict(
                span_id=span_id,
                label="bad",
                score=flag_score,
                explanation=explanation,
                category=category,
                metadata={
                    "project_name": context.project_name,
                    "session_id": context.session_id,
                    "target": "turn",
                    "category": category,
                },
            )
        )
    return JudgeResult(session=session_verdict, flags=flags)


def span_annotation_payload(verdict: Verdict) -> dict[str, Any]:
    result = {
        "label": verdict.label,
        "score": int(verdict.score),
        "explanation": verdict.explanation,
    }
    metadata = {**dict(verdict.metadata), "source": "phoenix-auto-critic"}
    if verdict.category:
        metadata["category"] = verdict.category
    return {
        "data": [
            {
                "span_id": verdict.span_id,
                "name": ANNOTATION_NAME,
                "annotator_kind": "LLM",
                "identifier": ANNOTATION_IDENTIFIER,
                "result": result,
                "metadata": metadata,
            }
        ]
    }


def _row_value(row: Any, key: str, default: Any = None) -> Any:
    if isinstance(row, Mapping):
        return row.get(key, default)
    return getattr(row, key, default)


def _annotation_identifier(row: Any) -> str:
    return str(_row_value(row, "identifier") or "")


def _annotation_name(row: Any) -> str:
    return str(_row_value(row, "name") or _row_value(row, "annotation_name") or "")


def _annotation_kind(row: Any) -> str:
    return str(_row_value(row, "annotator_kind") or "").upper()


def _annotation_result(row: Any) -> Mapping[str, Any]:
    result = _row_value(row, "result")
    return result if isinstance(result, Mapping) else {}


def has_human_quality_annotation(rows: Sequence[Any]) -> bool:
    for row in rows:
        if _annotation_name(row) != ANNOTATION_NAME:
            continue
        identifier = _annotation_identifier(row)
        kind = _annotation_kind(row)
        if identifier and identifier != ANNOTATION_IDENTIFIER and kind in {"", "HUMAN"}:
            return True
        if kind == "HUMAN" and identifier != ANNOTATION_IDENTIFIER:
            return True
    return False


def _auto_annotation_matches(row: Any, verdict: Verdict) -> bool:
    if _annotation_name(row) != ANNOTATION_NAME:
        return False
    if _annotation_identifier(row) != ANNOTATION_IDENTIFIER:
        return False
    result = _annotation_result(row)
    return (
        str(result.get("label") or "").lower() == verdict.label
        and int(float(result.get("score", -1))) == int(verdict.score)
    )


def write_verdicts_with_readback(gateway: Any, verdicts: Sequence[Verdict]) -> dict[str, Any]:
    summary = {
        "posted": 0,
        "skipped_human": 0,
        "verified": 0,
        "errors": [],
        "written_span_ids": [],
    }
    for verdict in verdicts:
        before = gateway.get_span_annotations(verdict.span_id)
        if has_human_quality_annotation(before):
            summary["skipped_human"] += 1
            continue
        payload = span_annotation_payload(verdict)
        try:
            gateway.post_span_annotations(payload)
            summary["posted"] += 1
        except Exception as exc:
            summary["errors"].append(
                {
                    "span_id": verdict.span_id,
                    "stage": "post",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
            continue
        after = gateway.get_span_annotations(verdict.span_id)
        if any(_auto_annotation_matches(row, verdict) for row in after):
            summary["verified"] += 1
            summary["written_span_ids"].append(verdict.span_id)
        else:
            summary["errors"].append(
                {
                    "span_id": verdict.span_id,
                    "stage": "readback",
                    "error": "auto-critic annotation not found after write",
                }
            )
    return summary


class PhoenixGateway:
    def __init__(self, *, base_url: str = DEFAULT_PHOENIX_BASE_URL, project_name: str = DEFAULT_PROJECT_NAME):
        self.base_url = base_url.rstrip("/")
        self.project_name = project_name
        try:
            from phoenix.client import Client
        except Exception as exc:
            raise AutoCriticError(f"phoenix.client import failed: {exc}") from exc
        self.client = Client(base_url=self.base_url)

    def list_sessions(self, *, limit: int = 5) -> list[dict[str, Any]]:
        rows = self.client.sessions.list(project_name=self.project_name, limit=limit, timeout=20)
        return [dict(row) if isinstance(row, Mapping) else {"value": str(row)} for row in rows]

    def get_session_spans(self, session_id: str) -> list[dict[str, Any]]:
        traces = self.client.traces.get_traces(
            project_identifier=self.project_name,
            session_id=session_id,
            include_spans=False,
            limit=1000,
            timeout=30,
        )
        trace_rows = [dict(trace) for trace in traces if isinstance(trace, Mapping)]
        trace_ids = [
            str(trace.get("trace_id"))
            for trace in trace_rows
            if trace.get("trace_id")
        ]
        if not trace_ids:
            return []
        fetched_rows: list[Any] = []
        for idx in range(0, len(trace_ids), 200):
            chunk = trace_ids[idx : idx + 200]
            fetched_rows.extend(
                self.client.spans.get_spans(
                    project_identifier=self.project_name,
                    trace_ids=chunk,
                    limit=5000,
                    timeout=30,
                )
            )
        return [
            dict(span) if isinstance(span, Mapping) else {"value": str(span)}
            for span in fetched_rows
        ]

    def get_span_annotations(self, span_id: str) -> list[Any]:
        return self.client.spans.get_span_annotations(
            span_ids=[span_id],
            project_identifier=self.project_name,
            include_annotation_names=[ANNOTATION_NAME],
            limit=100,
            timeout=20,
        )

    def post_span_annotations(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}/v1/span_annotations?sync=true"
        body = json.dumps(payload).encode("utf-8")
        request = Request(url, data=body, headers={"content-type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=30) as response:
                text = response.read().decode("utf-8")
                if not text:
                    return {"ok": True, "status": response.status}
                parsed = json.loads(text)
                return parsed if isinstance(parsed, dict) else {"data": parsed}
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise AutoCriticError(f"Phoenix REST {exc.code}: {detail}") from exc
        except URLError as exc:
            raise AutoCriticError(f"Phoenix REST failed: {exc}") from exc


def judge_messages(context: SessionContext) -> list[dict[str, str]]:
    schema = {
        "session": {
            "label": "good|bad",
            "score": "1 for good, 0 for bad",
            "explanation": "one or two sentences",
        },
        "flags": [
            {
                "span_id": "16-char span id from the transcript",
                "label": "bad",
                "score": 0,
                "category": "tool_misuse|ignored_tool_result|wrong_assumption|unrecovered_error|unsafe_advice|other",
                "explanation": "short reason",
            }
        ],
    }
    system = (
        "You are the Phoenix auto-critic. Grade agent sessions with a strict, "
        "evidence-based rubric. Return only valid JSON."
    )
    user = (
        "Rubric:\n"
        "- cmux: did the agent understand the task, use tools well, and recover from mistakes.\n"
        "- coach: advice must be correct, safe, actionable, and privacy-preserving.\n"
        "- Mark session bad if there is tool misuse, ignored tool output, wrong assumptions, "
        "unrecovered errors, unsafe advice, or fabricated claims.\n"
        "- Add per-turn flags only for spans that are pre-fixable and clearly wrong.\n"
        "- A bad turn can be flagged even when the overall session remains good because "
        "the agent later recovered.\n\n"
        f"Required JSON schema:\n{json.dumps(schema, indent=2)}\n\n"
        f"Session transcript:\n{context.transcript_for_judge()}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _default_https_context() -> ssl.SSLContext | None:
    try:
        import certifi
    except Exception:
        return None
    return ssl.create_default_context(cafile=certifi.where())


class GroqJudgeBackend:
    kind = "groq"

    def __init__(self, *, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key or os.environ.get("GROQ_API_KEY")
        self.model = model or os.environ.get("GROQ_MODEL") or DEFAULT_GROQ_MODEL

    def judge(self, context: SessionContext) -> Mapping[str, Any]:
        if not self.api_key:
            raise AutoCriticError("GROQ_API_KEY is required for backend=groq")
        payload = {
            "model": self.model,
            "messages": judge_messages(context),
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }
        request = Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "accept": "application/json",
                "user-agent": "golems-phoenix-auto-critic/1.0",
                "authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=90, context=_default_https_context()) as response:
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise AutoCriticError(f"Groq HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise AutoCriticError(f"Groq request failed: {exc}") from exc
        content = data["choices"][0]["message"]["content"]
        return _require_mapping(content)


class OllamaJudgeBackend:
    kind = "ollama"

    def __init__(self, *, host: str | None = None, model: str | None = None):
        self.host = (host or os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434").rstrip("/")
        self.model = model or os.environ.get("OLLAMA_MODEL") or DEFAULT_OLLAMA_MODEL

    def judge(self, context: SessionContext) -> Mapping[str, Any]:
        payload = {
            "model": self.model,
            "messages": judge_messages(context),
            "format": "json",
            "stream": False,
            "options": {"temperature": 0},
        }
        request = Request(
            f"{self.host}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=180) as response:
                data = json.loads(response.read().decode("utf-8"))
        except URLError as exc:
            raise AutoCriticError(f"Ollama request failed: {exc}") from exc
        return _require_mapping(data.get("message", {}).get("content"))


def make_backend(kind: str, *, model: str | None = None) -> Any:
    normalized = kind.strip().lower()
    if normalized == "groq":
        return GroqJudgeBackend(model=model)
    if normalized in {"local", "mlx", "ollama"}:
        return OllamaJudgeBackend(model=model)
    raise AutoCriticError(f"unsupported backend {kind!r}")


def _session_id_from_row(row: Mapping[str, Any]) -> str:
    return str(row.get("session_id") or row.get("id") or "")


def run_auto_critic(
    *,
    gateway: PhoenixGateway,
    backend: Any,
    project_name: str,
    session_ids: Sequence[str] | None = None,
    limit: int = 3,
    dry_run: bool = False,
) -> dict[str, Any]:
    if session_ids:
        selected = list(session_ids)
    else:
        selected = [
            session_id
            for session_id in (_session_id_from_row(row) for row in gateway.list_sessions(limit=limit))
            if session_id
        ][:limit]

    results: list[dict[str, Any]] = []
    total_posted = 0
    total_verified = 0
    total_flags = 0
    for session_id in selected:
        spans = gateway.get_session_spans(session_id)
        context = build_session_context(project_name=project_name, session_id=session_id, spans=spans)
        raw_result = backend.judge(context)
        judged = parse_judge_result(raw_result, context)
        verdicts = [judged.session, *judged.flags]
        total_flags += len(judged.flags)
        write_summary = {"dry_run": True, "posted": 0, "verified": 0, "skipped_human": 0, "errors": []}
        if not dry_run:
            write_summary = write_verdicts_with_readback(gateway, verdicts)
            total_posted += int(write_summary["posted"])
            total_verified += int(write_summary["verified"])
        results.append(
            {
                "session_id": session_id,
                "root_span_id": context.root_span_id,
                "session_label": judged.session.label,
                "session_score": judged.session.score,
                "session_explanation": judged.session.explanation,
                "flags": [
                    {
                        "span_id": flag.span_id,
                        "category": flag.category,
                        "explanation": flag.explanation,
                    }
                    for flag in judged.flags
                ],
                "write": write_summary,
            }
        )
    return {
        "project_name": project_name,
        "backend": getattr(backend, "kind", backend.__class__.__name__),
        "sessions": len(results),
        "flags": total_flags,
        "posted": total_posted,
        "verified": total_verified,
        "results": results,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pre-grade Phoenix sessions with an LLM auto-critic.")
    parser.add_argument("--phoenix-url", default=os.environ.get("PHOENIX_BASE_URL", DEFAULT_PHOENIX_BASE_URL))
    parser.add_argument("--project-name", default=os.environ.get("PHOENIX_PROJECT_NAME", DEFAULT_PROJECT_NAME))
    parser.add_argument("--session-id", action="append", default=[])
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--backend", default=None, help="groq, ollama/local/mlx")
    parser.add_argument("--model", default=None)
    parser.add_argument("--trusted-cloud", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    backend_kind = args.backend or default_backend_for_project(args.project_name)
    trusted_cloud_allowed = args.trusted_cloud or os.environ.get("PHOENIX_CRITIC_TRUSTED_BACKEND") == "1"
    try:
        validate_backend_policy(
            args.project_name,
            backend_kind,
            trusted_cloud_allowed=trusted_cloud_allowed,
        )
        gateway = PhoenixGateway(base_url=args.phoenix_url, project_name=args.project_name)
        backend = make_backend(backend_kind, model=args.model)
        summary = run_auto_critic(
            gateway=gateway,
            backend=backend,
            project_name=args.project_name,
            session_ids=args.session_id,
            limit=args.limit,
            dry_run=args.dry_run,
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except AutoCriticError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

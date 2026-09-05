#!/usr/bin/env python3
"""
cmux_capture_batch — score recent real cmux session JSONLs as a Phoenix batch.

This module intentionally imports the single-session capture path from
cmux_capture.py instead of changing it. Each Phoenix row represents one real
session, and the experiment task looks up that row's own precomputed scores.
"""
from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import json
import os
import re
import sys
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from cmux_capture import (
    ALL_USAGE_EVALUATORS,
    DEFAULT_PHOENIX_BASE_URL,
    EVALUATOR_DESCRIPTIONS,
    PRIMARY_SCORE_COLUMNS,
    USAGE_EVALUATORS,
    capture_usage_run,
    extract_session_id,
    find_jsonl_by_mtime,
    load_session_events,
    normalize_model_display,
)


DEFAULT_DATASET_NAME = "cmux-mcp-usage-live"
STARTER_DATASET_NAME = "cmux-usage-starter"
DEFAULT_EXPERIMENT_NAME = None
DEFAULT_EXPERIMENT_DESCRIPTION = (
    "Per-session cmux MCP usage (F1-F9 behavioral), one row per real agent session, "
    "labeled by agent name/type/role; raw IDs and constant scores are kept in metadata."
)
STARTER_EXPERIMENT_DESCRIPTION = (
    "Four curated cmux MCP usage sessions for onboarding: clean, focus gap, "
    "layout sprawl, and relay/zero-exec examples."
)
DEFAULT_FIND_ROOT = "~/.claude/projects"
DEFAULT_CONTAINS = "mcp__cmuxlayer__"
DEFAULT_CURSOR_PATH = "~/.local/share/brainlayer/phoenix_eval_cursor.json"
DEFAULT_LOCK_PATH = "~/.local/share/brainlayer/phoenix_eval_cursor.lock"
DEFAULT_IDLE_MIN = 5.0
DEFAULT_MODEL_VERSION = "observed-live"
DEFAULT_SUITE_VERSION = "cmux-live-v1"
DEFAULT_SURFACE = "cmux-mcp"
DEFAULT_CONDITION = "baseline_live"
DEFAULT_CATALOG_CONTEXT = "full-fleet-live"
DEFAULT_INTENT = "cmux usage live batch"
DEFAULT_GOLD_SEQUENCE = ("enumerate", "focus_or_dock", "send", "verify")
DEFAULT_GOLD_SEQUENCE_NOTE = (
    "Gold sequence is configurable and not settled; Etan challenged whether the ideal "
    "may simply be send, while current deterministic evaluators measure real cmux behavior."
)
STARTER_DEFAULT_LIMIT = 250
FROZEN_STARTER_ROW_COUNT = 4
FROZEN_STARTER_EXPERIMENT_COUNT = 1
STARTER_VARIANTS = (
    "clean_high",
    "focus_before_send_0",
    "docked_le2_columns_0",
    "relay_zero_exec",
)
FROZEN_STARTER_EXPERIMENT_NAME = "cmux-usage-starter | frozen 4 curated sessions"


@dataclass(frozen=True)
class SinceLastSession:
    path: Path
    session_key: str
    mtime: float
    idle_seconds: float
    action_count: int


def _session_id(path: Path) -> str:
    return path.stem


def _real_session_id_from_jsonl(path: Path) -> str:
    try:
        events, _parse_errors = load_session_events(str(path))
        return extract_session_id(str(path), events)
    except Exception:
        return _session_id(path)


def _mtime(path: Path) -> float:
    return path.stat().st_mtime


def _legacy_mtime_session_key(path: Path) -> str | None:
    try:
        return f"{_session_id(path)}-{path.stat().st_mtime_ns}"
    except FileNotFoundError:
        return None


def discover_sessions(
    find_roots: Sequence[str] | None = None,
    *,
    contains: str | None = DEFAULT_CONTAINS,
    limit: int = 20,
) -> list[Path]:
    """Return the most recent cmux-using JSONLs across roots, deduped by session+mtime."""
    if limit <= 0:
        return []
    roots = list(find_roots or [DEFAULT_FIND_ROOT])
    candidates: list[tuple[float, str, Path]] = []
    for root in roots:
        for match in find_jsonl_by_mtime(root, contains=contains):
            path = Path(match).expanduser()
            try:
                mtime = _mtime(path)
            except FileNotFoundError:
                continue
            if cmux_tool_use_count(path) <= 0:
                continue
            candidates.append((mtime, _session_id(path), path))

    seen: set[tuple[str, float]] = set()
    deduped: list[tuple[float, str, Path]] = []
    for mtime, session_id, path in sorted(candidates, key=lambda item: item[0], reverse=True):
        key = (session_id, mtime)
        if key in seen:
            continue
        seen.add(key)
        deduped.append((mtime, session_id, path))
        if len(deduped) >= limit:
            break
    return [path for _mtime_value, _session_id_value, path in deduped]


def discover_starter_sessions(
    find_roots: Sequence[str] | None = None,
    *,
    contains: str | None = DEFAULT_CONTAINS,
    limit: int = STARTER_DEFAULT_LIMIT,
) -> list[Path]:
    """Return a larger candidate pool, including zero-action relay rows for starter selection."""
    return _candidate_sessions(find_roots, contains=contains)[:limit]


def load_since_last_cursor(cursor_path: str | Path = DEFAULT_CURSOR_PATH) -> dict[str, float]:
    path = Path(cursor_path).expanduser()
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if not isinstance(data, Mapping):
        raise ValueError(f"since-last cursor must be a JSON object: {path}")
    return {str(key): float(value) for key, value in data.items()}


@contextmanager
def since_last_lock(lock_path: str | Path = DEFAULT_LOCK_PATH) -> Iterable[None]:
    path = Path(lock_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def write_since_last_cursor(
    cursor: Mapping[str, float],
    cursor_path: str | Path = DEFAULT_CURSOR_PATH,
) -> dict[str, float]:
    payload = {str(key): float(value) for key, value in cursor.items()}
    path = Path(cursor_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return payload


def cmux_tool_use_count(path: str | Path) -> int:
    total = 0
    with Path(path).expanduser().open(errors="ignore") as handle:
        for line in handle:
            try:
                total += _count_cmux_tool_uses(json.loads(line))
            except json.JSONDecodeError:
                continue
    return total


def _count_cmux_tool_uses(value: Any, depth: int = 0) -> int:
    if depth > 100:
        return 0
    if isinstance(value, Mapping):
        if value.get("type") == "tool_use":
            name = str(value.get("name") or "")
            if name.startswith(DEFAULT_CONTAINS):
                return 1 + sum(_count_cmux_tool_uses(item, depth + 1) for item in value.values())
            if name == "Bash":
                inp = value.get("input")
                if isinstance(inp, Mapping):
                    command = str(inp.get("command") or "")
                    if "cmux " in command or command.startswith("cmux"):
                        return 1 + sum(_count_cmux_tool_uses(item, depth + 1) for item in value.values())
        return sum(_count_cmux_tool_uses(item, depth + 1) for item in value.values())
    if isinstance(value, list):
        return sum(_count_cmux_tool_uses(item, depth + 1) for item in value)
    return 0


def _candidate_sessions(
    find_roots: Sequence[str] | None = None,
    *,
    contains: str | None = DEFAULT_CONTAINS,
) -> list[Path]:
    roots = list(find_roots or [DEFAULT_FIND_ROOT])
    candidates: list[tuple[float, Path]] = []
    seen: set[str] = set()
    for root in roots:
        for match in find_jsonl_by_mtime(root, contains=contains):
            path = Path(match).expanduser()
            key = str(path)
            if key in seen:
                continue
            try:
                mtime = _mtime(path)
            except FileNotFoundError:
                continue
            seen.add(key)
            candidates.append((mtime, path))
    return [path for _mtime_value, path in sorted(candidates, key=lambda item: item[0], reverse=True)]


def select_since_last_sessions(
    find_roots: Sequence[str] | None = None,
    *,
    cursor: Mapping[str, float] | None = None,
    cursor_path: str | Path = DEFAULT_CURSOR_PATH,
    contains: str | None = DEFAULT_CONTAINS,
    limit: int | None = None,
    idle_min: float = DEFAULT_IDLE_MIN,
    now: float | None = None,
) -> list[SinceLastSession]:
    if limit == 0:
        return []
    cursor_data = dict(cursor) if cursor is not None else load_since_last_cursor(cursor_path)
    now_ts = time.time() if now is None else now
    paths = _candidate_sessions(find_roots, contains=contains)
    keys = _session_keys(paths)
    selected: list[SinceLastSession] = []
    for path in paths:
        session_key = keys[path]
        try:
            mtime = _mtime(path)
        except FileNotFoundError:
            continue
        stem_key = _session_id(path)
        cursor_mtime = max(
            float(cursor_data.get(session_key, 0.0)),
            float(cursor_data.get(stem_key, 0.0)),
        )
        legacy_key = _legacy_mtime_session_key(path) if session_key != stem_key else None
        if legacy_key is not None:
            cursor_mtime = max(cursor_mtime, float(cursor_data.get(legacy_key, 0.0)))
        if mtime <= cursor_mtime:
            continue
        idle_seconds = now_ts - mtime
        if idle_seconds < idle_min * 60:
            continue
        action_count = cmux_tool_use_count(path)
        if action_count <= 0:
            continue
        selected.append(
            SinceLastSession(
                path=path,
                session_key=session_key,
                mtime=mtime,
                idle_seconds=idle_seconds,
                action_count=action_count,
            )
        )
        if limit is not None and len(selected) >= limit:
            break
    return selected


def advance_since_last_cursor(
    cursor: Mapping[str, float],
    selected: Sequence[SinceLastSession],
) -> dict[str, float]:
    updated = {str(key): float(value) for key, value in cursor.items()}
    for item in selected:
        updated[item.session_key] = max(float(updated.get(item.session_key, 0.0)), item.mtime)
    return updated


def _selection_summary(selected: Sequence[SinceLastSession]) -> list[dict[str, Any]]:
    return [
        {
            "session_key": item.session_key,
            "source": str(item.path),
            "mtime": item.mtime,
            "idle_seconds": item.idle_seconds,
            "action_count": item.action_count,
        }
        for item in selected
    ]


def _session_keys(paths: Sequence[Path]) -> dict[Path, str]:
    stems: dict[str, int] = {}
    base_keys: dict[Path, str] = {}
    for path in paths:
        base_key = _real_session_id_from_jsonl(path)
        base_keys[path] = base_key
        stems[base_key] = stems.get(base_key, 0) + 1

    keys: dict[Path, str] = {}
    for path in paths:
        stem = base_keys[path]
        if stems[stem] == 1:
            keys[path] = stem
            continue
        suffix = hashlib.md5(str(path).encode()).hexdigest()[:16]
        keys[path] = f"{stem}-{suffix}"
    return keys


def _metadata_scores(scores: Mapping[str, int]) -> dict[str, int]:
    return {f"score_{name}": int(scores.get(name, 0)) for name in ALL_USAGE_EVALUATORS}


def _row_from_capture(
    result: Mapping[str, Any],
    *,
    session_key: str,
    surface: str,
    intent: str,
    gold_call_budget: int | None,
    gold_sequence: Sequence[str] = DEFAULT_GOLD_SEQUENCE,
    gold_sequence_note: str = DEFAULT_GOLD_SEQUENCE_NOTE,
) -> dict[str, Any]:
    actions = list(result.get("actions") or [])
    scores = dict(result.get("scores") or {})
    evidence = dict(result.get("evidence") or {})
    result_metadata = dict(result.get("metadata") or {})
    identity = {
        key: result_metadata.get(key)
        for key in ("agent_name", "agent_type", "agent_role", "repo", "reports_to", "task_summary")
        if result_metadata.get(key) is not None
    }
    timing = {
        key: result_metadata.get(key)
        for key in ("session_duration_ms", "session_end_ts")
        if result_metadata.get(key) is not None
    }
    session_id = str(result.get("session_id") or result_metadata.get("session_id") or session_key)
    agent_type = str(identity.get("agent_type") or result_metadata.get("agent_type") or "unknown")
    model = str(
        result_metadata.get("model")
        or normalize_model_display(result.get("booted_model"), agent_type=agent_type)
    )
    user_input = str(result.get("user_input") or "")
    agent_output = str(result.get("agent_output") or "")
    details = dict(result_metadata.get("details") or {})
    details.update(
        {
            "session_key": session_key,
            "session_id": session_id,
            "source": result.get("source"),
            "surface": result_metadata.get("surface") or surface,
        }
    )
    metadata = {
        **result_metadata,
        "surface": result_metadata.get("surface") or surface,
        "session_key": session_key,
        "session_id": session_id,
        "source": result.get("source"),
        "model": model,
        "details": details,
        "parse_errors": int(result.get("parse_errors") or 0),
        "booted_model": result.get("booted_model"),
        "action_count": len(actions),
        "scores": scores,
        "evidence": evidence,
        "composite_pass_rate": composite_pass_rate(scores),
        "gold_sequence_note": gold_sequence_note,
        **_metadata_scores(scores),
    }
    return {
        "session_key": session_key,
        "source": result.get("source"),
        "input": {
            "repo": identity.get("repo"),
            "agent_name": identity.get("agent_name"),
            "model": model,
            "agent_role": identity.get("agent_role"),
            "reports_to": identity.get("reports_to") or "",
            "task_summary": identity.get("task_summary") or intent,
            **{name: int(scores.get(name, 0)) for name in PRIMARY_SCORE_COLUMNS},
            "agent_type": agent_type,
            "session_duration_ms": timing.get("session_duration_ms"),
        },
        "output": {
            "gold_primary": "cmux usage behavior",
            "gold_sequence": list(gold_sequence),
            "gold_call_budget": gold_call_budget,
            "guard": True,
            "user_input": user_input,
            "agent_output": agent_output,
        },
        "metadata": metadata,
        "scores": scores,
        "evidence": evidence,
        "actions": actions,
        "booted_model": result.get("booted_model"),
        "parse_errors": int(result.get("parse_errors") or 0),
    }


def capture_batch(
    sources: Iterable[str | Path],
    *,
    surface: str = DEFAULT_SURFACE,
    condition: str = DEFAULT_CONDITION,
    model_version: str,
    catalog_context: str = DEFAULT_CATALOG_CONTEXT,
    suite_version: str = DEFAULT_SUITE_VERSION,
    intent: str = DEFAULT_INTENT,
    gold_call_budget: int | None = None,
    intended_model: str | None = None,
    dataset_name: str = DEFAULT_DATASET_NAME,
    session_keys: Mapping[str | Path, str] | None = None,
    gold_sequence: Sequence[str] = DEFAULT_GOLD_SEQUENCE,
    gold_sequence_note: str = DEFAULT_GOLD_SEQUENCE_NOTE,
) -> dict[str, Any]:
    paths = [Path(source).expanduser() for source in sources]
    keys = _session_keys(paths)
    if session_keys:
        overrides = {Path(path).expanduser(): str(key) for path, key in session_keys.items()}
        for path in paths:
            if path in overrides:
                keys[path] = overrides[path]
    rows: list[dict[str, Any]] = []
    for path in paths:
        session_key = keys[path]
        result = capture_usage_run(
            str(path),
            surface=surface,
            condition=condition,
            model_version=model_version,
            catalog_context=catalog_context,
            suite_version=suite_version,
            intent=intent,
            case_id=session_key,
            gold_call_budget=gold_call_budget,
            intended_model=intended_model,
        )
        rows.append(
            _row_from_capture(
                result,
                session_key=session_key,
                surface=surface,
                intent=intent,
                gold_call_budget=gold_call_budget,
                gold_sequence=gold_sequence,
                gold_sequence_note=gold_sequence_note,
            )
        )

    return {
        "dataset": {"name": dataset_name, "description": DEFAULT_EXPERIMENT_DESCRIPTION},
        "rows": rows,
        "evaluator_names": list(USAGE_EVALUATORS),
        "summary": summarize_rows(rows),
    }


def _scores_from(row_or_scores: Mapping[str, Any]) -> Mapping[str, Any]:
    if "scores" in row_or_scores and isinstance(row_or_scores["scores"], Mapping):
        return row_or_scores["scores"]
    metadata = row_or_scores.get("metadata")
    if isinstance(metadata, Mapping) and isinstance(metadata.get("scores"), Mapping):
        return metadata["scores"]
    return row_or_scores


def score_vector(
    row_or_scores: Mapping[str, Any],
    evaluator_names: Sequence[str] = USAGE_EVALUATORS,
) -> tuple[int, ...]:
    scores = _scores_from(row_or_scores)
    return tuple(int(scores.get(name, 0)) for name in evaluator_names)


def composite_pass_rate(
    row_or_scores: Mapping[str, Any],
    evaluator_names: Sequence[str] = USAGE_EVALUATORS,
) -> float:
    vector = score_vector(row_or_scores, evaluator_names)
    if not vector:
        return 0.0
    return sum(vector) / len(vector)


def summarize_rows(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    per_evaluator: dict[str, float] = {}
    for name in USAGE_EVALUATORS:
        values = [int(_scores_from(row).get(name, 0)) for row in rows]
        per_evaluator[name] = (sum(values) / len(values)) if values else 0.0

    leaderboard = [
        {
            "session_key": str(row.get("input", {}).get("session_key") or row.get("session_key")),
            "agent_name": str(row.get("input", {}).get("agent_name") or ""),
            "agent_type": str(row.get("input", {}).get("agent_type") or ""),
            "agent_role": str(row.get("input", {}).get("agent_role") or ""),
            "repo": str(row.get("input", {}).get("repo") or ""),
            "model": str(row.get("input", {}).get("model") or row.get("metadata", {}).get("model") or ""),
            "reports_to": str(row.get("input", {}).get("reports_to") or ""),
            "task_summary": str(row.get("input", {}).get("task_summary") or ""),
            "composite": composite_pass_rate(row),
            "session_duration_ms": row.get("input", {}).get("session_duration_ms")
            or row.get("metadata", {}).get("session_duration_ms"),
            "session_end_ts": row.get("input", {}).get("session_end_ts")
            or row.get("metadata", {}).get("session_end_ts"),
            "action_count": int(row.get("metadata", {}).get("action_count") or 0),
            "source": row.get("source"),
        }
        for row in rows
    ]
    leaderboard.sort(key=lambda item: item["composite"], reverse=True)
    composites = [item["composite"] for item in leaderboard]
    vectors = {score_vector(row) for row in rows}
    return {
        "rows": len(rows),
        "per_evaluator_pass_rate": per_evaluator,
        "per_session_composite": leaderboard,
        "composite_min": min(composites) if composites else 0.0,
        "composite_max": max(composites) if composites else 0.0,
        "composite_spread": (max(composites) - min(composites)) if composites else 0.0,
        "distinct_score_vectors": len(vectors),
    }


def _row_session_key(row: Mapping[str, Any]) -> str:
    metadata = row.get("metadata")
    if isinstance(metadata, Mapping) and metadata.get("session_key"):
        return str(metadata["session_key"])
    return str(row.get("session_key") or "")


def _score_value(row: Mapping[str, Any], name: str) -> int:
    return int(_scores_from(row).get(name, 0))


def _action_count(row: Mapping[str, Any]) -> int:
    metadata = row.get("metadata")
    if isinstance(metadata, Mapping) and metadata.get("action_count") is not None:
        return int(metadata["action_count"])
    actions = row.get("actions")
    return len(actions) if isinstance(actions, Sequence) else 0


def _tag_starter_row(row: Mapping[str, Any], *, variant: str, reason: str) -> dict[str, Any]:
    tagged = copy.deepcopy(dict(row))
    metadata = dict(tagged.get("metadata") or {})
    metadata["starter_variant"] = variant
    metadata["starter_reason"] = reason
    tagged["metadata"] = metadata
    return tagged


def _pick_starter_candidate(
    rows: Sequence[Mapping[str, Any]],
    *,
    used: set[str],
    predicate: Callable[[Mapping[str, Any]], bool],
) -> Mapping[str, Any] | None:
    candidates = [row for row in rows if _row_session_key(row) not in used and predicate(row)]
    if not candidates:
        return None
    return sorted(
        candidates,
        key=lambda row: (composite_pass_rate(row), _action_count(row)),
        reverse=True,
    )[0]


def select_starter_rows(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    variants: tuple[
        tuple[
            str,
            str,
            Callable[[Mapping[str, Any]], bool],
            Callable[[Mapping[str, Any]], bool],
        ],
        ...,
    ] = (
        (
            "clean_high",
            "High-composite session with execution, focus, and docked layout passing.",
            lambda row: _score_value(row, "executed_not_relayed") == 1
            and _score_value(row, "focus_before_send") == 1
            and _score_value(row, "docked_le2_columns") == 1,
            lambda row: _score_value(row, "executed_not_relayed") == 1
            and _score_value(row, "focus_before_send") == 1
            and _score_value(row, "docked_le2_columns") == 1,
        ),
        (
            "focus_before_send_0",
            "Session executed cmux actions but missed focus-before-send.",
            lambda row: _score_value(row, "executed_not_relayed") == 1
            and _score_value(row, "focus_before_send") == 0
            and _score_value(row, "docked_le2_columns") == 1,
            lambda row: _score_value(row, "executed_not_relayed") == 1
            and _score_value(row, "focus_before_send") == 0,
        ),
        (
            "docked_le2_columns_0",
            "Session executed cmux actions but left layout docking or column count unproven.",
            lambda row: _score_value(row, "executed_not_relayed") == 1
            and _score_value(row, "focus_before_send") == 1
            and _score_value(row, "docked_le2_columns") == 0,
            lambda row: _score_value(row, "executed_not_relayed") == 1
            and _score_value(row, "docked_le2_columns") == 0,
        ),
        (
            "relay_zero_exec",
            "Session had cmux intent but no executed cmux action.",
            lambda row: _score_value(row, "executed_not_relayed") == 0 or _action_count(row) == 0,
            lambda row: _score_value(row, "executed_not_relayed") == 0 or _action_count(row) == 0,
        ),
    )
    selected: list[dict[str, Any]] = []
    used: set[str] = set()
    for variant, reason, preferred, fallback in variants:
        row = _pick_starter_candidate(rows, used=used, predicate=preferred)
        if row is None:
            row = _pick_starter_candidate(rows, used=used, predicate=fallback)
        if row is None:
            continue
        used.add(_row_session_key(row))
        selected.append(_tag_starter_row(row, variant=variant, reason=reason))

    if len(selected) >= 4:
        return selected[:4]

    remaining = [
        row for row in rows if _row_session_key(row) not in used
    ]
    remaining.sort(key=lambda row: (composite_pass_rate(row), _action_count(row)), reverse=True)
    for idx, row in enumerate(remaining, start=1):
        if len(selected) >= 4:
            break
        used.add(_row_session_key(row))
        selected.append(
            _tag_starter_row(
                row,
                variant=f"fallback_{idx}",
                reason="Additional high-composite session used because a starter contrast bucket was unavailable.",
            )
        )
    return selected


def capture_starter_batch(
    sources: Iterable[str | Path],
    *,
    surface: str = DEFAULT_SURFACE,
    condition: str = DEFAULT_CONDITION,
    model_version: str,
    catalog_context: str = DEFAULT_CATALOG_CONTEXT,
    suite_version: str = DEFAULT_SUITE_VERSION,
    intent: str = DEFAULT_INTENT,
    gold_call_budget: int | None = None,
    intended_model: str | None = None,
    dataset_name: str = STARTER_DATASET_NAME,
    session_keys: Mapping[str | Path, str] | None = None,
    gold_sequence: Sequence[str] = DEFAULT_GOLD_SEQUENCE,
    gold_sequence_note: str = DEFAULT_GOLD_SEQUENCE_NOTE,
) -> dict[str, Any]:
    batch = capture_batch(
        sources,
        surface=surface,
        condition=condition,
        model_version=model_version,
        catalog_context=catalog_context,
        suite_version=suite_version,
        intent=intent,
        gold_call_budget=gold_call_budget,
        intended_model=intended_model,
        dataset_name=dataset_name,
        session_keys=session_keys,
        gold_sequence=gold_sequence,
        gold_sequence_note=gold_sequence_note,
    )
    rows = select_starter_rows(batch["rows"])
    return {
        **batch,
        "dataset": {"name": dataset_name, "description": STARTER_EXPERIMENT_DESCRIPTION},
        "rows": rows,
        "summary": summarize_rows(rows),
        "starter": {
            "source_row_count": len(batch["rows"]),
            "selected_row_count": len(rows),
            "variants": [row["metadata"].get("starter_variant") for row in rows],
        },
    }


def _example_input(example: Any = None, **kwargs: Any) -> Mapping[str, Any]:
    if isinstance(kwargs.get("input"), Mapping):
        return kwargs["input"]
    if isinstance(kwargs.get("inputs"), Mapping):
        return kwargs["inputs"]
    if isinstance(example, Mapping):
        value = example.get("input") or example.get("inputs")
        return value if isinstance(value, Mapping) else example
    value = getattr(example, "input", None)
    if isinstance(value, Mapping):
        return value
    value = getattr(example, "inputs", None)
    if isinstance(value, Mapping):
        return value
    return {}


def _example_metadata(example: Any = None, **kwargs: Any) -> Mapping[str, Any]:
    if isinstance(kwargs.get("metadata"), Mapping):
        return kwargs["metadata"]
    if isinstance(example, Mapping):
        value = example.get("metadata")
        return value if isinstance(value, Mapping) else {}
    value = getattr(example, "metadata", None)
    return value if isinstance(value, Mapping) else {}


def _example_id(example: Any) -> str | None:
    if isinstance(example, Mapping):
        for key in ("id", "dataset_example_id", "example_id"):
            value = example.get(key)
            if value:
                return str(value)
        return None
    for key in ("id", "dataset_example_id", "example_id"):
        value = getattr(example, key, None)
        if value:
            return str(value)
    return None


def _dataset_example_metadata_by_id(dataset: Any) -> dict[str, Mapping[str, Any]]:
    metadata_by_id: dict[str, Mapping[str, Any]] = {}
    for example in getattr(dataset, "examples", []) or []:
        example_id = _example_id(example)
        metadata = _example_metadata(example)
        if example_id and metadata:
            metadata_by_id[example_id] = metadata
    return metadata_by_id


def _example_session_key(example: Any = None, **kwargs: Any) -> str:
    inputs = _example_input(example, **kwargs)
    key = inputs.get("session_key")
    if key:
        return str(key)
    metadata = _example_metadata(example, **kwargs)
    key = metadata.get("session_key")
    if key:
        return str(key)
    raise KeyError(f"Phoenix example is missing input.session_key: {example!r}")


def make_score_task(rows: Sequence[Mapping[str, Any]]) -> Callable[..., dict[str, Any]]:
    rows_by_key = {
        str(row.get("metadata", {}).get("session_key") or row.get("session_key")): row
        for row in rows
        if row.get("metadata", {}).get("session_key") or row.get("session_key")
    }

    def _task_output(
        *,
        session_key: str,
        scores: Mapping[str, Any],
        evidence: Mapping[str, Any],
        metadata: Mapping[str, Any],
        row_input: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        row_input = row_input or {}
        return {
            "scores": dict(scores),
            "evidence": dict(evidence),
            "action_count": row_input.get("action_count", metadata.get("action_count")),
            "booted_model": row_input.get("booted_model", metadata.get("booted_model")),
            "agent_name": row_input.get("agent_name", metadata.get("agent_name")),
            "agent_type": row_input.get("agent_type", metadata.get("agent_type")),
            "agent_role": row_input.get("agent_role", metadata.get("agent_role")),
            "repo": row_input.get("repo", metadata.get("repo")),
            "session_duration_ms": row_input.get(
                "session_duration_ms", metadata.get("session_duration_ms")
            ),
            "session_end_ts": row_input.get("session_end_ts", metadata.get("session_end_ts")),
        }

    def task(example: Any = None, **kwargs: Any) -> dict[str, Any]:
        session_key = _example_session_key(example, **kwargs)
        row = rows_by_key.get(session_key)
        if row is None:
            metadata = _example_metadata(example, **kwargs)
            if not isinstance(metadata.get("scores"), Mapping):
                raise KeyError(f"no precomputed scores for session_key={session_key}")
            return _task_output(
                session_key=session_key,
                scores=metadata["scores"],
                evidence=metadata.get("evidence") or {},
                metadata=metadata,
            )
        return _task_output(
            session_key=session_key,
            scores=row.get("scores", {}),
            evidence=row.get("evidence", {}),
            metadata=row.get("metadata", {}),
            row_input=row.get("input"),
        )

    task.__name__ = "cmux_capture_batch_score_lookup"
    return task


def _score_evaluator(name: str) -> Callable[..., dict[str, Any]]:
    def evaluator(output: Mapping[str, Any] | None = None, **kwargs: Any) -> dict[str, Any]:
        payload = output if isinstance(output, Mapping) else kwargs.get("output")
        if not isinstance(payload, Mapping):
            score = 0
        else:
            scores = payload.get("scores")
            if not isinstance(scores, Mapping):
                prediction = payload.get("prediction")
                scores = prediction.get("scores") if isinstance(prediction, Mapping) else {}
            score = int(scores.get(name, 0)) if isinstance(scores, Mapping) else 0
        description = EVALUATOR_DESCRIPTIONS.get(name, "")
        return {
            "score": float(score),
            "label": "pass" if score else "fail",
            "explanation": f"{description} precomputed cmux usage score {name}={score}".strip(),
            "metadata": {"evaluator_description": description},
        }

    evaluator.__name__ = name
    evaluator.__doc__ = EVALUATOR_DESCRIPTIONS.get(name, "")
    return evaluator


def make_evaluators() -> dict[str, Callable[..., int]]:
    return {name: _score_evaluator(name) for name in USAGE_EVALUATORS}


def _stable_example_id(
    row: Mapping[str, Any],
    *,
    index: int,
    dataset_name: str,
) -> str:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
    label = str(metadata.get("starter_variant") or f"row_{index + 1}")
    label = re.sub(r"[^A-Za-z0-9_.-]+", "-", label).strip("-") or f"row_{index + 1}"
    return f"{dataset_name}:{label}"


def _examples_from_rows(
    rows: Sequence[Mapping[str, Any]],
    *,
    stable_example_ids: bool = False,
    dataset_name: str = DEFAULT_DATASET_NAME,
) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        example = {
            "input": dict(row["input"]),
            "output": dict(row["output"]),
            "metadata": dict(row["metadata"]),
        }
        if stable_example_ids:
            example["example_id"] = _stable_example_id(
                row,
                index=index,
                dataset_name=dataset_name,
            )
        examples.append(example)
    return examples


def evaluation_payloads_for_run(
    run: Mapping[str, Any],
    *,
    evaluator_names: Sequence[str] = USAGE_EVALUATORS,
    existing_names: Iterable[str] = (),
    now: str | None = None,
) -> list[dict[str, Any]]:
    timestamp = now or datetime.now(timezone.utc).isoformat()
    output = run.get("output") if isinstance(run.get("output"), Mapping) else {}
    scores = output.get("scores") if isinstance(output.get("scores"), Mapping) else {}
    run_metadata = run.get("metadata") if isinstance(run.get("metadata"), Mapping) else {}
    details = (
        run_metadata.get("details")
        if isinstance(run_metadata.get("details"), Mapping)
        else {}
    )

    def hidden_value(key: str) -> Any:
        output_value = output.get(key)
        if output_value is not None:
            return output_value
        metadata_value = run_metadata.get(key)
        if metadata_value is not None:
            return metadata_value
        return details.get(key)

    session_key = str(hidden_value("session_key") or "")
    existing = set(existing_names)
    payloads: list[dict[str, Any]] = []
    for name in evaluator_names:
        if name in existing:
            continue
        score = int(scores.get(name, 0))
        description = EVALUATOR_DESCRIPTIONS.get(name, "")
        payloads.append(
            {
                "experiment_run_id": run["id"],
                "name": name,
                "annotator_kind": "CODE",
                "start_time": timestamp,
                "end_time": timestamp,
                "result": {
                    "score": float(score),
                    "label": "pass" if score else "fail",
                    "explanation": (
                        f"{description} precomputed cmux usage score {name}={score} "
                        f"for session_key={session_key}"
                    ).strip(),
                },
                "metadata": {
                    "evaluator_description": description,
                    "session_key": session_key,
                    "source": hidden_value("source"),
                    "action_count": hidden_value("action_count"),
                    "booted_model": hidden_value("booted_model"),
                    "agent_name": hidden_value("agent_name"),
                    "agent_type": hidden_value("agent_type"),
                    "agent_role": hidden_value("agent_role"),
                    "repo": hidden_value("repo"),
                    "session_duration_ms": hidden_value("session_duration_ms"),
                    "session_end_ts": hidden_value("session_end_ts"),
                },
            }
        )
    return payloads


def _experiment_annotation_names(
    client: Any,
    experiment_id: str,
    *,
    timeout: int = 120,
) -> dict[tuple[str, int], set[str]]:
    # Phoenix 17 has no public client method for experiment JSON annotations.
    # The private REST client is also used by brainlayer_phoenix.loader.
    rest_client = _phoenix_rest_client(client)
    response = rest_client.get(f"v1/experiments/{experiment_id}/json", timeout=timeout)
    response.raise_for_status()
    rows = response.json()
    annotations: dict[tuple[str, int], set[str]] = {}
    for row in rows:
        key = (str(row.get("example_id")), int(row.get("repetition_number") or 1))
        annotations[key] = {
            str(annotation.get("name"))
            for annotation in (row.get("annotations") or [])
            if annotation.get("name")
        }
    return annotations


def _phoenix_rest_client(client: Any) -> Any:
    rest_client = getattr(client, "_client", None)
    if rest_client is None or not hasattr(rest_client, "get") or not hasattr(rest_client, "post"):
        raise RuntimeError(
            "Phoenix client internal API changed. Update cmux_capture_batch "
            "experiment annotation implementation."
        )
    return rest_client


def ensure_precomputed_evaluations(
    client: Any,
    *,
    experiment_id: str,
    task_runs: Sequence[Mapping[str, Any]],
    evaluator_names: Sequence[str] = USAGE_EVALUATORS,
    example_metadata_by_id: Mapping[str, Mapping[str, Any]] | None = None,
    timeout: int = 120,
) -> dict[str, Any]:
    before = _experiment_annotation_names(client, experiment_id, timeout=timeout)
    rest_client = _phoenix_rest_client(client)
    metadata_by_id = dict(example_metadata_by_id or {})
    expected = len(task_runs) * len(evaluator_names)
    before_count = sum(
        len(names.intersection(evaluator_names)) for names in before.values()
    )
    uploaded = 0
    errors: list[dict[str, Any]] = []
    for run in task_runs:
        example_id = str(run.get("dataset_example_id") or "")
        example_metadata = metadata_by_id.get(example_id)
        if example_metadata:
            run_metadata = run.get("metadata") if isinstance(run.get("metadata"), Mapping) else {}
            run = {
                **run,
                "metadata": {
                    **dict(example_metadata),
                    **dict(run_metadata),
                },
            }
        key = (
            str(run.get("dataset_example_id")),
            int(run.get("repetition_number") or 1),
        )
        for payload in evaluation_payloads_for_run(
            run,
            evaluator_names=evaluator_names,
            existing_names=before.get(key, set()),
        ):
            try:
                response = rest_client.post(
                    "v1/experiment_evaluations",
                    json=payload,
                    timeout=timeout,
                )
                response.raise_for_status()
                uploaded += 1
            except Exception as exc:
                errors.append(
                    {
                        "run_id": run.get("id"),
                        "name": payload.get("name"),
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )

    after = _experiment_annotation_names(client, experiment_id, timeout=timeout)
    after_count = sum(len(names.intersection(evaluator_names)) for names in after.values())
    return {
        "expected": expected,
        "annotation_count_before": before_count,
        "annotation_count_after": after_count,
        "uploaded": uploaded,
        "complete": expected > 0 and after_count >= expected,
        "errors": errors,
    }


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, type):
        return f"{value.__module__}.{value.__qualname__}"
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if is_dataclass(value) and not isinstance(value, type):
        return json_safe(asdict(value))
    if isinstance(value, Mapping):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [json_safe(item) for item in value]
    if hasattr(value, "__dict__"):
        return json_safe(vars(value))
    return str(value)


def _result_get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _dataset_existing_keys(dataset: Any) -> set[str]:
    keys: set[str] = set()
    for example in getattr(dataset, "examples", []) or []:
        try:
            keys.add(_example_session_key(example))
        except KeyError:
            continue
    return keys


def _create_or_update_dataset(
    client: Any,
    dataset_name: str,
    examples: list[dict[str, Any]],
    *,
    dataset_description: str = DEFAULT_EXPERIMENT_DESCRIPTION,
    refresh_existing: bool = False,
    example_id_key: str | None = None,
) -> tuple[Any, str, int]:
    if refresh_existing:
        dataset = client.datasets.create_dataset(
            name=dataset_name,
            examples=examples,
            example_id_key=example_id_key,
            dataset_description=dataset_description,
            timeout=120,
        )
        return dataset, "updated", len(examples)

    try:
        dataset = client.datasets.get_dataset(dataset=dataset_name, timeout=120)
    except Exception as get_exc:
        try:
            dataset = client.datasets.create_dataset(
                name=dataset_name,
                examples=examples,
                dataset_description=dataset_description,
                timeout=120,
            )
            return dataset, "created", len(examples)
        except Exception as create_exc:
            raise RuntimeError(
                f"failed to create dataset {dataset_name!r}: {create_exc}; "
                f"failed to get existing dataset: {get_exc}"
            ) from get_exc

    existing_keys = _dataset_existing_keys(dataset)
    new_examples = [
        example for example in examples if _example_session_key(example) not in existing_keys
    ]
    if new_examples:
        dataset = client.datasets.add_examples_to_dataset(
            dataset=dataset,
            examples=new_examples,
            timeout=120,
        )
    return dataset, "reused", len(new_examples)


def _dataset_example_count(dataset: Any) -> int:
    examples = getattr(dataset, "examples", None)
    if examples is not None:
        return len(examples)
    for key in ("example_count", "examples_count"):
        value = _result_get(dataset, key)
        if value is not None:
            return int(value)
    return 0


def _dataset_example_ids(dataset: Any) -> list[str]:
    ids: list[str] = []
    for example in getattr(dataset, "examples", []) or []:
        example_id = _example_id(example)
        if example_id:
            ids.append(example_id)
    return ids


def _frozen_experiment_evaluation_status(
    client: Any,
    experiment_id: str,
    *,
    row_count: int,
    expected_example_ids: Sequence[str] = (),
    timeout: int = 120,
) -> dict[str, Any]:
    required_names = set(USAGE_EVALUATORS)
    expected = row_count * len(required_names)
    try:
        annotations = _experiment_annotation_names(client, experiment_id, timeout=timeout)
    except Exception as exc:
        return {
            "expected": expected,
            "annotation_count_before": 0,
            "annotation_count_after": 0,
            "uploaded": 0,
            "complete": False,
            "errors": [
                {
                    "experiment_id": experiment_id,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            ],
        }

    annotation_count = sum(
        len(names.intersection(required_names)) for names in annotations.values()
    )
    missing_examples: list[dict[str, Any]] = []
    complete_example_count = 0
    if expected_example_ids:
        for example_id in expected_example_ids:
            example_names: set[str] = set()
            for (annotated_id, _repetition), names in annotations.items():
                if annotated_id == example_id:
                    example_names.update(names.intersection(required_names))
            missing = sorted(required_names.difference(example_names))
            if missing:
                missing_examples.append(
                    {
                        "example_id": example_id,
                        "missing_evaluators": missing,
                    }
                )
            else:
                complete_example_count += 1
        complete = (
            len(expected_example_ids) == row_count
            and complete_example_count == row_count
            and annotation_count >= expected
        )
    else:
        # Without dataset example ids, per-example verification is impossible.
        # Stay conservative: report incomplete so the repair path reruns the
        # experiment instead of trusting an aggregate annotation count.
        complete_example_count = sum(
            1 for names in annotations.values() if required_names.issubset(names)
        )
        complete = False
    return {
        "expected": expected,
        "annotation_count_before": annotation_count,
        "annotation_count_after": annotation_count,
        "uploaded": 0,
        "complete": complete,
        "complete_example_count": complete_example_count,
        "missing_examples": missing_examples,
        "errors": [],
    }


def _experiment_id(experiment: Any) -> str:
    return str(
        _result_get(experiment, "id")
        or _result_get(experiment, "experiment_id")
        or ""
    )


def _list_dataset_experiments(client: Any, dataset: Any, *, timeout: int = 120) -> list[Any]:
    dataset_id = getattr(dataset, "id", None)
    if not dataset_id:
        return []
    return list(client.experiments.list(dataset_id=dataset_id, timeout=timeout) or [])


def _delete_dataset_experiments(client: Any, experiments: Sequence[Any]) -> list[str]:
    deleted: list[str] = []
    for experiment in experiments:
        experiment_id = _experiment_id(experiment)
        if not experiment_id:
            continue
        client.experiments.delete(experiment_id=experiment_id)
        deleted.append(experiment_id)
    return deleted


def _experiment_urls(
    client: Any,
    dataset_id: str | None,
    experiment_id: str | None,
) -> tuple[str | None, str | None]:
    if not dataset_id or not experiment_id:
        return None, None
    experiment_url_fn = getattr(client.experiments, "get_experiment_url", None)
    dataset_url_fn = getattr(client.experiments, "get_dataset_experiments_url", None)
    experiment_url = (
        experiment_url_fn(dataset_id, experiment_id) if callable(experiment_url_fn) else None
    )
    dataset_experiments_url = dataset_url_fn(dataset_id) if callable(dataset_url_fn) else None
    return experiment_url, dataset_experiments_url


def _validate_frozen_starter_rows(rows: Sequence[Mapping[str, Any]]) -> str | None:
    if len(rows) != FROZEN_STARTER_ROW_COUNT:
        return (
            f"{STARTER_DATASET_NAME} build requires exactly {FROZEN_STARTER_ROW_COUNT} rows; "
            f"got {len(rows)}"
        )
    variants = tuple(
        str((row.get("metadata") or {}).get("starter_variant") or "")
        for row in rows
    )
    if variants != STARTER_VARIANTS:
        return (
            f"{STARTER_DATASET_NAME} build requires variants {list(STARTER_VARIANTS)}; "
            f"got {list(variants)}"
        )
    return None


def _starter_dataset_response(
    dataset: Any,
    *,
    pushed: bool,
    dataset_action: str,
    examples_added: int,
    experiments: Sequence[Any],
    experiment_id: str | None = None,
    experiment_url: str | None = None,
    dataset_experiments_url: str | None = None,
    evaluation_upload: Mapping[str, Any] | None = None,
    ran: Any = None,
    deleted_experiment_ids: Sequence[str] = (),
) -> dict[str, Any]:
    dataset_id = getattr(dataset, "id", None)
    if experiment_id is None and experiments:
        experiment_id = _experiment_id(experiments[0]) or None
    return {
        "pushed": pushed,
        "dataset_action": dataset_action,
        "examples_added": examples_added,
        "dataset_name": getattr(dataset, "name", STARTER_DATASET_NAME),
        "dataset_id": dataset_id,
        "dataset_example_count": _dataset_example_count(dataset),
        "experiment_count": len(experiments),
        "experiment_id": experiment_id,
        "experiment_url": experiment_url,
        "dataset_experiments_url": dataset_experiments_url,
        "evaluation_upload": dict(evaluation_upload) if evaluation_upload is not None else None,
        "ran": json_safe(dict(ran) if isinstance(ran, Mapping) else ran),
        "frozen": pushed and len(experiments) == FROZEN_STARTER_EXPERIMENT_COUNT,
        "deleted_experiment_ids": list(deleted_experiment_ids),
    }


def _push_frozen_starter_to_phoenix(
    client: Any,
    rows: Sequence[Mapping[str, Any]],
    *,
    dataset_description: str,
    experiment_name: str | None,
) -> dict[str, Any]:
    validation_error = _validate_frozen_starter_rows(rows)
    if validation_error:
        return {"pushed": False, "error": validation_error}

    examples = _examples_from_rows(
        rows,
        stable_example_ids=True,
        dataset_name=STARTER_DATASET_NAME,
    )
    dataset = None
    dataset_action = "frozen"
    examples_added = 0
    existing_experiments: list[Any] = []
    try:
        dataset = client.datasets.get_dataset(dataset=STARTER_DATASET_NAME, timeout=120)
    except Exception:
        dataset = client.datasets.create_dataset(
            name=STARTER_DATASET_NAME,
            examples=examples,
            example_id_key="example_id",
            dataset_description=dataset_description,
            timeout=120,
        )
        dataset_action = "created"
        examples_added = len(examples)
        existing_experiments = _list_dataset_experiments(client, dataset, timeout=120)
    else:
        existing_experiments = _list_dataset_experiments(client, dataset, timeout=120)
        if (
            _dataset_example_count(dataset) == FROZEN_STARTER_ROW_COUNT
            and len(existing_experiments) == FROZEN_STARTER_EXPERIMENT_COUNT
        ):
            dataset_id = getattr(dataset, "id", None)
            experiment_id = _experiment_id(existing_experiments[0])
            experiment_url, dataset_experiments_url = _experiment_urls(
                client,
                dataset_id,
                experiment_id,
            )
            evaluation_upload = _frozen_experiment_evaluation_status(
                client,
                experiment_id,
                row_count=FROZEN_STARTER_ROW_COUNT,
                expected_example_ids=_dataset_example_ids(dataset),
                timeout=120,
            )
            if evaluation_upload.get("complete"):
                return _starter_dataset_response(
                    dataset,
                    pushed=True,
                    dataset_action="frozen",
                    examples_added=0,
                    experiments=existing_experiments,
                    experiment_id=experiment_id,
                    experiment_url=experiment_url,
                    dataset_experiments_url=dataset_experiments_url,
                    evaluation_upload=evaluation_upload,
                )
            # Incomplete evaluations: fall through to delete and rerun the
            # experiment so the starter can self-repair. The frozen dataset
            # examples themselves are never rewritten (count already matches).
        if _dataset_example_count(dataset) != FROZEN_STARTER_ROW_COUNT:
            dataset = client.datasets.create_dataset(
                name=STARTER_DATASET_NAME,
                examples=examples,
                example_id_key="example_id",
                dataset_description=dataset_description,
                timeout=120,
            )
            dataset_action = "repaired"
            examples_added = len(examples)
            existing_experiments = _list_dataset_experiments(client, dataset, timeout=120)

    deleted_experiment_ids: list[str] = []
    if existing_experiments:
        deleted_experiment_ids = _delete_dataset_experiments(client, existing_experiments)

    ran = client.experiments.run_experiment(
        dataset=dataset,
        task=make_score_task(rows),
        evaluators=make_evaluators(),
        experiment_name=experiment_name or FROZEN_STARTER_EXPERIMENT_NAME,
        experiment_description=dataset_description,
        experiment_metadata={
            "surface": rows[0]["metadata"].get("surface"),
            "mode": "usage-starter-frozen",
            "dataset_name": STARTER_DATASET_NAME,
            "suite_version": rows[0]["metadata"].get("suite_version"),
            "row_count": FROZEN_STARTER_ROW_COUNT,
            "current_batch_row_count": len(rows),
            "description": dataset_description,
            "frozen": True,
        },
        print_summary=True,
        timeout=120,
        retries=1,
    )
    experiment_id = _result_get(ran, "experiment_id")
    task_runs = list(_result_get(ran, "task_runs", []) or [])
    if experiment_id and task_runs:
        example_metadata_by_id = _dataset_example_metadata_by_id(dataset)
        if not example_metadata_by_id:
            example_metadata_by_id = {
                str(row.get("metadata", {}).get("session_key")): row.get("metadata", {})
                for row in rows
                if row.get("metadata", {}).get("session_key")
            }
        evaluation_upload = ensure_precomputed_evaluations(
            client,
            experiment_id=experiment_id,
            task_runs=task_runs,
            evaluator_names=USAGE_EVALUATORS,
            example_metadata_by_id=example_metadata_by_id,
            timeout=120,
        )
    else:
        # An experiment with no task runs never evaluated anything — not a
        # complete starter push (mirrors the live-batch bool(task_runs) guard).
        evaluation_upload = {
            "expected": 0,
            "annotation_count_before": 0,
            "annotation_count_after": 0,
            "uploaded": 0,
            "complete": False,
            "errors": [],
        }

    experiments = _list_dataset_experiments(client, dataset, timeout=120)
    if experiment_id and not experiments:
        experiments = [{"id": experiment_id}]
    dataset_id = getattr(dataset, "id", None)
    experiment_url, dataset_experiments_url = _experiment_urls(client, dataset_id, experiment_id)
    pushed = (
        bool(experiment_id)
        and bool(task_runs)
        and bool(evaluation_upload.get("complete"))
        and _dataset_example_count(dataset) == FROZEN_STARTER_ROW_COUNT
        and len(experiments) == FROZEN_STARTER_EXPERIMENT_COUNT
    )
    return _starter_dataset_response(
        dataset,
        pushed=pushed,
        dataset_action=dataset_action,
        examples_added=examples_added,
        experiments=experiments,
        experiment_id=experiment_id,
        experiment_url=experiment_url,
        dataset_experiments_url=dataset_experiments_url,
        evaluation_upload=evaluation_upload,
        ran=ran,
        deleted_experiment_ids=deleted_experiment_ids,
    )


def default_experiment_name(
    rows: Sequence[Mapping[str, Any]],
    *,
    dataset_name: str = DEFAULT_DATASET_NAME,
) -> str:
    date = datetime.now(timezone.utc).date().isoformat()
    if dataset_name == STARTER_DATASET_NAME:
        return f"cmux-usage-starter | {len(rows)} curated sessions | {date}"
    return f"cmux-usage | {len(rows)} real sessions | {date}"


def push_to_phoenix(
    batch: Mapping[str, Any],
    *,
    base_url: str = DEFAULT_PHOENIX_BASE_URL,
    dataset_name: str = DEFAULT_DATASET_NAME,
    experiment_name: str | None = DEFAULT_EXPERIMENT_NAME,
) -> dict[str, Any]:
    try:
        from phoenix.client import Client
    except Exception as exc:
        return {"pushed": False, "error": f"phoenix client import failed: {exc}"}

    rows = list(batch.get("rows") or [])
    if not rows:
        return {"pushed": False, "error": "no rows to push"}

    try:
        client = Client(base_url=base_url)
        is_starter_dataset = dataset_name == STARTER_DATASET_NAME
        dataset_description = str(
            (batch.get("dataset") or {}).get("description") or DEFAULT_EXPERIMENT_DESCRIPTION
        )
        if is_starter_dataset:
            return _push_frozen_starter_to_phoenix(
                client,
                rows,
                dataset_description=dataset_description,
                experiment_name=experiment_name,
            )
        examples = _examples_from_rows(
            rows,
            dataset_name=dataset_name,
        )
        dataset, dataset_action, examples_added = _create_or_update_dataset(
            client,
            dataset_name,
            examples,
            dataset_description=dataset_description,
        )
        ran = client.experiments.run_experiment(
            dataset=dataset,
            task=make_score_task(rows),
            evaluators=make_evaluators(),
            experiment_name=experiment_name or default_experiment_name(rows, dataset_name=dataset_name),
            experiment_description=dataset_description,
            experiment_metadata={
                "surface": rows[0]["metadata"].get("surface"),
                "mode": "usage",
                "dataset_name": dataset_name,
                "suite_version": rows[0]["metadata"].get("suite_version"),
                "row_count": len(getattr(dataset, "examples", []) or rows),
                "current_batch_row_count": len(rows),
                "description": dataset_description,
            },
            print_summary=True,
            timeout=120,
            retries=1,
        )
        experiment_id = _result_get(ran, "experiment_id")
        task_runs = list(_result_get(ran, "task_runs", []) or [])
        evaluation_upload = None
        if experiment_id:
            example_metadata_by_id = _dataset_example_metadata_by_id(dataset)
            if not example_metadata_by_id and rows:
                example_metadata_by_id = {
                    str(row.get("metadata", {}).get("session_key")): row.get("metadata", {})
                    for row in rows
                    if row.get("metadata", {}).get("session_key")
                }
            evaluation_upload = ensure_precomputed_evaluations(
                client,
                experiment_id=experiment_id,
                task_runs=task_runs,
                evaluator_names=USAGE_EVALUATORS,
                example_metadata_by_id=example_metadata_by_id,
                timeout=120,
            )
        dataset_id = getattr(dataset, "id", None)
        experiment_url = None
        dataset_experiments_url = None
        if dataset_id and experiment_id:
            experiment_url = client.experiments.get_experiment_url(dataset_id, experiment_id)
            dataset_experiments_url = client.experiments.get_dataset_experiments_url(dataset_id)
        push_complete = bool(experiment_id) and bool(task_runs) and (
            evaluation_upload is None or bool(evaluation_upload.get("complete"))
        )
        return {
            "pushed": push_complete,
            "dataset_action": dataset_action,
            "examples_added": examples_added,
            "dataset_name": getattr(dataset, "name", dataset_name),
            "dataset_id": dataset_id,
            "dataset_example_count": len(getattr(dataset, "examples", []) or []),
            "experiment_id": experiment_id,
            "experiment_url": experiment_url,
            "dataset_experiments_url": dataset_experiments_url,
            "evaluation_upload": evaluation_upload,
            "ran": json_safe(dict(ran) if isinstance(ran, Mapping) else ran),
        }
    except Exception as exc:
        return {"pushed": False, "error": f"phoenix push failed: {type(exc).__name__}: {exc}"}


def _write_json(path: str, payload: Mapping[str, Any]) -> None:
    out = Path(path).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(json_safe(payload), indent=2, sort_keys=True) + "\n")


def _print_summary(batch: Mapping[str, Any]) -> None:
    payload = {"summary": batch.get("summary")}
    if batch.get("phoenix_push"):
        payload["phoenix_push"] = batch["phoenix_push"]
    print(json.dumps(json_safe(payload), indent=2, sort_keys=True))


def _parse_gold_sequence(value: str | None) -> tuple[str, ...]:
    if not value:
        return DEFAULT_GOLD_SEQUENCE
    parsed = tuple(part.strip() for part in value.split(",") if part.strip())
    return parsed or DEFAULT_GOLD_SEQUENCE


def _run_batch(args: argparse.Namespace) -> int:
    roots = args.find_root or [DEFAULT_FIND_ROOT]
    dataset_name = (
        STARTER_DATASET_NAME
        if args.starter
        else (args.dataset_name or DEFAULT_DATASET_NAME)
    )
    if args.since_last and not args.starter and dataset_name == STARTER_DATASET_NAME:
        # The live feed must never write to the frozen curated starter dataset.
        dataset_name = DEFAULT_DATASET_NAME
    selected: list[SinceLastSession] = []
    cursor: dict[str, float] = {}
    if args.since_last:
        cursor = load_since_last_cursor(args.cursor_path)
        selected = select_since_last_sessions(
            roots,
            cursor=cursor,
            contains=args.contains,
            limit=args.limit,
            idle_min=args.idle_min,
        )
        sources = [item.path for item in selected]
    elif args.starter:
        starter_limit = args.limit if args.limit is not None else STARTER_DEFAULT_LIMIT
        sources = discover_starter_sessions(roots, contains=args.contains, limit=starter_limit)
    else:
        manual_limit = args.limit if args.limit is not None else 20
        sources = discover_sessions(roots, contains=args.contains, limit=manual_limit)

    if not sources:
        if args.since_last:
            batch = {
                "dataset": {"name": dataset_name, "description": DEFAULT_EXPERIMENT_DESCRIPTION},
                "rows": [],
                "evaluator_names": list(USAGE_EVALUATORS),
                "summary": summarize_rows([]),
                "since_last": {
                    "cursor_path": str(Path(args.cursor_path).expanduser()),
                    "selected": [],
                    "cursor_entries": len(cursor),
                    "idle_min": args.idle_min,
                    "pushed": False,
                    "reason": "no idle sessions advanced past cursor with action_count > 0",
                },
            }
            if args.out:
                _write_json(args.out, batch)
            _print_summary(batch)
            return 0
        print("ERROR: no JSONL sessions matched batch lookup", file=sys.stderr)
        return 1

    capture_fn = capture_starter_batch if args.starter else capture_batch
    batch = capture_fn(
        sources,
        surface=args.surface,
        condition=args.condition,
        model_version=args.model_version,
        catalog_context=args.catalog_context,
        suite_version=args.suite_version,
        intent=args.intent,
        gold_call_budget=args.gold_call_budget or None,
        intended_model=args.intended_model,
        dataset_name=dataset_name,
        session_keys={item.path: item.session_key for item in selected} if args.since_last else None,
        gold_sequence=args.gold_sequence,
        gold_sequence_note=args.gold_sequence_note,
    )
    if args.since_last:
        batch["since_last"] = {
            "cursor_path": str(Path(args.cursor_path).expanduser()),
            "selected": _selection_summary(selected),
            "cursor_entries": len(cursor),
            "idle_min": args.idle_min,
        }
    if args.push:
        batch["phoenix_push"] = push_to_phoenix(
            batch,
            base_url=args.phoenix_url,
            dataset_name=dataset_name,
            experiment_name=args.experiment_name,
        )
        if args.since_last and batch["phoenix_push"].get("pushed"):
            updated_cursor = advance_since_last_cursor(cursor, selected)
            write_since_last_cursor(updated_cursor, args.cursor_path)
            batch["since_last"]["cursor_update"] = {
                "updated_entries": len(selected),
                "cursor_entries": len(updated_cursor),
                "cursor": updated_cursor,
            }
        elif args.since_last:
            batch["since_last"]["cursor_update"] = {
                "updated_entries": 0,
                "reason": "phoenix push did not complete",
            }
    elif args.since_last:
        batch["since_last"]["cursor_update"] = {
            "updated_entries": 0,
            "reason": "dry run without --push",
        }

    if args.out:
        _write_json(args.out, batch)
    _print_summary(batch)
    return 0 if not batch.get("phoenix_push") or batch["phoenix_push"].get("pushed") else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Capture a live cmux usage micro-batch from recent session JSONLs."
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Maximum sessions to score. Manual mode defaults to 20; --since-last is uncapped unless this is set.",
    )
    parser.add_argument("--find-root", action="append", help="Root for mtime JSONL lookup")
    parser.add_argument("--contains", default=DEFAULT_CONTAINS)
    parser.add_argument(
        "--since-last",
        action="store_true",
        help="Score only idle sessions whose source mtime advanced past the cursor.",
    )
    parser.add_argument(
        "--starter",
        action="store_true",
        help="Build the four-row cmux-usage-starter onboarding dataset from a larger candidate pool.",
    )
    parser.add_argument("--cursor-path", default=DEFAULT_CURSOR_PATH)
    parser.add_argument("--lock-path", default=DEFAULT_LOCK_PATH)
    parser.add_argument("--idle-min", type=float, default=DEFAULT_IDLE_MIN)
    parser.add_argument("--out", help="Write scored batch JSON to this file")
    parser.add_argument("--push", action="store_true", help="Push dataset and experiment to Phoenix")
    parser.add_argument("--phoenix-url", default=DEFAULT_PHOENIX_BASE_URL)
    parser.add_argument("--dataset-name", default=None)
    parser.add_argument("--experiment-name", default=DEFAULT_EXPERIMENT_NAME)
    parser.add_argument("--surface", default=DEFAULT_SURFACE)
    parser.add_argument("--condition", default=DEFAULT_CONDITION)
    parser.add_argument("--model-version", default=DEFAULT_MODEL_VERSION)
    parser.add_argument("--catalog-context", default=DEFAULT_CATALOG_CONTEXT)
    parser.add_argument("--suite-version", default=DEFAULT_SUITE_VERSION)
    parser.add_argument("--intent", default=DEFAULT_INTENT)
    parser.add_argument("--gold-call-budget", type=int, default=0)
    parser.add_argument(
        "--gold-sequence",
        default=",".join(DEFAULT_GOLD_SEQUENCE),
        help="Comma-separated configurable reference sequence; not treated as settled virtue.",
    )
    parser.add_argument("--gold-sequence-note", default=DEFAULT_GOLD_SEQUENCE_NOTE)
    parser.add_argument("--intended-model")
    args = parser.parse_args(argv)
    args.gold_sequence = _parse_gold_sequence(args.gold_sequence)

    if args.since_last and args.starter:
        parser.error("--since-last and --starter are mutually exclusive")

    if args.since_last:
        with since_last_lock(args.lock_path):
            return _run_batch(args)
    return _run_batch(args)


if __name__ == "__main__":
    raise SystemExit(main())

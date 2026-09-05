#!/usr/bin/env python3
"""
cmux_capture — capture cmux usage behavior from worker session JSONL.

Input:  Claude/Codex-style session JSONL.
Output: canonical cmux-action events, locked usage evaluator scores, and a
Phoenix-ready row for dataset cmux-mcp-usage (RGF0YXNldDo0).

The parser intentionally lives beside session-miner.py and reuses its JSONL
walker/categorizer. It does not modify session-miner.py behavior.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shlex
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable


def _load_session_miner_module() -> Any:
    path = Path(__file__).with_name("session-miner.py")
    spec = importlib.util.spec_from_file_location("session_miner", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not load session-miner.py from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


session_miner = _load_session_miner_module()


DEFAULT_PHOENIX_BASE_URL = "http://127.0.0.1:6006"
DEFAULT_DATASET_ID = "RGF0YXNldDo0"
DEFAULT_DATASET_NAME = "cmux-mcp-usage"

BASELINE_TUPLE_KEYS = (
    "surface",
    "mode",
    "condition",
    "model_version",
    "catalog_context",
    "suite_version",
)

ALL_USAGE_EVALUATORS = (
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
PRIMARY_SCORE_COLUMNS = (
    "focus_before_send",
    "executed_not_relayed",
    "model_tier_correct",
    "docked_le2_columns",
)
USAGE_EVALUATORS = (
    *PRIMARY_SCORE_COLUMNS,
    "success",
    "verified_after_action",
    "reenumerated_after_change",
    "routed_by_agent",
    "spawn_discipline",
)
EVALUATOR_DESCRIPTIONS = {
    "focus_before_send": "Agent focused or selected the target surface before sending input.",
    "executed_not_relayed": "Agent actually used cmux tooling instead of only relaying a tool-shaped instruction.",
    "model_tier_correct": "Booted session model tier matches the intended observed model tier.",
    "docked_le2_columns": "Agent kept the workspace docked or verified the layout stayed within two columns.",
    "success": "Session shows a concrete completion signal without failure language.",
    "verified_after_action": "Agent checked the target after taking a cmux action.",
    "reenumerated_after_change": "Agent refreshed surface or agent state after changing cmux topology.",
    "routed_by_agent": "Agent routed through cmux agent primitives when sending to another agent.",
    "spawn_discipline": "Agent waited for readiness before spawning or driving additional agents.",
    "call_economy": "Agent stayed within the configured cmux call budget.",
    "menu_confirmed_before_enter": "Agent read the menu or screen before pressing Enter for menu interactions.",
}

CMUX_PREFIX = "mcp__cmuxlayer__"
SEND_ACTIONS = {"send_command", "send_input", "send_key", "send_to"}
VERIFY_ACTIONS = {"read_screen", "read_agent_output", "wait_for", "wait_for_all"}
LIST_ACTIONS = {"list_surfaces", "list_agents", "my_agents", "list_panes", "identify"}
CHANGE_ACTIONS = {
    "new_surface",
    "new_split",
    "close_surface",
    "move_surface",
    "reorder_surface",
    "spawn_agent",
    "spawn_in_workspace",
    "kill",
    "stop_agent",
}

SURFACE_RE = re.compile(r"\bsurface:\d+\b")
PANE_RE = re.compile(r"\bpane:\d+\b")
WORKSPACE_RE = re.compile(r"\bworkspace:\d+\b")
LAUNCHER_RE = re.compile(
    r"(?:(?<=^)|(?<=[;&\n]))\s*[A-Za-z0-9_-]*(?:Cursor|Codex|Claude)\s+(?:[^\n;&]*\s)?-s(?:\s|$)",
    re.MULTILINE,
)
RELAY_RE = re.compile(r"```(?:json)?[\s\S]*?mcp__cmuxlayer__[\s\S]*?```", re.IGNORECASE)
CMUX_ID_RE = re.compile(r"\b(?:surface|pane|workspace):\d+\b|^agent:[A-Za-z0-9_-]+$")
GITS_SLUG_PATTERN = re.compile(r"^-Users-[^-]+-Gits-")
DOMAIN_LEAD_ALIASES = {
    "brainlayer": "BL",
    "brainlayerclaude": "BL",
    "phoenix": "PHX",
    "phx": "PHX",
    "voicelayer": "VL",
    "voicelayerclaude": "VL",
    "voice": "VL",
    "cmuxlayer": "CMUX",
    "cmuxlayerclaude": "CMUX",
    "golems": "GOLEMS",
    "golemsclaude": "GOLEMS",
    "orchestrator": "ORC",
    "orchestratorclaude": "ORC",
    "skillcreator": "SC",
    "skillcreatorclaude": "SC",
    "skill-creator": "SC",
}


@dataclass
class CmuxAction:
    event_index: int
    timestamp: str
    transport: str
    action: str
    tool_name: str
    tool_use_id: str
    command: str | None = None
    text: str | None = None
    key: str | None = None
    target_surface: str | None = None
    target_pane: str | None = None
    target_workspace: str | None = None
    agent_id: str | None = None
    is_spawn: bool = False
    spawn_shape: str | None = None
    focused: bool = False
    ready_signal: bool = False
    column_count: int | None = None
    raw_input: dict[str, Any] | None = None
    output_excerpt: str | None = None


def load_session_events(src: str) -> tuple[list[tuple[int, dict[str, Any]]], int]:
    return session_miner.load_events(src)


def _safe_json_loads(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return None


def _first_regex(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text or "")
    return match.group(0) if match else None


def _str_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, sort_keys=True)


def _content_text(content: Any, *, include_tool_results: bool = False) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        ctype = item.get("type")
        if ctype in {"text", "input_text", "output_text"}:
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
        elif include_tool_results and ctype == "tool_result":
            body = item.get("content", "")
            if isinstance(body, str):
                parts.append(body)
            elif isinstance(body, list):
                parts.extend(
                    str(part.get("text", ""))
                    for part in body
                    if isinstance(part, dict) and part.get("text")
                )
    return "\n".join(part for part in parts if part)


def _message_role_and_text(obj: dict[str, Any]) -> tuple[str | None, str]:
    if obj.get("type") in {"user", "assistant"}:
        msg = obj.get("message")
        if isinstance(msg, dict):
            role = msg.get("role") or obj.get("type")
            return str(role), _content_text(msg.get("content"))

    payload = obj.get("payload")
    if isinstance(payload, dict) and payload.get("type") == "message":
        role = payload.get("role")
        return str(role) if role else None, _content_text(payload.get("content"))

    return None, ""


def _format_turns(turns: list[tuple[int, str, str]]) -> str:
    rendered: list[str] = []
    for ordinal, (_idx, ts, text) in enumerate(turns, start=1):
        body = (text or "").strip()
        if not body:
            continue
        label = f"turn {ordinal}"
        if ts:
            label = f"{label} @ {ts}"
        rendered.append(f"{label}\n{body}")
    return "\n\n---\n\n".join(rendered)


def extract_session_io(events: list[tuple[int, dict[str, Any]]]) -> dict[str, str]:
    user_turns: list[tuple[int, str, str]] = []
    assistant_turns: list[tuple[int, str, str]] = []
    for idx, obj in events:
        role, text = _message_role_and_text(obj)
        if not text.strip():
            continue
        ts = str(obj.get("timestamp") or "")
        if role == "user":
            user_turns.append((idx, ts, text))
        elif role == "assistant":
            assistant_turns.append((idx, ts, text))
    return {
        "user_input": _format_turns(user_turns),
        "agent_output": _format_turns(assistant_turns),
    }


def extract_boot_prompt(events: list[tuple[int, dict[str, Any]]]) -> str:
    for _idx, obj in events:
        role, text = _message_role_and_text(obj)
        if role == "user" and text.strip():
            return text.strip()
    return ""


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def extract_session_timing(events: list[tuple[int, dict[str, Any]]]) -> dict[str, Any]:
    stamped: list[tuple[str, datetime]] = []
    for _idx, obj in events:
        ts = obj.get("timestamp")
        parsed = _parse_timestamp(ts)
        if parsed is not None and isinstance(ts, str):
            stamped.append((ts, parsed))
    if not stamped:
        return {
            "session_start_ts": None,
            "session_end_ts": None,
            "session_duration_ms": None,
        }
    start_ts, start = stamped[0]
    end_ts, end = stamped[-1]
    duration_ms = max(0, int((end - start).total_seconds() * 1000))
    return {
        "session_start_ts": start_ts,
        "session_end_ts": end_ts,
        "session_duration_ms": duration_ms,
    }


def _is_cmux_id(value: str | None) -> bool:
    return bool(value and CMUX_ID_RE.search(value))


def _session_id_candidates(obj: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    for key in ("sessionId", "session_id", "sessionUUID", "sessionUuid", "conversation_id"):
        value = obj.get(key)
        if value:
            candidates.append(str(value))
    for container_name in ("payload", "message"):
        container = obj.get(container_name)
        if not isinstance(container, dict):
            continue
        for key in ("id", "sessionId", "session_id", "sessionUUID", "sessionUuid"):
            value = container.get(key)
            if value:
                candidates.append(str(value))
    return candidates


def extract_session_id(src: str, events: list[tuple[int, dict[str, Any]]]) -> str:
    for _idx, obj in events:
        for candidate in _session_id_candidates(obj):
            if candidate and not _is_cmux_id(candidate):
                return candidate
    fallback = Path(src).expanduser().stem
    if _is_cmux_id(fallback):
        return re.sub(r"[^A-Za-z0-9_.-]+", "-", fallback).strip("-") or "unknown-session"
    return fallback


def infer_agent_type(src: str, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    path = str(Path(src).expanduser())
    home = str(Path.home())
    if path.startswith(f"{home}/.claude/projects/"):
        return "claude"
    if path.startswith(f"{home}/.codex/sessions/"):
        return "codex"
    if path.startswith(f"{home}/.cursor/"):
        return "cursor"
    return "claude"


def _repo_from_cwd(cwd: str | None) -> str | None:
    if not cwd:
        return None
    name = Path(cwd).expanduser().name
    return name or None


def _repo_from_project_slug(src: str) -> str:
    parent = Path(src).expanduser().parent.name
    match = GITS_SLUG_PATTERN.match(parent)
    if match:
        remainder = parent[match.end() :]
        if remainder and not remainder.startswith("-"):
            return remainder
        parts = [part for part in remainder.split("-") if part]
        return parts[0] if parts else "unknown"
    return parent or "unknown"


def extract_repo(src: str, events: list[tuple[int, dict[str, Any]]]) -> str:
    for _idx, obj in events:
        cwd = obj.get("cwd")
        if cwd:
            repo = _repo_from_cwd(str(cwd))
            if repo:
                return repo
        payload = obj.get("payload")
        if isinstance(payload, dict) and payload.get("cwd"):
            repo = _repo_from_cwd(str(payload.get("cwd")))
            if repo:
                return repo
    return _repo_from_project_slug(src)


def _normalize_domain_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-")
    return cleaned.lower()


def _lead_alias(value: str) -> str:
    key = re.sub(r"[^A-Za-z0-9-]+", "", value).lower()
    return DOMAIN_LEAD_ALIASES.get(key, key.upper() or "LEAD")


def _cli_name(agent_type: str) -> str:
    lookup = {"claude": "Claude", "codex": "Codex", "cursor": "Cursor"}
    return lookup.get(agent_type.lower(), agent_type[:1].upper() + agent_type[1:])


def _launcher_name(repo: str, agent_type: str) -> str:
    compact_repo = re.sub(r"[^A-Za-z0-9]+", "", repo)
    if not compact_repo:
        compact_repo = "agent"
    return f"{compact_repo}{_cli_name(agent_type)}"


def _normalize_handle(value: str) -> str:
    value = re.sub(r"\s+", "-", value.strip())
    value = re.sub(r"gen-(\d+)", r"gen\1", value, flags=re.IGNORECASE)
    return re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-")


def normalize_model_display(model: str | None, *, agent_type: str | None = None) -> str:
    if not model:
        return "cursor" if agent_type == "cursor" else "unknown"
    m = model.lower()
    if "opus" in m:
        return "opus"
    if "sonnet" in m:
        return "sonnet"
    if "haiku" in m:
        return "haiku"
    if "cursor-auto" in m or m == "auto":
        return "cursor/auto"
    match = re.search(r"gpt[-_]?5(?:\.\d+)?", m)
    if match:
        normalized = match.group(0).replace("_", "-")
        return f"{normalized}-codex" if agent_type == "codex" and "codex" not in m else normalized
    if agent_type == "cursor":
        return "cursor"
    return re.sub(r"[^a-z0-9.]+", "-", m).strip("-")


def extract_agent_role(boot_prompt: str) -> str:
    text = boot_prompt or ""
    if re.search(r"\bDOMAIN LEAD\b", text, re.IGNORECASE):
        return "lead"
    if re.search(r"\breporting to\s+orcClaude(?:\s+gen-?\d+)?\b", text, re.IGNORECASE):
        return "lead"
    if re.search(
        r"\b(?:implement|identity-implement|gather)\s+worker\b|"
        r"\breporting to\s+[A-Za-z][A-Za-z0-9_-]*-LEAD\b",
        text,
        re.IGNORECASE,
    ):
        return "worker"
    if re.search(
        r"\bYou are (?:the\s+)?[A-Za-z][A-Za-z0-9_-]*-LEAD\b|\borchestrator\b",
        text,
        re.IGNORECASE,
    ):
        return "lead"
    if re.search(r"\borc\b|orcClaude", text, re.IGNORECASE):
        return "lead"
    return "standalone"


def extract_agent_name(boot_prompt: str, *, repo: str, agent_type: str) -> str:
    text = boot_prompt or ""
    domain = re.search(r"\bthe\s+([A-Za-z][A-Za-z0-9_-]*)\s+DOMAIN LEAD\b", text, re.IGNORECASE)
    if domain:
        return f"{_lead_alias(domain.group(1))}-LEAD"

    self_orc = re.search(
        r"\bYou are (?:the\s+)?orcClaude\s+gen-?(\d+)\b",
        text,
        re.IGNORECASE,
    )
    if self_orc:
        return f"orcClaude-gen{self_orc.group(1)}"

    you_are_lead = re.search(r"\bYou are (?:the\s+)?([A-Za-z][A-Za-z0-9_-]*-LEAD)\b", text, re.IGNORECASE)
    if you_are_lead:
        handle = you_are_lead.group(1)
        prefix = handle[: -len("-LEAD")]
        return f"{_lead_alias(prefix)}-LEAD"

    self_handle = re.search(
        r"\bYou are (?:the\s+)?([A-Za-z][A-Za-z0-9_-]*(?:Claude|Codex|Cursor))\b",
        text,
    )
    if self_handle:
        return _normalize_handle(self_handle.group(1))

    orc = re.search(r"\borcClaude\s+gen-?(\d+)\b", text, re.IGNORECASE)
    if orc:
        return f"orcClaude-gen{orc.group(1)}"

    handle = re.search(r"\b([A-Za-z][A-Za-z0-9_-]*(?:Claude|Codex|Cursor))\b", text)
    if handle:
        return _normalize_handle(handle.group(1))

    return _launcher_name(repo, agent_type)


def _normalize_reporting_target(value: str) -> str:
    target = _normalize_handle(value)
    match = re.search(r"orcClaude-gen?(\d+)", target, re.IGNORECASE)
    if match:
        return f"orcClaude-gen{match.group(1)}"
    lead = re.search(r"([A-Za-z][A-Za-z0-9_-]*)-LEAD", target, re.IGNORECASE)
    if lead:
        return f"{_lead_alias(lead.group(1))}-LEAD"
    return target


def extract_reports_to(boot_prompt: str, *, agent_role: str) -> str:
    text = boot_prompt or ""
    match = re.search(r"\breporting to\s+([A-Za-z][A-Za-z0-9_-]*(?:\s+gen-?\d+)?)", text, re.IGNORECASE)
    if match:
        target = _normalize_reporting_target(match.group(1))
        if target.startswith("orcClaude"):
            return "lead-under-orc"
        return f"worker-of {target}"
    return "standalone"


def extract_task_summary(boot_prompt: str) -> str:
    text = re.sub(r"\s+", " ", (boot_prompt or "").strip())
    if not text:
        return ""
    patterns = (
        r"\bMission:\s*(.+)",
        r"\bTASK:\s*(.+)",
        r"\bYour P0\b[^:]*:\s*(.+)",
        r"\bTOP PRIORITY\s*(?:\([^)]*\))?:\s*(.+)",
        r"\bRead\s+\S+\s+(?:IN FULL\s+)?and execute (?:it )?(?:exactly|now)\s*(?:[:.\-\u2013\u2014]+)?\s*(.+)",
        r"(?:execute it now|go now|your job):\s*(.+)",
        r"(?:execute it now|go now)(?:\s|\.|-|\u2013|\u2014)+(.+)",
        r"Repo:\s*[^.]+[.]\s*(.+)",
    )
    summary = ""
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            summary = match.group(1)
            break
    if not summary:
        stripped = re.sub(r"^You are [^.]+[.]\s*", "", text, flags=re.IGNORECASE)
        summary = stripped if stripped != text else text
    summary = re.split(r"\s+(?:Spawn|COMMS|/pr-loop|Report PR#|Run tests)\b", summary)[0]
    summary = summary.strip(" .")
    if len(summary) > 180:
        summary = summary[:177].rstrip() + "..."
    return summary


def extract_agent_identity(
    src: str,
    events: list[tuple[int, dict[str, Any]]],
    *,
    agent_type: str | None = None,
) -> dict[str, str]:
    resolved_type = infer_agent_type(src, agent_type)
    repo = extract_repo(src, events)
    boot_prompt = extract_boot_prompt(events)
    role = extract_agent_role(boot_prompt)
    name = extract_agent_name(boot_prompt, repo=repo, agent_type=resolved_type)
    return {
        "agent_type": resolved_type,
        "agent_role": role,
        "agent_name": name,
        "repo": repo,
        "reports_to": extract_reports_to(boot_prompt, agent_role=role),
        "task_summary": extract_task_summary(boot_prompt),
    }


def _tool_result_excerpt(result: str, limit: int = 240) -> str | None:
    result = (result or "").strip()
    if not result:
        return None
    return result.replace("\n", " ")[:limit]


def _normalize_action(name: str) -> str:
    if name.startswith(CMUX_PREFIX):
        name = name[len(CMUX_PREFIX) :]
    return name.replace("-", "_")


def _input_field(inp: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in inp and inp[name] not in (None, ""):
            return inp[name]
    return None


def _surface_from(inp: dict[str, Any], result: str = "") -> str | None:
    value = _input_field(inp, "surface", "surface_id", "surface_ref", "target_surface")
    return str(value) if value else _first_regex(SURFACE_RE, result)


def _pane_from(inp: dict[str, Any], result: str = "") -> str | None:
    value = _input_field(inp, "pane", "pane_id", "pane_ref", "target_pane")
    return str(value) if value else _first_regex(PANE_RE, result)


def _workspace_from(inp: dict[str, Any], result: str = "") -> str | None:
    value = _input_field(inp, "workspace", "workspace_id", "workspace_ref", "target_workspace")
    return str(value) if value else _first_regex(WORKSPACE_RE, result)


def _agent_from(inp: dict[str, Any]) -> str | None:
    value = _input_field(inp, "agent_id", "agent", "agent_name", "worker")
    return str(value) if value else None


def _shell_tokens(segment: str) -> list[str]:
    try:
        return shlex.split(segment)
    except ValueError:
        return segment.split()


def _cmux_segments(command: str) -> list[str]:
    segments: list[str] = []
    for part in re.split(r"[;\n]", command or ""):
        stripped = part.strip()
        if stripped.startswith("cmux "):
            segments.append(stripped)
    return segments


def _cli_option(tokens: list[str], option: str) -> str | None:
    if option not in tokens:
        return None
    idx = tokens.index(option)
    if idx + 1 >= len(tokens):
        return None
    return tokens[idx + 1]


def _extract_column_count(result: str) -> int | None:
    text = result or ""
    match = re.search(r"Distinct column x-positions:\s*(\d+)", text)
    if match:
        return int(match.group(1))

    data = _safe_json_loads(text)
    if isinstance(data, dict) and isinstance(data.get("panes"), list):
        xs = set()
        for pane in data["panes"]:
            if not isinstance(pane, dict):
                continue
            frame = pane.get("pixel_frame")
            if isinstance(frame, dict) and "x" in frame:
                try:
                    xs.add(round(float(frame["x"])))
                except Exception:
                    pass
        if xs:
            return len(xs)
    return None


def _is_launcher(command: str) -> bool:
    return bool(LAUNCHER_RE.search(command or ""))


def _make_mcp_action(
    idx: int,
    ts: str,
    name: str,
    inp: dict[str, Any],
    tool_use_id: str,
    result: str,
    previous_action: CmuxAction | None,
) -> CmuxAction | None:
    if not name.startswith(CMUX_PREFIX):
        return None

    action = _normalize_action(name)
    if action == "send_to_agent":
        action = "send_to"

    command = _str_value(_input_field(inp, "command"))
    text = _str_value(_input_field(inp, "text", "input", "message"))
    key = _str_value(_input_field(inp, "key", "keys"))
    result_for_target = "" if action in {"list_surfaces", "list_agents", "my_agents"} else result
    target_surface = _surface_from(inp, result_for_target)
    target_pane = _pane_from(inp, result_for_target)
    target_workspace = _workspace_from(inp, result_for_target)
    is_spawn = action in {"spawn_agent", "spawn_in_workspace"}
    spawn_shape = action if is_spawn else None

    if action == "send_command" and _is_launcher(command):
        is_spawn = True
        spawn_shape = "new_split_send_command" if previous_action and previous_action.action == "new_split" else "raw_launcher"

    return CmuxAction(
        event_index=idx,
        timestamp=ts,
        transport="mcp_tool",
        action=action,
        tool_name=name,
        tool_use_id=tool_use_id,
        command=command or None,
        text=text or None,
        key=key or None,
        target_surface=target_surface,
        target_pane=target_pane,
        target_workspace=target_workspace,
        agent_id=_agent_from(inp),
        is_spawn=is_spawn,
        spawn_shape=spawn_shape,
        focused=bool(inp.get("focus") or inp.get("focused")),
        ready_signal=action in {"wait_for", "wait_for_all"},
        column_count=_extract_column_count(result),
        raw_input=inp,
        output_excerpt=_tool_result_excerpt(result),
    )


def _make_bash_cmux_action(
    idx: int,
    ts: str,
    inp: dict[str, Any],
    tool_use_id: str,
    result: str,
) -> CmuxAction | None:
    command = _str_value(inp.get("command"))
    segments = _cmux_segments(command)
    if not segments:
        if _is_launcher(command):
            return CmuxAction(
                event_index=idx,
                timestamp=ts,
                transport="bash_launcher",
                action="spawn_agent",
                tool_name="Bash",
                tool_use_id=tool_use_id,
                command=command,
                target_surface=_first_regex(SURFACE_RE, result),
                target_pane=_first_regex(PANE_RE, result),
                target_workspace=_first_regex(WORKSPACE_RE, result),
                is_spawn=True,
                spawn_shape="raw_launcher",
                raw_input=inp,
                output_excerpt=_tool_result_excerpt(result),
            )
        return None

    segment = segments[0]
    tokens = _shell_tokens(segment)
    cli_action = tokens[1] if len(tokens) > 1 else "unknown"
    action = _normalize_action(cli_action)
    target_result = "" if action in {"list_panes", "list_surfaces", "list_agents"} else result
    target_pane = _cli_option(tokens, "--pane") or _first_regex(PANE_RE, target_result)
    target_surface = _cli_option(tokens, "--surface") or _first_regex(SURFACE_RE, target_result)
    target_workspace = _cli_option(tokens, "--workspace") or _first_regex(WORKSPACE_RE, target_result)
    focused = "--focus" in tokens and (_cli_option(tokens, "--focus") or "true").lower() != "false"

    return CmuxAction(
        event_index=idx,
        timestamp=ts,
        transport="bash_cli",
        action=action,
        tool_name="Bash",
        tool_use_id=tool_use_id,
        command=command,
        target_surface=target_surface,
        target_pane=target_pane,
        target_workspace=target_workspace,
        is_spawn=_is_launcher(command),
        spawn_shape="raw_launcher" if _is_launcher(command) else None,
        focused=focused,
        column_count=_extract_column_count(result),
        raw_input=inp,
        output_excerpt=_tool_result_excerpt(result),
    )


def extract_cmux_actions(
    events: list[tuple[int, dict[str, Any]]],
    tool_calls: list[tuple[int, str, str, dict[str, Any], str]],
    tool_results: dict[str, str],
) -> list[CmuxAction]:
    actions: list[CmuxAction] = []
    previous: CmuxAction | None = None
    for idx, ts, name, inp, tool_use_id in tool_calls:
        result = tool_results.get(tool_use_id, "")
        action: CmuxAction | None = None
        if name.startswith(CMUX_PREFIX):
            action = _make_mcp_action(idx, ts, name, inp or {}, tool_use_id, result, previous)
        elif name == "Bash":
            action = _make_bash_cmux_action(idx, ts, inp or {}, tool_use_id, result)
        if action is not None:
            actions.append(action)
            previous = action
    return actions


def _assistant_models(events: list[tuple[int, dict[str, Any]]]) -> list[tuple[int, str]]:
    models: list[tuple[int, str]] = []
    for idx, obj in events:
        if obj.get("type") != "assistant":
            continue
        msg = obj.get("message")
        if isinstance(msg, dict):
            model = msg.get("model")
            if model:
                models.append((idx, str(model)))
        model = obj.get("model")
        if model:
            models.append((idx, str(model)))
    return models


def extract_booted_model(events: list[tuple[int, dict[str, Any]]]) -> tuple[str | None, int | None]:
    models = _assistant_models(events)
    if not models:
        return None, None
    idx, model = models[0]
    return model, idx


def _normalize_model_tier(model: str | None) -> str | None:
    if not model:
        return None
    m = model.lower()
    if "opus" in m:
        return "opus"
    if "sonnet" in m:
        return "sonnet"
    if "haiku" in m:
        return "haiku"
    match = re.search(r"gpt[-_]?5(?:\.\d+)?", m)
    if match:
        return match.group(0).replace("_", "-")
    if "cursor-auto" in m or m == "auto":
        return "cursor-auto"
    return re.sub(r"[^a-z0-9.]+", "-", m).strip("-")


def _relay_indices(assistant_texts: list[tuple[int, str, str]]) -> list[int]:
    return [idx for idx, _ts, text in assistant_texts if RELAY_RE.search(text or "")]


def _all_session_text(events: list[tuple[int, dict[str, Any]]]) -> str:
    return "\n".join(json.dumps(obj, sort_keys=True) for _idx, obj in events)


def _first_action(actions: list[CmuxAction], predicate: Callable[[CmuxAction], bool]) -> CmuxAction | None:
    return next((action for action in actions if predicate(action)), None)


def _actions_before(actions: list[CmuxAction], event_index: int) -> list[CmuxAction]:
    return [action for action in actions if action.event_index < event_index]


def _is_focus_action(action: CmuxAction) -> bool:
    if action.focused:
        return True
    return action.action in {"focus", "select_surface", "select_workspace", "interact"}


def _same_target(focus: CmuxAction, send: CmuxAction) -> bool:
    if focus.target_surface and send.target_surface:
        return focus.target_surface == send.target_surface
    if focus.target_pane and send.target_pane:
        return focus.target_pane == send.target_pane
    return True


def _done_index(assistant_texts: list[tuple[int, str, str]], after_idx: int) -> int | None:
    for idx, _ts, text in assistant_texts:
        if idx <= after_idx:
            continue
        if re.search(r"\b(done|confirmed|complete|task_done|claude_counter)\b", text or "", re.IGNORECASE):
            return idx
    return None


def _has_failure_language(events: list[tuple[int, dict[str, Any]]]) -> bool:
    text = _all_session_text(events).lower()
    if "spawn_rate_limited" in text:
        return True
    return bool(re.search(r"\b(give ?up|gave up|cannot complete|failed to|fatal error)\b", text))


def _ready_after_first_spawn(actions: list[CmuxAction], first_spawn: CmuxAction) -> CmuxAction | None:
    for action in actions:
        if action.event_index <= first_spawn.event_index:
            continue
        if action.ready_signal or action.action in {"wait_for", "wait_for_all", "read_screen", "read_agent_output", "list_agents"}:
            text = (action.output_excerpt or "").lower()
            if not text or any(token in text for token in ("ready", "idle", "done", "ok", "status")):
                return action
    return None


def score_usage(
    *,
    events: list[tuple[int, dict[str, Any]]],
    actions: list[CmuxAction],
    assistant_texts: list[tuple[int, str, str]],
    booted_model: str | None,
    booted_model_event_index: int | None,
    intended_model: str | None,
    model_version: str,
    gold_call_budget: int | None,
) -> tuple[dict[str, int], dict[str, list[int]]]:
    scores: dict[str, int] = {}
    evidence: dict[str, list[int]] = {}

    relays = _relay_indices(assistant_texts)
    scores["executed_not_relayed"] = 1 if actions else 0
    evidence["executed_not_relayed"] = [actions[0].event_index] if actions else []
    if relays and not actions:
        evidence["relay_detected"] = relays

    first_send = _first_action(actions, lambda action: action.action in SEND_ACTIONS and not action.is_spawn)
    if first_send is None:
        scores["focus_before_send"] = 0 if not actions else 1
        evidence["focus_before_send"] = []
    else:
        focus = next(
            (
                action
                for action in reversed(_actions_before(actions, first_send.event_index))
                if _is_focus_action(action) and _same_target(action, first_send)
            ),
            None,
        )
        scores["focus_before_send"] = 1 if focus else 0
        evidence["focus_before_send"] = [focus.event_index] if focus else []

    topology_checks = [action for action in actions if action.column_count is not None]
    dock_action = _first_action(
        actions,
        lambda action: action.action in {"new_surface", "new_split", "spawn_in_workspace"}
        and bool(action.target_pane or action.raw_input and action.raw_input.get("pane_ref")),
    )
    le2_action = next((action for action in topology_checks if (action.column_count or 99) <= 2), None)
    scores["docked_le2_columns"] = 1 if dock_action or le2_action else 0
    evidence["docked_le2_columns"] = [dock_action.event_index] if dock_action else ([le2_action.event_index] if le2_action else [])

    if first_send is None:
        scores["reenumerated_after_change"] = 0 if not actions else 1
        evidence["reenumerated_after_change"] = []
    else:
        list_before_send = next(
            (action for action in actions if action.event_index < first_send.event_index and action.action in LIST_ACTIONS),
            None,
        )
        change_before_send = next(
            (action for action in actions if action.event_index < first_send.event_index and action.action in CHANGE_ACTIONS),
            None,
        )
        list_after_change = None
        if change_before_send:
            list_after_change = next(
                (
                    action
                    for action in actions
                    if change_before_send.event_index < action.event_index < first_send.event_index
                    and action.action in LIST_ACTIONS
                ),
                None,
            )
        # Creating a fresh target and using that returned ref is not stale-ref reuse.
        returned_fresh_target = bool(
            change_before_send
            and change_before_send.target_surface
            and first_send.target_surface == change_before_send.target_surface
        )
        chosen = list_after_change or list_before_send
        scores["reenumerated_after_change"] = 1 if chosen or returned_fresh_target or not change_before_send else 0
        evidence["reenumerated_after_change"] = [chosen.event_index] if chosen else (
            [change_before_send.event_index] if returned_fresh_target and change_before_send else []
        )

    done_idx = _done_index(assistant_texts, first_send.event_index if first_send else -1)
    verify = None
    if first_send:
        verify = next(
            (
                action
                for action in actions
                if action.event_index > first_send.event_index
                and action.action in VERIFY_ACTIONS
                and (done_idx is None or action.event_index < done_idx)
            ),
            None,
        )
    scores["verified_after_action"] = 1 if verify else 0
    evidence["verified_after_action"] = [verify.event_index] if verify else []

    menu_trigger_idx = None
    for idx, _ts, text in assistant_texts:
        if "/mcp" in (text or "") or "/model" in (text or ""):
            menu_trigger_idx = idx
            break
    enter = _first_action(
        actions,
        lambda action: action.action == "send_key"
        and (action.key or "").lower() in {"enter", "return"}
        and (menu_trigger_idx is None or action.event_index > menu_trigger_idx),
    )
    if enter is None:
        scores["menu_confirmed_before_enter"] = 1
        evidence["menu_confirmed_before_enter"] = []
    else:
        read = next(
            (
                action
                for action in actions
                if action.action == "read_screen"
                and (menu_trigger_idx is None or action.event_index > menu_trigger_idx)
                and action.event_index < enter.event_index
            ),
            None,
        )
        scores["menu_confirmed_before_enter"] = 1 if read else 0
        evidence["menu_confirmed_before_enter"] = [read.event_index] if read else [enter.event_index]

    send_to = _first_action(actions, lambda action: action.action == "send_to")
    list_agents = _first_action(actions, lambda action: action.action == "list_agents")
    if send_to:
        scores["routed_by_agent"] = 1 if list_agents is None or list_agents.event_index < send_to.event_index else 0
        evidence["routed_by_agent"] = [send_to.event_index]
    else:
        scores["routed_by_agent"] = 1
        evidence["routed_by_agent"] = []

    intended = intended_model or model_version
    actual_tier = _normalize_model_tier(booted_model)
    intended_tier = _normalize_model_tier(intended)
    if actual_tier and intended_tier:
        scores["model_tier_correct"] = 1 if actual_tier == intended_tier else 0
    elif intended_tier:
        scores["model_tier_correct"] = 0
    else:
        scores["model_tier_correct"] = 1
    evidence["model_tier_correct"] = [booted_model_event_index] if booted_model_event_index is not None else []

    rate_limited_indices = [idx for idx, obj in events if "SPAWN_RATE_LIMITED" in json.dumps(obj)]
    spawns = [action for action in actions if action.is_spawn]
    if rate_limited_indices:
        scores["spawn_discipline"] = 0
        evidence["spawn_discipline"] = rate_limited_indices
    elif len(spawns) < 2:
        scores["spawn_discipline"] = 1
        evidence["spawn_discipline"] = [spawns[0].event_index] if spawns else []
    else:
        first_spawn = spawns[0]
        ready = _ready_after_first_spawn(actions, first_spawn)
        second_spawn = spawns[1]
        if ready is None or second_spawn.event_index < ready.event_index:
            scores["spawn_discipline"] = 0
            evidence["spawn_discipline"] = [first_spawn.event_index, second_spawn.event_index]
        else:
            scores["spawn_discipline"] = 1
            evidence["spawn_discipline"] = [first_spawn.event_index, ready.event_index, second_spawn.event_index]

    actual_calls = len(actions)
    if gold_call_budget is None or gold_call_budget <= 0:
        scores["call_economy"] = 1
    else:
        scores["call_economy"] = 1 if actual_calls <= gold_call_budget else 0
    evidence["call_economy"] = [action.event_index for action in actions]

    success_action = next(
        (
            action
            for action in actions
            if "harness-ok" in ((action.output_excerpt or "") + " " + (action.command or ""))
        ),
        None,
    )
    text_done = done_idx is not None
    scores["success"] = 1 if actions and not _has_failure_language(events) and (success_action or text_done) else 0
    if success_action:
        evidence["success"] = [success_action.event_index]
    elif done_idx is not None:
        evidence["success"] = [done_idx]
    else:
        evidence["success"] = []

    return scores, evidence


def _to_action_dicts(actions: list[CmuxAction]) -> list[dict[str, Any]]:
    return [asdict(action) for action in actions]


def _cmux_ids(actions: list[CmuxAction]) -> list[str]:
    ids: set[str] = set()
    for action in actions:
        for value in (
            action.target_surface,
            action.target_pane,
            action.target_workspace,
            action.agent_id,
        ):
            if value and _is_cmux_id(value):
                ids.add(value)
    return sorted(ids)


def _cmux_id_candidates_from_events(events: list[tuple[int, dict[str, Any]]]) -> list[str]:
    ids: set[str] = set()
    for _idx, obj in events:
        for candidate in _session_id_candidates(obj):
            if _is_cmux_id(candidate):
                ids.add(candidate)
    return sorted(ids)


def _details_blob(
    *,
    src: str,
    case_id: str,
    session_id: str,
    actions: list[CmuxAction],
    events: list[tuple[int, dict[str, Any]]],
) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "jsonl_id": Path(src).expanduser().stem,
        "source": str(src),
        "case_id": case_id,
        "cmux_ids": sorted(set(_cmux_ids(actions) + _cmux_id_candidates_from_events(events))),
    }


def _score_metadata(scores: dict[str, int], evidence: dict[str, list[int]]) -> dict[str, Any]:
    return {
        "scores": dict(scores),
        "evidence": dict(evidence),
        **{f"score_{name}": int(scores.get(name, 0)) for name in ALL_USAGE_EVALUATORS},
    }


def _experiment_metadata(
    *,
    surface: str,
    condition: str,
    model_version: str,
    catalog_context: str,
    suite_version: str,
) -> dict[str, Any]:
    return {
        "surface": surface,
        "mode": "usage",
        "condition": condition,
        "model_version": model_version,
        "catalog_context": catalog_context,
        "suite_version": suite_version,
    }


def _phoenix_row(
    *,
    case_id: str,
    intent: str,
    catalog_context: str,
    gold_call_budget: int | None,
    scores: dict[str, int],
    evidence: dict[str, list[int]],
    metadata: dict[str, Any],
    actions: list[CmuxAction],
    input_fields: dict[str, Any] | None = None,
    output_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "input": dict(input_fields or {}),
        "output": {
            "gold_primary": "cmux usage behavior",
            "gold_sequence": ["enumerate", "focus_or_dock", "send", "verify"],
            "gold_call_budget": gold_call_budget,
            "guard": True,
            **(output_fields or {}),
        },
        "metadata": {
            **metadata,
            "case_id": case_id,
            "intent": intent,
            "catalog_context": catalog_context,
            "failure_id": "F1-F9",
            "retro_cite": "angle-methodology.md §2",
            "over_steer_guard": True,
        },
        "prediction": {
            "scores": scores,
            "evidence": evidence,
            "action_count": len(actions),
        },
    }


def capture_usage_run(
    src: str,
    *,
    surface: str,
    condition: str,
    model_version: str,
    catalog_context: str,
    suite_version: str,
    intent: str,
    case_id: str,
    gold_call_budget: int | None = None,
    intended_model: str | None = None,
    agent_type: str | None = None,
) -> dict[str, Any]:
    events, parse_errors = load_session_events(src)
    (
        _user_msgs,
        assistant_texts,
        tool_calls,
        tool_results,
        _queue_ops,
        _sys_events,
    ) = session_miner.categorize(events)

    actions = extract_cmux_actions(events, tool_calls, tool_results)
    booted_model, booted_model_event_index = extract_booted_model(events)
    session_id = extract_session_id(src, events)
    identity = extract_agent_identity(src, events, agent_type=agent_type)
    transcript = extract_session_io(events)
    timing = extract_session_timing(events)
    model_display = normalize_model_display(booted_model, agent_type=identity["agent_type"])
    details = _details_blob(
        src=src,
        case_id=case_id,
        session_id=session_id,
        actions=actions,
        events=events,
    )
    metadata = {
        **_experiment_metadata(
            surface=surface,
            condition=condition,
            model_version=model_version,
            catalog_context=catalog_context,
            suite_version=suite_version,
        ),
        "session_id": session_id,
        "source": str(src),
        "model": model_display,
        **identity,
        **timing,
        "details": details,
    }
    scores, evidence = score_usage(
        events=events,
        actions=actions,
        assistant_texts=assistant_texts,
        booted_model=booted_model,
        booted_model_event_index=booted_model_event_index,
        intended_model=intended_model,
        model_version=model_version,
        gold_call_budget=gold_call_budget,
    )
    metadata.update(_score_metadata(scores, evidence))
    row = _phoenix_row(
        case_id=case_id,
        intent=intent,
        catalog_context=catalog_context,
        gold_call_budget=gold_call_budget,
        scores=scores,
        evidence=evidence,
        metadata=metadata,
        actions=actions,
        input_fields={
            "repo": identity["repo"],
            "agent_name": identity["agent_name"],
            "model": model_display,
            "agent_role": identity["agent_role"],
            "reports_to": identity["reports_to"],
            "task_summary": identity["task_summary"],
            "focus_before_send": scores.get("focus_before_send"),
            "executed_not_relayed": scores.get("executed_not_relayed"),
            "model_tier_correct": scores.get("model_tier_correct"),
            "docked_le2_columns": scores.get("docked_le2_columns"),
            "agent_type": identity["agent_type"],
            "session_duration_ms": timing["session_duration_ms"],
        },
        output_fields={
            "user_input": transcript["user_input"],
            "agent_output": transcript["agent_output"],
        },
    )
    return {
        "source": str(src),
        "parse_errors": parse_errors,
        "dataset": {"name": DEFAULT_DATASET_NAME, "id": DEFAULT_DATASET_ID},
        "session_id": session_id,
        "booted_model": booted_model,
        "user_input": transcript["user_input"],
        "agent_output": transcript["agent_output"],
        "actions": _to_action_dicts(actions),
        "scores": scores,
        "evidence": evidence,
        "metadata": metadata,
        "phoenix_rows": [row],
    }


def find_jsonl_by_mtime(root: str, *, contains: str | None = None) -> list[str]:
    paths = [str(path) for path in Path(root).expanduser().glob("**/*.jsonl") if path.is_file()]
    if contains:
        paths = [path for path in paths if contains in Path(path).read_text(errors="ignore")]
    return sorted(paths, key=lambda path: os.path.getmtime(path), reverse=True)


def _score_evaluator(name: str, result: dict[str, Any]) -> Callable[..., dict[str, Any]]:
    def evaluator(output: dict[str, Any] | None = None, **_kwargs: Any) -> dict[str, Any]:
        payload = output if isinstance(output, dict) else result
        scores = payload.get("scores") or payload.get("prediction", {}).get("scores") or {}
        score = int(scores.get(name, 0))
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


def push_to_phoenix(
    result: dict[str, Any],
    *,
    base_url: str = DEFAULT_PHOENIX_BASE_URL,
    dataset_id: str = DEFAULT_DATASET_ID,
    dataset_name: str = DEFAULT_DATASET_NAME,
    experiment_name: str = "cmux_capture_usage",
) -> dict[str, Any]:
    """Push via the Phoenix client. Run this module with uv + arize-phoenix."""
    try:
        from phoenix.client import Client
    except Exception as exc:
        return {"pushed": False, "error": f"phoenix client import failed: {exc}"}

    try:
        client = Client(base_url=base_url)
        try:
            dataset = client.datasets.get_dataset(dataset=dataset_id)
        except Exception:
            row = result["phoenix_rows"][0]
            dataset = client.datasets.create_dataset(
                name=dataset_name,
                inputs=[row["input"]],
                outputs=[row["output"]],
                metadata=[row["metadata"]],
                dataset_description="cmux MCP usage behavior capture rows",
            )

        evaluator_dict = {name: _score_evaluator(name, result) for name in USAGE_EVALUATORS}

        def task(_example: Any) -> dict[str, Any]:
            return {
                "scores": result["scores"],
                "evidence": result["evidence"],
                "action_count": len(result["actions"]),
                "booted_model": result["booted_model"],
            }

        ran = client.experiments.run_experiment(
            dataset=dataset,
            task=task,
            evaluators=evaluator_dict,
            experiment_name=experiment_name,
            experiment_metadata=result["metadata"],
            print_summary=False,
        )
        return {
            "pushed": True,
            "experiment": str(getattr(ran, "experiment", ran)),
            "dataset_id": dataset_id,
        }
    except Exception as exc:
        return {"pushed": False, "error": f"phoenix push failed: {type(exc).__name__}: {exc}"}


def _write_json(path: str, payload: dict[str, Any]) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Capture cmux usage evaluators from session JSONL.")
    parser.add_argument("--src", help="Session JSONL path")
    parser.add_argument("--find-root", default="~/.claude/projects", help="Root for mtime JSONL lookup")
    parser.add_argument("--contains", help="Only consider JSONL files containing this text")
    parser.add_argument("--out", help="Write scored row JSON to this file")
    parser.add_argument("--push", action="store_true", help="Push to Phoenix via arize-phoenix client")
    parser.add_argument("--phoenix-url", default=DEFAULT_PHOENIX_BASE_URL)
    parser.add_argument("--dataset-id", default=DEFAULT_DATASET_ID)
    parser.add_argument("--dataset-name", default=DEFAULT_DATASET_NAME)
    parser.add_argument("--experiment-name", default="cmux_capture_usage")
    parser.add_argument("--surface", default="cmux-mcp")
    parser.add_argument("--condition", default="baseline_live")
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--catalog-context", default="full-fleet-live")
    parser.add_argument("--suite-version", default="cmux-v1")
    parser.add_argument("--intent", default="cmux usage baseline")
    parser.add_argument("--case-id", default="cmux-usage-capture")
    parser.add_argument("--gold-call-budget", type=int, default=0)
    parser.add_argument("--intended-model")
    args = parser.parse_args(argv)

    src = args.src
    if not src:
        matches = find_jsonl_by_mtime(args.find_root, contains=args.contains)
        if not matches:
            print("ERROR: no JSONL sessions matched mtime lookup", file=sys.stderr)
            return 1
        src = matches[0]

    result = capture_usage_run(
        src,
        surface=args.surface,
        condition=args.condition,
        model_version=args.model_version,
        catalog_context=args.catalog_context,
        suite_version=args.suite_version,
        intent=args.intent,
        case_id=args.case_id,
        gold_call_budget=args.gold_call_budget or None,
        intended_model=args.intended_model,
    )

    if args.push:
        result["phoenix_push"] = push_to_phoenix(
            result,
            base_url=args.phoenix_url,
            dataset_id=args.dataset_id,
            dataset_name=args.dataset_name,
            experiment_name=args.experiment_name,
        )

    if args.out:
        _write_json(args.out, result)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

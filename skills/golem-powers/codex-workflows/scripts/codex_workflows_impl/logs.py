"""Logs operations for headless Codex workflows."""

from __future__ import annotations

from pathlib import Path
from typing import Any
import json

from .config import DEGRADED_MODE, PR_URL_RE


def write_log_header(path: Path | str, metadata: dict[str, Any]) -> int:
    log_path = Path(path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fields = " ".join(f"{key}={value}" for key, value in sorted(metadata.items()))
    lines = [
        "# codex-workflows",
        f"# {fields}",
        f"# degraded_mode={','.join(DEGRADED_MODE)}",
    ]
    log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return log_path.stat().st_size


def _recognized_event(event: dict[str, Any]) -> bool:
    event_type = event.get("type")
    if event_type == "thread.started":
        return isinstance(event.get("thread_id"), str)
    if event_type == "turn.started":
        return True
    if event_type in {"item.started", "item.completed"}:
        item = event.get("item")
        return (
            isinstance(item, dict)
            and isinstance(item.get("id"), str)
            and isinstance(item.get("type"), str)
        )
    if event_type in {"turn.completed", "turn.failed", "error"}:
        return True
    return False


def parse_finished_log(path: Path | str) -> dict[str, Any]:
    """Parse a completed Codex JSONL log without trusting tool-output prose."""
    assistant_messages: list[str] = []
    failure_signatures: list[str] = []
    output_tokens = 0
    parser_error: str | None = None
    codex_activity = False

    for line_number, raw_line in enumerate(
        Path(path).read_text(encoding="utf-8", errors="replace").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            parser_error = f"line {line_number}: {exc.msg}"
            continue
        if not isinstance(event, dict) or not _recognized_event(event):
            continue
        codex_activity = True
        event_type = event.get("type")
        if event_type == "item.completed":
            item = event.get("item", {})
            if item.get("type") == "agent_message" and isinstance(item.get("text"), str):
                assistant_messages.append(item["text"])
        elif event_type == "turn.completed":
            usage = event.get("usage")
            if isinstance(usage, dict) and isinstance(usage.get("output_tokens"), int):
                output_tokens = usage["output_tokens"]
        elif event_type in {"turn.failed", "error"}:
            detail = event.get("message") or event.get("error") or event
            failure_signatures.append(str(detail))

    task_done = any(
        line == "TASK_DONE"
        for message in assistant_messages
        for line in message.splitlines()
    )
    pr_urls: list[str] = []
    for message in assistant_messages:
        for url in PR_URL_RE.findall(message):
            if url not in pr_urls:
                pr_urls.append(url)

    return {
        "assistant_messages": assistant_messages,
        "assistant_result": assistant_messages[-1] if assistant_messages else "",
        "task_done": task_done,
        "pr_urls": pr_urls,
        "failure_signatures": failure_signatures,
        "output_tokens": output_tokens,
        "parser_error": parser_error,
        "codex_activity": codex_activity,
    }


def _terminal_status(parsed: dict[str, Any]) -> str:
    if parsed["failure_signatures"]:
        return "failed"
    if parsed["parser_error"]:
        return "parser_failed"
    if parsed["task_done"]:
        return "completed"
    return "incomplete"

"""Portable AutoCursor primitives for read-only gather workflows."""

from __future__ import annotations

import json
import os
import selectors
import shutil
import signal
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


DEFAULT_SCHEMA_RETRIES = 2


def _resolve_cursor_agent() -> str:
    """Resolve cursor-agent binary. CURSOR_AGENT=1 is cmux seat pollution: ignore it."""
    env_val = os.environ.get("CURSOR_AGENT", "").strip()
    if env_val and os.path.isfile(env_val) and os.access(env_val, os.X_OK):
        return env_val
    found = shutil.which("cursor-agent")
    if found:
        return found
    raise RuntimeError("cursor-agent not found on PATH")


def _subprocess_env() -> dict[str, str]:
    """Child env for cursor-agent spawns: strip bogus CURSOR_AGENT=1."""
    env = os.environ.copy()
    ca = env.get("CURSOR_AGENT", "")
    if ca and not (os.path.isfile(ca) and os.access(ca, os.X_OK)):
        env.pop("CURSOR_AGENT", None)
    return env


def _log_dir() -> Path:
    root = Path(os.environ.get("AUTOCURSOR_LOG_DIR", ".autocursor-runs"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_label(label: str | None) -> str:
    raw = label or "agent"
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "-" for ch in raw)
    return safe.strip("-") or "agent"


def _command(prompt: str, *, resume: str | None, model: str | None) -> list[str]:
    cmd = [_resolve_cursor_agent(), "-p", "--force", "--approve-mcps", "--output-format", "json"]
    if resume:
        cmd.extend(["--resume", resume])
    if model:
        cmd.extend(["--model", model])
    cmd.append(prompt)
    return cmd


def _spawn_cursor_agent(
    prompt: str,
    timeout: int = 900,
    *,
    label: str | None = None,
    resume: str | None = None,
    model: str | None = None,
    attempt: int = 1,
) -> dict[str, Any]:
    """Spawn cursor-agent and stream stdout NDJSON to disk as lines arrive."""
    started = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    stem = f"{started}-{_safe_label(label)}-attempt{attempt}"
    log_path = _log_dir() / f"{stem}.ndjson"
    stderr_path = _log_dir() / f"{stem}.stderr"
    cmd = _command(prompt, resume=resume, model=model)
    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    deadline = time.monotonic() + timeout
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=_subprocess_env(),
        start_new_session=os.name != "nt",
    )
    assert proc.stdout is not None
    assert proc.stderr is not None
    sel = selectors.DefaultSelector()
    sel.register(proc.stdout, selectors.EVENT_READ, "stdout")
    sel.register(proc.stderr, selectors.EVENT_READ, "stderr")

    status = "ok"
    exit_code: int | None = None
    with log_path.open("a", encoding="utf-8") as out, stderr_path.open("a", encoding="utf-8") as err:
        while sel.get_map():
            if time.monotonic() > deadline:
                status = "timeout"
                _kill_process_group(proc)
                try:
                    rest_out, rest_err = proc.communicate(timeout=1)
                except subprocess.TimeoutExpired:
                    _kill_process_group(proc)
                    rest_out, rest_err = "", ""
                if rest_out:
                    out.write(rest_out)
                    out.flush()
                    stdout_lines.extend(rest_out.splitlines())
                if rest_err:
                    err.write(rest_err)
                    err.flush()
                    stderr_lines.extend(rest_err.splitlines())
                for key in list(sel.get_map().values()):
                    sel.unregister(key.fileobj)
                break

            for key, _ in sel.select(0.05):
                line = key.fileobj.readline()
                if line == "":
                    sel.unregister(key.fileobj)
                    continue
                if key.data == "stdout":
                    out.write(line)
                    out.flush()
                    stdout_lines.append(line.rstrip("\n"))
                else:
                    err.write(line)
                    err.flush()
                    stderr_lines.append(line.rstrip("\n"))

        if status == "ok":
            exit_code = proc.wait()
        else:
            proc.wait()

    return {
        "stdout": "\n".join(stdout_lines),
        "stderr": "\n".join(stderr_lines),
        "exit_code": exit_code,
        "status": status,
        "log_path": str(log_path),
        "stderr_path": str(stderr_path),
    }


def _kill_process_group(proc: subprocess.Popen[str]) -> None:
    if os.name != "nt":
        try:
            os.killpg(proc.pid, signal.SIGKILL)
            return
        except ProcessLookupError:
            return
        except OSError:
            pass
    try:
        proc.kill()
    except ProcessLookupError:
        pass


def _json_events(raw: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            events.append(value)
    if not events and raw.strip():
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            value = None
        if isinstance(value, dict):
            events.append(value)
    return events


def _usage_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _usage_from_events(events: list[dict[str, Any]]) -> dict[str, int]:
    input_tokens = 0
    output_tokens = 0
    for event in events:
        usage = event.get("usage")
        if not isinstance(usage, dict):
            continue
        input_tokens += _usage_int(usage.get("inputTokens") or usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
        output_tokens += _usage_int(
            usage.get("outputTokens") or usage.get("output_tokens") or usage.get("completion_tokens") or 0
        )
    return {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": input_tokens + output_tokens,
    }


def _add_usage(total: dict[str, int], usage: dict[str, int]) -> dict[str, int]:
    total["inputTokens"] += usage.get("inputTokens", 0)
    total["outputTokens"] += usage.get("outputTokens", 0)
    total["totalTokens"] = total["inputTokens"] + total["outputTokens"]
    return total


def _event_text(event: dict[str, Any]) -> str:
    for key in ("text", "content", "result", "response"):
        value = event.get(key)
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            return json.dumps(value)
    message = event.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
            return "\n".join(parts)
    return ""


def _combined_text(events: list[dict[str, Any]], raw: str) -> str:
    parts = [_event_text(event) for event in events]
    text = "\n".join(part for part in parts if part)
    return text or raw


def _chat_id(events: list[dict[str, Any]]) -> str | None:
    for event in events:
        for key in ("chat_id", "chatId", "conversation_id", "conversationId"):
            value = event.get(key)
            if isinstance(value, str) and value:
                return value
    return None


def _json_candidates(events: list[dict[str, Any]], text: str) -> list[Any]:
    candidates: list[Any] = []
    for event in events:
        for key in ("data", "result", "response", "message"):
            value = event.get(key)
            if isinstance(value, dict):
                candidates.append(value)
    for source in [text, *[_event_text(event) for event in events]]:
        source = source.strip()
        if not source:
            continue
        try:
            candidates.append(json.loads(source))
            continue
        except json.JSONDecodeError:
            pass
        start = source.find("{")
        end = source.rfind("}")
        if start != -1 and end > start:
            try:
                candidates.append(json.loads(source[start : end + 1]))
            except json.JSONDecodeError:
                pass
    return candidates


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def _validate_schema(value: Any, schema: dict[str, Any]) -> tuple[bool, str]:
    expected_type = schema.get("type")
    if isinstance(expected_type, str) and not _matches_type(value, expected_type):
        return False, f"expected {expected_type}"
    if isinstance(value, list):
        items_schema = schema.get("items")
        if isinstance(items_schema, dict):
            for idx, item in enumerate(value):
                ok, error = _validate_schema(item, items_schema)
                if not ok:
                    return False, f"item {idx}: {error}"
    if isinstance(value, dict):
        required = schema.get("required", [])
        if isinstance(required, list):
            for key in required:
                if isinstance(key, str) and key not in value:
                    return False, f"missing required key {key}"
        properties = schema.get("properties", {})
        if isinstance(properties, dict):
            for key, prop_schema in properties.items():
                if key in value and isinstance(prop_schema, dict):
                    ok, error = _validate_schema(value[key], prop_schema)
                    if not ok:
                        return False, f"{key}: {error}"
    return True, ""


def _extract_valid_data(events: list[dict[str, Any]], text: str, schema: dict[str, Any]) -> tuple[dict[str, Any], str]:
    for candidate in _json_candidates(events, text):
        ok, error = _validate_schema(candidate, schema)
        if ok and isinstance(candidate, dict):
            return candidate, ""
        if error:
            last_error = error
    return {}, locals().get("last_error", "no JSON object matched schema")


def _schema_prompt(prompt: str, schema: dict[str, Any]) -> str:
    return (
        f"{prompt}\n\n"
        "Emit exactly one JSON object matching this JSON schema. "
        "Do not wrap it in Markdown or include explanatory prose.\n"
        f"{json.dumps(schema, sort_keys=True)}"
    )


def agent(
    prompt: str,
    *,
    schema: dict | None = None,
    label: str | None = None,
    timeout: int = 900,
    resume: str | None = None,
    model: str | None = None,
) -> dict:
    """Spawn one headless cursor-agent and return text, optional data, usage, and status."""
    attempts = 1 + (DEFAULT_SCHEMA_RETRIES if schema else 0)
    usage_total = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
    log_paths: list[str] = []
    last_result: dict[str, Any] = {}
    last_schema_error = ""
    for attempt in range(1, attempts + 1):
        run_prompt = _schema_prompt(prompt, schema) if schema else prompt
        run = _spawn_cursor_agent(run_prompt, timeout, label=label, resume=resume, model=model, attempt=attempt)
        log_paths.append(run["log_path"])
        events = _json_events(run["stdout"])
        usage = _usage_from_events(events)
        _add_usage(usage_total, usage)
        text = _combined_text(events, run["stdout"])
        last_result = {
            "text": text,
            "usage": dict(usage_total),
            "exit_code": run["exit_code"],
            "label": label,
            "chat_id": _chat_id(events),
            "status": run["status"],
            "error": run["stderr"].strip() or (f"timeout {timeout}s" if run["status"] == "timeout" else ""),
            "log_path": run["log_path"],
            "log_paths": list(log_paths),
        }
        if schema:
            data, last_schema_error = _extract_valid_data(events, text, schema)
            if data:
                last_result["data"] = data
                return last_result
            last_result["schema_error"] = last_schema_error
            if run["status"] == "timeout":
                return last_result
            continue
        return last_result
    if schema and last_schema_error:
        last_result["schema_error"] = last_schema_error
    return last_result


def _effective_concurrency(concurrency: int) -> int:
    value = max(1, int(concurrency))
    override = os.environ.get("MAX_CHILDREN")
    if override:
        try:
            value = min(value, max(1, int(override)))
        except ValueError:
            pass
    return value


def parallel(thunks: list[Callable], *, concurrency: int = 8) -> list:
    """Run thunks concurrently as a barrier; failed thunk results become None."""
    results: list[Any] = [None] * len(thunks)
    if not thunks:
        return results
    with ThreadPoolExecutor(max_workers=_effective_concurrency(concurrency)) as pool:
        futures = {pool.submit(thunk): idx for idx, thunk in enumerate(thunks)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception:
                results[idx] = None
    return results


def pipeline(items: list, *stages: Callable) -> list:
    """Run each item through all stages independently; failed items become None."""
    out = []
    for item in items:
        current = item
        for stage in stages:
            if current is None:
                break
            try:
                current = stage(current)
            except Exception:
                current = None
                break
        out.append(current)
    return out


def phase(title: str) -> None:
    """Emit a lightweight progress phase marker."""
    print(f"\n== {title} ==", file=sys.stderr)


def _stable_key(item: Any) -> str:
    if isinstance(item, dict):
        for key in ("id", "stable_key", "key", "path", "label"):
            value = item.get(key)
            if value is not None:
                return f"{key}:{value}"
        return json.dumps(item, sort_keys=True, default=str)
    return repr(item)


def loop_until_dry(round_fn: Callable, *, dry_rounds: int = 2, max_rounds: int = 10) -> list:
    """Call round_fn until dry_rounds consecutive rounds add no new stable-keyed items."""
    seen: set[str] = set()
    findings: list[Any] = []
    dry = 0
    for _ in range(max(0, max_rounds)):
        batch = round_fn() or []
        new_items = []
        for item in batch:
            key = _stable_key(item)
            if key in seen:
                continue
            seen.add(key)
            new_items.append(item)
        if new_items:
            findings.extend(new_items)
            dry = 0
        else:
            dry += 1
            if dry >= dry_rounds:
                break
    return findings

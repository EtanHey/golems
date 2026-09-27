"""Pinned Codex commands, pin preflight and worker process execution."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
import re
import subprocess
import tempfile
import time
from typing import Any, Callable

from .payloads import validate_payload

@dataclass(frozen=True)
class RunnerConfig:
    model: str
    default_effort: str
    fallback_effort: str


@dataclass
class WorkerResult:
    label: str
    payload: dict[str, Any]
    events: list[dict[str, Any]]
    wall_seconds: float
    stdout_log: str
    stderr_log: str

def build_codex_command(
    *,
    codex_binary: str,
    repo: Path,
    output_schema: Path,
    effort: str,
    json_events: bool = True,
    output_last_message: Path | None = None,
    model: str,
) -> list[str]:
    command = [
        codex_binary,
        "exec",
        "--ignore-user-config",
        "--strict-config",
        "-m",
        model,
        "-c",
        f'model_reasoning_effort="{effort}"',
        "-s",
        "read-only",
        "-C",
        str(repo),
        "--ephemeral",
        "--output-schema",
        str(output_schema),
    ]
    if json_events:
        command.append("--json")
    if output_last_message is not None:
        command.extend(["-o", str(output_last_message)])
    command.append("-")
    return command

def verify_effective_pin(banner: str, *, requested_effort: str, model: str) -> dict[str, str]:
    model_match = re.search(r"(?im)^model:\s*([^\s]+)\s*$", banner)
    effort_match = re.search(r"(?im)^reasoning effort:\s*([^\s]+)\s*$", banner)
    if not model_match:
        raise RuntimeError("could not verify effective model from Codex startup banner")
    if not effort_match:
        raise RuntimeError(
            "could not verify effective reasoning effort from Codex startup banner"
        )
    effective_model = model_match.group(1).strip()
    effective_effort = effort_match.group(1).strip().lower()
    if effective_model != model:
        raise RuntimeError(f"effective model is {effective_model}, expected {model}")
    if effective_effort != requested_effort:
        raise RuntimeError(
            f"effective reasoning effort is {effective_effort}, expected {requested_effort}; refusing silent downgrade"
        )
    return {"model": effective_model, "effort": effective_effort}

def _max_is_unavailable(output: str) -> bool:
    normalized = output.lower()
    effort_error = "reasoning" in normalized or "model_reasoning_effort" in normalized
    unsupported = any(
        term in normalized
        for term in ("unsupported", "not supported", "invalid value", "unknown variant")
    )
    return effort_error and unsupported and "max" in normalized

def _json_events(raw: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in raw.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            events.append(value)
    return events

def _run_process(
    command: list[str], prompt: str, *, timeout: int
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command, input=prompt, capture_output=True, text=True, timeout=timeout
    )

def preflight_pin(
    codex_binary: str,
    repo: Path,
    schema: Path,
    *,
    timeout: int,
    evidence_path: Path | None = None,
    allow_fallback: bool = True,
    config: RunnerConfig,
    build_command: Callable[..., list[str]],
    verify_pin: Callable[..., dict[str, str]],
    run_process: Callable[..., subprocess.CompletedProcess[str]],
) -> dict[str, Any]:
    prompt = 'Return exactly {"worker":"synthesis","findings":[]} and do not inspect or edit files.'
    errors: list[str] = []
    evidence: list[str] = []
    efforts = (config.default_effort, config.fallback_effort) if allow_fallback else (config.default_effort,)
    for effort in efforts:
        with tempfile.TemporaryDirectory(prefix="convention-audit-pin-") as temp_dir:
            output_path = Path(temp_dir) / "last.json"
            command = build_command(
                codex_binary=codex_binary,
                repo=repo,
                output_schema=schema,
                effort=effort,
                json_events=False,
                output_last_message=output_path,
            )
            completed = run_process(command, prompt, timeout=timeout)
        banner = completed.stdout + "\n" + completed.stderr
        evidence.append(
            f"requested_model={config.model}\nrequested_effort={effort}\nreturncode={completed.returncode}\n{banner.rstrip()}"
        )
        if completed.returncode == 0:
            pin = verify_pin(banner, requested_effort=effort)
            pin["requested_effort"] = config.default_effort
            pin["fallback_used"] = effort != config.default_effort
            if evidence_path is not None:
                evidence_path.write_text(
                    "\n\n---\n\n".join(evidence) + "\n", encoding="utf-8"
                )
            return pin
        errors.append(banner.strip())
        if allow_fallback and effort == config.default_effort and _max_is_unavailable(banner):
            continue
        break
    if evidence_path is not None:
        evidence_path.write_text("\n\n---\n\n".join(evidence) + "\n", encoding="utf-8")
    raise RuntimeError("Codex Luna pin preflight failed:\n" + "\n---\n".join(errors))

def _run_worker(
    *,
    label: str,
    prompt: str,
    repo: Path,
    schema: Path,
    effort: str,
    codex_binary: str,
    run_dir: Path,
    timeout: int,
    require_divergent_subset: bool = True,
    build_command: Callable[..., list[str]],
    run_process: Callable[..., subprocess.CompletedProcess[str]],
) -> WorkerResult:
    output_path = run_dir / f"{label}.last.json"
    command = build_command(
        codex_binary=codex_binary,
        repo=repo,
        output_schema=schema,
        effort=effort,
        json_events=True,
        output_last_message=output_path,
    )
    started = time.monotonic()
    completed = run_process(command, prompt, timeout=timeout)
    wall_seconds = time.monotonic() - started
    stdout_path = run_dir / f"{label}.jsonl"
    stderr_path = run_dir / f"{label}.stderr.log"
    stdout_path.write_text(completed.stdout, encoding="utf-8")
    stderr_path.write_text(completed.stderr, encoding="utf-8")
    if completed.returncode != 0:
        raise RuntimeError(
            f"worker {label} failed (exit {completed.returncode}); see {stderr_path}"
        )
    if not output_path.exists():
        raise RuntimeError(f"worker {label} produced no structured last message")
    payload = validate_payload(
        json.loads(output_path.read_text(encoding="utf-8")),
        require_divergent_subset=require_divergent_subset,
    )
    return WorkerResult(
        label=label,
        payload=payload,
        events=_json_events(completed.stdout),
        wall_seconds=wall_seconds,
        stdout_log=str(stdout_path),
        stderr_log=str(stderr_path),
    )

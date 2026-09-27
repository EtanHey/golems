"""Token telemetry, durable run logs and Markdown rendering."""

from __future__ import annotations

import json
from pathlib import Path
import time
from typing import Any, Iterable

from .codex_runner import WorkerResult

def _walk_dicts(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_dicts(child)

def _number(mapping: dict[str, Any], keys: tuple[str, ...]) -> float:
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
    return 0.0

def usage_from_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    input_tokens = 0
    output_tokens = 0
    cached_input_tokens = 0
    cost_values: list[float] = []
    usage_observed = False
    for event in events:
        if event.get("type") not in {
            "turn.completed",
            "turn_completed",
            "response.completed",
        }:
            continue
        candidates = [
            item
            for item in _walk_dicts(event)
            if any("token" in key.lower() for key in item)
        ]
        if not candidates:
            continue
        usage_observed = True
        usage = candidates[-1] if candidates else event
        input_tokens += int(
            _number(usage, ("input_tokens", "inputTokens", "prompt_tokens"))
        )
        output_tokens += int(
            _number(usage, ("output_tokens", "outputTokens", "completion_tokens"))
        )
        cached_input_tokens += int(
            _number(usage, ("cached_input_tokens", "cachedInputTokens"))
        )
        cost = _number(
            usage, ("cost_usd", "costUsd", "estimated_cost_usd", "estimatedCostUsd")
        )
        if cost:
            cost_values.append(cost)
    return {
        "usage_observed": usage_observed,
        "input_tokens": input_tokens if usage_observed else None,
        "cached_input_tokens": cached_input_tokens if usage_observed else None,
        "output_tokens": output_tokens if usage_observed else None,
        "cost_usd": round(sum(cost_values), 8) if cost_values else None,
        "cost_source": "codex-cli-telemetry" if cost_values else "unavailable",
    }

def _telemetry_for_results(
    results: list[WorkerResult], *, wall_seconds: float, require_usage: bool
) -> dict[str, Any]:
    totals = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0}
    costs: list[float] = []
    workers: list[dict[str, Any]] = []
    for result in results:
        usage = usage_from_events(result.events)
        if require_usage and not usage["usage_observed"]:
            raise RuntimeError(
                f"worker {result.label} emitted no recognized token telemetry; refusing a silent zero-token report"
            )
        if usage["usage_observed"]:
            for key in totals:
                totals[key] += int(usage[key])
            if usage["cost_usd"] is not None:
                costs.append(float(usage["cost_usd"]))
        workers.append(
            {
                "label": result.label,
                "wall_seconds": round(result.wall_seconds, 3),
                **usage,
                "stdout_log": result.stdout_log,
                "stderr_log": result.stderr_log,
            }
        )
    return {
        **totals,
        "cost_usd": round(sum(costs), 8) if costs else None,
        "cost_source": "codex-cli-telemetry" if costs else "unavailable",
        "wall_seconds": round(wall_seconds, 3),
        "workers": workers,
    }

def _sum_usage(results: list[WorkerResult]) -> dict[str, Any]:
    telemetry = _telemetry_for_results(results, wall_seconds=0.0, require_usage=True)
    return {
        key: telemetry[key]
        for key in (
            "input_tokens",
            "cached_input_tokens",
            "output_tokens",
            "cost_usd",
            "cost_source",
        )
    }

def _detector_seed_log(
    detector_payload: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if detector_payload is None:
        return None
    return {
        "worker": detector_payload["worker"],
        "finding_count": len(detector_payload["findings"]),
        "evidence_status": (
            "seed-assisted"
            if detector_payload["findings"]
            else "unmeasured-without-seed"
        ),
    }

def _build_run_log(
    *,
    repo: str,
    revision: str,
    pin: dict[str, Any] | None,
    detector_payload: dict[str, Any] | None,
    results: list[WorkerResult],
    started: float,
    status: str,
    stage: str,
    target_git_state_unchanged: bool | None,
    failure: dict[str, str] | None = None,
    require_usage: bool = False,
) -> dict[str, Any]:
    run_log: dict[str, Any] = {
        "status": status,
        "stage": stage,
        "repo": repo,
        "revision": revision,
        "pin": pin,
        "detector_seed": _detector_seed_log(detector_payload),
        "telemetry": _telemetry_for_results(
            results,
            wall_seconds=time.monotonic() - started,
            require_usage=require_usage,
        ),
        "target_git_state_unchanged": target_git_state_unchanged,
        "target_git_state_scope": "tracked and nonignored untracked paths visible to git status",
    }
    if failure is not None:
        run_log["failure"] = failure
    return run_log

def _write_run_log(run_dir: Path, run_log: dict[str, Any]) -> None:
    (run_dir / "run-log.json").write_text(
        json.dumps(run_log, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

def _render_report(report: dict[str, Any], run_log: dict[str, Any]) -> str:
    telemetry = run_log["telemetry"]
    cost = (
        f"${telemetry['cost_usd']:.6f} ({telemetry['cost_source']})"
        if telemetry["cost_usd"] is not None
        else "unavailable (Codex CLI emitted no cost telemetry)"
    )
    detector_seed = run_log["detector_seed"]
    detection_evidence = (
        f"seed-assisted; the static detector emitted {detector_seed['finding_count']} candidate finding(s) for model verification"
        if detector_seed["finding_count"]
        else "no static seed candidate; this run has no measured known-answer detection evidence for unseeded lenses"
    )
    lines = [
        f"# Convention audit — {report['repo']}",
        "",
        f"- Revision: `{report['revision']}`",
        f"- Accepted preflight model: `{run_log['pin']['model']}`",
        f"- Accepted preflight reasoning effort: `{run_log['pin']['effort']}`",
        f"- Detection evidence: {detection_evidence}",
        f"- Output tokens: {telemetry['output_tokens']}",
        f"- Wall-clock: {telemetry['wall_seconds']:.2f}s",
        f"- Cost: {cost}",
        f"- Findings: {len(report['findings'])}",
        "",
        "Findings are reports only. Fixes require a separate PR loop in the owning repository.",
        "",
    ]
    if not report["findings"]:
        lines.extend(
            [
                "## Findings",
                "",
                "No independently implemented concept survived synthesis verification.",
                "",
            ]
        )
        return "\n".join(lines)
    for index, finding in enumerate(report["findings"], start=1):
        lines.extend(
            [
                f"## {index}. {finding['concept']}",
                "",
                f"Confidence: {finding['confidence']}",
                "",
                "| Site | Diverges? | Evidence |",
                "|---|---:|---|",
            ]
        )
        divergent = {
            (site["path"], int(site["line"])): site["reason"]
            for site in finding["divergent_sites"]
        }
        for site in finding["implementation_sites"]:
            key = (site["path"], int(site["line"]))
            reason = divergent.get(key)
            evidence = reason or site["summary"]
            lines.append(
                f"| `{site['path']}:{site['line']}` | {'yes' if reason else 'no'} | {evidence} |"
            )
        lines.extend(["", f"Shared-helper shape: {finding['shared_helper_shape']}", ""])
    return "\n".join(lines)

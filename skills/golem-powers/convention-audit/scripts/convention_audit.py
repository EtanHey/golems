#!/usr/bin/env python3
"""Read-only, Luna-pinned fan-out for single-source-of-truth audits."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


MODEL = "gpt-5.6-luna"
DEFAULT_EFFORT = "max"
FALLBACK_EFFORT = "xhigh"
LENSES = {
    "time-and-query-semantics": "time windows, timestamp normalization, query predicates, pagination boundaries, and equivalent database semantics",
    "data-ownership": "multiple writers, precedence rules, state ownership, derived fields, and schema columns with competing producers",
    "lifecycle-control": "start/stop/pause/resume/drain lifecycle halves, producer-consumer coordination, queues, workers, daemons, and cleanup",
    "paths-and-identity": "path derivation, naming, worktree/project identity, configuration defaults, cache keys, and identifiers",
    "live-copy-drift": "vendored copies, generated copies, installed copies, hooks, watchers, duplicated live code trees, and deployment propagation",
    "duplicated-domain-logic": "independent algorithms, thresholds, parsing, routing, policy, validation, and business rules that should share one owner",
}
DETECTOR_IGNORED_DIRS = {
    "build",
    "dist",
    "node_modules",
    "site-packages",
    "vendor",
    "venv",
}

SQLITE_RECENT_WINDOW_PATTERN = re.compile(
    r"(?:"
    r"datetime\s*\(\s*(?P<normalized_column>[A-Za-z_][A-Za-z0-9_.]*(?:_at|timestamp))\s*\)"
    r"|(?P<raw_column>[A-Za-z_][A-Za-z0-9_.]*(?:_at|timestamp))"
    r")\s*(?:>|>=)\s*datetime\s*\(",
    re.IGNORECASE,
)


def detect_sqlite_recent_window_candidates(repo: Path) -> dict[str, Any]:
    """Inventory lower-bound SQLite time windows and flag raw text comparisons."""

    implementation_sites: list[dict[str, Any]] = []
    divergent_sites: list[dict[str, Any]] = []
    for path in sorted(repo.rglob("*.py")):
        relative = path.relative_to(repo)
        if any(
            part.startswith(".")
            or part in {"tests", "__tests__", "__pycache__"}
            or part.lower() in DETECTOR_IGNORED_DIRS
            for part in relative.parts
        ):
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(lines, start=1):
            if line.lstrip().startswith("#"):
                continue
            for match in SQLITE_RECENT_WINDOW_PATTERN.finditer(line):
                normalized_column = match.group("normalized_column")
                column = normalized_column or match.group("raw_column")
                normalized = normalized_column is not None
                implementation_sites.append(
                    {
                        "path": relative.as_posix(),
                        "line": line_number,
                        "summary": (
                            f"normalizes {column} through SQLite datetime() before the lower-bound comparison"
                            if normalized
                            else f"compares raw {column} text to a SQLite datetime() lower bound"
                        ),
                    }
                )
                if not normalized:
                    divergent_sites.append(
                        {
                            "path": relative.as_posix(),
                            "line": line_number,
                            "reason": (
                                f"raw {column} text can use an ISO separator that sorts differently from "
                                "SQLite datetime() output"
                            ),
                        }
                    )

    findings: list[dict[str, Any]] = []
    normalized_site_count = len(implementation_sites) - len(divergent_sites)
    if len(implementation_sites) >= 2 and divergent_sites and normalized_site_count > 0:
        findings.append(
            {
                "concept": "SQLite recent timestamp-window comparison",
                "implementation_sites": implementation_sites,
                "divergent_sites": divergent_sites,
                "shared_helper_shape": (
                    "One parameterized recent_timestamp_clause(column, amount, unit) that always applies "
                    "SQLite datetime() normalization."
                ),
                "confidence": "high",
            }
        )
    return {"worker": "static-sqlite-recent-window-detector", "findings": findings}


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
) -> list[str]:
    command = [
        codex_binary,
        "exec",
        "--ignore-user-config",
        "--strict-config",
        "-m",
        MODEL,
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


def verify_effective_pin(banner: str, *, requested_effort: str) -> dict[str, str]:
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
    if effective_model != MODEL:
        raise RuntimeError(f"effective model is {effective_model}, expected {MODEL}")
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


def validate_payload(
    payload: Any, *, require_divergent_subset: bool = True
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RuntimeError("structured worker output must be an object")
    if not isinstance(payload.get("worker"), str):
        raise RuntimeError("structured worker output missing required field worker")
    findings = payload.get("findings")
    if not isinstance(findings, list):
        raise RuntimeError("structured worker output missing required field findings")
    required_finding = (
        "concept",
        "implementation_sites",
        "divergent_sites",
        "shared_helper_shape",
        "confidence",
    )
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            raise RuntimeError(f"finding {index} must be an object")
        for field in required_finding:
            if field not in finding:
                raise RuntimeError(f"finding {index} missing required field {field}")
        if not isinstance(finding["implementation_sites"], list) or not isinstance(
            finding["divergent_sites"], list
        ):
            raise RuntimeError(f"finding {index} sites must be arrays")
        if not finding["implementation_sites"]:
            raise RuntimeError(
                f"finding {index} must include at least one implementation site"
            )
        if finding["confidence"] not in {"high", "medium", "low"}:
            raise RuntimeError(f"finding {index} confidence is invalid")
        for group, required_site in (
            (finding["implementation_sites"], ("path", "line", "summary")),
            (finding["divergent_sites"], ("path", "line", "reason")),
        ):
            for site_index, site in enumerate(group):
                if not isinstance(site, dict) or any(
                    field not in site for field in required_site
                ):
                    raise RuntimeError(
                        f"finding {index} site {site_index} is malformed"
                    )
        implementation_identities = {
            (str(site["path"]), int(site["line"]))
            for site in finding["implementation_sites"]
        }
        divergent_identities = {
            (str(site["path"]), int(site["line"]))
            for site in finding["divergent_sites"]
        }
        if require_divergent_subset and not divergent_identities.issubset(
            implementation_identities
        ):
            raise RuntimeError(
                f"finding {index} divergent sites must also be implementation sites"
            )
    return payload


def aggregate_worker_payloads(
    payloads: list[dict[str, Any]], *, repo: str, revision: str
) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, tuple[tuple[str, int], ...]]] = set()
    for payload in payloads:
        for raw in payload.get("findings", []):
            sites = raw.get("implementation_sites", [])
            identity = (
                str(raw.get("concept", "")).strip().lower(),
                tuple(sorted((str(site["path"]), int(site["line"])) for site in sites)),
            )
            if identity in seen:
                continue
            seen.add(identity)
            finding = dict(raw)
            finding["site_count"] = len(sites)
            findings.append(finding)
    findings.sort(
        key=lambda item: (
            -len(item.get("implementation_sites", [])),
            item.get("concept", ""),
        )
    )
    return {"repo": repo, "revision": revision, "findings": findings}


def _worker_prompt(
    label: str,
    focus: str,
    *,
    detector_payload: dict[str, Any] | None = None,
) -> str:
    detector_context = ""
    if detector_payload is not None:
        detector_context = f"""
A cheap deterministic inventory found the following candidate evidence:
{json.dumps(detector_payload, indent=2, sort_keys=True)}

Verify this inventory first against the cited files and lines. Keep it only if the concept and
divergence are real; correct the enumeration if repository evidence requires it. Then continue
the broader lens search.
"""
    return f"""You are one read-only worker in a convention audit of the repository at your current directory.

Question: Where does ONE concept have multiple independent implementations that can silently diverge?
Your lens: {focus}.

Inspect the real repository with rg and targeted file reads. This is NOT a generic linter or style review.
Only report a finding when you can enumerate all relevant implementation sites and identify an actual divergence risk.
Shared callers of one helper are a negative control, not a finding. Do not edit files.
Do not inspect paths outside the current working directory; external skill trees, evals, reports,
collab files, and other repository checkouts are out of scope and may contain answer keys.
{detector_context}

For every finding:
- name the concept;
- list every implementation site as a repo-relative path and exact current line;
- identify only the sites that diverge and explain why;
- propose the smallest shared-helper/owner/controller shape that collapses them.

Set worker to {json.dumps(label)}. Return the schema object even when findings is empty.
"""


def _synthesis_prompt(candidates: list[dict[str, Any]]) -> str:
    return f"""You are the final read-only verifier for a single-source-of-truth convention audit.

Question: Where does one concept have multiple independent implementations that can silently diverge?
Candidate findings from independent workers follow:
{json.dumps(candidates, indent=2, sort_keys=True)}

Verify every candidate against the real files in the current repository. Deduplicate overlapping candidates.
Reject generic lint/style duplication, false positives where callers share one helper, missing-file citations, and claims whose line numbers do not contain the described implementation.
Do not inspect paths outside the current working directory; external skill trees, evals, reports,
collab files, and other repository checkouts are out of scope and may contain answer keys.
For each retained finding, enumerate every implementation site, mark only the divergent sites, and give the smallest shared-helper/owner/controller shape. Do not edit files.
Every retained divergent `path:line` must also appear verbatim in that finding's implementation-sites
array. Normalize or reject raw candidates that use a broader implementation entrypoint and a different
internal line for the divergence.
Set worker to "synthesis". Return an empty findings list if nothing survives verification.
"""


def _git_state(repo: Path) -> str:
    probe = subprocess.run(
        ["git", "-C", str(repo), "status", "--porcelain=v1", "--untracked-files=all"],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        detail = probe.stderr.strip() or "git status returned no diagnostic"
        raise RuntimeError(f"could not read git state for {repo}: {detail}")
    return probe.stdout


def _revision(repo: Path) -> str:
    probe = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True
    )
    return probe.stdout.strip() if probe.returncode == 0 else "unknown"


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
) -> dict[str, Any]:
    prompt = 'Return exactly {"worker":"synthesis","findings":[]} and do not inspect or edit files.'
    errors: list[str] = []
    evidence: list[str] = []
    efforts = (DEFAULT_EFFORT, FALLBACK_EFFORT) if allow_fallback else (DEFAULT_EFFORT,)
    for effort in efforts:
        with tempfile.TemporaryDirectory(prefix="convention-audit-pin-") as temp_dir:
            output_path = Path(temp_dir) / "last.json"
            command = build_codex_command(
                codex_binary=codex_binary,
                repo=repo,
                output_schema=schema,
                effort=effort,
                json_events=False,
                output_last_message=output_path,
            )
            completed = _run_process(command, prompt, timeout=timeout)
        banner = completed.stdout + "\n" + completed.stderr
        evidence.append(
            f"requested_model={MODEL}\nrequested_effort={effort}\nreturncode={completed.returncode}\n{banner.rstrip()}"
        )
        if completed.returncode == 0:
            pin = verify_effective_pin(banner, requested_effort=effort)
            pin["requested_effort"] = DEFAULT_EFFORT
            pin["fallback_used"] = effort != DEFAULT_EFFORT
            if evidence_path is not None:
                evidence_path.write_text(
                    "\n\n---\n\n".join(evidence) + "\n", encoding="utf-8"
                )
            return pin
        errors.append(banner.strip())
        if allow_fallback and effort == DEFAULT_EFFORT and _max_is_unavailable(banner):
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
) -> WorkerResult:
    output_path = run_dir / f"{label}.last.json"
    command = build_codex_command(
        codex_binary=codex_binary,
        repo=repo,
        output_schema=schema,
        effort=effort,
        json_events=True,
        output_last_message=output_path,
    )
    started = time.monotonic()
    completed = _run_process(command, prompt, timeout=timeout)
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


def run_audit(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    repo = args.repo.resolve()
    if not repo.is_dir():
        raise RuntimeError(f"repository does not exist: {repo}")
    codex_binary = (
        shutil.which(args.codex_binary)
        if os.sep not in args.codex_binary
        else args.codex_binary
    )
    if not codex_binary or not Path(codex_binary).is_file():
        raise RuntimeError(f"codex binary not found: {args.codex_binary}")
    skill_dir = Path(__file__).resolve().parents[1]
    worker_schema = skill_dir / "scripts" / "worker.schema.json"
    report_schema = skill_dir / "scripts" / "report.schema.json"
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = output_dir / f"{repo.name}-{stamp}"
    run_dir.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    stage = "target-preflight"
    results: list[WorkerResult] = []
    before: str | None = None
    revision = "unknown"
    detector_payload: dict[str, Any] | None = None
    pin: dict[str, Any] | None = None

    def checkpoint(
        *,
        status: str = "running",
        target_git_state_unchanged: bool | None = None,
        failure: dict[str, str] | None = None,
        require_usage: bool = False,
    ) -> dict[str, Any]:
        run_log = _build_run_log(
            repo=repo.name,
            revision=revision,
            pin=pin,
            detector_payload=detector_payload,
            results=results,
            started=started,
            status=status,
            stage=stage,
            target_git_state_unchanged=target_git_state_unchanged,
            failure=failure,
            require_usage=require_usage,
        )
        _write_run_log(run_dir, run_log)
        return run_log

    try:
        before = _git_state(repo)
        revision = _revision(repo)
        detector_payload = detect_sqlite_recent_window_candidates(repo)
        checkpoint()

        stage = "pin-preflight"
        checkpoint()
        pin = preflight_pin(
            codex_binary,
            repo,
            report_schema,
            timeout=args.timeout,
            evidence_path=run_dir / "pin-preflight.log",
            allow_fallback=not args.no_effort_fallback,
        )
        effort = pin["effort"]
        checkpoint()

        stage = "analysis"
        checkpoint()
        worker_errors: dict[str, str] = {}
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=args.concurrency
        ) as executor:
            futures = {
                executor.submit(
                    _run_worker,
                    label=label,
                    prompt=_worker_prompt(
                        label,
                        focus,
                        detector_payload=(
                            detector_payload
                            if label == "time-and-query-semantics"
                            else None
                        ),
                    ),
                    repo=repo,
                    schema=worker_schema,
                    effort=effort,
                    codex_binary=codex_binary,
                    run_dir=run_dir,
                    timeout=args.timeout,
                    require_divergent_subset=False,
                ): label
                for label, focus in LENSES.items()
            }
            for future in concurrent.futures.as_completed(futures):
                label = futures[future]
                try:
                    results.append(future.result())
                except Exception as exc:
                    worker_errors[label] = str(exc)
                checkpoint()
        if worker_errors:
            details = "; ".join(
                f"{label}: {worker_errors[label]}" for label in sorted(worker_errors)
            )
            raise RuntimeError(f"analysis worker failures: {details}")
        results.sort(key=lambda result: result.label)

        stage = "synthesis"
        checkpoint()
        synthesis = _run_worker(
            label="synthesis",
            prompt=_synthesis_prompt(
                [detector_payload, *[result.payload for result in results]]
            ),
            repo=repo,
            schema=report_schema,
            effort=effort,
            codex_binary=codex_binary,
            run_dir=run_dir,
            timeout=args.timeout,
            require_divergent_subset=True,
        )
        results.append(synthesis)
        checkpoint()
        report = aggregate_worker_payloads(
            [synthesis.payload], repo=repo.name, revision=revision
        )

        stage = "target-verification"
        after = _git_state(repo)
        if before != after:
            raise RuntimeError("audit mutated target repository state; refusing report")

        stage = "reporting"
        checkpoint(target_git_state_unchanged=True)
        run_log = _build_run_log(
            repo=repo.name,
            revision=revision,
            pin=pin,
            detector_payload=detector_payload,
            results=results,
            started=started,
            status="complete",
            stage="complete",
            target_git_state_unchanged=True,
            require_usage=True,
        )
        (run_dir / "report.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (run_dir / "report.md").write_text(
            _render_report(report, run_log), encoding="utf-8"
        )
        _write_run_log(run_dir, run_log)
        return report, run_log
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        target_git_state_unchanged: bool | None = None
        failure = {
            "stage": stage,
            "type": type(exc).__name__,
            "message": str(exc),
        }
        if before is not None:
            try:
                target_git_state_unchanged = before == _git_state(repo)
            except RuntimeError as state_exc:
                failure["target_state_error"] = str(state_exc)
        checkpoint(
            status="failed",
            target_git_state_unchanged=target_git_state_unchanged,
            failure=failure,
        )
        raise


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Find concepts with multiple independent implementations that can silently diverge."
    )
    parser.add_argument(
        "--repo", required=True, type=Path, help="Repository to inspect read-only"
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Directory for report and raw run logs",
    )
    parser.add_argument(
        "--codex-binary",
        default="codex",
        help="Raw Codex CLI binary (never a repoGolem alias)",
    )
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument(
        "--timeout", type=int, default=1800, help="Per-worker timeout in seconds"
    )
    parser.add_argument(
        "--no-effort-fallback",
        action="store_true",
        help="Require max reasoning and never attempt the xhigh fallback",
    )
    return parser


def main() -> int:
    args = _parser().parse_args()
    if args.concurrency < 1 or args.concurrency > len(LENSES):
        raise SystemExit(f"--concurrency must be between 1 and {len(LENSES)}")
    try:
        report, run_log = run_audit(args)
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        print(f"convention-audit: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {"findings": len(report["findings"]), "telemetry": run_log["telemetry"]},
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

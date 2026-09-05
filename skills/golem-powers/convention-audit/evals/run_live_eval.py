#!/usr/bin/env python3
"""Live A/B eval for the BrainLayer known answer and shared-helper control."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_DIR / "scripts"))
import convention_audit as audit  # noqa: E402


KNOWN_COMMIT = "c99fabb7"
SESSION_SITE = ("src/brainlayer/session_repo.py", 62)
SCRIPT_SITE = ("scripts/enrich_recent.py", 77)
CORRECT_SITES = {
    ("src/brainlayer/search_repo.py", 2264),
    ("src/brainlayer/mcp/enrich_handler.py", 107),
    ("src/brainlayer/eval/enrichment_quality_benchmark.py", 127),
    ("src/brainlayer/p0_longitudinal_count.py", 25),
}
EXPECTED_SITES = {SESSION_SITE, SCRIPT_SITE, *CORRECT_SITES}
CONTAMINATION_MARKERS = (
    "evals/expected",
    "worker-output.json",
    "skills/golem-powers/convention-audit",
)


def _score(assertions: list[bool]) -> dict[str, Any]:
    passed = sum(1 for assertion in assertions if assertion)
    return {
        "passed": passed,
        "total": len(assertions),
        "score_pct": round(passed / len(assertions) * 100, 1),
    }


def _finding_for_known_answer(report: dict[str, Any]) -> dict[str, Any] | None:
    candidates: list[tuple[int, int, dict[str, Any]]] = []
    for finding in report.get("findings", []):
        all_sites = {
            (site.get("path"), site.get("line"))
            for site in finding.get("implementation_sites", [])
        }
        if SESSION_SITE in all_sites or SCRIPT_SITE in all_sites:
            candidates.append(
                (
                    len(all_sites ^ EXPECTED_SITES),
                    -len(all_sites & EXPECTED_SITES),
                    finding,
                )
            )
    return (
        min(candidates, key=lambda candidate: candidate[:2])[2] if candidates else None
    )


def score_known_answer(report: dict[str, Any]) -> dict[str, Any]:
    finding = _finding_for_known_answer(report)
    if finding is None:
        return _score([False] * 5)
    all_sites = {
        (site.get("path"), site.get("line"))
        for site in finding.get("implementation_sites", [])
    }
    divergent = {
        (site.get("path"), site.get("line"))
        for site in finding.get("divergent_sites", [])
    }
    helper = str(finding.get("shared_helper_shape", "")).lower()
    return _score(
        [
            all_sites == EXPECTED_SITES,
            SESSION_SITE in divergent,
            SCRIPT_SITE in divergent,
            CORRECT_SITES.isdisjoint(divergent),
            bool(helper)
            and any(
                term in helper for term in ("helper", "datetime", "normaliz", "clause")
            ),
        ]
    )


def score_control(report: dict[str, Any]) -> dict[str, Any]:
    clean = report.get("findings") == []
    return _score([clean, clean, clean])


def assert_no_eval_contamination(workers: list[Any]) -> None:
    for worker in workers:
        raw = Path(worker.stdout_log).read_text(encoding="utf-8").lower()
        for marker in CONTAMINATION_MARKERS:
            if marker in raw:
                raise RuntimeError(
                    f"answer-key contamination in worker {worker.label}: observed marker {marker!r}"
                )


def ship_gate_passed(results: dict[str, Any]) -> bool:
    if results.get("contamination_check_passed") is not True:
        return False
    cases = results.get("green_with_skill", {}).get("cases", {})
    required = ("known_answer", "shared_helper_control")
    return all(
        isinstance(cases.get(name), dict)
        and cases[name].get("passed") == cases[name].get("total")
        and isinstance(cases[name].get("total"), int)
        and cases[name]["total"] > 0
        for name in required
    )


def _run_checked(command: list[str]) -> None:
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(
            f"command failed ({completed.returncode}): {' '.join(command)}\n{completed.stderr}"
        )


def _tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root)
        if ".git" in relative.parts:
            continue
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _baseline_prompt() -> str:
    return """Review this repository for important convention and duplication problems. Return concrete findings with all implementation sites, divergent sites, a refactoring shape, and confidence. Do not edit files. Do not inspect paths outside the current working directory; external evals, reports, skill trees, and other checkouts may contain answer keys. Set worker to synthesis."""


def _run_pair(
    *,
    repo: Path,
    label: str,
    codex_binary: str,
    effort: str,
    output_dir: Path,
    timeout: int,
    revision: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[audit.WorkerResult]]:
    pair_dir = output_dir / label
    pair_dir.mkdir(parents=True, exist_ok=False)
    report_schema = SKILL_DIR / "scripts" / "report.schema.json"
    worker_schema = SKILL_DIR / "scripts" / "worker.schema.json"
    baseline = audit._run_worker(
        label="baseline-without-skill",
        prompt=_baseline_prompt(),
        repo=repo,
        schema=report_schema,
        effort=effort,
        codex_binary=codex_binary,
        run_dir=pair_dir,
        timeout=timeout,
    )
    detector_payload = audit.detect_sqlite_recent_window_candidates(repo)
    lens = audit._run_worker(
        label="green-time-and-query-semantics",
        prompt=audit._worker_prompt(
            "time-and-query-semantics",
            audit.LENSES["time-and-query-semantics"],
            detector_payload=detector_payload,
        ),
        repo=repo,
        schema=worker_schema,
        effort=effort,
        codex_binary=codex_binary,
        run_dir=pair_dir,
        timeout=timeout,
        require_divergent_subset=False,
    )
    synthesis = audit._run_worker(
        label="green-synthesis",
        prompt=audit._synthesis_prompt([detector_payload, lens.payload]),
        repo=repo,
        schema=report_schema,
        effort=effort,
        codex_binary=codex_binary,
        run_dir=pair_dir,
        timeout=timeout,
    )
    report_revision = revision if revision is not None else audit._revision(repo)
    baseline_report = audit.aggregate_worker_payloads(
        [baseline.payload], repo=repo.name, revision=report_revision
    )
    green_report = audit.aggregate_worker_payloads(
        [synthesis.payload], repo=repo.name, revision=report_revision
    )
    return baseline_report, green_report, [baseline, lens, synthesis]


def run(args: argparse.Namespace) -> dict[str, Any]:
    started = time.monotonic()
    brainlayer = args.brainlayer_repo.resolve()
    if not brainlayer.is_dir():
        raise RuntimeError(f"BrainLayer repository not found: {brainlayer}")
    codex_binary = (
        shutil.which(args.codex_binary)
        if "/" not in args.codex_binary
        else args.codex_binary
    )
    if not codex_binary:
        raise RuntimeError(f"Codex binary not found: {args.codex_binary}")
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    run_dir = output_dir / f"live-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
    run_dir.mkdir(parents=True, exist_ok=False)
    control_source = SKILL_DIR / "evals" / "fixtures" / "shared-helper-control"

    with tempfile.TemporaryDirectory(prefix="convention-audit-c99fabb7-") as temporary:
        checkout = Path(temporary) / "brainlayer"
        _run_checked(
            [
                "git",
                "-C",
                str(brainlayer),
                "worktree",
                "add",
                "--detach",
                str(checkout),
                KNOWN_COMMIT,
            ]
        )
        try:
            pin = audit.preflight_pin(
                str(codex_binary),
                checkout,
                SKILL_DIR / "scripts" / "report.schema.json",
                timeout=args.timeout,
                evidence_path=run_dir / "pin-preflight.log",
                allow_fallback=not args.no_effort_fallback,
            )
            before = audit._git_state(checkout)
            baseline_known, green_known, known_workers = _run_pair(
                repo=checkout,
                label="known-answer",
                codex_binary=str(codex_binary),
                effort=pin["effort"],
                output_dir=run_dir,
                timeout=args.timeout,
            )
            assert_no_eval_contamination(known_workers)
            if before != audit._git_state(checkout):
                raise RuntimeError(
                    "known-answer audit mutated the detached BrainLayer worktree"
                )
        finally:
            _run_checked(
                [
                    "git",
                    "-C",
                    str(brainlayer),
                    "worktree",
                    "remove",
                    "--force",
                    str(checkout),
                ]
            )

    with tempfile.TemporaryDirectory(prefix="convention-audit-control-") as temporary:
        control = Path(temporary) / "shared-helper-control"
        shutil.copytree(control_source, control)
        control_before = _tree_digest(control)
        _run_checked(["git", "-C", str(control), "init", "-q"])
        baseline_control, green_control, control_workers = _run_pair(
            repo=control,
            label="shared-helper-control",
            codex_binary=str(codex_binary),
            effort=pin["effort"],
            output_dir=run_dir,
            timeout=args.timeout,
            revision=f"fixture-sha256:{control_before}",
        )
        assert_no_eval_contamination(control_workers)
        if control_before != _tree_digest(control):
            raise RuntimeError(
                "shared-helper control audit mutated the isolated fixture"
            )
    baseline_scores = {
        "known_answer": score_known_answer(baseline_known),
        "shared_helper_control": score_control(baseline_control),
    }
    green_scores = {
        "known_answer": score_known_answer(green_known),
        "shared_helper_control": score_control(green_control),
    }
    baseline_passed = sum(score["passed"] for score in baseline_scores.values())
    green_passed = sum(score["passed"] for score in green_scores.values())
    total = sum(score["total"] for score in green_scores.values())
    baseline_pct = round(baseline_passed / total * 100, 1)
    green_pct = round(green_passed / total * 100, 1)
    telemetry = audit._sum_usage(known_workers + control_workers)
    telemetry["wall_seconds"] = round(time.monotonic() - started, 3)
    results = {
        "pin": pin,
        "contamination_check_passed": True,
        "baseline_without_skill": {"score_pct": baseline_pct, "cases": baseline_scores},
        "green_with_skill": {"score_pct": green_pct, "cases": green_scores},
        "delta_pct": round(green_pct - baseline_pct, 1),
        "known_answer_report": green_known,
        "control_report": green_control,
        "telemetry": telemetry,
    }
    results_path = run_dir / "results.json"
    results_path.write_text(
        json.dumps(results, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    results["results_path"] = str(results_path)
    return results


def run_control_confirmation(args: argparse.Namespace) -> dict[str, Any]:
    started = time.monotonic()
    codex_binary = (
        shutil.which(args.codex_binary)
        if "/" not in args.codex_binary
        else args.codex_binary
    )
    if not codex_binary:
        raise RuntimeError(f"Codex binary not found: {args.codex_binary}")
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    run_dir = (
        output_dir / f"control-live-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
    )
    run_dir.mkdir(parents=True, exist_ok=False)
    control_source = SKILL_DIR / "evals" / "fixtures" / "shared-helper-control"

    with tempfile.TemporaryDirectory(prefix="convention-audit-control-") as temporary:
        control = Path(temporary) / "shared-helper-control"
        shutil.copytree(control_source, control)
        control_before = _tree_digest(control)
        _run_checked(["git", "-C", str(control), "init", "-q"])
        pin = audit.preflight_pin(
            str(codex_binary),
            control,
            SKILL_DIR / "scripts" / "report.schema.json",
            timeout=args.timeout,
            evidence_path=run_dir / "pin-preflight.log",
            allow_fallback=not args.no_effort_fallback,
        )
        baseline_control, green_control, workers = _run_pair(
            repo=control,
            label="shared-helper-control",
            codex_binary=str(codex_binary),
            effort=pin["effort"],
            output_dir=run_dir,
            timeout=args.timeout,
            revision=f"fixture-sha256:{control_before}",
        )
        assert_no_eval_contamination(workers)
        if control_before != _tree_digest(control):
            raise RuntimeError(
                "shared-helper control audit mutated the isolated fixture"
            )

    baseline_score = score_control(baseline_control)
    green_score = score_control(green_control)
    telemetry = audit._sum_usage(workers)
    telemetry["wall_seconds"] = round(time.monotonic() - started, 3)
    results_path = run_dir / "results.json"
    results = {
        "pin": pin,
        "fixture_revision": f"fixture-sha256:{control_before}",
        "contamination_check_passed": True,
        "baseline_without_skill": baseline_score,
        "green_with_skill": green_score,
        "control_gate_passed": green_score["passed"] == green_score["total"],
        "control_report": green_control,
        "telemetry": telemetry,
        "results_path": str(results_path),
    }
    results_path.write_text(
        json.dumps(results, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--brainlayer-repo", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--codex-binary", default="codex")
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--control-only", action="store_true")
    parser.add_argument("--no-effort-fallback", action="store_true")
    args = parser.parse_args()
    try:
        if args.control_only:
            results = run_control_confirmation(args)
        else:
            if args.brainlayer_repo is None:
                parser.error(
                    "--brainlayer-repo is required unless --control-only is used"
                )
            results = run(args)
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        print(f"live-eval: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(results, sort_keys=True))
    gate_passed = (
        results["control_gate_passed"]
        if args.control_only
        else ship_gate_passed(results)
    )
    if not gate_passed:
        print(
            "live-eval: ship gate failed; every green assertion must pass",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

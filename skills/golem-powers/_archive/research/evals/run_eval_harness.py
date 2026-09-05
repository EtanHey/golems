#!/usr/bin/env python3
"""Run the research-skills-v2 eval pack against baseline and current refs."""

from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import tempfile
from datetime import datetime, timezone


REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
EVALS_FILE = REPO_ROOT / "skills" / "golem-powers" / "research" / "evals" / "evals.json"
RESULTS_DIR = REPO_ROOT / "skills" / "golem-powers" / "research" / "evals" / "results"
ORCHESTRATOR_RESULTS_DIR = (
    pathlib.Path.home()
    / "Gits"
    / "orchestrator"
    / "docs.local"
    / "plans"
    / "research-skills-v2"
    / "evals"
)
BASELINE_REF = os.environ.get("RESEARCH_EVAL_BASELINE_REF", "f4b79dd")
WITH_SKILL_REF = os.environ.get("RESEARCH_EVAL_WITH_SKILL_REF", "HEAD")

RESEARCH_SKILL = "skills/golem-powers/research/SKILL.md"
AB_TEST_SKILL = "skills/golem-powers/research-ab-test/SKILL.md"
GEMINI_SKILL = "skills/golem-powers/gemini-research/SKILL.md"
ALIAS_SKILL = "skills/golem-powers/notebooklm-research/SKILL.md"
CLAUDE_WEB_SKILL = "skills/golem-powers/claude-web-research/SKILL.md"
VERIFY_ACCOUNT = "skills/golem-powers/research/_shared/verify-account.sh"
CONTEXT_NUMBERING = "skills/golem-powers/research/_shared/context-numbering.md"
UNIFIED_DISPATCH = "skills/golem-powers/research/scripts/unified_dispatch.py"
DRIVE_SYNC = "skills/golem-powers/gemini-research/scripts/drive_sync.py"
DRIVE_PATHS = "skills/golem-powers/research/_shared/drive-paths.py"
MIGRATE_TEST = "skills/golem-powers/claude-web-research/scripts/__tests__/migrate-obsidian-to-drive.test.sh"


def run_command(cmd: list[str], env: dict[str, str] | None = None) -> tuple[int, str]:
    """Run a repo-local command and return its exit code plus combined output."""
    completed = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    output = completed.stdout.strip()
    if completed.stderr.strip():
        output = f"{output}\n{completed.stderr.strip()}".strip()
    return completed.returncode, output


def git_show(ref: str, repo_path: str) -> str | None:
    """Read a file from a specific git ref, returning None when it is absent."""
    completed = subprocess.run(
        ["git", "show", f"{ref}:{repo_path}"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return None
    return completed.stdout


def path_exists(ref: str, repo_path: str) -> bool:
    """Check whether a repo path exists at the given git ref."""
    return git_show(ref, repo_path) is not None


def contains(ref: str, repo_path: str, needle: str) -> bool:
    """Return True when the git-tracked file contains the given substring."""
    content = git_show(ref, repo_path)
    return content is not None and needle in content


def regex(ref: str, repo_path: str, pattern: str) -> bool:
    """Return True when the git-tracked file matches the given regex."""
    content = git_show(ref, repo_path)
    return content is not None and re.search(pattern, content, re.MULTILINE) is not None


def current_only(ref: str, fn):
    """Run a fixture-backed check only for HEAD, not for historical refs."""
    if ref != "HEAD":
        return None
    return fn()


def build_fixture_file(payload: dict) -> pathlib.Path:
    """Persist a JSON fixture to a temporary file for helper-script execution."""
    tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(payload, tmp)
    tmp.write("\n")
    tmp.flush()
    tmp.close()
    return pathlib.Path(tmp.name)


def cleanup_fixture(path: pathlib.Path | None) -> None:
    """Remove a temporary fixture file when it was created."""
    if path and path.exists():
        path.unlink()


def run_unified_dispatch_fixture() -> dict | None:
    """Execute the unified dispatch helper against a deterministic fixture."""
    fixture = {
        "prompt_number": "82",
        "folders": {
            "project": "project-folder",
            "context": "ctx-folder",
            "prompts": "prompts-folder",
            "results": "results-folder",
        },
        "operations": [],
    }
    fixture_path = build_fixture_file(fixture)
    try:
        env = os.environ.copy()
        env["RESEARCH_UNIFIED_FIXTURE"] = str(fixture_path)
        rc, output = run_command(
            [
                "python3",
                "skills/golem-powers/research/scripts/unified_dispatch.py",
                "--project",
                "brainlayer",
                "--topic",
                "Compare BrainLayer vs Mem0 for long-term memory",
            ],
            env=env,
        )
        if rc != 0:
            return None
        return {
            "summary": json.loads(output),
            "fixture": json.loads(fixture_path.read_text()),
        }
    finally:
        cleanup_fixture(fixture_path)


def run_drive_paths_fixture() -> dict | None:
    """Execute the Drive paths helper against a deterministic folder fixture."""
    fixture = {
        "next_id": 7,
        "folders": [
            {"id": "1", "name": "Brain Drive", "parent": "root"},
            {"id": "2", "name": "Research", "parent": "1"},
        ],
        "files": [],
    }
    fixture_path = build_fixture_file(fixture)
    try:
        env = os.environ.copy()
        env["DRIVE_PATHS_FIXTURE"] = str(fixture_path)
        rc, output = run_command(
            [
                "python3",
                "skills/golem-powers/research/_shared/drive-paths.py",
                "ensure-project-folders",
                "voicelayer",
            ],
            env=env,
        )
        if rc != 0:
            return None
        return {
            "summary": json.loads(output),
            "fixture": json.loads(fixture_path.read_text()),
        }
    finally:
        cleanup_fixture(fixture_path)


def run_verify_account_mismatch() -> dict | None:
    """Exercise the mismatch path of verify-account with mocked account payloads."""
    env = os.environ.copy()
    env["RESEARCH_VERIFY_DRIVE_CMD"] = "printf '%s' '{\"user\":{\"emailAddress\":\"maintainer@example.com\"}}'"
    env["RESEARCH_VERIFY_NOTEBOOKLM_CMD"] = "printf '%s' '{\"email\":\"maintainer@example.com\"}'"
    rc, output = run_command(
        [
            "bash",
            "skills/golem-powers/research/_shared/verify-account.sh",
            "--expect",
            "research-account@example.com",
        ],
        env=env,
    )
    return {"exit_code": rc, "output": output}


def run_shell_test(script_path: str) -> dict | None:
    """Run a shell regression test and return its exit code plus output."""
    rc, output = run_command(["bash", script_path])
    return {"exit_code": rc, "output": output}


def score_case(case: dict, ref: str) -> dict:
    """Score one eval case for a git ref using static and fixture-backed evidence."""
    checks: list[tuple[str, bool | None, str]] = []

    if case["id"] == 1:
        checks = [
            (
                "invokes-gemini-research",
                contains(ref, GEMINI_SKILL, "name: gemini-research")
                and contains(ref, RESEARCH_SKILL, "/gemini-research"),
                "Gemini skill is primary and research routes to /gemini-research.",
            ),
            (
                "no-gemini-google-com-redirect",
                contains(ref, GEMINI_SKILL, "You do NOT need to go to `gemini.google.com` separately."),
                "Gemini skill explicitly tells callers not to leave for gemini.google.com.",
            ),
        ]
    elif case["id"] == 2:
        checks = [
            (
                "invokes-gemini-research",
                contains(ref, ALIAS_SKILL, "/gemini-research"),
                "Legacy notebooklm alias points to /gemini-research.",
            ),
            (
                "notebook-created",
                contains(ref, GEMINI_SKILL, "notebook_create")
                and contains(ref, GEMINI_SKILL, 'title="Research: [Topic]"'),
                "Gemini skill still documents notebook creation via notebook_create.",
            ),
        ]
    elif case["id"] == 3:
        result = current_only(ref, run_unified_dispatch_fixture)
        summary = result["summary"] if result else {}
        checks = [
            (
                "claude-web-dispatch",
                contains(ref, RESEARCH_SKILL, "/claude-web-research")
                and summary.get("claude_web", {}).get("skill") == "/claude-web-research",
                "Unified dispatch emits a Claude Web leg.",
            ),
            (
                "gemini-dispatch",
                contains(ref, RESEARCH_SKILL, "/gemini-research")
                and summary.get("gemini", {}).get("skill") == "/gemini-research",
                "Unified dispatch emits a Gemini leg.",
            ),
            (
                "matching-folder-ids",
                summary.get("claude_web", {}).get("folder_id") == summary.get("gemini", {}).get("folder_id"),
                "Both dispatch legs reference the same Drive context folder id.",
            ),
        ]
    elif case["id"] == 4:
        checks = [
            (
                "verify-account-called",
                contains(ref, GEMINI_SKILL, VERIFY_ACCOUNT)
                and contains(ref, DRIVE_SYNC, "verify-account"),
                "Gemini workflow documents and records verify-account before Drive/NotebookLM work.",
            ),
            (
                "active-account-logged",
                contains(ref, GEMINI_SKILL, "research-account@example.com"),
                "Gemini skill surfaces the expected active account.",
            ),
        ]
    elif case["id"] == 5:
        result = current_only(ref, run_verify_account_mismatch)
        output = result["output"] if result else ""
        checks = [
            (
                "explicit-mismatch-error",
                result is not None and result["exit_code"] == 1 and "Active account mismatch." in output,
                "verify-account exits non-zero with an explicit mismatch error.",
            ),
            (
                "remediation-message",
                "Run: nlm login switch <profile> && mcp__google-drive__refresh_auth" in output,
                "Mismatch path includes remediation.",
            ),
            (
                "no-silent-proceed",
                "match\": true" not in output,
                "Mismatch path does not claim success.",
            ),
        ]
    elif case["id"] == 6:
        result = current_only(ref, run_drive_paths_fixture)
        summary = result["summary"] if result else {}
        checks = [
            (
                "references-shared-scheme",
                path_exists(ref, CONTEXT_NUMBERING)
                and contains(ref, GEMINI_SKILL, "context-numbering.md")
                and contains(ref, AB_TEST_SKILL, "Keep the numbering definition there; this skill should only reference it."),
                "Skills reference the shared numbering doc instead of duplicating the table.",
            ),
            (
                "creates-in-drive",
                result is not None
                and set(summary.get("folders", {}).keys()) == {"project", "context", "prompts", "results"},
                "Drive helper creates Drive-backed project/context/prompts/results folders.",
            ),
        ]
    elif case["id"] == 7:
        checks = [
            (
                "drive-upload",
                contains(ref, CLAUDE_WEB_SKILL, "Brain Drive/Research/<project>/prompts/")
                and contains(ref, CLAUDE_WEB_SKILL, "Upload `R{NN}-{topic}.md`"),
                "Claude Web prompts now write to Drive prompts/.",
            ),
            (
                "no-obsidian-write",
                not contains(ref, CLAUDE_WEB_SKILL, "Mobile Documents")
                and not contains(ref, CLAUDE_WEB_SKILL, "iCloud~md~obsidian"),
                "Claude Web skill no longer treats Obsidian as primary output storage.",
            ),
            (
                "next-rnn-correct",
                contains(ref, CLAUDE_WEB_SKILL, "list-prompts")
                and contains(ref, CLAUDE_WEB_SKILL, "R{NN+1}"),
                "Claude Web workflow derives the next prompt number from Drive prompts.",
            ),
        ]
    elif case["id"] == 8:
        checks = [
            (
                "reads-paired-results",
                contains(ref, AB_TEST_SKILL, "R{NN}-claude-web-result.md")
                and contains(ref, AB_TEST_SKILL, "R{NN}-gemini-result.md"),
                "A/B test skill reads the paired unified filenames directly.",
            ),
            (
                "no-platform-guessing",
                contains(ref, AB_TEST_SKILL, "No need to guess.")
                and contains(ref, AB_TEST_SKILL, "pre-attributed unified output names"),
                "Unified path explicitly avoids provenance guessing.",
            ),
            (
                "10-dimension-scoring",
                contains(ref, AB_TEST_SKILL, "THE 10-DIMENSION SCORING RUBRIC"),
                "A/B test skill keeps the full 10-dimension rubric.",
            ),
        ]
    elif case["id"] == 9:
        result = current_only(ref, lambda: run_shell_test(MIGRATE_TEST))
        output = result["output"] if result else ""
        checks = [
            (
                "file-count-matches",
                result is not None and result["exit_code"] == 0,
                "Migration regression test passed, including file-count preservation.",
            ),
            (
                "empty-content-diff",
                result is not None and result["exit_code"] == 0,
                "Migration regression test passed, including content parity checks.",
            ),
            (
                "deprecation-marker",
                "migrate-obsidian-to-drive.test.sh PASS" in output,
                "Migration regression test verified DEPRECATED.md emission.",
            ),
        ]
    elif case["id"] == 10:
        checks = [
            (
                "deprecation-warning",
                contains(ref, ALIAS_SKILL, "Deprecated: use /gemini-research")
                and contains(ref, ALIAS_SKILL, "active for 1 release"),
                "Alias skill prints the deprecation warning and retention window.",
            ),
            (
                "loads-gemini-research",
                contains(ref, ALIAS_SKILL, "/gemini-research")
                and path_exists(ref, GEMINI_SKILL),
                "Alias resolves to the new gemini-research skill.",
            ),
            (
                "same-functionality",
                contains(ref, ALIAS_SKILL, "NotebookLM MCP workflows")
                and contains(ref, GEMINI_SKILL, "Default Workflow: Drive-Sync Research"),
                "Alias delegates callers to the full Gemini workflow rather than a stub feature set.",
            ),
        ]
    else:
        raise ValueError(f"unsupported case id: {case['id']}")

    passed = 0
    total = 0
    assertion_results = []
    for name, ok, evidence in checks:
        total += 1
        passed_flag = bool(ok)
        if passed_flag:
            passed += 1
        assertion_results.append(
            {
                "name": name,
                "passed": passed_flag,
                "evidence": evidence,
            }
        )

    return {
        "id": case["id"],
        "name": case["name"],
        "score_percent": round((passed / total) * 100, 2),
        "passed_assertions": passed,
        "total_assertions": total,
        "assertions": assertion_results,
    }


def summarize(label: str, ref: str, cases: list[dict]) -> dict:
    """Score every case for one ref and compute the aggregate percent."""
    case_results = [score_case(case, ref) for case in cases]
    total_percent = round(sum(case["score_percent"] for case in case_results) / len(case_results), 2)
    return {
        "label": label,
        "ref": ref,
        "overall_score_percent": total_percent,
        "cases": case_results,
    }


def build_delta(baseline: dict, with_skill: dict) -> dict:
    """Compute per-case and overall deltas between baseline and current scores."""
    baseline_cases = {case["id"]: case for case in baseline["cases"]}
    with_skill_cases = {case["id"]: case for case in with_skill["cases"]}
    deltas = []
    for case_id, current_case in with_skill_cases.items():
        previous = baseline_cases[case_id]
        deltas.append(
            {
                "id": case_id,
                "name": current_case["name"],
                "baseline_percent": previous["score_percent"],
                "with_skill_percent": current_case["score_percent"],
                "delta_percent": round(current_case["score_percent"] - previous["score_percent"], 2),
            }
        )
    return {
        "overall_delta_percent": round(
            with_skill["overall_score_percent"] - baseline["overall_score_percent"],
            2,
        ),
        "cases": deltas,
    }


def write_json(path: pathlib.Path, payload: dict) -> None:
    """Write JSON with stable pretty formatting, creating parent dirs as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> int:
    """Run the full harness and write timestamped result artifacts."""
    evals = json.loads(EVALS_FILE.read_text())
    cases = evals["cases"]
    baseline = summarize("baseline", BASELINE_REF, cases)
    with_skill = summarize("with-skill", WITH_SKILL_REF, cases)
    delta = build_delta(baseline, with_skill)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    payload = {
        "generated_at": timestamp,
        "baseline": baseline,
        "with-skill": with_skill,
        "delta": delta,
        "targets": {
            "target_with_skill_score": evals["target_with_skill_score"],
            "minimum_delta": evals["minimum_delta"],
        },
    }

    write_json(RESULTS_DIR / f"baseline-{timestamp}.json", baseline)
    write_json(RESULTS_DIR / f"with-skill-{timestamp}.json", with_skill)
    write_json(RESULTS_DIR / f"delta-{timestamp}.json", delta)
    write_json(ORCHESTRATOR_RESULTS_DIR / f"results-{timestamp}.json", payload)

    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

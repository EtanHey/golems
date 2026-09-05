#!/usr/bin/env python3
import filecmp
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
EVALS_FILE = ROOT / "evals" / "evals.json"
FIXTURES_DIR = ROOT / "tests" / "fixtures"
HELPERS_DIR = ROOT / "tests" / "helpers"
CHECK_SCRIPT = ROOT / "scripts" / "check.sh"
RESULTS_DIR = ROOT / "evals" / "results"


@dataclass
class CaseConfig:
    fixture: str | None
    args: list[str]


CASE_CONFIG = {
    1: CaseConfig("missing-easignore", []),
    2: CaseConfig("partial-easignore", []),
    3: CaseConfig("bundle-id-default", []),
    4: CaseConfig("no-version-fields", ["--platform", "both"]),
    5: CaseConfig("no-ios-devices", ["--platform", "ios", "--profile", "preview"]),
    6: CaseConfig("no-ios-devices", ["--platform", "ios", "--profile", "production"]),
    7: CaseConfig("happy-path", []),
    8: CaseConfig("missing-easignore", ["--fix"]),
    9: CaseConfig("bundle-id-default", ["--fix"]),
    10: CaseConfig("happy-path", ["--json"]),
    11: CaseConfig("managed-workflow", []),
    12: CaseConfig("missing-easignore", []),
    13: CaseConfig("happy-path", []),
    14: CaseConfig(None, []),
}


def run_command(
    cmd: list[str],
    cwd: Path,
    env: dict[str, str],
    timeout_seconds: int = 90,
    input_text: str | None = None,
) -> tuple[int, str]:
    try:
        completed = subprocess.run(
            cmd,
            cwd=str(cwd),
            env=env,
            text=True,
            capture_output=True,
            input=input_text,
            timeout=timeout_seconds,
        )
        output = completed.stdout
        if completed.stderr:
            output = f"{output}\n{completed.stderr}" if output else completed.stderr
        return completed.returncode, sanitize_output(output.strip())
    except subprocess.TimeoutExpired as exc:
        partial = exc.stdout or exc.stderr or ""
        output = partial.strip() if isinstance(partial, str) else ""
        if not output:
            output = f"TIMEOUT after {timeout_seconds}s"
        return 124, sanitize_output(output)


def make_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PATH"] = f"{HELPERS_DIR}:{env.get('PATH', '')}"
    return env


def sanitize_output(text: str) -> str:
    if not text:
        return text

    sanitized = text.replace(str(Path.home()), "~")
    sanitized = re.sub(r"/private/var/folders/[^/\s]+(?:/[^/\s]+)+", "{TMPDIR}", sanitized)
    sanitized = re.sub(r"/var/folders/[^/\s]+(?:/[^/\s]+)+", "{TMPDIR}", sanitized)
    return sanitized


def prepare_fixture(fixture_name: str | None) -> tuple[tempfile.TemporaryDirectory[str], Path]:
    tmpdir = tempfile.TemporaryDirectory(prefix="eas-prebuild-check-eval-")
    target_root = Path(tmpdir.name)
    if fixture_name is None:
        return tmpdir, target_root

    source = FIXTURES_DIR / fixture_name
    target = target_root / fixture_name
    shutil.copytree(source, target)
    return tmpdir, target


def baseline_prompt(case: dict) -> str:
    return (
        "Answer the user naturally without any special slash commands or repo-specific skills. "
        "Do not inspect files or run tools. Keep the response under 6 lines.\n\n"
        f"USER TASK: {case['prompt']}"
    )


def run_baseline(case: dict, cfg: CaseConfig) -> dict:
    tmpdir, cwd = prepare_fixture(cfg.fixture)
    env = make_env()
    try:
        cmd = [
            "claude",
            "-p",
            "--dangerously-skip-permissions",
            "--disable-slash-commands",
            baseline_prompt(case),
        ]
        rc, output = run_command(cmd, cwd, env, timeout_seconds=20)
        return {
            "exit_code": rc,
            "output": output,
            "metadata": collect_metadata(cfg.fixture, cwd),
        }
    finally:
        tmpdir.cleanup()


def run_with_skill(case: dict, cfg: CaseConfig) -> dict:
    tmpdir, cwd = prepare_fixture(cfg.fixture)
    env = make_env()
    try:
        env["PROJECT_DIR"] = str(cwd)
        cmd = ["bash", str(CHECK_SCRIPT), *cfg.args]
        rc, output = run_command(cmd, cwd, env)
        return {
            "exit_code": rc,
            "output": output,
            "metadata": collect_metadata(cfg.fixture, cwd),
        }
    finally:
        tmpdir.cleanup()


def list_relative_files(root: Path) -> set[str]:
    return {
        str(path.relative_to(root))
        for path in root.rglob("*")
        if path.is_file()
    }


def collect_metadata(fixture_name: str | None, cwd: Path) -> dict:
    metadata = {
        "easignore_exists": (cwd / ".easignore").exists(),
        "easignore_contains_node_modules": False,
        "app_json_matches_fixture": None,
        "non_easignore_files_unchanged": None,
    }

    easignore = cwd / ".easignore"
    if easignore.exists():
        metadata["easignore_contains_node_modules"] = "node_modules" in easignore.read_text(encoding="utf-8")

    if fixture_name is None:
        return metadata

    source = FIXTURES_DIR / fixture_name
    source_app_json = source / "app.json"
    target_app_json = cwd / "app.json"
    if source_app_json.exists() and target_app_json.exists():
        metadata["app_json_matches_fixture"] = filecmp.cmp(source_app_json, target_app_json, shallow=False)

    source_files = {path for path in list_relative_files(source) if path != ".easignore"}
    target_files = {path for path in list_relative_files(cwd) if path != ".easignore"}
    if source_files != target_files:
        metadata["non_easignore_files_unchanged"] = False
        return metadata

    unchanged = True
    for relative_path in source_files:
        if not filecmp.cmp(source / relative_path, cwd / relative_path, shallow=False):
            unchanged = False
            break
    metadata["non_easignore_files_unchanged"] = unchanged
    return metadata


def score_assertion(case_id: int, assertion_name: str, output: str, exit_code: int, metadata: dict) -> int:
    text = output
    if assertion_name == "check-01-fail":
        return int("[1/9]" in text and "✗ FAIL" in text and ".easignore" in text)
    if assertion_name == "fix-suggested":
        return int("--fix" in text or "templates/.easignore" in text)
    if assertion_name == "do-not-build-warning":
        return int("DO NOT run `eas build`" in text)
    if assertion_name == "check-01-warn":
        return int("[1/9]" in text and "⚠ WARN" in text)
    if assertion_name == "missing-node-modules-listed":
        return int("node_modules" in text)
    if assertion_name == "check-04-warn":
        return int("Bundle ID consistency" in text and "⚠ WARN" in text)
    if assertion_name == "suspicious-label":
        return int("suspicious" in text.lower() or "scaffold default" in text.lower())
    if assertion_name == "fix-references-app-json":
        return int("app.json" in text and "bundleIdentifier" in text)
    if assertion_name == "check-05-fail":
        return int("Version sync" in text and "✗ FAIL" in text)
    if assertion_name == "missing-fields-listed":
        return int("ios.buildNumber" in text or "android.versionCode" in text)
    if assertion_name == "check-06-fail":
        return int("iOS devices registered" in text and "✗ FAIL" in text)
    if assertion_name == "device-create-suggested":
        return int("eas device:create" in text)
    if assertion_name == "check-06-skipped":
        return int("iOS devices registered" in text and "⊘ SKIPPED" in text and "ad-hoc distribution not required" in text)
    if assertion_name == "no-device-failure":
        return int("iOS devices registered" in text and "✗ FAIL" not in text)
    if assertion_name == "check-03-warn":
        return int("eas-cli version up to date" in text and "⚠ WARN" in text)
    if assertion_name == "upgrade-command":
        return int("npm install -g eas-cli@latest" in text)
    if assertion_name == "check-01-pass-after-fix":
        return int(".easignore exists" in text and "✓ PASS" in text)
    if assertion_name == "easignore-file-written":
        return int(metadata["easignore_exists"] and metadata["easignore_contains_node_modules"])
    if assertion_name == "no-other-files-touched":
        return int(exit_code == 0 and metadata["non_easignore_files_unchanged"] is True)
    if assertion_name == "no-auto-bundle-change":
        return int(metadata["app_json_matches_fixture"] is True)
    if assertion_name == "user-judgment-required":
        return int("user judgment" in text.lower() or "user action" in text.lower() or "Edit app.json" in text)
    if assertion_name == "valid-json":
        try:
            json.loads(text)
            return 1
        except json.JSONDecodeError:
            return 0
    if assertion_name == "has-checks-array":
        try:
            return int(len(json.loads(text).get("checks", [])) >= 9)
        except json.JSONDecodeError:
            return 0
    if assertion_name == "has-summary-object":
        try:
            summary = json.loads(text).get("summary", {})
            return int(all(key in summary for key in ("pass", "fail", "warn", "skip", "info")))
        except json.JSONDecodeError:
            return 0
    if assertion_name == "still-runs-all-checks":
        return int("[1/9]" in text and "[9/9]" in text)
    if assertion_name == "easignore-still-important":
        return int(".easignore exists" in text)
    if assertion_name == "exit-code-1":
        return int(exit_code == 1)
    if assertion_name == "exit-code-0":
        return int(exit_code == 0)
    if assertion_name == "not-expo-message":
        return int("Not an Expo project" in text)
    if assertion_name == "exit-code-2":
        return int(exit_code == 2)
    raise ValueError(f"Unhandled assertion: {assertion_name}")


def score_variant(case: dict, result: dict) -> dict:
    scored = []
    for assertion in case["assertions"]:
        passed = score_assertion(
            case["id"],
            assertion["name"],
            result["output"],
            result["exit_code"],
            result["metadata"],
        )
        scored.append(
            {
                "name": assertion["name"],
                "description": assertion["description"],
                "passed": passed,
            }
        )

    total = len(scored)
    passed_count = sum(item["passed"] for item in scored)
    score = (passed_count / total) * 100 if total else 0.0
    return {"assertions": scored, "score": round(score, 2)}


def main() -> int:
    with EVALS_FILE.open("r", encoding="utf-8") as handle:
        evals = json.load(handle)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d")
    baseline_results = []
    with_skill_results = []

    for case in evals["cases"]:
        cfg = CASE_CONFIG[case["id"]]
        baseline = run_baseline(case, cfg)
        with_skill = run_with_skill(case, cfg)

        baseline_score = score_variant(case, baseline)
        with_skill_score = score_variant(case, with_skill)

        baseline_results.append(
            {
                "id": case["id"],
                "name": case["name"],
                "fixture": cfg.fixture,
                "prompt": case["prompt"],
                "exit_code": baseline["exit_code"],
                "score": baseline_score["score"],
                "assertions": baseline_score["assertions"],
                "output": baseline["output"],
            }
        )
        with_skill_results.append(
            {
                "id": case["id"],
                "name": case["name"],
                "fixture": cfg.fixture,
                "prompt": case["prompt"],
                "exit_code": with_skill["exit_code"],
                "score": with_skill_score["score"],
                "assertions": with_skill_score["assertions"],
                "output": with_skill["output"],
            }
        )

    baseline_avg = round(sum(item["score"] for item in baseline_results) / len(baseline_results), 2) if baseline_results else 0.0
    with_skill_avg = round(sum(item["score"] for item in with_skill_results) / len(with_skill_results), 2) if with_skill_results else 0.0
    delta = round(with_skill_avg - baseline_avg, 2)

    baseline_path = RESULTS_DIR / f"baseline-{timestamp}.json"
    with_skill_path = RESULTS_DIR / f"with-skill-{timestamp}.json"
    summary_path = RESULTS_DIR / f"delta-{timestamp}.json"

    baseline_path.write_text(json.dumps({"skill": "eas-prebuild-check", "cases": baseline_results, "average_score": baseline_avg}, indent=2), encoding="utf-8")
    with_skill_path.write_text(json.dumps({"skill": "eas-prebuild-check", "cases": with_skill_results, "average_score": with_skill_avg}, indent=2), encoding="utf-8")
    summary_path.write_text(
        json.dumps(
            {
                "skill": "eas-prebuild-check",
                "date": timestamp,
                "baseline_average": baseline_avg,
                "with_skill_average": with_skill_avg,
                "delta": delta,
                "minimum_delta": evals.get("minimum_delta"),
                "meets_gate": delta > float(evals.get("minimum_delta", 70)),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(json.dumps({"baseline_average": baseline_avg, "with_skill_average": with_skill_avg, "delta": delta, "summary_file": str(summary_path)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

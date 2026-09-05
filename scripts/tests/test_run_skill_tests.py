from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts" / "run-skill-tests.sh"
WORKFLOW = ROOT / ".github" / "workflows" / "golem-powers-skill-tests.yml"
REQUIREMENTS = ROOT / "scripts" / "skill-test-requirements.txt"


def test_runner_lists_python_skill_test_suites_only():
    env = {**os.environ, "RUN_SKILL_TESTS_LIST_ONLY": "1"}
    result = subprocess.run(
        [str(RUNNER)],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )
    suites = set(result.stdout.splitlines())

    assert "skills/golem-powers/install-runbook-linter/tests" in suites
    assert "skills/golem-powers/tdd-guard/hooks/tests" in suites
    assert "skills/golem-powers/frustration-capture/hooks/tests" in suites
    assert "skills/golem-powers/eas-prebuild-check/tests" not in suites


def test_workflow_runs_the_shared_skill_test_runner():
    workflow = WORKFLOW.read_text()

    assert "golem-powers-skill-tests" in workflow
    assert "python-version: \"3.11\"" in workflow
    assert "python -m pip install --upgrade pip pytest" in workflow
    assert "scripts/run-skill-tests.sh" in workflow


def test_skill_test_requirements_do_not_pull_optional_trace_deps():
    assert not REQUIREMENTS.exists()


def test_optional_phoenix_trace_suite_skips_without_heavy_deps():
    test_module = (
        ROOT
        / "skills"
        / "golem-powers"
        / "skill-creator"
        / "tests"
        / "test_jsonl_to_phoenix_traces.py"
    ).read_text()

    assert 'pytest.importorskip("opentelemetry")' in test_module

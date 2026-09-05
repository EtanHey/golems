from __future__ import annotations

import json
import subprocess
from pathlib import Path


EVALS_DIR = Path(__file__).resolve().parents[1]
CHECKER = EVALS_DIR / "eval-provenance-check.mjs"
FIXTURES = EVALS_DIR / "fixtures" / "eval-provenance"
REPO_ROOT = EVALS_DIR.parents[3]
CONVENTION_RESULTS = (
    REPO_ROOT
    / "skills"
    / "golem-powers"
    / "convention-audit"
    / "evals"
    / "results"
)


def run_checker(
    *fixtures: str,
    require_comparable: bool = False,
) -> subprocess.CompletedProcess[str]:
    options = ["--require-comparable"] if require_comparable else []
    return subprocess.run(
        [
            "node",
            str(CHECKER),
            *options,
            *(str(FIXTURES / fixture) for fixture in fixtures),
        ],
        check=False,
        capture_output=True,
        text=True,
    )


def run_paths(*paths: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(CHECKER), *(str(path) for path in paths)],
        check=False,
        capture_output=True,
        text=True,
    )


def test_observed_provenance_is_valid_and_comparable() -> None:
    result = run_checker(
        "compliant.md",
        "parenthetical-observation-source.json",
        "concrete-no-digit-model.json",
        "alias-mention-with-provenance-2026-08-04.md",
        "markdown-extra-column.md",
    )

    assert result.returncode == 0
    assert result.stdout.count("VALID ") == 5


def test_not_determined_is_honest_but_non_comparable() -> None:
    result = run_checker(
        "not-determined-no-claims.json",
        "not-determined-parenthetical.json",
        "not-determined-score-not-calculated.json",
        "not-determined-score-not-calculated.md",
    )

    assert result.returncode == 0
    assert result.stdout.count("NON_COMPARABLE ") == 4


def test_non_comparable_score_or_comparability_claim_is_invalid() -> None:
    for fixture, error_code in (
        ("not-determined.json", "NON_COMPARABLE_WITH_SCORE_CLAIM"),
        ("not-determined-with-delta.md", "NON_COMPARABLE_WITH_SCORE_CLAIM"),
        (
            "not-determined-comparable-true.json",
            "NON_COMPARABLE_WITH_COMPARABILITY_CLAIM",
        ),
        ("missing-provenance-with-delta.json", "SCORE_CLAIM_WITHOUT_PROVENANCE"),
        ("historical-alias-only-with-claims.json", "ALIAS_ONLY_WITH_SCORE_CLAIM"),
    ):
        result = run_checker(fixture)

        assert result.returncode == 1, fixture
        assert error_code in result.stderr, fixture


def test_require_comparable_distinguishes_retained_history_from_evidence() -> None:
    non_comparable = run_checker(
        "not-determined-no-claims.json",
        require_comparable=True,
    )
    comparable = run_checker(
        "comparable-with-scores.json",
        require_comparable=True,
    )
    alias_only = run_checker(
        "historical-alias-only.json",
        require_comparable=True,
    )

    assert non_comparable.returncode == 3
    assert "COMPARABILITY_REQUIRED" in non_comparable.stderr
    assert alias_only.returncode == 3
    assert "COMPARABILITY_REQUIRED" in alias_only.stderr
    assert comparable.returncode == 0
    assert comparable.stdout.startswith("VALID ")


def test_pre_contract_alias_only_is_retained_but_non_comparable() -> None:
    result = run_checker(
        "historical-alias-only.json",
        "historical-alias-only-2026-04-05.md",
    )

    assert result.returncode == 0
    assert result.stdout.count("ALIAS_ONLY ") == 2


def test_missing_or_false_surface_provenance_is_invalid() -> None:
    for fixture in (
        "missing-provenance.md",
        "provenance-only-in-code-fence.md",
        "alias-as-effective.json",
        "default-as-effective-effort.json",
        "friendly-label-as-effective.json",
        "missing-observation-source.json",
        "unsupported-observation-source.json",
        "unreplaced-placeholders.json",
        "new-alias-only.json",
        "non-string-provenance-field.json",
        "unexpected-provenance-field.json",
    ):
        result = run_checker(fixture)

        assert result.returncode == 1, fixture
        assert result.stderr.startswith("INVALID "), fixture


def test_delta_claim_requires_two_provenance_arms() -> None:
    result = run_checker("single-arm-delta.json")

    assert result.returncode == 1
    assert "DELTA_CLAIM_REQUIRES_TWO_ARMS" in result.stderr


def test_top_level_runtime_fields_must_match_selected_provenance_arm() -> None:
    result = run_checker("top-level-runtime-mismatch.json")

    assert result.returncode == 1
    assert "TOP_LEVEL_PROVENANCE_MISMATCH" in result.stderr


def test_convention_audit_recovery_uses_only_retained_runtime_evidence() -> None:
    observed = run_paths(
        CONVENTION_RESULTS / "round2-control-live" / "results.json",
        CONVENTION_RESULTS / "round2-served-run" / "report.json",
        CONVENTION_RESULTS / "round2-served-run" / "report.md",
        CONVENTION_RESULTS / "round2-served-run" / "run-log.json",
    )
    replay = run_paths(CONVENTION_RESULTS / "brainlayer-failure-replay.json")
    aggregate = run_paths(CONVENTION_RESULTS / "iterate-2-evidence.json")

    assert observed.returncode == 0
    assert observed.stdout.count("VALID ") == 4
    assert replay.returncode == 0
    assert replay.stdout.startswith("NON_COMPARABLE ")
    assert aggregate.returncode == 0
    assert aggregate.stdout.startswith("NON_COMPARABLE ")


def test_convention_audit_aggregate_provenance_is_explicit_and_countable() -> None:
    control = json.loads(
        (CONVENTION_RESULTS / "round2-control-live" / "results.json").read_text()
    )
    served_report = json.loads(
        (CONVENTION_RESULTS / "round2-served-run" / "report.json").read_text()
    )
    served_run_log = json.loads(
        (CONVENTION_RESULTS / "round2-served-run" / "run-log.json").read_text()
    )
    served_markdown = (
        CONVENTION_RESULTS / "round2-served-run" / "report.md"
    ).read_text()
    aggregate = json.loads(
        (CONVENTION_RESULTS / "iterate-2-evidence.json").read_text()
    )

    assert [arm["agent_or_arm"] for arm in control["provenance"]] == [
        "authorized_round_2_control_baseline_without_skill",
        "authorized_round_2_control_green_with_skill",
    ]
    for worker_count, arm in zip((1, 2), control["provenance"], strict=True):
        for source_key in (
            "model_observation_source",
            "effort_observation_source",
        ):
            source = arm[source_key]
            assert "1 preflight observation applied to 3 workers by construction" in source
            assert "shared across 2 compared arms" in source
            assert f"this arm: {worker_count} worker" in source
            assert "per-worker banners are not emitted under --json" in source

    served_scope = (
        "1 preflight observation applied to 7 workers by construction; "
        "per-worker banners are not emitted under --json"
    )
    for record in (served_report, served_run_log):
        assert len(record["provenance"]) == 1
        arm = record["provenance"][0]
        assert served_scope in arm["model_observation_source"]
        assert served_scope in arm["effort_observation_source"]
    assert served_markdown.count(served_scope) == 2

    aggregate_arms = {
        arm["agent_or_arm"]: arm for arm in aggregate["provenance"]
    }
    assert set(aggregate_arms) == {
        "live_confirmation_baseline_without_skill",
        "live_confirmation_green_with_skill",
        "authorized_round_2_control_baseline_without_skill",
        "authorized_round_2_control_green_with_skill",
        "authorized_round_2_served",
    }
    assert served_scope in aggregate_arms["authorized_round_2_served"][
        "model_observation_source"
    ]

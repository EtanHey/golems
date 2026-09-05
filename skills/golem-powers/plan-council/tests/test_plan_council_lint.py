"""RED→GREEN replay for the plan-council ballot validator."""

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("plan_council_lint", ROOT / "council_lint.py")
lint = importlib.util.module_from_spec(spec)
sys.modules["plan_council_lint"] = lint
spec.loader.exec_module(lint)
sys.modules["council_lint"] = lint
cli_spec = importlib.util.spec_from_file_location(
    "plan_council_lint_cli",
    ROOT / "council_lint_cli.py",
)
lint_cli = importlib.util.module_from_spec(cli_spec)
cli_spec.loader.exec_module(lint_cli)

RED = (ROOT / "fixtures" / "red-ballot.md").read_text()
GREEN = (ROOT / "fixtures" / "green-ballot.md").read_text()
LANES = ["W3 preconditions", "3a source_class"]
SENTINEL = "DONE_COUNCIL_R1"


def rules(findings):
    return {finding["rule"] for finding in findings}


def gate_rules(findings):
    return {finding["rule"] for finding in findings if finding["severity"] == "gate"}


def warning_rules(findings):
    return {finding["rule"] for finding in findings if finding["severity"] == "warning"}


def test_red_ballot_trips_ten_gates_and_two_warnings_by_name():
    findings = lint.validate_ballot(RED, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    assert rules(findings) == {
        "table-not-first",
        "missing-rubric",
        "rubric-weights-not-100",
        "unscored-lane",
        "score-out-of-range",
        "unfalsifiable-finding",
        "missing-refuter",
        "missing-live-receipts",
        "missing-conditional-verdict",
        "missing-family-signature",
        "missing-sentinel",
        "author-scored",
    }
    assert warning_rules(findings) == {"missing-refuter", "missing-live-receipts"}
    assert len(gate_rules(findings)) == 10


def test_green_ballot_returns_zero_findings():
    assert lint.validate_ballot(GREEN, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL) == []


def test_rubric_weight_tolerance_is_half_a_point():
    almost = GREEN.replace("Sequencing | 20%", "Sequencing | 20.5%")
    too_far = GREEN.replace("Sequencing | 20%", "Sequencing | 20.6%")
    assert "rubric-weights-not-100" not in rules(
        lint.validate_ballot(almost, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    )
    assert "rubric-weights-not-100" in rules(
        lint.validate_ballot(too_far, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    )


def test_command_and_query_are_concrete_finding_locators():
    command = GREEN.replace("`src/release.py:41`", "Command: `git rev-parse HEAD`")
    query = GREEN.replace("`src/release.py:41`", "Query: `SELECT version FROM releases`")
    for ballot in (command, query):
        assert "unfalsifiable-finding" not in rules(
            lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
        )


def test_non_author_same_family_seat_is_allowed():
    ballot = GREEN.replace("— R1 · opus · Claude Code", "— R1 · FABLE · Claude Code")
    assert "author-scored" not in rules(
        lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    )


def test_author_voting_seat_is_rejected_case_insensitively():
    ballot = GREEN.replace("— R1 · opus · Claude Code", "— R2 · fable · Claude Code")
    assert "author-scored" in rules(
        lint.validate_ballot(ballot, lanes=LANES, author_seat="r2", sentinel=SENTINEL)
    )
    assert "missing-family-signature" not in rules(
        lint.validate_ballot(ballot, lanes=LANES, author_seat="r2", sentinel=SENTINEL)
    )


def test_ballot_requires_at_least_one_gating_verdict():
    ballot = GREEN.replace("NO-GO", "PENDING").replace("CONDITIONAL GO", "PENDING")
    findings = lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    missing = [finding for finding in findings if finding["rule"] == "missing-conditional-verdict"]
    assert [finding["where"] for finding in missing] == ["Verdict"]


def test_lowercase_go_in_prose_is_not_a_gating_verdict():
    ballot = GREEN.replace("NO-GO", "unclear").replace("CONDITIONAL GO", "unclear")
    ballot = ballot.replace("## Conditional verdicts and top three changes", "## Notes")
    ballot = ballot.replace(
        "- W3 preconditions — **unclear** until the artifact manifest exists.\n"
        "- 3a source_class — **unclear** after C1 lands.\n",
        "- Someone else should go over both lanes.\n",
    )
    assert "missing-conditional-verdict" in rules(
        lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    )


def test_real_dispatch_verdict_vocabulary_is_accepted():
    for verdict in ("BLOCK", "HOLD", "RESHAPE", "RESCOPE", "REDESIGN", "GO (gated)"):
        ballot = GREEN.replace("NO-GO", verdict).replace("CONDITIONAL GO", verdict)
        assert "missing-conditional-verdict" not in rules(
            lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
        )


def test_refuter_and_receipt_absence_are_non_gating_warnings():
    ballot = GREEN.replace(
        "\n  Refute me with: a checked-in artifact manifest that resolves the exact SHA.",
        "",
    ).replace(
        "## Live receipts I verified myself\n\n"
        "- Read `src/release.py:35-45` and ran `git rev-parse HEAD` read-only.\n\n",
        "",
    )
    findings = lint.validate_ballot(
        ballot,
        lanes=LANES,
        author_seat="planAuthor",
        sentinel=SENTINEL,
    )
    assert warning_rules(findings) == {"missing-refuter", "missing-live-receipts"}
    assert gate_rules(findings) == set()


def test_warning_only_ballot_exits_zero(tmp_path):
    ballot = GREEN.replace(
        "\n  Refute me with: a checked-in artifact manifest that resolves the exact SHA.",
        "",
    ).replace(
        "## Live receipts I verified myself\n\n"
        "- Read `src/release.py:35-45` and ran `git rev-parse HEAD` read-only.\n\n",
        "",
    )
    ballot_path = tmp_path / "warning-only.md"
    ballot_path.write_text(ballot)
    assert lint_cli.main(
        [
            str(ballot_path),
            "--author-seat",
            "planAuthor",
            "--lane",
            "W3 preconditions",
            "--lane",
            "3a source_class",
        ]
    ) == 0


def test_loose_corpus_vocabulary_does_not_satisfy_checkability_rules():
    ballot = GREEN.replace(
        "\n  Refute me with: a checked-in artifact manifest that resolves the exact SHA.",
        "",
    ).replace(
        "## Live receipts I verified myself\n\n"
        "- Read `src/release.py:35-45` and ran `git rev-parse HEAD` read-only.\n\n",
        "",
    )
    ballot = ballot.replace("## Conditional verdicts and top three changes", "## Notes")
    ballot = ballot.replace("NO-GO", "unclear").replace("CONDITIONAL GO", "unclear")
    ballot += "\nPremise truth/live evidence. Falsifiable basis. Someone should go over this.\n"
    findings = lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    assert {"missing-refuter", "missing-live-receipts"} <= warning_rules(findings)
    assert "missing-conditional-verdict" in gate_rules(findings)


def test_documented_helper_commands_are_skill_root_qualified():
    skill = (ROOT / "SKILL.md").read_text()
    workflow = (ROOT / "workflows" / "run-council.md").read_text()
    assert "python3 <plan-council-skill-dir>/council_bias.py" in skill
    assert "python3 <plan-council-skill-dir>/council_lint_cli.py" in skill
    assert "python3 <plan-council-skill-dir>/council_lint_cli.py" in workflow
    assert "python3 <plan-council-skill-dir>/council_bias.py" in workflow


def test_real_ballots_are_golden_and_lint_clean():
    corpus = ROOT / "fixtures" / "real-ballots"
    sentinels = {
        "r1-opus.md": "DONE_REALC_R1",
        "r2-sol.md": "DONE_REALC_R2",
        "r3-fable.md": "DONE_REALC_R3",
    }
    for name, sentinel in sentinels.items():
        text = (corpus / name).read_text()
        findings = lint.validate_ballot(
            text,
            lanes=["W3 preconditions"],
            author_seat="brainlayerClaude",
            sentinel=sentinel,
        )
        assert gate_rules(findings) == set(), name


def test_heading_finding_without_locator_trips_ballot_level_gate():
    ballot = GREEN.replace(
        "- **F1 — executing artifact is unpinned.** `src/release.py:41` reads the floating alias.\n  Refute me with: a checked-in artifact manifest that resolves the exact SHA.",
        "### F7 — deploy looked wrong\n\nThe 14:53 deploy log looked wrong; no file, command, query, PR, or issue was checked.\nFalsifier: inspect the deployed artifact.",
    )
    findings = lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    bad = [finding for finding in findings if finding["rule"] == "unfalsifiable-finding"]
    assert [(finding["where"], finding["severity"]) for finding in bad] == [
        ("Findings", "gate")
    ]


def test_slash_token_and_ap_number_are_not_concrete_locators():
    for replacement in (
        "the `read/write` split looks wrong; I did not open a file.",
        "this violates AP7; I did not open a file.",
    ):
        ballot = GREEN.replace(
            "`src/release.py:41` reads the floating alias.",
            replacement,
        )
        assert "unfalsifiable-finding" in rules(
            lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
        )


def test_finding_cannot_borrow_a_locator_from_its_lane_scorecard_row():
    ballot = GREEN.replace(
        "Executing artifact is not pinned.",
        "`src/release.py:41` is not pinned.",
    ).replace(
        "- **F1 — executing artifact is unpinned.** `src/release.py:41` reads the floating alias.\n"
        "  Refute me with: a checked-in artifact manifest that resolves the exact SHA.",
        "- **F1 — W3 preconditions worry me.** I did not open any file or run any command.\n"
        "  Refute me with: nothing in particular.",
    )
    assert "unfalsifiable-finding" in rules(
        lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    )


def test_uncited_finding_warns_when_other_findings_make_ballot_checkable():
    findings_block = """- **F1 — file evidence.** `src/release.py:41` is unpinned.
- **F2 — command evidence.** Run: `git rev-parse HEAD`.
- **F3 — query evidence.** Query: `SELECT version FROM releases`.
- **F4 — paper contract conflict.** AP7 and the proposal disagree; resolve it on paper.
  Refute me with: a single written policy.
"""
    ballot = GREEN.replace(
        "- **F1 — executing artifact is unpinned.** `src/release.py:41` reads the floating alias.\n"
        "  Refute me with: a checked-in artifact manifest that resolves the exact SHA.\n",
        findings_block,
    )
    findings = lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    uncited = [finding for finding in findings if finding["rule"] == "unfalsifiable-finding"]
    assert [(finding["where"], finding["severity"]) for finding in uncited] == [("F4", "warning")]


def test_all_uncited_findings_fail_ballot_level_checkability_gate():
    ballot = GREEN.replace(
        "- **F1 — executing artifact is unpinned.** `src/release.py:41` reads the floating alias.\n"
        "  Refute me with: a checked-in artifact manifest that resolves the exact SHA.",
        "- **F1 — first concern.** No source was checked.\n"
        "- **F2 — second concern.** No source was checked.",
    )
    findings = lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    uncited = [finding for finding in findings if finding["rule"] == "unfalsifiable-finding"]
    assert len(uncited) == 1
    assert uncited[0]["severity"] == "gate"


def test_lane_identity_preserves_descriptor_after_numeric_prefix():
    assert lint._lane_key("3a source_class") != lint._lane_key("3a backfill")
    assert "unscored-lane" in rules(
        lint.validate_ballot(
            GREEN,
            lanes=["3a backfill"],
            author_seat="planAuthor",
            sentinel=SENTINEL,
        )
    )


def test_unknown_but_well_formed_family_signature_is_allowed():
    ballot = GREEN.replace("— R1 · opus · Claude Code", "— R4 · gemini · Gemini CLI")
    assert "missing-family-signature" not in rules(
        lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    )


def test_common_markdown_variants_are_accepted():
    ballot = GREEN.replace("# Plan council ballot — GREEN\n\n| Lane", "# Plan council ballot — GREEN\n\n## Scorecard\n\n| Wave/Lane")
    ballot = ballot.replace("| Score | Verdict", "| Score (1-10) | Verdict")
    ballot = ballot.replace("| 3a source_class |", "| 3a `source_class` |")
    ballot = ballot.replace("| Dimension | Weight |", "| Dimension | Weight % |")
    ballot = ballot.replace("## Live receipts I verified myself", "## Receipts I verified myself")
    assert lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL) == []


def test_seat_splitter_extracts_each_ballot_from_one_collab():
    corpus = ROOT / "fixtures" / "real-ballots"
    collab = "\n\n---\n\n".join((corpus / name).read_text() for name in ("r3-fable.md", "r1-opus.md", "r2-sol.md"))
    for seat, sentinel in (("R1", "DONE_REALC_R1"), ("R2", "DONE_REALC_R2"), ("R3", "DONE_REALC_R3")):
        ballot = lint.extract_seat_ballot(collab, seat=seat, sentinel=sentinel)
        assert ballot.rstrip().endswith(sentinel)
        assert gate_rules(
            lint.validate_ballot(ballot, author_seat="brainlayerClaude", sentinel=sentinel)
        ) == set()


def test_cli_extracts_all_seats_from_untouched_real_collab():
    collab_path = ROOT / "fixtures" / "real-collab.md"
    for seat, sentinel in (
        ("R1", "DONE_REALC_R1"),
        ("R2", "DONE_REALC_R2"),
        ("R3", "DONE_REALC_R3"),
    ):
        assert lint_cli.main(
            [
                str(collab_path),
                "--seat",
                seat,
                "--author-seat",
                "planAuthor",
                "--lane",
                "W3 preconditions",
                "--sentinel",
                sentinel,
            ]
        ) == 0


def test_real_collab_r1_extracts_ballot_instead_of_lift_table():
    collab = (ROOT / "fixtures" / "real-collab.md").read_text()
    ballot = lint.extract_seat_ballot(collab, seat="R1", sentinel="DONE_REALC_R1")
    assert "REAL round 2" in ballot
    assert "R1 — LIFT TABLE" not in ballot
    assert ballot.rstrip().endswith("DONE_REALC_R1")


def test_seat_splitter_returns_corrected_second_ballot():
    first = GREEN.replace("# Plan council ballot — GREEN", "## R1 ballot v1")
    second = first.replace("## R1 ballot v1", "## R1 ballot v2 corrected").replace(
        "| W3 preconditions | 4 |", "| W3 preconditions | 9 |"
    )
    ballot = lint.extract_seat_ballot(
        f"{first}\n---\n\n{second}", seat="R1", sentinel=SENTINEL
    )
    assert "ballot v2 corrected" in ballot
    assert "| W3 preconditions | 9 |" in ballot
    assert "ballot v1" not in ballot


def test_seat_splitter_returns_fourth_reposted_ballot():
    ballots = []
    for version, score in enumerate((2, 4, 6, 9), start=1):
        ballot = GREEN.replace(
            "# Plan council ballot — GREEN", f"## R1 ballot v{version}"
        ).replace("| W3 preconditions | 4 |", f"| W3 preconditions | {score} |")
        ballots.append(ballot)
    extracted = lint.extract_seat_ballot(
        "\n---\n\n".join(ballots), seat="R1", sentinel=SENTINEL
    )
    assert "ballot v4" in extracted
    assert "| W3 preconditions | 9 |" in extracted
    assert "ballot v3" not in extracted


def test_exact_score_header_wins_over_later_score_rationale_column():
    ballot = GREEN.replace(
        "| Lane | Score | Verdict | Basis |",
        "| Lane | Score | Verdict | Score rationale |",
    ).replace(
        "| W3 preconditions | 4 | NO-GO | Executing artifact is not pinned. |",
        "| W3 preconditions | 42 | NO-GO | fixed in 3 days |",
    )
    findings = lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    assert "score-out-of-range" in rules(findings)


def test_first_score_like_header_wins_when_no_header_is_exact_score():
    ballot = GREEN.replace(
        "| Lane | Score | Verdict | Basis |",
        "| Lane | Score (1-10) | Verdict | Score rationale |",
    ).replace(
        "| W3 preconditions | 4 | NO-GO | Executing artifact is not pinned. |",
        "| W3 preconditions | 42 | NO-GO | fixed in 3 days |",
    )
    findings = lint.validate_ballot(ballot, lanes=LANES, author_seat="planAuthor", sentinel=SENTINEL)
    assert "score-out-of-range" in rules(findings)


def test_seat_splitter_stops_at_first_matching_sentinel_after_heading():
    collab = GREEN.replace("# Plan council ballot — GREEN", "## @council-R1 ballot")
    collab += (
        "\n## @lead routing note\n\n"
        "A later post quotes the same sentinel:\n\n"
        f"{SENTINEL}\n"
    )
    ballot = lint.extract_seat_ballot(collab, seat="R1", sentinel=SENTINEL)
    assert "routing note" not in ballot
    assert ballot.count(SENTINEL) == 1
    assert ballot.rstrip().endswith(SENTINEL)


def test_cli_reports_missing_seat_sentinel_without_traceback(tmp_path, capsys):
    collab_path = tmp_path / "missing-seat-sentinel.md"
    collab_path.write_text("## R1 ballot\n\n| Lane | Score |\n|---|---:|\n")
    assert lint_cli.main(
        [
            str(collab_path),
            "--seat",
            "R1",
            "--author-seat",
            "planAuthor",
            "--sentinel",
            SENTINEL,
        ]
    ) == 2
    output = capsys.readouterr().out
    assert output.startswith("error: ")
    assert "Traceback" not in output

"""RED→GREEN replay for the plan-council conservative merge law."""

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("plan_council_bias", ROOT / "council_bias.py")
bias = importlib.util.module_from_spec(spec)
sys.modules["plan_council_bias"] = bias
spec.loader.exec_module(bias)


def test_conservative_non_family_read_governs_merge():
    report = bias.analyze_directory(ROOT / "fixtures" / "ballots-red", author_family="fable")
    lane = next(row for row in report["lanes"] if row["lane"] == "3d migration ledger")
    assert lane["scores"] == {"opus": 3.0, "sol": 4.2, "fable": 8.0}
    assert lane["conservative_non_family"] == 3.0
    assert lane["same_family_delta"] == 5.0
    assert lane["bias_flag"] is True


def test_two_point_delta_is_flagged_inclusively():
    report = bias.analyze_directory(ROOT / "fixtures" / "ballots-red", author_family="fable")
    lane = next(row for row in report["lanes"] if row["lane"] == "boundary lane")
    assert lane["same_family_delta"] == 2.0
    assert lane["bias_flag"] is True


def test_bad_declared_merge_causes_nonzero_exit():
    report = bias.analyze_directory(ROOT / "fixtures" / "ballots-red", author_family="fable")
    assert report["bad_merges"] == ["3d migration ledger"]
    assert bias.main([str(ROOT / "fixtures" / "ballots-red"), "--author-family", "fable"]) == 1


def test_green_bias_directory_is_clean_and_exits_zero():
    report = bias.analyze_directory(ROOT / "fixtures" / "ballots-green", author_family="fable")
    assert report["bad_merges"] == []
    assert not any(row["bias_flag"] for row in report["lanes"])
    assert bias.main([str(ROOT / "fixtures" / "ballots-green"), "--author-family", "fable"]) == 0


def test_lane_names_are_merged_case_insensitively(tmp_path):
    ballots = {
        "r1.md": "| Lane | Score | Merged |\n|---|---:|---:|\n| W3 Preconditions | 4 | 4 |\n\n— R1 · opus · Claude Code\n",
        "r2.md": "| Lane | Score | Merged |\n|---|---:|---:|\n| w3 preconditions | 5 | 4 |\n\n— R2 · sol · Codex\n",
        "r3.md": "| Lane | Score | Merged |\n|---|---:|---:|\n| W3 preconditions | 7 | 4 |\n\n— R3 · fable · Claude CLI\n",
    }
    for name, content in ballots.items():
        (tmp_path / name).write_text(content)
    report = bias.analyze_directory(tmp_path, author_family="fable")
    assert len(report["lanes"]) == 1
    assert report["lanes"][0]["scores"] == {"opus": 4.0, "sol": 5.0, "fable": 7.0}
    assert report["lanes"][0]["conservative_non_family"] == 4.0


def test_real_ballots_produce_measured_bias_table():
    report = bias.analyze_directory(ROOT / "fixtures" / "real-ballots", author_family="fable")
    ledger = next(row for row in report["lanes"] if row["lane_key"] == "3d")
    assert ledger["scores"] == {"opus": 3.0, "sol": 4.2, "fable": 8.0}
    assert ledger["conservative_non_family"] == 3.0
    assert ledger["same_family_delta"] == 5.0


# AIDEV-NOTE: four-seat council (Neon R4, Etan 2026-11-24 via orc). Family = model family: opus, sol,
# fable and neon are four families; Fable stays its own declared family, so a Claude (Opus) author's
# merge is min(sol, fable, neon). Run through the real CLI, with the R4 signature seat-briefs.md prescribes.
import subprocess


def _four_seat(tmp_path, merged):
    seats = [("r1.md", 9, "— R1 · opus · Claude Code"), ("r2.md", 8, "— R2 · sol · Codex"),
             ("r3.md", 3, "— R3 · fable · Claude CLI"), ("r4.md", 9, "— R4 · gemini · Antigravity")]
    for name, score, signature in seats:
        (tmp_path / name).write_text(
            f"| Lane | Score | Merged |\n|---|---:|---:|\n| W3 preconditions | {score} | {merged} |\n\n{signature}\n")
    return tmp_path


def _cli(directory, author_family):
    return subprocess.run([sys.executable, str(ROOT / "council_bias.py"), str(directory), "--author-family", author_family],
                          capture_output=True, text=True)


def test_four_seat_harvest_counts_the_neon_seat_for_an_opus_author(tmp_path):
    result = _cli(_four_seat(tmp_path, merged=3), "opus")
    assert result.returncode == 0, result.stdout + result.stderr
    header, _, row = result.stdout.splitlines()[:3]
    assert "| neon |" in header and "| opus |" in header
    report = bias.analyze_directory(tmp_path, author_family="opus")
    lane = report["lanes"][0]
    assert lane["scores"] == {"opus": 9.0, "sol": 8.0, "fable": 3.0, "neon": 9.0}
    assert lane["conservative_non_family"] == 3.0  # min(sol 8, fable 3, neon 9): Fable is its own family
    assert lane["same_family_delta"] == 6.0 and lane["bias_flag"] is True


def test_a_merge_that_drops_the_fable_seat_is_rejected(tmp_path):
    # Declaring min(sol, neon) = 8 for an Opus author would silently drop R3; the CLI refuses it.
    result = _cli(_four_seat(tmp_path, merged=8), "opus")
    assert result.returncode == 1 and "Invalid merge source" in result.stdout


def test_neon_authored_plan_excludes_only_the_neon_family(tmp_path):
    for author in ("neon", "gemini"):
        result = _cli(_four_seat(tmp_path, merged=3), author)
        assert result.returncode == 0, result.stdout + result.stderr
        report = bias.analyze_directory(tmp_path, author_family=author)
        assert report["author_family"] == "neon"
        lane = report["lanes"][0]
        assert lane["conservative_non_family"] == 3.0  # min(opus 9, sol 8, fable 3)
        assert lane["same_family_delta"] == 6.0


def test_ambiguous_claude_author_family_fails_closed(tmp_path):
    # "claude" names a vendor with two council families (opus, fable); guessing would let the
    # author's own family into the merge. Refuse and name the families instead.
    result = _cli(_four_seat(tmp_path, merged=3), "claude")
    assert result.returncode == 2
    assert "opus" in result.stdout and "fable" in result.stdout


# AIDEV-NOTE: only Neon holds R4 (Sol r2 on #1359). The bare alias `gemini` (the prescribed R4 signature) or a
# name containing the word `neon` counts as the neon family; every other Gemini model has no council family.
_REJECTED_GEMINI = ["gemini-flash", "gemini-4-argon", "gemini-4-hydrogen", "gemini-pro", "gemini-4", "gemini 3.1 pro", "gemini-4-carbon"]
_ACCEPTED_NEON = ["gemini", "neon", "gemini-4-neon", "gemini-pro-orchestrator-neon", "Gemini 4 Neon (High)"]


def _with_r4_family(tmp_path, family):
    directory = tmp_path / family.replace(" ", "_").replace("(", "").replace(")", "")
    directory.mkdir()
    _four_seat(directory, merged=3)
    (directory / "r4.md").write_text(
        f"| Lane | Score | Merged |\n|---|---:|---:|\n| W3 preconditions | 9 | 3 |\n\n— R4 · {family} · Antigravity\n")
    return directory


def test_older_gemini_models_cannot_sign_the_neon_seat(tmp_path):
    for family in _REJECTED_GEMINI:
        result = _cli(_with_r4_family(tmp_path, family), "opus")
        assert result.returncode == 2, (family, result.stdout)
        assert "no recognized model family" in result.stdout, (family, result.stdout)


def test_neon_names_and_the_bare_gemini_alias_count_as_the_neon_family(tmp_path):
    for family in _ACCEPTED_NEON:
        directory = _with_r4_family(tmp_path, family)
        result = _cli(directory, "opus")
        assert result.returncode == 0, (family, result.stdout + result.stderr)
        assert bias.analyze_directory(directory, author_family="opus")["lanes"][0]["scores"]["neon"] == 9.0, family

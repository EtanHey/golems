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

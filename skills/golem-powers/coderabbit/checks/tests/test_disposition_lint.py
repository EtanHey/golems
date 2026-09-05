"""RED→GREEN replay for the coderabbit review-disposition gate (gen-18 Track 6 D5)."""

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("disposition_lint", ROOT / "disposition_lint.py")
dl = importlib.util.module_from_spec(spec)
sys.modules["disposition_lint"] = dl
spec.loader.exec_module(dl)

RED = (ROOT / "fixtures" / "red-disposition.md").read_text()
GREEN = (ROOT / "fixtures" / "green-disposition.md").read_text()


def _rules(v):
    return {x["rule"] for x in v}


def test_red_log_trips_silent_skip_and_undisposed_critical():
    rules = _rules(dl.validate_dispositions(RED))
    assert "silent-skip" in rules
    assert "undisposed-critical" in rules


def test_green_log_is_clean():
    assert dl.validate_dispositions(GREEN) == []


def test_undisposed_critical_flagged():
    log = "Status: COMPLETED\n- CRITICAL: auth bypass\n- HIGH: x — FIXED\n"
    assert any(v["rule"] == "undisposed-critical" for v in dl.validate_dispositions(log))


def test_disposed_critical_clean():
    for disp in ["FIXED", "WAIVED", "ACCEPTED", "won't-fix"]:
        log = f"Status: COMPLETED\n- CRITICAL: auth bypass — {disp} (rationale)\n"
        assert not any(v["rule"] == "undisposed-critical" for v in dl.validate_dispositions(log)), disp


def test_negated_or_prose_fixed_is_not_a_disposition():
    # PR #539 Bugbot: "not fixed yet" / "the fixed-width buffer" contain "fixed" but are
    # not a disposition — the CRITICAL must still be flagged.
    for body in [
        "Status: COMPLETED\n- CRITICAL: auth bypass — not fixed yet\n",
        "Status: COMPLETED\n- CRITICAL: race in the fixed-width timer\n",
        "Status: COMPLETED\n- CRITICAL: never fixed the overflow\n",
    ]:
        assert any(v["rule"] == "undisposed-critical" for v in dl.validate_dispositions(body)), body


def test_skip_with_reason_is_clean():
    log = "Status: SKIPPED — OSS rate limit hit; fell back to red-team prompt review\n- HIGH: x — FIXED\n"
    assert not any(v["rule"] == "silent-skip" for v in dl.validate_dispositions(log))


def test_bare_skip_without_reason_flagged():
    assert any(v["rule"] == "silent-skip" for v in dl.validate_dispositions("Status: SKIPPED\n"))
    assert any(v["rule"] == "silent-skip" for v in dl.validate_dispositions("Status: rate-limited\n"))


def test_missing_status_flagged():
    assert any(v["rule"] == "missing-status" for v in dl.validate_dispositions("- HIGH: x — FIXED\n"))


def test_non_critical_findings_need_no_disposition():
    # Only CRITICAL is hard-gated; HIGH/MEDIUM/LOW without a disposition are allowed.
    log = "Status: COMPLETED\n- HIGH: x\n- MEDIUM: y\n- LOW: z\n"
    assert dl.validate_dispositions(log) == []

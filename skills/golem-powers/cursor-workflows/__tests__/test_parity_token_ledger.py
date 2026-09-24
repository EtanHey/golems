from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


PARITY_DIR = Path(__file__).resolve().parents[1] / "evals" / "parity"
PARITY = PARITY_DIR / "run_parity.py"
sys.path.insert(0, str(PARITY_DIR))  # run_parity imports its sibling modules


def load_run_parity():
    spec = importlib.util.spec_from_file_location("run_parity", PARITY)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ledger_inputs(billing="flat_rate"):
    red = {"red_arm": {"token_usage": {"total_tokens": 900}}}
    green = {"usage": {"total_tokens": 120}, "billing": {"cursor": billing}}
    return red, green


def test_token_ledger_line_prints_the_validated_billing_mode():
    run_parity = load_run_parity()
    red, green = ledger_inputs()
    assert run_parity.token_ledger_line(red, green) == (
        "token_ledger=cursor_total_tokens=120 cursor_billing=flat_rate "
        "claude_red_total_tokens=900"
    )


def test_token_ledger_line_rejects_non_flat_rate_billing():
    run_parity = load_run_parity()
    red, green = ledger_inputs(billing="metered")
    with pytest.raises(run_parity.ParityError, match="flat_rate"):
        run_parity.token_ledger_line(red, green)

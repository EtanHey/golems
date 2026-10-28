"""The M1 Pro write exception is bounded by one reviewed procedure."""
import hashlib
from pathlib import Path
import re

AGENTS = Path(__file__).resolve().parents[1] / "agents"
PIN = "1558e91ec5cef1e1b1c73c5f84c4b9042e5d31fce1ee7b70c7e7eda8baf675aa"


def test_m1_install_scope():
    text = (AGENTS / "deploy-local-prod.md").read_text()
    for required in (
        "~/.claude/skills", "~/.agents/skills", "~/.codex/skills",
        "~/.cursor/skills", "~/.gemini/config/skills", "~/.golems/bin",
        "~/.golems/releases", "~/.golems/current", "Claude/Codex client hooks",
        "/Applications", "LaunchAgents/launchctl", "BrainLayer", "brew",
        "~/.codex/config.toml", "~/.ssh/known_hosts", "~/.local/state/golems/install-receipts/", "post-checks",
        "VERBATIM", "§7 footprint only", "roll back and STOP",
        "m1-golems-install-PROCEDURE.md", "M4 Max", "M1 Pro",
    ):
        assert required in text, required
    assert "Everything else on the M1 Pro stays read-only" in text
    assert not re.search(r"until Etan authorizes|Write no receipt on the M1", text)
    # Every other M1 instruction must refer to the single scoped rule.
    for line in text.splitlines():
        if "M1" in line and not line.startswith(">") and "Contract 1" not in line:
            assert line.startswith("   "), line


def test_m1_procedure_pin_and_rulings():
    procedure = (AGENTS.parent / "workflows/m1-golems-install-PROCEDURE.md").read_bytes()
    assert hashlib.sha256(procedure).hexdigest() == PIN
    text = (AGENTS / "deploy-local-prod.md").read_text()
    quotes = [line for line in procedure.decode().splitlines()
              if line.startswith("> brainbar-")]
    assert len(quotes) == 3
    for quote in quotes:
        assert quote in text

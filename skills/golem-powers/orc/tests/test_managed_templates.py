"""Public managed agents and templates must use the post-release recall modes."""
import json
import re
from pathlib import Path

import pytest

AGENTS = Path(__file__).resolve().parents[1] / "agents"
SKILLS = Path(__file__).resolve().parents[3]
VALID_MODES = {"context", "stats", "injections"}
CALL = re.compile(r"\b(?:mcp__brainlayer__)?brain_recall\s*\(([^)]*)\)", re.S)
MODE = re.compile(r"\bmode\s*[:=]\s*([\"'])((?:(?!\1).)*)\1", re.S)


def recall_modes(text):
    return [m.group(2) for call in CALL.finditer(text)
            if (m := MODE.search(call.group(1)))]


@pytest.mark.parametrize("mode", ["context", "stats", "injections", "sessions", "summary"])
def test_mode_scanner_recognizes_qualified_and_multiline_calls(mode):
    text = f'mcp__brainlayer__brain_recall(\n mode="{mode}") brain_recall(mode: \'{mode}\')'
    # Qualified MCP names must be scanned as well as bare calls.
    assert recall_modes(text) == [mode, mode]


def test_all_managed_agent_recall_modes_are_valid():
    for path in SKILLS.rglob("*.md"):
        if "agents" not in path.relative_to(SKILLS).parts:
            continue
        text = path.read_text()
        invalid = set(recall_modes(text)) - VALID_MODES
        assert not invalid, f"{path.name}: unsupported recall modes {sorted(invalid)}"


def test_template_manifests_declare_exactly_the_placeholder_names():
    for path in (AGENTS / "templates").glob("*.md"):
        manifest = json.loads(path.with_suffix(".values.json").read_text())
        values = manifest["values"]
        names = [v["name"] for v in values]
        assert manifest["template"] == path.name
        assert len(names) == len(set(names))
        assert set(names) == set(re.findall(r"{{([A-Z][A-Z0-9_]*)}}", path.read_text()))
        for value in values:
            assert set(value) == {"name", "sensitive", "purpose"}
            assert isinstance(value["sensitive"], bool)
            assert value["purpose"]

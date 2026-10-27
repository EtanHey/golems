"""Every PR-F T3 settle site explicitly releases the child's provider session."""

from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[2] / "skills/golem-powers"


@pytest.mark.parametrize("path,start,end", [
    ("agent-routing/SKILL.md", "4. **Settle:**", "5. **Review rounds:**"),
    ("agent-routing/SKILL.md", "**Settle at the terminal state:**", "cmux adapter: harvest"),
    ("agent-routing/references/t3-native.md", "## 4. On wake:", "## 5. Review rounds"),
    ("large-plan/SKILL.md", "6. **Settle**", "### cmux adapter:"),
    ("large-plan/SKILL.md", "| **Watch cleanup (plan done)** |", "\n"),
])
def test_t3_settle_detaches_provider_session(path, start, end):
    text = (SKILLS / path).read_text()
    offset = text.index(start)
    site = text[offset:text.index(end, offset + len(start))]
    assert "`t3_thread_organize`" in site, f"{path}: {start} must detach the child"
    assert "action `settle`" in site, f"{path}: {start} must name the settle action"

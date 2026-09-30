from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_templates_define_gatherer_without_model_tier():
    agent = (ROOT / "templates/gemini/agents/gatherer.md").read_text()
    for field in ("name: gatherer", "mainAgent: true", "subagent: false", "inheritMcp: true", "/agent-routing"):
        assert field in agent
    assert "Gemini 3." not in agent
    assert "Never implement" in agent and "code review" in agent


from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
TIER = re.compile(r"\b(?:flash|pro|high|low|medium|minimal|maximum|max|xhigh|ultra|lite|effort|thinking|sonnet|opus|haiku|gpt)\b|\bgemini\s*[-:]?\s*\d", re.I)
PERSONA_BOOT = re.compile(r"\b(?:persona|boot|brain_recall|initialization|ceremonies|orchestrator)\b|you are (?:the|a) .*lead", re.I)


def test_templates_define_gatherer_without_model_tier():
    agent = (ROOT / "templates/gemini/agents/gatherer.md").read_text()
    for field in ("name: gatherer", "mainAgent: true", "subagent: false", "inheritMcp: true"):
        assert field in agent
    for template in (agent, (ROOT / "templates/gemini/GEMINI.md").read_text()):
        assert "/agent-routing" in template
        assert not TIER.search(template), "hardcoded model or tier"
        assert not PERSONA_BOOT.search(template), "persona or boot instructions"
        assert "Never implement" in template and "code review" in template

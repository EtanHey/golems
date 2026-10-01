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


def test_gatherer_writes_only_brief_named_reports_and_one_receipt():
    for path in ("templates/gemini/agents/gatherer.md", "templates/gemini/GEMINI.md"):
        template = (ROOT / path).read_text()
        for clause in ("brief names a findings/report path", "docs.local/", "engine-issued report path",
                       "never create a file inside tracked source", "exactly one receipt line",
                       "collab file the brief names", "### <id> → <lead> — <gather> findings: <path>",
                       "No other file writes", "no code, config, tests or docs edits",
                       "no git commits", "no installs"):
            assert clause in template, f"{path}: missing {clause}"


def test_gatherer_keeps_default_tools_for_scoped_writes():
    agent = (ROOT / "templates/gemini/agents/gatherer.md").read_text()
    frontmatter = agent.split("---", 2)[1]
    assert "retain default file tools for scoped report/receipt writes" in frontmatter
    assert not re.search(r"^(?:tools|excludeDefaultComponents):", frontmatter, re.M)

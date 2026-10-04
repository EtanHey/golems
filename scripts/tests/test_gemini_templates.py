from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
TIER = re.compile(r"\b(?:flash|pro|high|low|medium|minimal|maximum|max|xhigh|ultra|lite|effort|thinking|sonnet|opus|haiku|gpt)\b|\bgemini\s*[-:]?\s*\d", re.I)
PERSONA_BOOT = re.compile(r"\b(?:persona|boot|brain_recall|initialization|ceremonies|orchestrator)\b|you are (?:the|a) .*lead", re.I)


def test_templates_define_gatherer_without_model_tier():
    agent = (ROOT / "templates/gemini/agents/gatherer.md").read_text()
    for field in ("name: gatherer", "mainAgent: true", "subagent: false", "inheritMcp: false"):
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
                       "never write to a tracked file",
                       "the findings path must be under `docs.local/` or the engine-issued report path",
                       "append exactly one receipt line", "never edit, reorder or delete existing collab lines",
                       "collab file the brief names", "### <id> → <lead> — <gather> findings: <path>",
                       "No other file writes", "no code, config, tests or docs edits",
                       "no git commits", "no installs"):
            assert clause in template, f"{path}: missing {clause}"


def test_gatherer_tools_allow_scoped_writes_and_declared_brain_worker_without_shell():
    agent = (ROOT / "templates/gemini/agents/gatherer.md").read_text()
    frontmatter = agent.split("---", 2)[1]
    assert "tools:" in frontmatter
    tools = re.findall(r"^  - (\w+)$", frontmatter, re.M)
    assert set(tools) == {"view_file", "read_url_content", "search_web", "send_message",
                          "write_to_file", "replace_file_content",
                          "list_dir", "grep_search", "find_by_name", "invoke_subagent"}
    assert len(tools) == 10
    assert "call_mcp_tool" not in tools
    assert "inheritMcp: false" in frontmatter
    assert "run_command" not in tools
    assert "agents: [brain-worker]" in frontmatter
    assert not re.search(r"^excludeDefaultComponents:", frontmatter, re.M)


def test_gatherer_has_no_explicit_mcp_servers():
    frontmatter = (ROOT / "templates/gemini/agents/gatherer.md").read_text().split("---", 2)[1]
    assert not re.search(r"^\s*mcpServers\s*:", frontmatter, re.M)


def test_gatherer_has_no_command_or_terminal_tools():
    frontmatter = (ROOT / "templates/gemini/agents/gatherer.md").read_text().split("---", 2)[1]
    tools = re.findall(r"^  - (\w+)$", frontmatter, re.M)
    assert "run_command" not in tools
    assert not any(tool.endswith("_terminal") for tool in tools)

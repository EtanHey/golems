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
                          "list_dir", "grep_search", "find_by_name", "invoke_subagent", "manage_subagents", "wait"}
    assert len(tools) == 12
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


def test_shell_worker_profile_has_scoped_shell_without_inheritance():
    template = (ROOT / "templates/gemini/agents/shell-worker.md").read_text()
    frontmatter = template.split("---", 2)[1]
    for field in ("name: shell-worker", "mainAgent: true", "subagent: false",
                  "inheritMcp: false", "inheritCustomizations: false"):
        assert re.search(rf"^{field}$", frontmatter, re.M)
    tools = re.findall(r"^  - (\w+)$", frontmatter, re.M)
    assert set(tools) == {"run_command", "view_file", "write_to_file",
                          "replace_file_content", "list_dir", "grep_search",
                          "find_by_name", "send_message"}
    assert len(tools) == 8
    assert not re.search(r"^\s*(?:agents|mcpServers)\s*:", frontmatter, re.M)
    assert "/agent-routing" in template
    assert not TIER.search(template)
    assert not PERSONA_BOOT.search(template)
    for clause in ("exactly the brief's task", "your own shell", "background",
                   "logs", "PID", "exit-status", "brief's artifact directory",
                   "Write only where the brief allows", "never read other agents' reports",
                   "inboxes, briefs or collabs unless the brief names them",
                   "STOP and report in one line", "Never explore instead",
                   "No git commits, installs or persistent config changes",
                   "unless the brief explicitly allows them",
                   "Never open, inspect, or type into cmux panes", "NOT DONE",
                   "Never use open -a, osascript", "app/GUI/browser driving",
                   "No outward messages or posts beyond the brief"):
        assert clause in template

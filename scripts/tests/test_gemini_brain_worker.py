from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def metadata(name):
    text = (ROOT / f"templates/gemini/agents/{name}.md").read_text()
    return text.split("---", 2)[1]


def list_field(frontmatter, name):
    block = re.search(rf"^{name}:\n((?:  [^\n]*\n)+)", frontmatter, re.M)
    assert block, f"missing {name} list"
    return re.findall(r"^  - (\S+)$", block[1], re.M)


def test_brain_worker_is_isolated_read_only_subagent():
    agent = metadata("brain-worker")
    for field in ("subagent: true", "mainAgent: false", "inheritMcp: false",
                  "inheritCustomizations: false", "model: flash"):
        assert re.search(rf"^{field}$", agent, re.M)
    assert set(list_field(agent, "tools")) == {
        "view_file", "grep_search", "find_by_name", "list_dir", "send_message"
    }
    # A mapping silently drops the whole agent in agy 1.2.14; use a list.
    servers = agent.split("mcpServers:\n", 1)[1]
    assert len(re.findall(r"^\s*-\s+name:", servers, re.M)) == 1
    assert re.findall(r"^\s*-\s+name: (\S+)$", servers, re.M) == ["brainlayer"]
    assert not re.search(r"^\s*disabledTools:", servers, re.M)
    assert "mcpServers:\n  - name: brainlayer\n" in agent
    assert "    command: /opt/homebrew/bin/brainlayer-mcp-stdio-bridge\n" in agent
    # An allowlist also rejects future writes, not only today's brain_store.
    block = agent.split("    enabledTools:\n", 1)[1]
    assert set(re.findall(r"^      - (\S+)$", block, re.M)) == {
        "brain_search", "brain_recall", "brain_expand"
    }


def test_gatherer_declares_brain_worker_dependency_and_invocation():
    agent = metadata("gatherer")
    assert 'agents: [brain-worker]' in agent
    assert re.search(r"^inheritCustomizations: false$", agent, re.M)
    assert "invoke_subagent" in list_field(agent, "tools")
    assert "run_command" not in list_field(agent, "tools")


def test_no_mcp_dispatcher_registry_component_in_any_agent():
    for path in (ROOT / "templates/gemini/agents").glob("*.md"):
        agent = metadata(path.stem)
        tools = list_field(agent, "tools")
        assert "call_mcp_tool" not in tools
        if "invoke_subagent" in tools:
            assert re.search(r"^inheritCustomizations: false$", agent, re.M)

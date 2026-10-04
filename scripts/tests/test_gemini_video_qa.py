"""Video QA runs media commands locally without ambient MCP or delegation."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def metadata():
    return (ROOT / "templates/gemini/agents/video-qa.md").read_text().split("---", 2)[1]


def tools():
    return set(re.findall(r"^  - (\w+)$", metadata(), re.M))


def test_video_qa_is_primary_without_inheritance():
    for field in ("name: video-qa", "mainAgent: true", "subagent: false",
                  "inheritMcp: false", "inheritCustomizations: false"):
        assert re.search(rf"^{field}$", metadata(), re.M)


def test_video_qa_has_no_mcp_servers_or_cmux_tools():
    front = metadata()
    assert not re.search(r"^\s*mcpServers\s*:", front, re.M)
    assert "cmuxlayer" not in front
    assert "call_mcp_tool" not in tools()


def test_video_qa_can_run_and_manage_background_commands():
    # run_command is the registry component; its runtime command helpers are
    # checked by the renamed live profile canary, not registered separately.
    assert "run_command" in tools()


def test_video_qa_can_read_and_write_evidence():
    assert {"view_file", "write_to_file", "replace_file_content", "list_dir",
            "grep_search", "find_by_name", "send_message"} <= tools()


def test_video_qa_has_no_subagent_delegation():
    assert not re.search(r"^\s*agents\s*:", metadata(), re.M)
    assert "invoke_subagent" not in tools()

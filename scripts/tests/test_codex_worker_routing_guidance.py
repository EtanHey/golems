"""Ordinary Codex children must explicitly select the lean T3 worker instance."""

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROUTING = REPO / "skills/golem-powers/agent-routing"
LAUNCH_ARGS = (
    "-c plugins._default.enabled=true "
    "-c plugins.codex-security@openai-curated-remote.enabled=false "
    "-c plugins.computer-history@openai-bundled.enabled=false "
    "-c plugins.computer-use@openai-bundled.enabled=false "
    "-c plugins.unified-computer-use@openai-bundled.enabled=false "
    "-c mcp_servers.node_repl.enabled=false -c thread_unload_delay_secs=60"
)


def test_codex_worker_routing_and_recreate_guidance():
    skill = (ROUTING / "SKILL.md").read_text()
    dispatch = skill.split("## T3-native dispatch\n", 1)[1].split("\n## ", 1)[0]
    discover = dispatch.split("2. **Dispatch:**", 1)[0]
    assert 'target.providerInstanceId: "codex-worker"' in discover
    for group in (
        "ordinary Codex implementers, recon and reviewers",
        "security (implementers + scans)",
        "UI / computer-use recorders",
        "browser / web-QA workers",
        "leads and Etan",
    ):
        assert group in discover, group
    assert "inherit" in discover
    for server in ("codex-security", "computer-history", "node_repl", "cua_repl"):
        assert server in discover, server

    reference = (ROUTING / "references/t3-native.md").read_text()
    instances = reference.split("## Codex instances\n", 1)[1].split("\n## ", 1)[0]
    definition = json.loads(re.search(r"```json\n(.*?)\n```", instances, re.S)[1])
    assert definition["id"] == "codex-worker"
    assert definition["driver"] == "codex"
    assert definition["binaryPath"] == (
        "/Users/etanheyman/.codex/packages/standalone/releases/"
        "0.164.0-aarch64-apple-darwin/bin/codex"
    )
    assert definition["CODEX_HOME"] == "/Users/etanheyman/.codex"
    assert definition["launchArgs"] == LAUNCH_ARGS
    for required in (
        "inherit", "~/.t3/userdata/settings.json", "providerInstances",
        "hot-reloaded", "remove the entry", "no credential copy",
        "G-verify", "every Codex CLI upgrade", "0.164-specific",
        "orchestrator_capabilities", "fall back to `codex` and report",
    ):
        assert required in instances, required

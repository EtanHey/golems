"""Ordinary Codex children must explicitly select the lean T3 worker instance."""

import json
import re
import shlex
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROUTING = REPO / "skills/golem-powers/agent-routing"
LAUNCH_ARGS = (
    "-c plugins._default.enabled=true "
    "-c plugins.'codex-security@openai-curated-remote'.enabled=false "
    "-c plugins.'computer-history@openai-bundled'.enabled=false "
    "-c plugins.'computer-use@openai-bundled'.enabled=false "
    "-c plugins.'unified-computer-use@openai-bundled'.enabled=false "
    "-c mcp_servers.node_repl.enabled=false "
    "-c thread_unload_delay_secs=60"
)


def guidance():
    skill = (ROUTING / "SKILL.md").read_text()
    dispatch = skill.split("## T3-native dispatch\n", 1)[1].split("\n## ", 1)[0]
    reference = (ROUTING / "references/t3-native.md").read_text()
    # Accept either heading while testing the pre-fix artifact; N6 checks placement.
    instances = reference.split("Codex instances\n", 1)[1].split("\n## ", 1)[0]
    return dispatch.split("2. **Dispatch:**", 1)[0], instances, reference


def test_l1_n5_settings_entry_and_upgrade_following_binary():
    _, instances, _ = guidance()
    definition = json.loads(re.search(r"```json\n(.*?)\n```", instances, re.S)[1])
    assert set(definition) == {"providerInstances"}
    entry = definition["providerInstances"]["codex-worker"]
    assert set(entry) == {"driver", "displayName", "config"}
    assert entry["driver"] == "codex"
    assert entry["displayName"] == "Codex worker (lean MCP)"
    assert entry["config"] == {
        "binaryPath": "~/.local/bin/codex", "launchArgs": LAUNCH_ARGS,
    }
    parsed_args = shlex.split(entry["config"]["launchArgs"])
    for plugin in ("codex-security@openai-curated-remote", "computer-history@openai-bundled",
                   "computer-use@openai-bundled", "unified-computer-use@openai-bundled"):
        assert f"plugins.{plugin}.enabled=false" in parsed_args
    for required in ("~/.local/bin/codex", "never a versioned release path", "expand `~` to your home",
                     "shared `~/.codex`", "no credential copy",
                     "hot-reloaded", "remove the entry"):
        assert required in instances, required


def test_l2_n5_server_environment_precondition():
    _, instances, _ = guidance()
    assert "only in its child environment" not in instances
    for required in ("must stay unset", "REPLACES", "every Codex instance", "codexLaunchArgs.ts:5-8",
                     "launchctl getenv T3CODE_CODEX_LAUNCH_ARGS", "T3 server env"):
        assert required in instances, required


def test_b3_live_upgrade_recheck_is_self_contained():
    _, instances, _ = guidance()
    for required in ("every Codex CLI upgrade", "dispatches this one-shot check to read-only children",
                     "only reads their reports", "read-only child on the running `codex` instance",
                     "one trivial read-only delegate",
                     'target.providerInstanceId: "codex-worker"', "own ancestry", "codex app-server",
                     "children by family", "PASS", "codex-security", "computer-history",
                     "node_repl", "cua_repl", "all 0", "BrainLayer and VoiceLayer present",
                     "no other new MCP family", "`codex` instance", "C1", "FAIL",
                     "ordinary work on `codex`", "lifecycle lead, else skill-creator"):
        assert required in instances, required
    assert "G-verify" not in instances
    assert "docs.local" not in instances


def test_n1_explicit_instance_and_provider_specific_inheritance():
    discover, instances, _ = guidance()
    for text in (discover, instances):
        for required in ('target.providerInstanceId: "codex-worker"', "Codex child inherits",
                         "Claude lead", "codex driver", "T3 lists first", "always name the instance"):
            assert required in text, required
    assert "OrchestratorMcpService.ts:1337-1386" in instances


def test_n2_work_type_selects_instance_and_reviewer_exceptions():
    discover, instances, _ = guidance()
    for text in (discover, instances):
        for required in ("ordinary Codex implementers, recon and reviewers",
                         "security (implementers + scans)", "UI / computer-use recorders",
                         "browser / web-QA workers", "leads and Etan",
                         "the role picks the model, the work type picks the instance",
                         "Codex reviewers on security or full-panel PRs stay on `codex`"):
            assert required in text, required
    for server in ("codex-security", "computer-history", "node_repl", "cua_repl"):
        assert server in discover, server


def test_n3_missing_instance_falls_back_per_dispatch_and_reports_to_lead():
    _, instances, _ = guidance()
    for required in ("orchestrator_capabilities", "fall back to `codex`", "per dispatch",
                     "report to the lead", "not a BLOCKED condition", "an instance isn't a model",
                     "Recreating the instance is a lead action"):
        assert required in instances, required


def test_n4_leads_count_worker_dispatches_in_status():
    _, instances, _ = guidance()
    assert "Leads note in their STATUS how many of their Codex dispatches named `codex-worker`." in instances


def test_n6_instances_is_under_discover_and_link_resolves():
    _, _, reference = guidance()
    discover = reference.split("## 1. Discover\n", 1)[1].split("\n## 2. Dispatch", 1)[0]
    assert "\n### Codex instances\n" in discover
    assert "\n## Codex instances\n" not in reference
    assert "references/t3-native.md#codex-instances" in (ROUTING / "SKILL.md").read_text()

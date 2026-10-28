"""The M1 Pro write exception is bounded by one reviewed procedure."""
import hashlib
from pathlib import Path
import re
import subprocess

import pytest

AGENTS = Path(__file__).resolve().parents[1] / "agents"
PIN = "d64b9400d1984cb353ca14f0b05aba00a81fc40e142787efa3e3015ab57bdc44"


# Reviewed Contract 1 scope; changes require explicit review of the complete block.
APPROVED_SCOPE = """   **M1 Pro scoped rule:** after each guarded golems merge, run the tracked
   [M1 Pro golems-install procedure](../workflows/m1-golems-install-PROCEDURE.md) **VERBATIM**.
   Allowed writes are its **§7 footprint only**, subject to its prerequisites, refusal gates,
   and bootstrap authority. Everything else on the M1 Pro stays read-only status reporting.
   The footprint names all five roots: ~/.claude/skills, ~/.agents/skills, ~/.codex/skills,
   ~/.cursor/skills, ~/.gemini/config/skills; ~/.golems/bin wrappers; ~/.golems/releases
   and ~/.golems/current; and golems' Claude/Codex client hooks (shared configuration only
   under the top-level `hooks` key). No independent install, restart, upgrade, reconnect,
   helper kill or process-changing probe is authorized outside that procedure.
   **Never:** /Applications, LaunchAgents/launchctl, BrainLayer (DB, daemon, socket, jobs),
   brew, ~/.codex/config.toml, ~/.ssh/known_hosts. If any changes, roll back and STOP
   under the procedure's recovery rules; never improvise a protected-state repair.
   DONE requires the procedure's receipt at ~/.local/state/golems/install-receipts/ and
   its post-checks. A bootstrap NO-RECEIPT is not DONE; preserve that verdict until a full run."""

# Exact reviewed M1 references outside the scoped rule (including M4-only traps).
APPROVED_REFERENCES = (
    '    - `host.alias`: `mbp` on the M4 Max (the schema accepts only `mbp` or `m1`).',
    'description: Last-hop deploy agent for Etan\'s two Macs. Owns release → install → restart → LIVE proof → seat reconnect for cmuxlayer, voicelayer, and brainlayer on M4 Max; M1 Pro golems installs follow Contract 1. Proves the artifact actually serves on the machine (doctor/ps/launchctl + stdio probe), then pushes `/mcp reconnect <server>` into every affected Claude seat itself. Never stores to BrainLayer, never asks a human to reconnect an MCP. Use when. a merge has landed and someone needs it LIVE on a Mac, a seat\'s MCP is stale after an upgrade, or "is it actually deployed on the M1 Pro?". Triggers. \'deploy to local prod\', \'last hop\', \'report M1 Pro status\', \'merged but not deployed\', \'reconnect the seats\'.',
    'Machines, per-product commands, script paths, the seat-reconnect mechanics, and the M1 Pro findings (Contract 1)',
    '   An M1 Pro UNREACHABLE row does not block an M4 Max deploy.',
    "   (e.g. Coach's on the M1 Pro) are report-only unless the caller explicitly authorizes a push; the M1 Pro restriction in Contract 1 still applies. Report",
    '   proof runs on M4 Max; M1 Pro actions and receipts follow Contract 1 exclusively.',
    '8. **Releases run on M4 Max only.** M1 Pro scope follows Contract 1 (no assumable `gh` auth).',
    '    FAILED with the returned `reasons`, as not done. M1 Pro receipt requirements follow Contract 1.',
    '| T7 | **M1 Pro PATH (Contract 1)** — non-interactive ssh lacks `/opt/homebrew/bin`; also no `timeout(1)` | prefix every remote command with `export PATH=/opt/homebrew/bin:$PATH;`; use node/perl timers |',
    '| T8 | **M1 Pro GitHub auth** cannot be assumed | never release from the M1 Pro; all M1 Pro actions follow Contract 1 |',
    "| T15 | **A keg upgrade does not reach BrainBar's hybrid search helper** — BrainBarDaemon resolves `opt/brainlayer/libexec/venv/bin/python` once when it spawns `brainlayer.brainbar_hybrid_helper`, and restarts it only if it died; deploy briefs exclude BrainBar, so the helper keeps the old keg (on 2026-09-14 the M1 Pro helper ran 1.5.24 from a DELETED Cellar while the keg was 1.5.26) | **M4 Max only (M1 Pro follows Contract 1), after each brainlayer keg install:** find the helper's PID with `pgrep -f 'brainlayer.brainbar_hybrid_helper'`. Require exactly one match; read its parent with `ps -o ppid= -p <pid>`, then inspect that parent's command with `ps -o command= -p <ppid>` and require BrainBarDaemon. Otherwise STOP and report. Send `kill <pid>` (TERM only, never -9; the helper only, never BrainBar). Wait until `kill -0 <old-pid>` fails; if it does not exit within a bounded wait, STOP and report. Trigger one `brain_search` via the `brainlayer-mcp-stdio-bridge` client (`/opt/homebrew/opt/brainlayer/bin/brainlayer-mcp-stdio-bridge`), which relays to `/tmp/brainbar.sock`. The respawned PID must differ from the old one and its parent must still be BrainBarDaemon (check `ps -o ppid= -p <new-pid>`, then `ps -o command= -p <ppid>`). No respawn → STOP and report. Confirm the new PID's `lsof` shows `Cellar/brainlayer/<new-version>/` |",
    'for M1 Pro, report the procedure receipt and post-checks per Contract 1, or observed status only.',
)


def assert_m1_scope(text):
    assert text.count(APPROVED_SCOPE) == 1, "Contract 1 scope changed"
    outside = text.replace(APPROVED_SCOPE, "", 1)
    procedure = (AGENTS.parent / "workflows/m1-golems-install-PROCEDURE.md").read_text()
    quotes = {line for line in procedure.splitlines() if line.startswith("> brainbar-")}
    for line in outside.splitlines():
        if re.search(r"\bm1\b", line, re.IGNORECASE):
            assert line in APPROVED_REFERENCES or line in quotes, (
                "Unapproved M1 statement: " + line
            )


def test_m1_install_scope():
    text = (AGENTS / "deploy-local-prod.md").read_text()
    for required in (
        "~/.claude/skills", "~/.agents/skills", "~/.codex/skills",
        "~/.cursor/skills", "~/.gemini/config/skills", "~/.golems/bin",
        "~/.golems/releases", "~/.golems/current", "Claude/Codex client hooks",
        "/Applications", "LaunchAgents/launchctl", "BrainLayer", "brew",
        "~/.codex/config.toml", "~/.ssh/known_hosts", "~/.local/state/golems/install-receipts/", "post-checks",
        "VERBATIM", "§7 footprint only", "roll back and STOP",
        "m1-golems-install-PROCEDURE.md", "M4 Max", "M1 Pro",
    ):
        assert required in text, required
    assert "Everything else on the M1 Pro stays read-only" in text
    assert not re.search(r"until Etan authorizes|Write no receipt on the M1", text)
    assert_m1_scope(text)


def test_m1_procedure_pin_and_rulings():
    procedure = (AGENTS.parent / "workflows/m1-golems-install-PROCEDURE.md").read_bytes()
    assert hashlib.sha256(procedure).hexdigest() == PIN
    text = (AGENTS / "deploy-local-prod.md").read_text()
    quotes = [line for line in procedure.decode().splitlines()
              if line.startswith("> brainbar-")]
    assert len(quotes) == 3
    for quote in quotes:
        assert quote in text


@pytest.mark.parametrize("directive", [
    "   Restart BrainLayer on the M1 Pro after every merge.",
    "Restart BrainLayer on the M1 Pro outside Contract 1.",
])
def test_m1_scope_rejects_independent_writes(directive):
    text = (AGENTS / "deploy-local-prod.md").read_text()
    with pytest.raises(AssertionError, match="Unapproved M1 statement"):
        assert_m1_scope(text + "\n" + directive + "\n")


APPROVED_DEPLOY_ROUTING = "  M1 Pro golems installs follow the deploy-local-prod agent's Contract 1 (Etan's #32 standing grant); everything else on the M1 stays untouched until the M1 test-rig adapter is active (§ Dispatch Boundaries)."
APPROVED_OTHER_STATE = "   and bootstrap authority. Everything else on the M1 Pro stays read-only status reporting."


def assert_no_blanket_m1_restrictions(text, *, is_routing=False):
    if is_routing:
        text, count = re.subn(
            r"(?ms)^### M1 test-rig adapter\n.*?(?=^## |\Z)", "", text
        )
        assert count == 1, "Expected exactly one M1 test-rig adapter section"
    for line in text.splitlines():
        # A read-only inspection command or an unrelated later sentence does
        # not say that M1 installs are forbidden. Inspect prose sentences.
        prose = re.sub(r"`[^`]*`", "", line)
        restriction = r"(?:untouched|read.only|off.limits)"
        if re.search(
            rf"\bm1(?: pro)?\s+(?:(?:is|stays|remains|must stay|must remain)\s+)?{restriction}"
            rf"|\bm1(?: pro)?\s+(?:golems )?installs?\b[^.!?;\n]*{restriction}"
            rf"|{restriction}\s+for golems installs[^.!?;\n]*\bm1\b",
            prose, re.I,
        ):
            assert line in (APPROVED_DEPLOY_ROUTING, APPROVED_OTHER_STATE), (
                "Blanket M1 restriction: " + line
            )


def test_golems_guidance_has_no_blanket_m1_install_restriction():
    root = AGENTS.parents[3]
    paths = subprocess.check_output(
        ["git", "ls-files", "-z", "*.md"], cwd=root
    ).decode().split("\0")
    for relative in filter(None, paths):
        path = root / relative
        assert_no_blanket_m1_restrictions(
            path.read_text(),
            is_routing=relative == "skills/golem-powers/agent-routing/SKILL.md",
        )


def test_routing_rejects_restored_blanket_m1_restriction():
    root = AGENTS.parents[3]
    text = (root / "skills/golem-powers/agent-routing/SKILL.md").read_text()
    assert text.count(APPROVED_DEPLOY_ROUTING) == 1
    old = "  The M1 stays untouched until the M1 test-rig adapter is active (§ Dispatch Boundaries)."
    with pytest.raises(AssertionError, match="Blanket M1 restriction"):
        assert_no_blanket_m1_restrictions(
            text.replace(APPROVED_DEPLOY_ROUTING, old), is_routing=True
        )

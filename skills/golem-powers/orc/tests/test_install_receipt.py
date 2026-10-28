"""Deploy contract requires probed receipt evidence and tracks schema field names."""

import json
import re
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[4]
AGENT = ROOT / "skills/golem-powers/orc/agents/deploy-local-prod.md"
FIELD = re.compile(r"`([a-z_]+(?:\.[a-z_]+(?:\[\])?)+)`")
NON_FIELDS = {"_build.py", "version.ok", "brainlayer.brainbar_hybrid_helper"}


def schema_has_field(schema, path):
    for part in path.split("."):
        schema = schema.get("properties", {}).get(part.removesuffix("[]"))
        if schema is None:
            return False
        if part.endswith("[]"):
            schema = schema.get("items", {})
    return True


def test_deploy_requires_written_live_receipt():
    text = AGENT.read_text()
    assert "Install receipt or it did not ship" in text
    assert "node scripts/install-receipt.mjs write -" in text
    assert re.search(r"DONE requires a written receipt with `verdict: LIVE`", text)
    assert "Never copy any target.* value" in text
    assert "into installed.* or activation.*" in text
    assert "Write no receipt on the M1" in text


def test_deploy_points_to_closed_schema():
    assert "Fields: the closed schema in `scripts/schemas/install-receipt-v1.mjs`" in AGENT.read_text()


def test_install_finished_at_has_a_session_source():
    text = AGENT.read_text()
    assert "`installed.version`, `installed.path`, `installed.install_finished_at`" in text
    assert "completion time of the install command you ran this session" in text


def test_host_alias_uses_schema_enum():
    assert "`host.alias`: `mbp` on the MacBook Pro (the schema accepts only `mbp` or `m1`)" in AGENT.read_text()


def test_all_times_are_converted_to_utc():
    assert "Write every time as UTC ISO-8601 with Z; convert brew's epoch seconds and ps local times" in AGENT.read_text()


def test_release_identity_comes_from_the_remote_tag():
    text = AGENT.read_text()
    assert "git ls-remote --exit-code --tags <repo-url> refs/tags/<tag> 'refs/tags/<tag>^{}'" in text
    assert "if a `^{}` line is printed (annotated tag), use its SHA; otherwise use the single plain line" in text
    assert "A non-zero exit is unavailable evidence" in text
    assert "Never copy `merge_sha` into `target.released_sha`" in text
    assert "Neither `target.released_sha` nor `target.ancestry` comes from the caller or the target" in text


def test_ancestry_is_probed_in_the_schema_direction():
    text = AGENT.read_text()
    assert "gh api repos/<owner>/<repo>/compare/<merge_sha>...<released_sha> --jq .status" in text
    assert "record `target.ancestry.method` as `gh-compare`" in text
    assert "`target.ancestry.checked_at`" in text
    assert "UTC Z time of the call" in text
    assert "git merge-base --is-ancestor <merge_sha> <released_sha>" in text
    assert "`target.ancestry.method` as `git-merge-base`" in text
    assert "git merge-base --is-ancestor <released_sha> <merge_sha>" in text
    assert "`ahead` when the first exits 0" in text
    assert "`behind` when only the second exits 0" in text
    assert "`diverged` when both exit 1" in text
    assert "Any other exit, or any gh error, is a probe error" in text


def test_identity_matches_release_and_live_requires_ancestry():
    text = AGENT.read_text()
    assert ("Any present `installed.embedded_commit`, `install_source.pin_sha`, "
            "`install_source.owner_status.pin_sha` or `activation.self_report.commit` "
            "differing from `target.released_sha` gives MISMATCH.") in " ".join(text.split())
    assert "LIVE also requires ancestry `identical` or `ahead`" in text
    assert not re.search(r"(?:equal|equals|differing from|match(?:es)?)\s+`target\.merge_sha`", text)


@pytest.fixture(scope="module")
def schema():
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import schema from './scripts/schemas/install-receipt-v1.mjs';"
         "process.stdout.write(JSON.stringify(schema));"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def assert_receipt_fields(text, schema):
    fields = set(FIELD.findall(text)) - NON_FIELDS
    assert fields, "Expected receipt field paths in the deploy contract"
    for field in fields:
        assert field.split(".")[0] in schema["properties"], f"Unknown receipt root: {field}"
        assert schema_has_field(schema, field), f"Unknown receipt field: {field}"


def test_receipt_field_names_match_exported_schema(schema):
    text = AGENT.read_text()
    assert {"target.released_sha", "target.ancestry", "target.ancestry.status",
            "target.ancestry.checked_at", "target.ancestry.method",
            "activation.seat_scan.method", "activation.seat_scan.checked_at",
            "activation.seat_scan.active_seats", "activation.reconnected_seats"} <= set(FIELD.findall(text))
    assert_receipt_fields(text, schema)


def test_mcp_seat_scan_uses_same_session_active_seats():
    text = " ".join(AGENT.read_text().split())
    for required in (
        "brainlayer, voicelayer, cmuxlayer, brainbar and voicebar",
        "`activation.mcp_probe.ok: true`",
        "strictly after `installed.install_finished_at`",
        "`node scripts/t3-mcp-holders.mjs <server>`",
        "`method: client-processes`", "writer verifies `active_seats`",
        "Never hand-compute", "needs a fresh thread", "one-shot follow-up receipt",
        "No T3 reconnect exists", "contract #3 remains unchanged",
        "including the session that dispatched you", "Do not exclude your own client",
        "cmuxlayer refuses `client-processes`", "prior installed version's tag",
        "Never assume `changed: false`", "shared Codex app-server",
        "(then voicelayer cannot be LIVE: report INSTALLED_NOT_ACTIVE)",
    ):
        assert required in text


def test_tap_gate_checks_product_row_before_brew_upgrade():
    text = " ".join(AGENT.read_text().split())
    for required in (
        "Before any `brew upgrade`",
        "`node scripts/install-receipt.mjs status <product>`",
        "from the golems root checkout for each formula or cask you are about to upgrade",
        "Read the `TAP` column of its `mbp` row",
        "**TAP-STALE: STOP**", "report to that product's lead", "Do not run the upgrade",
        "**TAP-UNKNOWN: proceed**", "report the tap as **[UNVERIFIED]**",
        "never key on the exit code", "exits 1 for any non-CURRENT row",
        "M1 UNREACHABLE row does not block a MacBook Pro deploy",
    ):
        assert required in text


def test_contract_three_keeps_idle_ready_paused_rule():
    text = " ".join(AGENT.read_text().split())
    assert ("**Idle, ready and paused seats get no reconnect and no nudge**: "
            "they reconnect themselves on first failure, per") in text


def test_top_level_mutation_is_rejected(schema):
    text = AGENT.read_text().replace("`activation.processes[]`", "`activations.processes[]`")
    assert "`activations.processes[]`" in text
    with pytest.raises(AssertionError, match=r"Unknown receipt root: activations\.processes"):
        assert_receipt_fields(text, schema)


@pytest.mark.parametrize("field, valid", [
    ("activation.processes[].started_at", True),
    ("activation.processes[].start_time", False),
    ("install_source.owner_status.settings_drift", True),
    ("install_source.owner_status.unknown", False),
])
def test_field_checker_rejects_nested_and_array_drift(field, valid):
    schema = {"properties": {
        "activation": {"properties": {"processes": {"items": {
            "properties": {"started_at": {"type": "string"}}
        }}}},
        "install_source": {"properties": {"owner_status": {
            "properties": {"settings_drift": {"type": "boolean"}}
        }}},
    }}
    assert FIELD.findall(f"`{field}`") == [field]
    assert schema_has_field(schema, field) is valid


def test_t10_retains_held_kegs_until_followup_cleanup():
    text = " ".join(AGENT.read_text().split())
    assert "exactly one keg once the follow-up `brew cleanup <formula>` has run" in text
    assert "A second keg is expected while T14's held jobs or stale clients remain" in text


def test_contract_two_points_to_receipt_mcp_proof():
    text = " ".join(AGENT.read_text().split())
    assert "These checks prove the install is serving" in text
    assert "LIVE also needs the Install receipt item's MCP proof" in text


def test_brainlayer_live_proof_names_stdio_bridge():
    text = " ".join(AGENT.read_text().split())
    bullet = text.split("- **brainlayer** —", 1)[1].split("These checks prove", 1)[0]
    assert "a live `brainlayer-mcp-stdio-bridge` client relaying to `/tmp/brainbar.sock`" in bullet
    assert "socat child on `/tmp/brainbar.sock`" not in bullet


def test_brainbar_socket_never_offers_socat():
    for line in AGENT.read_text().splitlines():
        if line.lstrip().startswith("|"):
            for cell in line.split("|"):
                assert not ("socat" in cell.lower() and "brainbar.sock" in cell), cell
    cells = AGENT.read_text().split("|")
    for cell in cells:
        sentences = re.split(r"(?<=[.!?])\s+", cell)
        for sentence in sentences:
            assert not ("socat" in sentence.lower() and "brainbar.sock" in sentence), sentence


def test_voicelayer_embedded_commit_uses_installed_package_only():
    text = " ".join(AGENT.read_text().split())
    assert "/opt/homebrew/opt/voicelayer/bin/voicelayer --version --json" in text
    assert 'Use `gitCommit` only when `source` is `"package"`' in text
    assert "never a PATH lookup" in text
    assert "omit embedded_commit and report **[UNVERIFIED]**" in text


def test_other_scan_methods_define_the_own_probe_exclusion():
    text = " ".join(AGENT.read_text().split())
    assert "For other scan methods" in text
    assert "Your own session or thread (including the session that dispatched you)" in text
    assert "and your own stdio/MCP probe never count as a seat in either list" in text


def test_draft_scan_is_the_record_and_plain_scan_is_optional():
    text = " ".join(AGENT.read_text().split())
    assert "plain scan is an optional preview" in text
    assert "Use the receipt-draft output and its own stderr mapping notes as the record" in text


def test_client_argv_provenance_follows_i2f():
    text = " ".join(AGENT.read_text().split())
    assert '`argv_source: "ps-split"`' in text
    assert "raw whitespace split of the complete ps command" in text
    assert "do not normalise paths or truncate tokens" in text

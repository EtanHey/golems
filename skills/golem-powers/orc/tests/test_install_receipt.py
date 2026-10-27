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
    assert_receipt_fields(AGENT.read_text(), schema)


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

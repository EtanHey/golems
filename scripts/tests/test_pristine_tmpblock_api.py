"""The new API target must preserve complete child captures and request bytes."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("pristine_api_test", ROOT / "scripts/ci/pristine-harness.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def test_api_target_captures_raw_streams_exit_and_ledger(monkeypatch, tmp_path):
    request = {"function": "_bash_temp_targets", "command": "echo x > {REPO}/out", "budget": 0}
    case = {"id": "tmp-w7-routing", "target": "tmp-block-api", "request": request}
    observed = {}

    def child(argv, **kwargs):
        observed.update(argv=argv, **kwargs)
        (tmp_path / "ledger.jsonl").write_bytes(b'{"raw": "ledger"}\n')
        return SimpleNamespace(returncode=2, stdout=b'raw stdout\x00\n', stderr=b'raw stderr\xff\n')

    monkeypatch.setattr(harness.subprocess, "run", child)
    result = harness.capture(case, ROOT, tmp_path)
    assert result == {"exit": 2, "stdout": harness.b64(b'raw stdout\x00\n'),
                      "stderr": harness.b64(b'raw stderr\xff\n'),
                      "files": {"ledger.jsonl": harness.b64(b'{"raw": "ledger"}\n')}}
    payload = json.loads(observed["input"])
    assert payload["command"] == f"echo x > {tmp_path}/repo/out"
    assert payload["budget"] == 0
    assert observed["argv"][2] == harness.TMP_BLOCK_API_PROBE
    assert observed["argv"][3:] == [str(ROOT), str(tmp_path / "api-copies")]
    assert observed["env"]["PYTHONDONTWRITEBYTECODE"] == "1"
    assert observed["timeout"] == 15 and observed["capture_output"] is True
    assert request["command"] == "echo x > {REPO}/out"

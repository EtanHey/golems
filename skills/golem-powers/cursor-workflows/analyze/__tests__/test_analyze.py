from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
ANALYZE_ROOT = ROOT / "analyze"
sys.path.insert(0, str(ANALYZE_ROOT))

import analyze  # noqa: E402


def install_fake_cursor(tmp_path: Path, body: str, monkeypatch: pytest.MonkeyPatch) -> Path:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    cursor = fake_bin / "cursor-agent"
    cursor.write_text("#!/usr/bin/env python3\n" + body)
    cursor.chmod(cursor.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}")
    monkeypatch.setenv("AUTOCURSOR_LOG_DIR", str(tmp_path / "logs"))
    return cursor


def sample_findings() -> list[dict]:
    return [
        {
            "id": "F1",
            "title": "Payment webhook fails on retry",
            "detail": "Retrying the Stripe webhook can enqueue duplicate jobs.",
            "evidence": ["payments.py:41", "payments.py:88"],
            "type": "bug",
            "importance": 5,
        },
        {
            "id": "F2",
            "title": "Payment webhook fails on retry",
            "detail": "Retrying the Stripe webhook can enqueue duplicate jobs.",
            "evidence": ["payments.py:41", "payments.py:88"],
            "type": "bug",
            "importance": 4,
        },
        {
            "id": "F3",
            "title": "Login session lacks expiry",
            "detail": "Session cookies are issued without an expiry.",
            "evidence": ["auth.py:12"],
            "type": "risk",
            "importance": 9,
        },
    ]


def test_analyze_clusters_deduplicates_ranks_and_validates_schema(tmp_path, monkeypatch):
    prompt_log = tmp_path / "prompts.ndjson"
    monkeypatch.setenv("PROMPT_LOG", str(prompt_log))
    install_fake_cursor(
        tmp_path,
        r'''
import json
import os
import sys

prompt = sys.argv[-1]
with open(os.environ["PROMPT_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps({"prompt": prompt}) + "\n")

if "ANALYZE_CLUSTER_PLAN" in prompt:
    payload = {
        "clusters": [
            {"cluster_id": "payments", "theme": "Webhook retry safety", "track": "payments", "finding_ids": ["F1"]},
            {"cluster_id": "auth", "theme": "Session lifetime", "track": "auth", "finding_ids": ["F3"]},
        ]
    }
elif "ANALYZE_CLUSTER_DETAIL" in prompt and '"cluster_id": "payments"' in prompt:
    payload = {
        "cluster_id": "payments",
        "theme": "Webhook retry safety",
        "track": "payments",
        "summary": "Payment retry handling can duplicate work and needs idempotency.",
        "recommended_actions": ["Add idempotency key coverage"],
    }
elif "ANALYZE_CLUSTER_DETAIL" in prompt and '"cluster_id": "auth"' in prompt:
    payload = {
        "cluster_id": "auth",
        "theme": "Session lifetime",
        "track": "auth",
        "summary": "Sessions need explicit expiry controls.",
        "recommended_actions": ["Set cookie expiry"],
    }
elif "ANALYZE_FINAL_SYNTHESIS" in prompt:
    payload = {"synthesis": "Webhook retry idempotency is the top theme because it recurs across duplicate evidence, narrowly outranking the single high-importance session-expiry risk."}
else:
    payload = {}

print(json.dumps({"type": "assistant", "text": json.dumps(payload)}), flush=True)
print(json.dumps({"usage": {"inputTokens": 2, "outputTokens": 3}}), flush=True)
''',
        monkeypatch,
    )

    result = analyze.analyze_findings(sample_findings(), top_n=2, concurrency=2, timeout=5)

    analyze.validate_synthesis(result)
    assert result["schema_version"] == "0.2"
    assert result["top_n"] == 2
    assert result["top_findings"][0]["id"] == "F1"
    assert result["top_findings"][0]["duplicate_ids"] == ["F2"]
    assert result["top_findings"][0]["score"] == 10
    assert result["top_findings"][1]["id"] == "F3"
    assert result["top_findings"][1]["score"] == 9
    assert [cluster["cluster_id"] for cluster in result["clusters"]] == ["payments", "auth"]
    assert result["clusters"][0]["recurrence"] == 2
    assert result["clusters"][0]["score"] == 10
    assert "Webhook retry idempotency" in result["synthesis"]
    assert result["usage"] == {"inputTokens": 8, "outputTokens": 12, "totalTokens": 20}

    prompts = [json.loads(line)["prompt"] for line in prompt_log.read_text().splitlines()]
    assert len([prompt for prompt in prompts if "ANALYZE_CLUSTER_DETAIL" in prompt]) == 2
    assert all("F2" not in prompt for prompt in prompts if "ANALYZE_CLUSTER_PLAN" in prompt)


def test_analyze_fails_loud_when_cursor_output_cannot_validate(tmp_path, monkeypatch):
    install_fake_cursor(
        tmp_path,
        r'''
import json

print(json.dumps({"type": "assistant", "text": "{\"clusters\":\"not-an-array\"}"}), flush=True)
''',
        monkeypatch,
    )

    with pytest.raises(analyze.AnalyzeError, match="cluster plan"):
        analyze.analyze_findings(sample_findings(), top_n=2, timeout=5)


def test_validate_synthesis_rejects_missing_required_output_fields():
    value = {
        "schema_version": "0.2",
        "top_n": 1,
        "clusters": [],
        "top_findings": [],
        "deduplicated_findings": [],
        "usage": {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0},
    }

    with pytest.raises(analyze.AnalyzeError, match="missing required key synthesis"):
        analyze.validate_synthesis(value)


def test_input_validation_rejects_malformed_findings_before_agent_calls():
    bad = [dict(sample_findings()[0], evidence="payments.py:41")]

    with pytest.raises(analyze.AnalyzeError, match="evidence"):
        analyze.analyze_findings(bad)

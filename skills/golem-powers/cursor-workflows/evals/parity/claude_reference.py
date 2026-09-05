#!/usr/bin/env python3
"""RED arm loader for the deterministic Claude-workflow gather golden."""

from __future__ import annotations

import json
from pathlib import Path


def load_reference(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ValueError(f"malformed golden JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    red_arm = data.get("red_arm")
    if not isinstance(red_arm, dict):
        raise ValueError("golden expected.json must contain object red_arm")
    if red_arm.get("runner") != "claude-workflow-reference":
        raise ValueError("golden expected.json must declare red_arm.runner=claude-workflow-reference")
    findings = data.get("findings")
    if not isinstance(findings, list) or not findings:
        raise ValueError("golden expected.json must contain non-empty findings")
    ids = []
    for finding in findings:
        if not isinstance(finding, dict) or not isinstance(finding.get("id"), str) or not finding["id"]:
            raise ValueError("each golden finding must include a non-empty string id")
        ids.append(finding["id"])
    second_round_id = data.get("second_round_only_finding_id")
    if not isinstance(second_round_id, str) or second_round_id not in ids:
        raise ValueError("golden second_round_only_finding_id must refer to a RED finding")
    return data

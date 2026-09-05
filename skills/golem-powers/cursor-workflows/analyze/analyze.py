"""Analyze gathered Cursor-workflow findings into a ranked synthesis."""

from __future__ import annotations

import argparse
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lib import autocursor  # noqa: E402


SCHEMA_VERSION = "0.2"
SCHEMA_PATH = Path(__file__).with_name("analyze.schema.json")

CLUSTER_PLAN_SCHEMA = {
    "type": "object",
    "required": ["clusters"],
    "properties": {
        "clusters": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["cluster_id", "theme", "track", "finding_ids"],
                "properties": {
                    "cluster_id": {"type": "string"},
                    "theme": {"type": "string"},
                    "track": {"type": "string"},
                    "finding_ids": {"type": "array", "items": {"type": "string"}},
                },
            },
        }
    },
}

CLUSTER_DETAIL_SCHEMA = {
    "type": "object",
    "required": ["cluster_id", "theme", "track", "summary", "recommended_actions"],
    "properties": {
        "cluster_id": {"type": "string"},
        "theme": {"type": "string"},
        "track": {"type": "string"},
        "summary": {"type": "string"},
        "recommended_actions": {"type": "array", "items": {"type": "string"}},
    },
}

FINAL_SYNTHESIS_SCHEMA = {
    "type": "object",
    "required": ["synthesis"],
    "properties": {"synthesis": {"type": "string"}},
}


class AnalyzeError(RuntimeError):
    """Raised when analyze input or Cursor-produced output is invalid."""


def load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _schema_error(value: Any, schema: dict[str, Any], path: str = "$") -> str | None:
    expected = schema.get("type")
    if isinstance(expected, str) and not _matches_type(value, expected):
        return f"{path}: expected {expected}"
    if isinstance(value, dict):
        required = schema.get("required", [])
        if isinstance(required, list):
            for key in required:
                if isinstance(key, str) and key not in value:
                    return f"{path}: missing required key {key}"
        properties = schema.get("properties", {})
        if isinstance(properties, dict):
            for key, child_schema in properties.items():
                if key in value and isinstance(child_schema, dict):
                    error = _schema_error(value[key], child_schema, f"{path}.{key}")
                    if error:
                        return error
    if isinstance(value, list):
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                error = _schema_error(item, item_schema, f"{path}[{index}]")
                if error:
                    return error
    return None


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def validate_synthesis(value: dict[str, Any]) -> None:
    error = _schema_error(value, load_schema())
    if error:
        raise AnalyzeError(error)


def analyze_findings(
    findings: list[dict[str, Any]],
    *,
    top_n: int = 10,
    concurrency: int = 8,
    timeout: int = 900,
) -> dict[str, Any]:
    """Cluster, deduplicate, rank, and synthesize gathered findings."""
    phase = autocursor.phase
    phase("analyze: validate + deduplicate")
    normalized = _validate_findings(findings)
    deduped = _deduplicate_findings(normalized)

    phase("analyze: cluster")
    plan = _cluster_plan(deduped, timeout=timeout)
    clusters = _sanitize_clusters(plan["clusters"], deduped)

    phase("analyze: cluster detail")
    detailed = _cluster_details(clusters, deduped, concurrency=concurrency, timeout=timeout)

    ranked_clusters = sorted(
        detailed,
        key=lambda cluster: (-cluster["score"], -cluster["max_importance"], cluster["cluster_id"]),
    )
    top_findings = _rank_top_findings(deduped, ranked_clusters, top_n=top_n)

    phase("analyze: final synthesis")
    synthesis = _final_synthesis(ranked_clusters, top_findings, timeout=timeout)

    result = {
        "schema_version": SCHEMA_VERSION,
        "top_n": int(top_n),
        "synthesis": synthesis,
        "clusters": ranked_clusters,
        "top_findings": top_findings,
        "deduplicated_findings": [
            {
                "id": item["id"],
                "title": item["title"],
                "duplicate_ids": item["duplicate_ids"],
                "recurrence": item["recurrence"],
                "max_importance": item["max_importance"],
            }
            for item in deduped
        ],
        "usage": _sum_usage([plan, *detailed, {"usage": _final_synthesis.last_usage}]),
    }
    validate_synthesis(result)
    return result


def _validate_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(findings, list):
        raise AnalyzeError("findings must be a list")
    required = ("id", "title", "detail", "evidence", "type", "importance")
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            raise AnalyzeError(f"finding {index} must be an object")
        for key in required:
            if key not in finding:
                raise AnalyzeError(f"finding {index} missing {key}")
        if not isinstance(finding["id"], str) or not finding["id"]:
            raise AnalyzeError(f"finding {index} id must be a non-empty string")
        if finding["id"] in seen:
            raise AnalyzeError(f"duplicate finding id {finding['id']}")
        seen.add(finding["id"])
        evidence = finding["evidence"]
        if not isinstance(evidence, list) or not all(isinstance(item, str) for item in evidence):
            raise AnalyzeError(f"finding {finding['id']} evidence must be a list of strings")
        try:
            importance = float(finding["importance"])
        except (TypeError, ValueError) as exc:
            raise AnalyzeError(f"finding {finding['id']} importance must be numeric") from exc
        normalized.append(
            {
                "id": finding["id"],
                "title": str(finding["title"]),
                "detail": str(finding["detail"]),
                "evidence": list(evidence),
                "type": str(finding["type"]),
                "importance": importance,
            }
        )
    return normalized


def _deduplicate_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    for finding in findings:
        target = next((group for group in groups if _near_duplicate(group, finding)), None)
        if target is None:
            item = dict(finding)
            item["duplicate_ids"] = []
            item["recurrence"] = 1
            item["max_importance"] = item["importance"]
            groups.append(item)
            continue
        target["duplicate_ids"].append(finding["id"])
        target["recurrence"] += 1
        target["max_importance"] = max(target["max_importance"], finding["importance"])
        target["evidence"] = sorted(set(target["evidence"]) | set(finding["evidence"]))
    return groups


def _near_duplicate(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_text = _norm(f"{left['title']} {left['detail']}")
    right_text = _norm(f"{right['title']} {right['detail']}")
    if left_text == right_text:
        return True
    evidence_overlap = bool(set(left["evidence"]) & set(right["evidence"]))
    title_ratio = SequenceMatcher(None, _norm(left["title"]), _norm(right["title"])).ratio()
    detail_ratio = SequenceMatcher(None, _norm(left["detail"]), _norm(right["detail"])).ratio()
    return evidence_overlap and title_ratio >= 0.9 and detail_ratio >= 0.85


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower())).strip()


def _cluster_plan(deduped: list[dict[str, Any]], *, timeout: int) -> dict[str, Any]:
    prompt = (
        "ANALYZE_CLUSTER_PLAN\n"
        "Cluster these deduplicated gathered findings into related themes/tracks. "
        "Use only the provided ids. No web or external research.\n"
        f"{json.dumps(_cluster_input(deduped), sort_keys=True)}"
    )
    result = autocursor.agent(prompt, schema=CLUSTER_PLAN_SCHEMA, label="analyze-cluster-plan", timeout=timeout)
    if not result.get("data"):
        raise AnalyzeError(f"cluster plan did not validate: {result.get('schema_error') or result.get('error')}")
    data = result["data"]
    data["usage"] = result.get("usage", {})
    return data


def _cluster_details(
    clusters: list[dict[str, Any]],
    deduped: list[dict[str, Any]],
    *,
    concurrency: int,
    timeout: int,
) -> list[dict[str, Any]]:
    by_id = {finding["id"]: finding for finding in deduped}

    def thunk(cluster: dict[str, Any]):
        cluster_findings = [by_id[finding_id] for finding_id in cluster["finding_ids"] if finding_id in by_id]
        prompt = (
            "ANALYZE_CLUSTER_DETAIL\n"
            "Explain this cluster in concise operational terms. No web or external research.\n"
            f"{json.dumps({'cluster': cluster, 'findings': cluster_findings}, sort_keys=True)}"
        )
        result = autocursor.agent(
            prompt,
            schema=CLUSTER_DETAIL_SCHEMA,
            label=f"analyze-cluster-{cluster['cluster_id']}",
            timeout=timeout,
        )
        if not result.get("data"):
            raise AnalyzeError(f"cluster detail did not validate for {cluster['cluster_id']}: {result.get('schema_error') or result.get('error')}")
        return _enrich_cluster(result["data"], cluster, cluster_findings, result.get("usage", {}))

    results = autocursor.parallel([lambda cluster=cluster: thunk(cluster) for cluster in clusters], concurrency=concurrency)
    if any(result is None for result in results):
        raise AnalyzeError("cluster detail analysis failed")
    return [result for result in results if result is not None]


def _enrich_cluster(
    detail: dict[str, Any],
    cluster: dict[str, Any],
    findings: list[dict[str, Any]],
    usage: dict[str, int],
) -> dict[str, Any]:
    recurrence = sum(int(finding["recurrence"]) for finding in findings)
    max_importance = max((float(finding["max_importance"]) for finding in findings), default=0.0)
    duplicate_ids = sorted({dup for finding in findings for dup in finding["duplicate_ids"]})
    return {
        "cluster_id": str(detail.get("cluster_id") or cluster["cluster_id"]),
        "theme": str(detail.get("theme") or cluster["theme"]),
        "track": str(detail.get("track") or cluster["track"]),
        "finding_ids": [finding["id"] for finding in findings],
        "duplicate_ids": duplicate_ids,
        "recurrence": recurrence,
        "max_importance": max_importance,
        "score": max_importance * recurrence,
        "summary": str(detail.get("summary", "")),
        "recommended_actions": [str(item) for item in detail.get("recommended_actions", [])],
        "usage": usage,
    }


def _sanitize_clusters(clusters: list[dict[str, Any]], deduped: list[dict[str, Any]]) -> list[dict[str, Any]]:
    known = {finding["id"] for finding in deduped}
    assigned: set[str] = set()
    sanitized: list[dict[str, Any]] = []
    for index, cluster in enumerate(clusters):
        finding_ids = [finding_id for finding_id in cluster.get("finding_ids", []) if finding_id in known and finding_id not in assigned]
        if not finding_ids:
            continue
        assigned.update(finding_ids)
        cluster_id = _safe_id(str(cluster.get("cluster_id") or f"cluster-{index + 1}"))
        sanitized.append(
            {
                "cluster_id": cluster_id,
                "theme": str(cluster.get("theme") or cluster_id),
                "track": str(cluster.get("track") or "general"),
                "finding_ids": finding_ids,
            }
        )
    for finding in deduped:
        if finding["id"] not in assigned:
            cluster_id = _safe_id(f"{finding['type']}-{finding['id']}")
            sanitized.append(
                {
                    "cluster_id": cluster_id,
                    "theme": finding["title"],
                    "track": finding["type"],
                    "finding_ids": [finding["id"]],
                }
            )
    if not sanitized and deduped:
        raise AnalyzeError("cluster plan produced no usable clusters")
    return sanitized


def _safe_id(value: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "-", value).strip("-")
    return safe or "cluster"


def _rank_top_findings(
    deduped: list[dict[str, Any]],
    clusters: list[dict[str, Any]],
    *,
    top_n: int,
) -> list[dict[str, Any]]:
    cluster_by_finding = {
        finding_id: cluster
        for cluster in clusters
        for finding_id in cluster["finding_ids"]
    }
    ranked = sorted(
        deduped,
        key=lambda finding: (
            -(float(finding["max_importance"]) * int(finding["recurrence"])),
            -float(finding["max_importance"]),
            finding["id"],
        ),
    )
    top: list[dict[str, Any]] = []
    for finding in ranked[: max(0, int(top_n))]:
        cluster = cluster_by_finding.get(finding["id"], {})
        score = float(finding["max_importance"]) * int(finding["recurrence"])
        top.append(
            {
                "id": finding["id"],
                "title": finding["title"],
                "detail": finding["detail"],
                "evidence": finding["evidence"],
                "type": finding["type"],
                "importance": finding["max_importance"],
                "cluster_id": str(cluster.get("cluster_id", "")),
                "recurrence": int(finding["recurrence"]),
                "score": score,
                "duplicate_ids": finding["duplicate_ids"],
                "reason": f"importance {finding['max_importance']} x recurrence {finding['recurrence']}",
            }
        )
    return top


def _final_synthesis(clusters: list[dict[str, Any]], top_findings: list[dict[str, Any]], *, timeout: int) -> str:
    prompt = (
        "ANALYZE_FINAL_SYNTHESIS\n"
        "Write one paragraph synthesizing the ranked findings. No web or external research.\n"
        f"{json.dumps({'clusters': _strip_usage(clusters), 'top_findings': top_findings}, sort_keys=True)}"
    )
    result = autocursor.agent(prompt, schema=FINAL_SYNTHESIS_SCHEMA, label="analyze-final-synthesis", timeout=timeout)
    if not result.get("data"):
        raise AnalyzeError(f"final synthesis did not validate: {result.get('schema_error') or result.get('error')}")
    _final_synthesis.last_usage = result.get("usage", {})
    return " ".join(str(result["data"]["synthesis"]).split())


_final_synthesis.last_usage = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}


def _cluster_input(deduped: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": finding["id"],
            "title": finding["title"],
            "detail": finding["detail"],
            "evidence": finding["evidence"],
            "type": finding["type"],
            "importance": finding["max_importance"],
            "recurrence": finding["recurrence"],
        }
        for finding in deduped
    ]


def _strip_usage(clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in cluster.items() if key != "usage"} for cluster in clusters]


def _sum_usage(items: list[dict[str, Any]]) -> dict[str, int]:
    total = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
    for item in items:
        usage = item.get("usage", {})
        total["inputTokens"] += int(usage.get("inputTokens", 0) or 0)
        total["outputTokens"] += int(usage.get("outputTokens", 0) or 0)
    total["totalTokens"] = total["inputTokens"] + total["outputTokens"]
    return total


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze gathered AutoCursor findings.")
    parser.add_argument("input", help="JSON file containing a list of gathered findings")
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--concurrency", type=int, default=8)
    args = parser.parse_args(argv)

    findings = json.loads(Path(args.input).read_text(encoding="utf-8"))
    result = analyze_findings(findings, top_n=args.top_n, timeout=args.timeout, concurrency=args.concurrency)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

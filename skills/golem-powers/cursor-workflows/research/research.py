"""Quick-Deep-Research workflow built on AutoCursor primitives."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from lib import autocursor

from .search_backend import SearchBackend, make_search_backend


SCHEMA_PATH = Path(__file__).with_name("research.schema.json")
_USAGE_LOCK = Lock()


class ResearchValidationError(RuntimeError):
    """Raised when agent/search output violates the research contract."""


def quick_deep_research(
    topic: str,
    *,
    breadth: int = 4,
    depth: int = 2,
    search_backend: SearchBackend | None = None,
    run_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Run quick-deep-research and return report, graph, claims, sources, usage.

    All reasoning calls go through autocursor.agent(). The search layer is the only
    external I/O, and is supplied through the swappable SearchBackend interface.
    """

    topic = topic.strip()
    if not topic:
        raise ValueError("topic is required")
    breadth = max(1, min(_max_children(), int(breadth)))
    depth = max(1, int(depth))
    out_dir = _run_dir(topic, run_dir)
    backend = search_backend or make_search_backend()
    schemas = _load_schemas()
    usage = {"agent_calls": 0, "search_calls": 0, "inputTokens": 0, "outputTokens": 0, "totalTokens": 0}

    autocursor.phase("QUICK-DEEP-RESEARCH search")
    queries = _derive_queries(topic, breadth=breadth, usage=usage)
    _write_json(out_dir / "00-queries.json", {"topic": topic, "queries": queries})
    sources = _search_sources(backend, queries, depth=depth, usage=usage)
    _write_json(out_dir / "01-search.json", {"sources": sources})

    autocursor.phase("QUICK-DEEP-RESEARCH web-graph")
    graph = _build_graph(topic, sources, schema=schemas["graph"], usage=usage)
    _validate_graph(graph)
    _write_json(out_dir / "02-graph.json", graph)

    autocursor.phase("QUICK-DEEP-RESEARCH cross-reference")
    claims = _cross_reference(topic, graph, depth=depth, schema=schemas["claimVerdict"], usage=usage)
    _write_json(out_dir / "03-claims.json", {"claims": claims})

    autocursor.phase("QUICK-DEEP-RESEARCH synthesize")
    synthesis = _synthesize(topic, graph, claims, schema=schemas["synthesis"], usage=usage)
    _validate_citation_integrity(synthesis, graph=graph, claims=claims)
    _write_json(out_dir / "04-report.json", synthesis)

    result = {
        "report": synthesis["report"],
        "graph": graph,
        "claims": claims,
        "sources": sources,
        "usage": usage,
    }
    _write_json(out_dir / "result.json", result)
    return result


def _load_schemas() -> dict[str, dict[str, Any]]:
    with SCHEMA_PATH.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    definitions = raw.get("definitions")
    if not isinstance(definitions, dict):
        raise ResearchValidationError("research.schema.json missing definitions")
    required = ["graph", "claimVerdict", "synthesis"]
    missing = [name for name in required if not isinstance(definitions.get(name), dict)]
    if missing:
        raise ResearchValidationError(f"research.schema.json missing definitions: {', '.join(missing)}")
    return definitions


def _run_dir(topic: str, run_dir: str | Path | None) -> Path:
    if run_dir is not None:
        path = Path(run_dir)
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        safe = "".join(ch if ch.isalnum() else "-" for ch in topic.lower()).strip("-")[:48] or "topic"
        path = Path(".quick-deep-research") / f"{stamp}-{safe}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _max_children() -> int:
    raw = os.environ.get("MAX_CHILDREN") or os.environ.get("QDR_MAX_BREADTH") or "8"
    try:
        return max(1, int(raw))
    except ValueError:
        return 8


def _write_json(path: Path, payload: Any) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    tmp_path.replace(path)


def _agent_data(prompt: str, *, schema: dict[str, Any], label: str, usage: dict[str, int]) -> dict[str, Any]:
    result = autocursor.agent(prompt, schema=schema, label=label)
    agent_usage = result.get("usage") if isinstance(result, dict) else None
    with _USAGE_LOCK:
        usage["agent_calls"] += 1
        if isinstance(agent_usage, dict):
            usage["inputTokens"] += int(agent_usage.get("inputTokens") or 0)
            usage["outputTokens"] += int(agent_usage.get("outputTokens") or 0)
            usage["totalTokens"] = usage["inputTokens"] + usage["outputTokens"]
    if result.get("status") != "ok" or result.get("exit_code") not in (0, None):
        raise ResearchValidationError(f"{label} failed: {result.get('error') or result.get('status')}")
    data = result.get("data")
    if not isinstance(data, dict):
        raise ResearchValidationError(f"{label} returned no schema-valid data: {result.get('schema_error')}")
    return data


def _derive_queries(topic: str, *, breadth: int, usage: dict[str, int]) -> list[str]:
    schema = {
        "type": "object",
        "required": ["queries"],
        "properties": {"queries": {"type": "array", "items": {"type": "string"}}},
    }
    data = _agent_data(
        "Derive search queries for Quick-Deep-Research.\n"
        f"Topic: {topic}\n"
        f"Return {breadth} diverse web-search queries. Favor primary sources, benchmarks, limitations, and dissenting evidence.",
        schema=schema,
        label="qdr-query-derivation",
        usage=usage,
    )
    queries = [item.strip() for item in data.get("queries", []) if isinstance(item, str) and item.strip()]
    queries = _dedupe_strings(queries)[:breadth]
    if not queries:
        raise ResearchValidationError("query derivation returned no queries")
    return queries


def _search_sources(
    backend: SearchBackend,
    queries: list[str],
    *,
    depth: int,
    usage: dict[str, int],
) -> list[dict[str, Any]]:
    def thunk(query: str):
        return backend.search(query, num_results=max(2, depth))

    batches = autocursor.parallel([lambda query=query: thunk(query) for query in queries], concurrency=min(len(queries), 8))
    sources: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for query, batch in zip(queries, batches):
        usage["search_calls"] += 1
        if batch is None:
            raise ResearchValidationError(f"search failed for query: {query}")
        if not isinstance(batch, list):
            raise ResearchValidationError(f"search returned malformed batch for query: {query}")
        for item in batch:
            source = _validate_source(item)
            if source["url"] in seen_urls:
                continue
            seen_urls.add(source["url"])
            sources.append(source)
    if not sources:
        raise ResearchValidationError("search returned no sources")
    return sources


def _validate_source(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ResearchValidationError("search source must be an object")
    for key in ("id", "title", "url", "snippet", "query"):
        if not isinstance(item.get(key), str):
            raise ResearchValidationError(f"search source missing string key: {key}")
    return dict(item)


def _build_graph(
    topic: str,
    sources: list[dict[str, Any]],
    *,
    schema: dict[str, Any],
    usage: dict[str, int],
) -> dict[str, Any]:
    data = _agent_data(
        "Build a web graph for Quick-Deep-Research.\n"
        "Nodes must be sources, entities, and claims. Edges must be supports, contradicts, or mentions.\n"
        f"Topic: {topic}\n"
        f"Sources JSON:\n{json.dumps(sources, sort_keys=True)}",
        schema=schema,
        label="qdr-web-graph",
        usage=usage,
    )
    return data


def _validate_graph(graph: dict[str, Any]) -> None:
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise ResearchValidationError("graph must contain nodes and edges arrays")
    node_ids: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise ResearchValidationError("graph node must be object")
        node_id = node.get("id")
        node_type = node.get("type")
        label = node.get("label")
        if not isinstance(node_id, str) or not isinstance(node_type, str) or not isinstance(label, str):
            raise ResearchValidationError("graph node missing id/type/label")
        if node_type not in {"source", "entity", "claim"}:
            raise ResearchValidationError(f"unsupported graph node type: {node_type}")
        if node_id in node_ids:
            raise ResearchValidationError(f"duplicate graph node id: {node_id}")
        node_ids.add(node_id)
    for edge in edges:
        if not isinstance(edge, dict):
            raise ResearchValidationError("graph edge must be object")
        if edge.get("source") not in node_ids or edge.get("target") not in node_ids:
            raise ResearchValidationError("graph edge references missing node")
        if edge.get("type") not in {"supports", "contradicts", "mentions"}:
            raise ResearchValidationError(f"unsupported graph edge type: {edge.get('type')}")


def _cross_reference(
    topic: str,
    graph: dict[str, Any],
    *,
    depth: int,
    schema: dict[str, Any],
    usage: dict[str, int],
) -> list[dict[str, Any]]:
    claim_nodes = [node for node in graph["nodes"] if node.get("type") == "claim"]
    source_nodes = [node for node in graph["nodes"] if node.get("type") == "source"]
    if not claim_nodes:
        return []
    if len(source_nodes) < 2:
        raise ResearchValidationError("cross-reference requires at least two source nodes")

    def verify_one(claim: dict[str, Any]) -> dict[str, Any]:
        return _verify_claim(topic, graph, claim, source_nodes, depth=depth, schema=schema, usage=usage)

    results = autocursor.parallel([lambda claim=claim: verify_one(claim) for claim in claim_nodes], concurrency=4)
    claims: list[dict[str, Any]] = []
    for result in results:
        if not isinstance(result, dict):
            raise ResearchValidationError("claim verification failed")
        claims.append(result)
    return claims


def _verify_claim(
    topic: str,
    graph: dict[str, Any],
    claim: dict[str, Any],
    source_nodes: list[dict[str, Any]],
    *,
    depth: int,
    schema: dict[str, Any],
    usage: dict[str, int],
) -> dict[str, Any]:
    seen_sources: set[str] = set()

    def round_fn() -> list[dict[str, Any]]:
        remaining = [source for source in source_nodes if source["id"] not in seen_sources]
        if not remaining:
            return []
        selected = remaining[: max(2, depth + 1)]
        prompts = [
            _verifier_prompt(topic, graph, claim, selected, stance="primary"),
            _verifier_prompt(topic, graph, claim, selected, stance="adversarial"),
        ]

        def call(prompt: str, idx: int) -> dict[str, Any]:
            return _agent_data(prompt, schema=schema, label=f"qdr-verify-{claim['id']}-{idx}", usage=usage)

        batches = autocursor.parallel(
            [lambda prompt=prompt, idx=idx: call(prompt, idx) for idx, prompt in enumerate(prompts, start=1)],
            concurrency=2,
        )
        verdicts: list[dict[str, Any]] = []
        for batch in batches:
            if not isinstance(batch, dict):
                raise ResearchValidationError(f"verifier failed for claim {claim['id']}")
            if batch.get("claim_id") != claim["id"]:
                raise ResearchValidationError(f"verifier returned wrong claim id for {claim['id']}")
            items = batch.get("verdicts")
            if not isinstance(items, list):
                raise ResearchValidationError(f"verifier returned malformed verdicts for {claim['id']}")
            for item in items:
                verdict = _validate_verdict(item, source_ids={source["id"] for source in source_nodes})
                seen_sources.add(verdict["source_id"])
                verdicts.append(verdict)
        return verdicts

    verdicts = autocursor.loop_until_dry(round_fn, dry_rounds=1, max_rounds=max(2, depth + 1))
    deduped = _dedupe_verdicts(verdicts)
    source_ids = _ordered_unique([item["source_id"] for item in deduped])
    if len(source_ids) < 2:
        raise ResearchValidationError(f"claim {claim['id']} was not verified across >=2 sources")
    verdict_types = {item["verdict"] for item in deduped}
    return {
        "claim_id": claim["id"],
        "text": claim.get("text") or claim.get("label") or claim["id"],
        "source_ids": source_ids,
        "verdicts": deduped,
        "conflict": "supports" in verdict_types and "contradicts" in verdict_types,
    }


def _verifier_prompt(
    topic: str,
    graph: dict[str, Any],
    claim: dict[str, Any],
    sources: list[dict[str, Any]],
    *,
    stance: str,
) -> str:
    return (
        "Verify claim for Quick-Deep-Research.\n"
        f"Stance: {stance}. Flag conflicts; never silently merge contradictory sources.\n"
        f"Topic: {topic}\n"
        f"Claim JSON: {json.dumps(claim, sort_keys=True)}\n"
        f"Source nodes JSON: {json.dumps(sources, sort_keys=True)}\n"
        f"Graph edges JSON: {json.dumps(graph.get('edges', []), sort_keys=True)}"
    )


def _validate_verdict(item: Any, *, source_ids: set[str]) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ResearchValidationError("verdict must be object")
    for key in ("id", "source_id", "verdict", "rationale", "anchor"):
        if not isinstance(item.get(key), str):
            raise ResearchValidationError(f"verdict missing string key: {key}")
    if item["source_id"] not in source_ids:
        raise ResearchValidationError(f"verdict references missing source: {item['source_id']}")
    if item["verdict"] not in {"supports", "contradicts", "unclear"}:
        raise ResearchValidationError(f"unsupported verdict: {item['verdict']}")
    return dict(item)


def _synthesize(
    topic: str,
    graph: dict[str, Any],
    claims: list[dict[str, Any]],
    *,
    schema: dict[str, Any],
    usage: dict[str, int],
) -> dict[str, Any]:
    return _agent_data(
        "Synthesize cited report for Quick-Deep-Research.\n"
        "Every material claim must cite source anchors in square brackets, e.g. [S1]. "
        "Conflicts must be explicitly flagged instead of merged.\n"
        f"Topic: {topic}\n"
        f"Graph JSON: {json.dumps(graph, sort_keys=True)}\n"
        f"Verified claims JSON: {json.dumps(claims, sort_keys=True)}",
        schema=schema,
        label="qdr-synthesis",
        usage=usage,
    )


def _validate_citation_integrity(
    synthesis: dict[str, Any],
    *,
    graph: dict[str, Any],
    claims: list[dict[str, Any]],
) -> None:
    report = synthesis.get("report")
    citations = synthesis.get("claim_citations")
    if not isinstance(report, str) or not isinstance(citations, list):
        raise ResearchValidationError("synthesis missing report or claim_citations")
    source_ids = {node["id"] for node in graph["nodes"] if node.get("type") == "source"}
    by_claim: dict[str, list[str]] = {}
    for citation in citations:
        if not isinstance(citation, dict):
            raise ResearchValidationError("citation entry must be object")
        claim_id = citation.get("claim_id")
        cited_sources = citation.get("source_ids")
        if not isinstance(claim_id, str) or not isinstance(cited_sources, list):
            raise ResearchValidationError("citation entry missing claim_id/source_ids")
        clean_sources = [source for source in cited_sources if isinstance(source, str)]
        by_claim[claim_id] = clean_sources
    for claim in claims:
        claim_id = claim["claim_id"]
        cited = by_claim.get(claim_id)
        if not cited:
            raise ResearchValidationError(f"missing citation for claim {claim_id}")
        if len(_ordered_unique(cited)) < 2:
            raise ResearchValidationError(f"claim {claim_id} must cite >=2 sources")
        verified_sources = set(claim["source_ids"])
        for source_id in cited:
            if source_id not in source_ids:
                raise ResearchValidationError(f"citation references missing source: {source_id}")
            if source_id not in verified_sources:
                raise ResearchValidationError(f"citation source not verified for claim {claim_id}: {source_id}")
            if f"[{source_id}]" not in report:
                raise ResearchValidationError(f"missing source anchor [{source_id}] for claim {claim_id}")


def _dedupe_strings(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _ordered_unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _dedupe_verdicts(verdicts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for verdict in verdicts:
        key = verdict.get("id") or f"{verdict.get('source_id')}:{verdict.get('verdict')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(verdict)
    return out

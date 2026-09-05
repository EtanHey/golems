from __future__ import annotations

import json
import os
import re
import stat
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from research import research  # noqa: E402
from research.search_backend import CursorNativeSearchBackend, make_search_backend  # noqa: E402


class FakeCursorNativeBackend:
    def __init__(self) -> None:
        self.queries: list[str] = []

    def search(self, query: str, *, num_results: int = 5) -> list[dict]:
        self.queries.append(query)
        slug = query.replace(" ", "-").lower()
        return [
            {
                "id": f"native-{slug}",
                "title": f"Result for {query}",
                "url": f"https://sample.test/{slug}",
                "snippet": f"Snippet for {query}",
                "query": query,
            }
        ]


def install_fake_cursor(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    cursor = fake_bin / "cursor-agent"
    prompt_log = tmp_path / "prompts.ndjson"
    monkeypatch.setenv("QDR_PROMPT_LOG", str(prompt_log))
    monkeypatch.setenv("AUTOCURSOR_LOG_DIR", str(tmp_path / "autocursor-logs"))
    cursor.write_text(
        "#!/usr/bin/env python3\n"
        r'''
import json
import os
import sys

prompt = sys.argv[-1]
with open(os.environ["QDR_PROMPT_LOG"], "a", encoding="utf-8") as handle:
    handle.write(json.dumps({"prompt": prompt}) + "\n")

def emit(payload):
    print(json.dumps({"type": "assistant", "text": json.dumps(payload, sort_keys=True)}), flush=True)
    print(json.dumps({"usage": {"inputTokens": 11, "outputTokens": 7}}), flush=True)

if "Derive search queries" in prompt:
    emit({
        "queries": [
            "vector database benchmark primary sources",
            "vector database benchmark performance",
            "vector database benchmark limitations"
        ]
    })
elif "Search the web" in prompt:
    emit({
        "results": [
            {
                "id": "native-source-1",
                "title": "Native search source",
                "url": "https://sample.test/native-source",
                "snippet": "Native search snippet"
            }
        ]
    })
elif "Build a web graph" in prompt:
    emit({
        "nodes": [
            {
                "id": "S1",
                "type": "source",
                "label": "Benchmark primary",
                "url": "https://sample.test/vector-database-benchmark-primary-sources"
            },
            {
                "id": "S2",
                "type": "source",
                "label": "Benchmark limitations",
                "url": "https://sample.test/vector-database-benchmark-limitations"
            },
            {"id": "E1", "type": "entity", "label": "VectorDB X"},
            {
                "id": "C1",
                "type": "claim",
                "label": "VectorDB X is the fastest option",
                "text": "VectorDB X is the fastest option."
            }
        ],
        "edges": [
            {"source": "S1", "target": "C1", "type": "supports", "evidence": "Benchmark table"},
            {"source": "S2", "target": "C1", "type": "contradicts", "evidence": "Methodology caveat"},
            {"source": "S1", "target": "E1", "type": "mentions", "evidence": "Product name"}
        ]
    })
elif "Verify claim" in prompt:
    emit({
        "claim_id": "C1",
        "verdicts": [
            {
                "id": "C1:S1",
                "source_id": "S1",
                "verdict": "supports",
                "rationale": "S1 reports the benchmark win.",
                "anchor": "Benchmark table"
            },
            {
                "id": "C1:S2",
                "source_id": "S2",
                "verdict": "contradicts",
                "rationale": "S2 says the method does not support that absolute claim.",
                "anchor": "Methodology caveat"
            }
        ]
    })
elif "Synthesize cited report" in prompt:
    if os.environ.get("QDR_BAD_CITATION") == "1":
        emit({
            "report": "Claim C1 is disputed [S1].",
            "claim_citations": [{"claim_id": "C1", "source_ids": ["S1", "S2"]}]
        })
    else:
        emit({
            "report": "Claim C1 is disputed: one source supports it [S1], while another contradicts it [S2].",
            "claim_citations": [{"claim_id": "C1", "source_ids": ["S1", "S2"]}]
        })
else:
    emit({"error": "unexpected prompt", "prompt": prompt})
''',
        encoding="utf-8",
    )
    cursor.chmod(cursor.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}")
    return cursor


def test_quick_deep_research_fans_out_queries_and_builds_graph(tmp_path, monkeypatch):
    install_fake_cursor(tmp_path, monkeypatch)
    backend = FakeCursorNativeBackend()

    result = research.quick_deep_research(
        "Vector database benchmark claims",
        breadth=3,
        depth=1,
        search_backend=backend,
        run_dir=tmp_path / "run",
    )

    assert sorted(backend.queries) == [
        "vector database benchmark limitations",
        "vector database benchmark performance",
        "vector database benchmark primary sources",
    ]
    assert result["graph"]["nodes"][0]["id"] == "S1"
    assert {edge["type"] for edge in result["graph"]["edges"]} >= {"supports", "contradicts", "mentions"}
    assert result["usage"]["agent_calls"] >= 4
    assert (tmp_path / "run" / "02-graph.json").exists()


def test_cross_reference_flags_conflicts_without_silent_merge(tmp_path, monkeypatch):
    install_fake_cursor(tmp_path, monkeypatch)

    result = research.quick_deep_research(
        "Vector database benchmark claims",
        breadth=2,
        depth=1,
        search_backend=FakeCursorNativeBackend(),
        run_dir=tmp_path / "run",
    )

    claim = result["claims"][0]
    assert claim["claim_id"] == "C1"
    assert claim["conflict"] is True
    assert [verdict["verdict"] for verdict in claim["verdicts"]] == ["supports", "contradicts"]
    assert claim["source_ids"] == ["S1", "S2"]


def test_synthesis_enforces_every_claim_has_source_anchors(tmp_path, monkeypatch):
    install_fake_cursor(tmp_path, monkeypatch)
    monkeypatch.setenv("QDR_BAD_CITATION", "1")

    with pytest.raises(research.ResearchValidationError, match="missing source anchor"):
        research.quick_deep_research(
            "Vector database benchmark claims",
            breadth=2,
            depth=1,
            search_backend=FakeCursorNativeBackend(),
            run_dir=tmp_path / "run",
        )


def test_default_search_backend_is_cursor_native():
    assert isinstance(make_search_backend(), CursorNativeSearchBackend)


def test_cursor_native_backend_parses_fake_agent_response(tmp_path, monkeypatch):
    install_fake_cursor(tmp_path, monkeypatch)

    results = CursorNativeSearchBackend().search("primary source query", num_results=1)

    assert results == [
        {
            "id": "native-source-1",
            "title": "Native search source",
            "url": "https://sample.test/native-source",
            "snippet": "Native search snippet",
            "published_date": None,
            "query": "primary source query",
        }
    ]


def test_package_has_no_paid_search_api_references():
    package_root = ROOT / "research"
    banned = [
        re.compile(r"\b" + "e" + "xa" + r"\b", re.IGNORECASE),
        re.compile(r"api\." + "e" + "xa" + r"\.ai", re.IGNORECASE),
    ]
    offenders: list[str] = []
    for path in package_root.rglob("*"):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if any(pattern.search(text) for pattern in banned):
            offenders.append(str(path.relative_to(package_root)))

    assert offenders == []

from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from research import quick_deep_research  # noqa: E402


FAKE_CURSOR = r'''
import json
import sys

prompt = sys.argv[-1]

def emit(payload):
    print(json.dumps({"type": "assistant", "text": json.dumps(payload, sort_keys=True)}), flush=True)
    print(json.dumps({"usage": {"inputTokens": 3, "outputTokens": 2}}), flush=True)

if "Derive search queries" in prompt:
    emit({"queries": ["alpha primary", "alpha dissent"]})
elif "Build a web graph" in prompt:
    emit({
        "nodes": [
            {"id": "S1", "type": "source", "label": "Alpha primary", "url": "https://sample.test/alpha-primary"},
            {"id": "S2", "type": "source", "label": "Alpha dissent", "url": "https://sample.test/alpha-dissent"},
            {"id": "E1", "type": "entity", "label": "Alpha"},
            {"id": "C1", "type": "claim", "label": "Alpha is best", "text": "Alpha is best."}
        ],
        "edges": [
            {"source": "S1", "target": "C1", "type": "supports", "evidence": "Primary result"},
            {"source": "S2", "target": "C1", "type": "contradicts", "evidence": "Dissent result"},
            {"source": "S1", "target": "E1", "type": "mentions", "evidence": "Alpha mention"}
        ]
    })
elif "Verify claim" in prompt:
    emit({
        "claim_id": "C1",
        "verdicts": [
            {"id": "C1:S1", "source_id": "S1", "verdict": "supports", "rationale": "S1 supports the claim.", "anchor": "Primary result"},
            {"id": "C1:S2", "source_id": "S2", "verdict": "contradicts", "rationale": "S2 contradicts the claim.", "anchor": "Dissent result"}
        ]
    })
elif "Synthesize cited report" in prompt:
    emit({
        "report": "Alpha is disputed: the primary source supports it [S1], while dissent contradicts it [S2].",
        "claim_citations": [{"claim_id": "C1", "source_ids": ["S1", "S2"]}]
    })
else:
    emit({"error": "unexpected prompt"})
'''


class SmokeSearchBackend:
    def search(self, query: str, *, num_results: int = 5) -> list[dict[str, Any]]:
        slug = query.replace(" ", "-")
        return [
            {
                "id": f"search-{slug}",
                "title": f"Search result {query}",
                "url": f"https://sample.test/{slug}",
                "snippet": f"Snippet for {query}",
                "query": query,
            }
        ][:num_results]


def install_fake_cursor(root: Path) -> None:
    fake_bin = root / "bin"
    fake_bin.mkdir()
    cursor = fake_bin / "cursor-agent"
    cursor.write_text("#!/usr/bin/env python3\n" + FAKE_CURSOR, encoding="utf-8")
    cursor.chmod(cursor.stat().st_mode | stat.S_IXUSR)
    os.environ["PATH"] = f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}"
    os.environ["AUTOCURSOR_LOG_DIR"] = str(root / "autocursor-logs")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="qdr-smoke-") as tmp:
        root = Path(tmp)
        install_fake_cursor(root)
        result = quick_deep_research(
            "Alpha product claim",
            breadth=2,
            depth=1,
            search_backend=SmokeSearchBackend(),
            run_dir=root / "run",
        )
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

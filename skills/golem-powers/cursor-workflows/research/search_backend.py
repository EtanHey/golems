"""Swappable search interface for Quick-Deep-Research.

Search is performed through cursor-agent native web/browse capability on the
Cursor subscription. No paid external search API belongs in this module.
"""

from __future__ import annotations

import hashlib
from typing import Any, Protocol

from lib import autocursor


class SearchBackend(Protocol):
    def search(self, query: str, *, num_results: int = 5) -> list[dict[str, Any]]:
        """Return normalized source dicts for one query."""


def _stable_id(value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
    return f"S-{digest}"


class CursorNativeSearchBackend:
    """Search via cursor-agent native web/browse capability."""

    def search(self, query: str, *, num_results: int = 5) -> list[dict[str, Any]]:
        schema = {
            "type": "object",
            "required": ["results"],
            "properties": {
                "results": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["title", "url", "snippet"],
                        "properties": {
                            "id": {"type": "string"},
                            "title": {"type": "string"},
                            "url": {"type": "string"},
                            "snippet": {"type": "string"},
                        },
                    },
                }
            },
        }
        result = autocursor.agent(
            "Search the web using cursor-agent native web/browse capability and return concise source results. "
            "Do not synthesize or analyze the results.\n"
            f"Query: {query}\nMaximum results: {num_results}",
            schema=schema,
            label="qdr-native-search",
        )
        data = result.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("results"), list):
            raise ValueError("malformed cursor-native search response")
        normalized: list[dict[str, Any]] = []
        for item in data["results"]:
            if not isinstance(item, dict):
                raise ValueError("malformed cursor-native search response: result is not object")
            normalized.append(_normalize_result(item, query=query))
        return normalized


def _normalize_result(item: dict[str, Any], *, query: str) -> dict[str, Any]:
    url = item.get("url")
    if not isinstance(url, str) or not url:
        raise ValueError("malformed search response: result missing url")
    title = item.get("title")
    if not isinstance(title, str) or not title:
        raise ValueError("malformed search response: result missing title")
    snippet = item.get("snippet")
    if not isinstance(snippet, str):
        snippet = item.get("text")
    if not isinstance(snippet, str):
        highlights = item.get("highlights")
        if isinstance(highlights, list):
            snippet = " ".join(str(part) for part in highlights)
    if not isinstance(snippet, str):
        snippet = ""
    source_id = item.get("id")
    if not isinstance(source_id, str) or not source_id:
        source_id = _stable_id(url)
    return {
        "id": source_id,
        "title": title,
        "url": url,
        "snippet": snippet,
        "published_date": item.get("publishedDate") or item.get("published_date"),
        "query": query,
    }


def make_search_backend(prefer: str | None = None) -> SearchBackend:
    selected = (prefer or "native").strip().lower()
    if selected in {"native", "cursor-native", "cursor"}:
        return CursorNativeSearchBackend()
    raise ValueError(f"unknown search backend: {selected}")

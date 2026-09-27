"""Structured findings validation and stable aggregation."""

from __future__ import annotations

from typing import Any

def validate_payload(
    payload: Any, *, require_divergent_subset: bool = True
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RuntimeError("structured worker output must be an object")
    if not isinstance(payload.get("worker"), str):
        raise RuntimeError("structured worker output missing required field worker")
    findings = payload.get("findings")
    if not isinstance(findings, list):
        raise RuntimeError("structured worker output missing required field findings")
    required_finding = (
        "concept",
        "implementation_sites",
        "divergent_sites",
        "shared_helper_shape",
        "confidence",
    )
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            raise RuntimeError(f"finding {index} must be an object")
        for field in required_finding:
            if field not in finding:
                raise RuntimeError(f"finding {index} missing required field {field}")
        if not isinstance(finding["implementation_sites"], list) or not isinstance(
            finding["divergent_sites"], list
        ):
            raise RuntimeError(f"finding {index} sites must be arrays")
        if not finding["implementation_sites"]:
            raise RuntimeError(
                f"finding {index} must include at least one implementation site"
            )
        if finding["confidence"] not in {"high", "medium", "low"}:
            raise RuntimeError(f"finding {index} confidence is invalid")
        for group, required_site in (
            (finding["implementation_sites"], ("path", "line", "summary")),
            (finding["divergent_sites"], ("path", "line", "reason")),
        ):
            for site_index, site in enumerate(group):
                if not isinstance(site, dict) or any(
                    field not in site for field in required_site
                ):
                    raise RuntimeError(
                        f"finding {index} site {site_index} is malformed"
                    )
        implementation_identities = {
            (str(site["path"]), int(site["line"]))
            for site in finding["implementation_sites"]
        }
        divergent_identities = {
            (str(site["path"]), int(site["line"]))
            for site in finding["divergent_sites"]
        }
        if require_divergent_subset and not divergent_identities.issubset(
            implementation_identities
        ):
            raise RuntimeError(
                f"finding {index} divergent sites must also be implementation sites"
            )
    return payload

def aggregate_worker_payloads(
    payloads: list[dict[str, Any]], *, repo: str, revision: str
) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, tuple[tuple[str, int], ...]]] = set()
    for payload in payloads:
        for raw in payload.get("findings", []):
            sites = raw.get("implementation_sites", [])
            identity = (
                str(raw.get("concept", "")).strip().lower(),
                tuple(sorted((str(site["path"]), int(site["line"])) for site in sites)),
            )
            if identity in seen:
                continue
            seen.add(identity)
            finding = dict(raw)
            finding["site_count"] = len(sites)
            findings.append(finding)
    findings.sort(
        key=lambda item: (
            -len(item.get("implementation_sites", [])),
            item.get("concept", ""),
        )
    )
    return {"repo": repo, "revision": revision, "findings": findings}

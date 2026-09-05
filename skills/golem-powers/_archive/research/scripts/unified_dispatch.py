#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import re
import sys
from typing import Any


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
SHARED_DRIVE_HELPER = REPO_ROOT / "skills" / "golem-powers" / "research" / "_shared" / "drive-paths.py"


def _load_drive_module():
    spec = importlib.util.spec_from_file_location("research_drive_paths", SHARED_DRIVE_HELPER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load shared drive helper: {SHARED_DRIVE_HELPER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


DRIVE_MODULE = _load_drive_module()
ensure_project_folders = DRIVE_MODULE.ensure_project_folders
get_backend = DRIVE_MODULE.get_backend


class UnifiedDispatchError(RuntimeError):
    pass


def load_fixture() -> dict[str, Any] | None:
    fixture_path = os.environ.get("RESEARCH_UNIFIED_FIXTURE")
    if not fixture_path:
        return None
    return json.loads(pathlib.Path(fixture_path).read_text())


def save_fixture(fixture: dict[str, Any]) -> None:
    fixture_path = os.environ.get("RESEARCH_UNIFIED_FIXTURE")
    pathlib.Path(fixture_path).write_text(json.dumps(fixture, indent=2) + "\n")


def record_op(fixture: dict[str, Any] | None, op: dict[str, Any]) -> None:
    if fixture is None:
        return
    fixture.setdefault("operations", []).append(op)
    save_fixture(fixture)


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "research"


def next_prompt_number(project: str, fixture: dict[str, Any] | None) -> str:
    if fixture is not None:
      return fixture["prompt_number"]

    backend = get_backend()
    structure = ensure_project_folders(backend, project)
    prompt_items = backend.list_files(structure["folders"]["prompts"])
    result_items = backend.list_files(structure["folders"]["results"])
    max_number = 0
    for item in [*prompt_items, *result_items]:
        match = re.search(r"R(\d+)", item["name"])
        if match:
            max_number = max(max_number, int(match.group(1)))
    return f"{max_number + 1:02d}"


def resolve_folders(project: str, fixture: dict[str, Any] | None) -> dict[str, str]:
    if fixture is not None:
        return fixture["folders"]
    backend = get_backend()
    structure = ensure_project_folders(backend, project)
    return structure["folders"]


def build_dispatch(project: str, topic: str, fixture: dict[str, Any] | None) -> dict[str, Any]:
    folders = resolve_folders(project, fixture)
    number = next_prompt_number(project, fixture)
    topic_slug = slugify(topic)
    prompt_name = f"R{number}-{topic_slug}.md"
    claude_result = f"R{number}-claude-web-result.md"
    gemini_result = f"R{number}-gemini-result.md"

    claude_web = {
        "skill": "/claude-web-research",
        "folder_id": folders["context"],
        "prompt_name": prompt_name,
        "result_name": claude_result,
        "command": f"/claude-web-research Write {prompt_name} --project {project}",
    }
    gemini = {
        "skill": "/gemini-research",
        "folder_id": folders["context"],
        "prompt_name": prompt_name,
        "result_name": gemini_result,
        "command": (
            "bash skills/golem-powers/gemini-research/scripts/drive-sync.sh "
            f"--project {project} --prompt {prompt_name}"
        ),
    }

    record_op(fixture, {"op": "dispatch_claude_web", "project": project, "folder_id": folders["context"], "prompt": prompt_name})
    record_op(fixture, {"op": "dispatch_gemini", "project": project, "folder_id": folders["context"], "prompt": prompt_name})

    return {
        "project": project,
        "topic": topic,
        "folders": folders,
        "prompt_name": prompt_name,
        "claude_web": claude_web,
        "gemini": gemini,
        "result_paths": {
            "claude_web": claude_result,
            "gemini": gemini_result,
        },
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Compute unified research dispatch for Claude Web + Gemini.")
    parser.add_argument("--project", required=True)
    parser.add_argument("--topic", required=True)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        fixture = load_fixture()
        summary = build_dispatch(args.project, args.topic, fixture)
        print(json.dumps(summary))
    except UnifiedDispatchError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

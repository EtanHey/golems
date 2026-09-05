#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
from typing import Any
from urllib.parse import quote


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
SHARED_DRIVE_HELPER = REPO_ROOT / "skills" / "golem-powers" / "research" / "_shared" / "drive-paths.py"
STATE_FILE = pathlib.Path(os.environ.get("GEMINI_RESEARCH_STATE_FILE", pathlib.Path.home() / ".golems" / "research-state.json"))
DEFAULT_PROFILE = os.environ.get("GEMINI_RESEARCH_PROFILE", "etanface")


def _load_drive_module():
    spec = importlib.util.spec_from_file_location("research_drive_paths", SHARED_DRIVE_HELPER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load shared drive helper: {SHARED_DRIVE_HELPER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


DRIVE_MODULE = _load_drive_module()
DrivePathsError = DRIVE_MODULE.DrivePathsError
ensure_project_folders = DRIVE_MODULE.ensure_project_folders
get_backend = DRIVE_MODULE.get_backend


class GeminiDriveSyncError(RuntimeError):
    pass


def run_cli(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    if check and result.returncode != 0:
        raise GeminiDriveSyncError(result.stderr.strip() or result.stdout.strip() or f"command failed: {' '.join(args)}")
    return result


def ensure_parent(path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {}
    return json.loads(STATE_FILE.read_text())


def save_state(state: dict[str, Any]) -> None:
    ensure_parent(STATE_FILE)
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n")


def parse_uuid(text: str) -> str:
    match = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", text)
    if not match:
        raise GeminiDriveSyncError(f"could not parse UUID from output: {text}")
    return match.group(0)


def parse_labeled_uuid(text: str, label: str) -> str:
    match = re.search(rf"{re.escape(label)}:\s*([0-9a-f-]{{36}})", text)
    if not match:
        raise GeminiDriveSyncError(f"could not parse {label} from output: {text}")
    return match.group(1)


def parse_result_number(prompt_name: str) -> str:
    match = re.search(r"R(\d+)", prompt_name)
    if not match:
        raise GeminiDriveSyncError(f"could not parse R-number from prompt name: {prompt_name}")
    return match.group(1)


def load_access_token() -> str:
    token_file = pathlib.Path(
        os.environ.get(
            "GOOGLE_DRIVE_TOKENS_FILE",
            pathlib.Path.home() / ".config" / "google-drive-mcp" / "tokens.json",
        )
    )
    if not token_file.exists():
        raise GeminiDriveSyncError(f"Drive token file not found: {token_file}")
    token_data = json.loads(token_file.read_text())
    token = token_data.get("access_token")
    if not token:
        raise GeminiDriveSyncError("missing access_token in Drive token file")
    return token


def drive_api_json(url: str, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    token = load_access_token()
    args = [
        "curl",
        "-fsS",
        "-H",
        f"Authorization: Bearer {token}",
    ]
    if payload is not None:
        args.extend(["-H", "Content-Type: application/json", "-X", method, "-d", json.dumps(payload)])
    elif method != "GET":
        args.extend(["-X", method])
    args.append(url)
    result = run_cli(args)
    return json.loads(result.stdout)


def drive_download(file_id: str) -> bytes:
    token = load_access_token()
    result = run_cli(
        [
            "curl",
            "-fsS",
            "-H",
            f"Authorization: Bearer {token}",
            f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media&supportsAllDrives=true",
        ]
    )
    return result.stdout.encode()


def drive_find_file(parent_id: str, name: str) -> dict[str, Any] | None:
    token = load_access_token()
    escaped_name = name.replace("'", "\\'")
    query = f"name = '{escaped_name}' and '{parent_id}' in parents and trashed = false"
    result = run_cli(
        [
            "curl",
            "-fsS",
            "-H",
            f"Authorization: Bearer {token}",
            "https://www.googleapis.com/drive/v3/files"
            f"?q={quote(query)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true",
        ]
    )
    payload = json.loads(result.stdout)
    files = payload.get("files", [])
    return files[0] if files else None


def drive_delete(file_id: str) -> None:
    token = load_access_token()
    run_cli(
        [
            "curl",
            "-fsS",
            "-H",
            f"Authorization: Bearer {token}",
            "-X",
            "DELETE",
            f"https://www.googleapis.com/drive/v3/files/{file_id}?supportsAllDrives=true",
        ]
    )


def drive_upload_markdown(parent_id: str, name: str, content: str) -> dict[str, Any]:
    token = load_access_token()
    existing = drive_find_file(parent_id, name)
    if existing is not None:
        drive_delete(existing["id"])
        existing = None
    metadata = json.dumps({"name": name, "parents": [parent_id]})
    endpoint = (
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name"
    )
    method = "POST"
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
        handle.write(content)
        temp_path = handle.name
    try:
        result = run_cli(
            [
                "curl",
                "-fsS",
                "-H",
                f"Authorization: Bearer {token}",
                "-X",
                method,
                "-F",
                f"metadata={metadata};type=application/json;charset=UTF-8",
                "-F",
                f"file=@{temp_path};type=text/markdown",
                endpoint,
            ]
        )
    finally:
        pathlib.Path(temp_path).unlink(missing_ok=True)
    return json.loads(result.stdout)


def load_fixture() -> dict[str, Any]:
    fixture_path = os.environ.get("GEMINI_DRIVE_SYNC_FIXTURE")
    if not fixture_path:
        raise GeminiDriveSyncError("fixture mode requested without GEMINI_DRIVE_SYNC_FIXTURE")
    return json.loads(pathlib.Path(fixture_path).read_text())


def save_fixture(fixture: dict[str, Any]) -> None:
    fixture_path = os.environ.get("GEMINI_DRIVE_SYNC_FIXTURE")
    pathlib.Path(fixture_path).write_text(json.dumps(fixture, indent=2) + "\n")


def fixture_record(fixture: dict[str, Any], op: dict[str, Any]) -> None:
    fixture.setdefault("operations", []).append(op)
    save_fixture(fixture)


def verify_account(fixture: dict[str, Any] | None) -> None:
    if fixture is not None:
        fixture_record(fixture, {"op": "verify-account"})
        if os.environ.get("GEMINI_DRIVE_SYNC_FAIL_VERIFY") == "1":
            raise GeminiDriveSyncError("account verification failed")
        return

    result = run_cli(
        [
            "bash",
            str(REPO_ROOT / "skills" / "golem-powers" / "research" / "_shared" / "verify-account.sh"),
            "--expect",
            "research-account@example.com",
        ]
    )
    payload = json.loads(result.stdout)
    if not payload.get("match"):
        raise GeminiDriveSyncError("account verification failed")


def load_project_assets(project: str, prompt_name: str, fixture: dict[str, Any] | None) -> tuple[dict[str, str], list[dict[str, Any]], dict[str, Any], str]:
    if fixture is not None:
        folders = {"project": f"{project}-project", "context": f"{project}-context", "prompts": f"{project}-prompts", "results": f"{project}-results"}
        context_files = fixture["drive_context_files"]
        prompt = next(item for item in fixture["prompts"] if item["name"] == prompt_name)
        return folders, context_files, prompt, prompt["content"]

    backend = get_backend()
    structure = ensure_project_folders(backend, project)
    folders = structure["folders"]
    context_files = backend.list_files(folders["context"])
    prompts = backend.list_files(folders["prompts"])
    prompt = next((item for item in prompts if item["name"] == prompt_name), None)
    if prompt is None:
        raise GeminiDriveSyncError(f"prompt not found in Drive prompts/: {prompt_name}")
    prompt_content = drive_download(prompt["id"]).decode()
    return folders, context_files, prompt, prompt_content


def ensure_notebook(project: str, state: dict[str, Any], fixture: dict[str, Any] | None) -> str:
    project_state = state.get(project, {})
    if project_state.get("notebook_id"):
        return project_state["notebook_id"]

    if fixture is not None:
        notebook_id = f"nb-{fixture['next_notebook_id']}"
        fixture["next_notebook_id"] += 1
        fixture.setdefault("notebooks", {})[notebook_id] = {"title": f"Research: {project}", "sources": []}
        fixture_record(fixture, {"op": "notebook_create", "project": project, "notebook_id": notebook_id})
    else:
        result = run_cli(["nlm", "notebook", "create", f"Research: {project}", "--profile", DEFAULT_PROFILE])
        notebook_id = parse_labeled_uuid(result.stdout, "ID")

    state[project] = {"notebook_id": notebook_id}
    save_state(state)
    return notebook_id


def add_context_sources(notebook_id: str, context_files: list[dict[str, Any]], fixture: dict[str, Any] | None) -> None:
    if fixture is not None:
        for item in context_files:
            fixture_record(fixture, {"op": "source_add_drive", "notebook_id": notebook_id, "document_id": item["id"]})
        return

    with tempfile.TemporaryDirectory() as temp_dir:
        for item in context_files:
            temp_path = pathlib.Path(temp_dir) / item["name"]
            temp_path.write_bytes(drive_download(item["id"]))
            run_cli(
                [
                    "nlm",
                    "source",
                    "add",
                    notebook_id,
                    "--file",
                    str(temp_path),
                    "--wait",
                    "--profile",
                    DEFAULT_PROFILE,
                ]
            )


def run_research(notebook_id: str, prompt_content: str, fixture: dict[str, Any] | None) -> str:
    query = prompt_content.strip()
    if fixture is not None:
        task_id = f"task-{fixture['next_task_id']}"
        fixture["next_task_id"] += 1
        fixture_record(fixture, {"op": "research_start", "notebook_id": notebook_id, "source": "drive", "task_id": task_id})
        fixture_record(fixture, {"op": "research_import", "notebook_id": notebook_id, "task_id": task_id})
        return task_id

    start = run_cli(
        [
            "nlm",
            "research",
            "start",
            query,
            "--source",
            "drive",
            "--notebook-id",
            notebook_id,
            "--profile",
            DEFAULT_PROFILE,
        ],
        check=False,
    )
    output = (start.stdout or "") + (start.stderr or "")
    if start.returncode not in (0, 1):
        raise GeminiDriveSyncError(output.strip() or "research start failed")
    task_id = parse_labeled_uuid(output, "Task ID")
    status = run_cli(
        [
            "nlm",
            "research",
            "status",
            notebook_id,
            "--task-id",
            task_id,
            "--max-wait",
            "60",
            "--profile",
            DEFAULT_PROFILE,
        ],
        check=False,
    )
    if status.returncode == 0 and "Status: completed" in status.stdout:
        run_cli(
            [
                "nlm",
                "research",
                "import",
                notebook_id,
                task_id,
                "--profile",
                DEFAULT_PROFILE,
            ],
            check=False,
        )
    return task_id


def query_summary(notebook_id: str, prompt_name: str, fixture: dict[str, Any] | None) -> str:
    if fixture is not None:
        return f"# Gemini Result\n\nPrompt: {prompt_name}\n\nFixture synthesis complete.\n"

    query = f"Using the current notebook context, produce a concise structured research summary for {prompt_name}."
    result = run_cli(
        [
            "nlm",
            "notebook",
            "query",
            notebook_id,
            query,
            "--json",
            "--profile",
            DEFAULT_PROFILE,
        ]
    )
    payload = json.loads(result.stdout)
    answer = payload.get("value", {}).get("answer")
    if not answer:
        raise GeminiDriveSyncError("NotebookLM query returned no answer")
    return f"# Gemini Result\n\nPrompt: {prompt_name}\n\n{answer}\n"


def write_result(project: str, folders: dict[str, str], result_name: str, content: str, fixture: dict[str, Any] | None) -> dict[str, Any]:
    if fixture is not None:
        record = {"name": result_name, "content": content}
        fixture.setdefault("results", []).append(record)
        fixture_record(fixture, {"op": "write_result", "project": project, "name": result_name})
        return record

    uploaded = drive_upload_markdown(folders["results"], result_name, content)
    return {"id": uploaded["id"], "name": uploaded["name"]}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Drive-sync workflow for gemini-research.")
    parser.add_argument("--project", required=True)
    parser.add_argument("--prompt", required=True, help="Prompt file name from Drive prompts/")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    fixture = load_fixture() if os.environ.get("GEMINI_DRIVE_SYNC_FIXTURE") else None

    try:
        verify_account(fixture)
        state = load_state()
        folders, context_files, prompt, prompt_content = load_project_assets(args.project, args.prompt, fixture)
        notebook_id = ensure_notebook(args.project, state, fixture)
        add_context_sources(notebook_id, context_files, fixture)
        task_id = run_research(notebook_id, prompt_content, fixture)
        result_number = parse_result_number(prompt["name"])
        result_name = f"R{result_number}-gemini-result.md"
        summary = query_summary(notebook_id, prompt["name"], fixture)
        result = write_result(args.project, folders, result_name, summary, fixture)
        print(
            json.dumps(
                {
                    "project": args.project,
                    "notebook_id": notebook_id,
                    "prompt": prompt["name"],
                    "task_id": task_id,
                    "result": result,
                }
            )
        )
    except GeminiDriveSyncError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except TimeoutError as exc:
        print(str(exc), file=sys.stderr)
        return 124

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

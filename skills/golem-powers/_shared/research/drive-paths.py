#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from urllib.parse import urlencode
from urllib.parse import quote

ROOT_CHAIN = ["Brain Drive", "Research"]
PROMPT_RE = re.compile(r"^R\d+.*\.md$")
RESULT_RE = re.compile(r"^R\d+.*-result\.md$")


class DrivePathsError(RuntimeError):
    pass


def _token_file_path() -> pathlib.Path:
    return pathlib.Path(
        os.environ.get(
            "GOOGLE_DRIVE_TOKENS_FILE",
            pathlib.Path.home() / ".config" / "google-drive-mcp" / "tokens.json",
        )
    )


def _oauth_keys_file_path() -> pathlib.Path:
    return pathlib.Path(
        os.environ.get(
            "GOOGLE_DRIVE_OAUTH_KEYS_FILE",
            pathlib.Path.home() / ".config" / "google-drive-mcp" / "gcp-oauth.keys.json",
        )
    )


def _load_token_data() -> tuple[pathlib.Path, dict]:
    token_file = _token_file_path()
    if not token_file.exists():
        raise DrivePathsError(f"Drive token file not found: {token_file}")
    return token_file, json.loads(token_file.read_text())


def _token_is_expired(token_data: dict) -> bool:
    expiry_date = token_data.get("expiry_date")
    if expiry_date is None:
        return False
    return int(expiry_date) <= int((time.time() + 60) * 1000)


def _refresh_access_token(token_file: pathlib.Path, token_data: dict) -> dict:
    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise DrivePathsError("missing refresh_token in Drive token file")

    oauth_file = _oauth_keys_file_path()
    if not oauth_file.exists():
        raise DrivePathsError(f"Drive OAuth keys file not found: {oauth_file}")

    oauth_data = json.loads(oauth_file.read_text()).get("installed", {})
    client_id = oauth_data.get("client_id")
    client_secret = oauth_data.get("client_secret")
    token_uri = oauth_data.get("token_uri")
    if not client_id or not client_secret or not token_uri:
        raise DrivePathsError("Drive OAuth keys file missing client credentials")

    payload = urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    )
    refreshed = _curl_json(
        [
            "-H",
            "Content-Type: application/x-www-form-urlencoded",
            "-X",
            "POST",
            "--data",
            payload,
            token_uri,
        ]
    )

    access_token = refreshed.get("access_token")
    if not access_token:
        raise DrivePathsError("refresh response missing access_token")

    token_data["access_token"] = access_token
    token_data["token_type"] = refreshed.get("token_type", token_data.get("token_type", "Bearer"))
    expires_in = refreshed.get("expires_in")
    if expires_in is not None:
        token_data["expiry_date"] = int((time.time() + int(expires_in)) * 1000)
    if refreshed.get("scope"):
        token_data["scope"] = refreshed["scope"]

    token_file.write_text(json.dumps(token_data, indent=2) + "\n")
    return token_data


def _load_access_token() -> str:
    token_file, token_data = _load_token_data()
    if _token_is_expired(token_data):
        token_data = _refresh_access_token(token_file, token_data)
    access_token = token_data.get("access_token")
    if not access_token:
        raise DrivePathsError("missing access_token in Drive token file")
    return access_token


def _curl_json(args: list[str]) -> dict | list:
    result = subprocess.run(
        ["curl", "-fsS", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise DrivePathsError(result.stderr.strip() or "curl request failed")
    return json.loads(result.stdout)


@dataclass
class FixtureBackend:
    path: pathlib.Path

    def __post_init__(self) -> None:
        self.data = json.loads(self.path.read_text())

    def _save(self) -> None:
        self.path.write_text(json.dumps(self.data, indent=2) + "\n")

    def _next_id(self) -> str:
        next_id = str(self.data.get("next_id", 1))
        self.data["next_id"] = int(next_id) + 1
        return next_id

    def find_folder(self, parent_id: str, name: str) -> dict | None:
        for folder in self.data["folders"]:
            if folder["parent"] == parent_id and folder["name"] == name:
                return folder
        return None

    def create_folder(self, parent_id: str, name: str) -> dict:
        folder = {"id": self._next_id(), "name": name, "parent": parent_id}
        self.data["folders"].append(folder)
        self._save()
        return folder

    def list_files(self, parent_id: str) -> list[dict]:
        return [
            {
                "id": item["id"],
                "name": item["name"],
                "mime": item["mimeType"],
            }
            for item in self.data["files"]
            if item["parent"] == parent_id
        ]

    @property
    def root_id(self) -> str:
        return "root"


@dataclass
class GoogleDriveBackend:
    access_token: str

    def _headers(self) -> list[str]:
        return ["-H", f"Authorization: Bearer {self.access_token}"]

    def find_folder(self, parent_id: str, name: str) -> dict | None:
        escaped_name = name.replace("'", "\\'")
        query = (
            f"name = '{escaped_name}' and "
            f"'{parent_id}' in parents and "
            "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        )
        payload = _curl_json(
            [
                *self._headers(),
                "https://www.googleapis.com/drive/v3/files"
                f"?q={quote(query)}&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true",
            ]
        )
        files = payload.get("files", [])
        return files[0] if files else None

    def create_folder(self, parent_id: str, name: str) -> dict:
        payload = json.dumps(
            {
                "name": name,
                "parents": [parent_id],
                "mimeType": "application/vnd.google-apps.folder",
            }
        )
        return _curl_json(
            [
                *self._headers(),
                "-H",
                "Content-Type: application/json",
                "-X",
                "POST",
                "-d",
                payload,
                "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
            ]
        )

    def list_files(self, parent_id: str) -> list[dict]:
        query = f"'{parent_id}' in parents and trashed = false"
        payload = _curl_json(
            [
                *self._headers(),
                "https://www.googleapis.com/drive/v3/files"
                f"?q={quote(query)}&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true",
            ]
        )
        return [
            {"id": item["id"], "name": item["name"], "mime": item["mimeType"]}
            for item in payload.get("files", [])
        ]

    @property
    def root_id(self) -> str:
        return "root"


def get_backend() -> FixtureBackend | GoogleDriveBackend:
    if os.environ.get("DRIVE_PATHS_SIMULATE_TIMEOUT") == "1":
        raise TimeoutError("Drive backend timed out")

    fixture_path = os.environ.get("DRIVE_PATHS_FIXTURE")
    if fixture_path:
        return FixtureBackend(pathlib.Path(fixture_path))

    return GoogleDriveBackend(_load_access_token())


def ensure_folder_chain(backend: FixtureBackend | GoogleDriveBackend, names: list[str]) -> list[dict]:
    parent_id = backend.root_id
    folders: list[dict] = []
    for name in names:
        folder = backend.find_folder(parent_id, name)
        if folder is None:
            folder = backend.create_folder(parent_id, name)
        folders.append(folder)
        parent_id = folder["id"]
    return folders


def resolve_project_folder(backend: FixtureBackend | GoogleDriveBackend, project: str) -> str:
    folders = ensure_folder_chain(backend, [*ROOT_CHAIN, project])
    return folders[-1]["id"]


def ensure_project_folders(backend: FixtureBackend | GoogleDriveBackend, project: str) -> dict:
    root_folders = ensure_folder_chain(backend, [*ROOT_CHAIN, project])
    project_folder = root_folders[-1]
    context = backend.find_folder(project_folder["id"], "context") or backend.create_folder(project_folder["id"], "context")
    prompts = backend.find_folder(project_folder["id"], "prompts") or backend.create_folder(project_folder["id"], "prompts")
    results = backend.find_folder(project_folder["id"], "results") or backend.create_folder(project_folder["id"], "results")
    return {
        "project": project,
        "folders": {
            "project": project_folder["id"],
            "context": context["id"],
            "prompts": prompts["id"],
            "results": results["id"],
        },
    }


def _list_named_files(
    backend: FixtureBackend | GoogleDriveBackend,
    project: str,
    folder_name: str,
    matcher: re.Pattern[str] | None = None,
) -> list[dict]:
    structure = ensure_project_folders(backend, project)
    folder_id = structure["folders"][folder_name]
    items = backend.list_files(folder_id)
    if matcher is not None:
        items = [item for item in items if matcher.match(item["name"])]
    items.sort(key=lambda item: item["name"])
    return items


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Resolve Drive-backed research project paths.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command in [
        "resolve-project-folder",
        "ensure-project-folders",
        "list-context-files",
        "list-prompts",
        "list-results",
    ]:
        subparser = subparsers.add_parser(command)
        subparser.add_argument("project")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        backend = get_backend()
        if args.command == "resolve-project-folder":
            print(resolve_project_folder(backend, args.project))
        elif args.command == "ensure-project-folders":
            print(json.dumps(ensure_project_folders(backend, args.project)))
        elif args.command == "list-context-files":
            print(json.dumps(_list_named_files(backend, args.project, "context")))
        elif args.command == "list-prompts":
            print(json.dumps(_list_named_files(backend, args.project, "prompts", PROMPT_RE)))
        elif args.command == "list-results":
            print(json.dumps(_list_named_files(backend, args.project, "results", RESULT_RE)))
        else:
            parser.error(f"unsupported command: {args.command}")
    except TimeoutError as exc:
        print(str(exc), file=sys.stderr)
        return 124
    except DrivePathsError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

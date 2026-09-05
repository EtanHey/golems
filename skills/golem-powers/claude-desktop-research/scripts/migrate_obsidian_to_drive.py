#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import mimetypes
import os
import pathlib
import subprocess
import sys
from dataclasses import dataclass
from urllib.parse import quote


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
DEFAULT_OBSIDIAN_ROOT = (
    pathlib.Path.home()
    / "Library"
    / "Mobile Documents"
    / "iCloud~md~obsidian"
    / "Documents"
    / "personal"
    / "Claude Web Research"
    / "research-to-run"
)
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
DrivePathsError = DRIVE_MODULE.DrivePathsError
ensure_project_folders = DRIVE_MODULE.ensure_project_folders
get_backend = DRIVE_MODULE.get_backend


def md5_for_path(path: pathlib.Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(65536)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def guess_mime(path: pathlib.Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "text/plain"


def batch_to_project(batch_name: str) -> str:
    return batch_name.removeprefix("batch-")


def build_deprecated_notice(project: str) -> str:
    return (
        "# DEPRECATED\n\n"
        "This Claude Web batch is no longer the source of truth.\n\n"
        f"Canonical Drive location: `Brain Drive/Research/{project}/`\n"
        f"- prompts: `Brain Drive/Research/{project}/prompts/`\n"
        f"- context: `Brain Drive/Research/{project}/context/`\n"
        f"- results: `Brain Drive/Research/{project}/results/`\n\n"
        "Keep this folder only as a migration breadcrumb.\n"
    )


def collect_batch_files(batch_dir: pathlib.Path) -> list[tuple[pathlib.Path, str, str]]:
    mappings: list[tuple[pathlib.Path, str, str]] = []

    description = batch_dir / "project-description.md"
    if description.exists():
        mappings.append((description, "project", "description.md"))

    instructions = batch_dir / "project-instructions.md"
    if instructions.exists():
        mappings.append((instructions, "project", "instructions.md"))

    context_dir = batch_dir / "context"
    if context_dir.exists():
        for path in sorted(context_dir.rglob("*")):
            if path.is_file():
                rel_name = path.relative_to(context_dir).as_posix()
                mappings.append((path, "context", rel_name))

    for path in sorted(batch_dir.glob("R*.md")):
        if path.name == "DEPRECATED.md":
            continue
        bucket = "results" if path.name.endswith("-result.md") else "prompts"
        mappings.append((path, bucket, path.name))

    return mappings


@dataclass
class LocalMirrorBackend:
    root: pathlib.Path

    def ensure_structure(self, project: str) -> dict[str, pathlib.Path]:
        project_root = self.root / "Research" / project
        context = project_root / "context"
        prompts = project_root / "prompts"
        results = project_root / "results"
        for path in [project_root, context, prompts, results]:
            path.mkdir(parents=True, exist_ok=True)
        return {
            "project": project_root,
            "context": context,
            "prompts": prompts,
            "results": results,
        }

    def sync_file(self, project: str, bucket: str, relative_name: str, source: pathlib.Path, dry_run: bool) -> str:
        if dry_run:
            return "planned"
        structure = self.ensure_structure(project)
        destination_root = structure[bucket]
        destination = destination_root / relative_name
        if destination.exists() and md5_for_path(destination) == md5_for_path(source):
            return "skipped"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read_bytes())
        return "uploaded"


class GoogleDriveSyncBackend:
    def __init__(self) -> None:
        self.backend = get_backend()
        if self.backend.__class__.__name__ != "GoogleDriveBackend":
            raise DrivePathsError("expected live Google Drive backend")
        self.access_token = self.backend.access_token

    def _curl_json(self, args: list[str]) -> dict:
        result = subprocess.run(["curl", "-fsS", *args], capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise DrivePathsError(result.stderr.strip() or "curl request failed")
        return json.loads(result.stdout)

    def _headers(self) -> list[str]:
        return ["-H", f"Authorization: Bearer {self.access_token}"]

    def _find_file(self, parent_id: str, name: str) -> dict | None:
        escaped_name = name.replace("'", "\\'")
        query = (
            f"name = '{escaped_name}' and "
            f"'{parent_id}' in parents and "
            "trashed = false"
        )
        payload = self._curl_json(
            [
                *self._headers(),
                "https://www.googleapis.com/drive/v3/files"
                f"?q={quote(query)}&fields=files(id,name,md5Checksum)&supportsAllDrives=true&includeItemsFromAllDrives=true",
            ]
        )
        files = payload.get("files", [])
        return files[0] if files else None

    def _upload(self, parent_id: str, relative_name: str, source: pathlib.Path, existing_id: str | None) -> None:
        metadata = json.dumps({"name": pathlib.Path(relative_name).name, "parents": [parent_id]})
        endpoint = (
            f"https://www.googleapis.com/upload/drive/v3/files/{existing_id}"
            "?uploadType=multipart&supportsAllDrives=true&fields=id,name,md5Checksum"
            if existing_id
            else "https://www.googleapis.com/upload/drive/v3/files"
            "?uploadType=multipart&supportsAllDrives=true&fields=id,name,md5Checksum"
        )
        method = "PATCH" if existing_id else "POST"
        result = subprocess.run(
            [
                "curl",
                "-fsS",
                *self._headers(),
                "-X",
                method,
                "-F",
                f"metadata={metadata};type=application/json;charset=UTF-8",
                "-F",
                f"file=@{source};type={guess_mime(source)}",
                endpoint,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise DrivePathsError(result.stderr.strip() or "upload failed")

    def ensure_structure(self, project: str) -> dict[str, str]:
        structure = ensure_project_folders(self.backend, project)
        return structure["folders"]

    def sync_file(self, project: str, bucket: str, relative_name: str, source: pathlib.Path, dry_run: bool) -> str:
        structure = self.ensure_structure(project)
        parent_id = structure[bucket]
        if "/" in relative_name:
            parts = relative_name.split("/")
            for folder_name in parts[:-1]:
                folder = self.backend.find_folder(parent_id, folder_name)
                if folder is None:
                    if dry_run:
                        return "planned"
                    folder = self.backend.create_folder(parent_id, folder_name)
                parent_id = folder["id"]
            relative_name = parts[-1]
        existing = self._find_file(parent_id, relative_name)
        source_hash = md5_for_path(source)
        if existing and existing.get("md5Checksum") == source_hash:
            return "skipped"
        if dry_run:
            return "planned"
        self._upload(parent_id, relative_name, source, existing["id"] if existing else None)
        return "uploaded"


def get_sync_backend():
    mirror_root = os.environ.get("CLAUDE_WEB_DRIVE_MIRROR_DIR")
    if mirror_root:
        return LocalMirrorBackend(pathlib.Path(mirror_root))
    return GoogleDriveSyncBackend()


def migrate_batch(sync_backend, batch_dir: pathlib.Path, batch_name: str, dry_run: bool) -> dict:
    project = batch_to_project(batch_name)
    actions = {"planned": 0, "uploaded": 0, "skipped": 0}
    files = collect_batch_files(batch_dir)
    files_summary = []
    for source, bucket, relative_name in files:
        outcome = sync_backend.sync_file(project, bucket, relative_name, source, dry_run)
        actions[outcome] += 1
        files_summary.append(
            {
                "source": str(source),
                "bucket": bucket,
                "target": relative_name,
                "outcome": outcome,
            }
        )

    if not dry_run:
        deprecated_file = batch_dir / "DEPRECATED.md"
        deprecated_file.write_text(build_deprecated_notice(project))

    return {
        "batch": batch_name,
        "project": project,
        "source_dir": str(batch_dir),
        "actions": actions,
        "files": files_summary,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Migrate Claude Web research batches from Obsidian to Drive.")
    parser.add_argument("batches", nargs="*", help="Specific batch-* folders to migrate. Defaults to all batch-* folders.")
    parser.add_argument("--dry-run", action="store_true", help="Print the migration plan without uploading or writing DEPRECATED.md.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    source_root = pathlib.Path(os.environ.get("CLAUDE_WEB_OBSIDIAN_ROOT", DEFAULT_OBSIDIAN_ROOT))
    if not source_root.exists():
        print(f"Obsidian root not found: {source_root}", file=sys.stderr)
        return 1

    if args.batches:
        batch_dirs = [source_root / name for name in args.batches]
    else:
        batch_dirs = sorted(path for path in source_root.glob("batch-*") if path.is_dir())

    missing = [path for path in batch_dirs if not path.exists()]
    if missing:
        print(f"Missing batch folder(s): {', '.join(str(path) for path in missing)}", file=sys.stderr)
        return 1

    try:
        sync_backend = get_sync_backend()
        summary = {
            "dry_run": args.dry_run,
            "source_root": str(source_root),
            "batches": [
                migrate_batch(sync_backend, batch_dir, batch_dir.name, args.dry_run)
                for batch_dir in batch_dirs
            ],
        }
    except TimeoutError as exc:
        print(str(exc), file=sys.stderr)
        return 124
    except DrivePathsError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

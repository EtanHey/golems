"""W1c preservation gates against disposable, real Git worktrees."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

import pytest

from test_workspace_retire import SCRIPT, command, git, load_retire, retire_args, run, tree


@pytest.fixture
def archive_root():
    scratch = SCRIPT.parents[2] / "docs.local"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="w1c-archive-", dir=scratch) as directory:
        yield Path(directory)


def ignored(tree, *names):
    target = tree[1]
    (target / ".gitignore").write_text("\n".join(names) + "\n")
    git(target, "add", ".gitignore")
    git(target, "commit", "-qm", "ignore fixture paths")


def manifest(tree, archive_root):
    ignored(tree, "docs.local/")
    entries = []
    for name in ("docs.local/report", "docs.local/nested/line\nname"):
        source, archived = tree[1] / name, archive_root / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"preserved evidence\n")
        archived.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, archived)
        entries.append(dict(path=name, sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                            size=source.stat().st_size, archived_to=str(archived)))
    path = archive_root / "manifest.json"
    path.write_text(json.dumps(dict(archive_root=str(archive_root), entries=entries)))
    return path


def test_regenerable_ignored_directories_removed(tree):
    ignored(tree, "node_modules/", "__pycache__/")
    for name in ("node_modules/package/file", "pkg/__pycache__/module.pyc"):
        path = tree[1] / name
        path.parent.mkdir(parents=True)
        path.write_text("regenerable\n")
    result, receipt = run(tree)
    assert result.returncode == 0 and receipt["disposition"] == "REMOVED"
    assert receipt["regenerable_entries_count"] == 2
    assert set(receipt["regenerable_entries"]) == {"node_modules/", "pkg/__pycache__/"}


@pytest.mark.parametrize("archived", [False, True])
def test_docs_local_requires_verified_archive(tree, archive_root, archived):
    path = manifest(tree, archive_root)
    result, receipt = run(tree, *(["--archive-manifest", path] if archived else []))
    assert receipt["disposition"] == ("REMOVED" if archived else "RETAINED")
    assert (result.returncode == 0) is archived
    if archived:
        assert receipt["archive_manifest"] == str(path)
        assert receipt["archive_manifest_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
        assert receipt["archive_verified_count"] == 2
    else:
        assert receipt["local_files"] == ["docs.local/"]
    assert all(Path(row["archived_to"]).read_bytes() == b"preserved evidence\n"
               for row in json.loads(path.read_text())["entries"])


@pytest.mark.parametrize("bad", ["hash", "missing", "source", "size", "uncovered", "symlink",
                                      "escape", "duplicate", "malformed", "unreadable"])
def test_bad_archive_retains(tree, archive_root, bad):
    path = manifest(tree, archive_root)
    data = json.loads(path.read_text())
    row = data["entries"][0]
    archived = Path(row["archived_to"])
    if bad == "hash":
        row["sha256"] = "0" * 64
    elif bad == "missing":
        archived.unlink()
    elif bad == "source":
        (tree[1] / row["path"]).write_text("changed\n")
    elif bad == "size":
        row["size"] += 1
    elif bad == "uncovered":
        (tree[1] / "docs.local/unlisted").write_text("valuable\n")
    elif bad == "symlink":
        archived.unlink()
        archived.symlink_to(tree[1] / row["path"])
    elif bad == "escape":
        row["path"] = "../escape"
    elif bad == "duplicate":
        data["entries"].append(row)
    elif bad == "unreadable":
        archived.chmod(0)
    path.write_text("[]" if bad == "malformed" else json.dumps(data))
    try:
        result, receipt = run(tree, "--archive-manifest", path)
        assert result.returncode != 0 and receipt["disposition"] == "RETAINED"
        assert receipt["remove_rc"] is None and tree[1].is_dir()
    finally:
        if bad == "unreadable":
            archived.chmod(0o600)


@pytest.mark.parametrize("location", ["inside", "tmp", "tmp-alias"])
def test_unsafe_archive_root_refused(tree, archive_root, location):
    path = manifest(tree, archive_root)
    data = json.loads(path.read_text())
    if location == "tmp-alias":
        alias = archive_root / "tmp-alias"
        alias.symlink_to("/tmp", target_is_directory=True)
    data["archive_root"] = str(tree[1] if location == "inside" else
                               alias if location == "tmp-alias" else Path("/tmp"))
    path.write_text(json.dumps(data))
    result, receipt = run(tree, "--archive-manifest", path)
    assert result.returncode == 2 and receipt["disposition"] == "RETAINED"
    assert "archive_root" in receipt["reason"] and receipt["move_rc"] is None


@pytest.mark.parametrize("name", ["node_modules/file", ".DS_Store", "mynode_modules/file"])
def test_untracked_cache_names_always_retained(tree, name):
    ignored(tree, "!.DS_Store")  # Override ambient global ignores in the child CLI.
    path = tree[1] / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("untracked work\n")
    result, receipt = run(tree)
    assert result.returncode == 2 and receipt["disposition"] == "RETAINED"
    assert receipt["local_files"] == [name]


def test_allowlist_excludes_preservation_patterns():
    patterns = SCRIPT.with_name("regenerable-paths.txt").read_text().lower().splitlines()
    assert patterns
    # .venv/ is the brief's explicit virtualenv exception to the env-name ban.
    assert not any(word in pattern for pattern in patterns
                   for word in ("docs.local", "env", "secret", "key", "token")
                   if pattern != ".venv/")


def test_cache_plus_unlisted_ignored_file_retained(tree):
    ignored(tree, "node_modules/", "valuable")
    (tree[1] / "node_modules").mkdir()
    (tree[1] / "node_modules/cache").write_text("cache\n")
    (tree[1] / "valuable").write_text("valuable\n")
    result, receipt = run(tree)
    assert result.returncode == 2 and receipt["disposition"] == "RETAINED"
    assert receipt["local_files"] == ["valuable"]
    assert receipt["regenerable_entries"] == ["node_modules/"]


@pytest.mark.parametrize("race", ["source", "archive", "manifest", "new-file", "root"])
def test_preservation_rechecked_after_quarantine(tree, archive_root, monkeypatch, race):
    path = manifest(tree, archive_root)
    data = json.loads(path.read_text())
    module, args = load_retire(), retire_args(tree)
    args.archive_manifest = str(path)
    real_git = module.git
    def inject(repo, *words):
        result = real_git(repo, *words)
        if words[:2] == ("worktree", "move") and Path(words[2]) == tree[1]:
            moved = Path(words[3])
            if race == "source":
                (moved / data["entries"][0]["path"]).write_text("changed\n")
            elif race == "archive":
                Path(data["entries"][0]["archived_to"]).unlink()
            elif race == "manifest":
                path.write_text(path.read_text() + " ")
            elif race == "root":
                data["archive_root"] = str(moved)
                path.write_text(json.dumps(data))
            else:
                (moved / "docs.local/new").write_text("new work\n")
        return result
    monkeypatch.setattr(module, "git", inject)
    monkeypatch.setattr(module, "open_handles", lambda path, **kwargs: [])
    receipt, code = module.retire(args)
    assert code == 2 and receipt["disposition"] == "RETAINED"
    assert receipt["move_back_rc"] == 0 and receipt["remove_rc"] is None
    assert tree[1].is_dir()


@pytest.mark.parametrize("name", ["node_modules", "mynode_modules/file", "node_modules.old/file"])
def test_ignored_allowlist_matching_is_directory_anchored(tree, name):
    ignored(tree, "*")
    path = tree[1] / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("valuable\n")
    result, receipt = run(tree)
    assert result.returncode == 2 and receipt["disposition"] == "RETAINED"
    assert receipt["regenerable_entries_count"] == 0


def test_regenerable_receipt_caps_examples(tree):
    ignored(tree, "__pycache__/")
    for number in range(25):
        path = tree[1] / str(number) / "__pycache__/module.pyc"
        path.parent.mkdir(parents=True)
        path.write_bytes(b"cache")
    result, receipt = run(tree)
    assert result.returncode == 0 and receipt["disposition"] == "REMOVED"
    assert receipt["regenerable_entries_count"] == 25
    assert len(receipt["regenerable_entries"]) == 20


@pytest.mark.parametrize("evidence", ["manifest", "copy", "late-copy"])
def test_receipt_cannot_overwrite_archive_evidence(tree, archive_root, evidence):
    path = manifest(tree, archive_root)
    data = json.loads(path.read_text())
    destination = path if evidence == "manifest" else Path(data["entries"][-1]["archived_to"])
    before = destination.read_bytes()
    if evidence == "late-copy":
        data["entries"][0]["sha256"] = "0" * 64
        path.write_text(json.dumps(data))
    result = subprocess.run(command(tree, "--archive-manifest", path,
                                    "--receipt-out", destination), capture_output=True, text=True)
    receipt = json.loads(result.stdout)
    assert result.returncode == 2 and receipt["disposition"] == "RETAINED"
    assert receipt["remove_rc"] is None and tree[1].is_dir()
    assert destination.read_bytes() == before


def test_broad_archive_root_cannot_hide_ephemeral_copies(tree, archive_root, monkeypatch):
    path = manifest(tree, archive_root)
    data = json.loads(path.read_text())
    data["archive_root"] = "/"
    with tempfile.TemporaryDirectory(prefix="w1c-ephemeral-", dir=archive_root.parent) as directory:
        monkeypatch.setenv("TMPDIR", directory)
        for row in data["entries"]:
            archived = Path(directory) / row["path"]
            archived.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(tree[1] / row["path"], archived)
            row["archived_to"] = str(archived)
        path.write_text(json.dumps(data))
        result, receipt = run(tree, "--archive-manifest", path)
        assert result.returncode == 2 and receipt["disposition"] == "RETAINED"
        assert "ephemeral directory" in receipt["reason"]
        assert receipt["remove_rc"] is None

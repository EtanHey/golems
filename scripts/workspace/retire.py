#!/usr/bin/env python3
"""Retire one separately authorized worktree; never force, prune or retry.

The caller owns consumer/lease and content-preservation checks. Untracked files
always retain the worktree. Ignored files require the committed regenerable-paths
allowlist or --archive-manifest: a JSON object with archive_root and entries of
{path, sha256, size, archived_to}. Paths are relative to the worktree; archived_to
may be absolute or relative to archive_root. Archives and the manifest must
survive outside the original/quarantine paths; archive_root cannot be ephemeral.
Directories require file-by-file coverage. This primitive never writes archives.
Regenerable directories are scanned without following symlinks; any .git entry
or incomplete scan retains the worktree. Each inventory's scan is capped at
30 seconds or 100,000 entries, with duration/count/budget evidence in the receipt.
Callers must hold the W2 lease with all consumers released before calling; W4
must enforce that precondition. Handle scans and repeated inventories reduce
the race window but cannot exclude a brand-new writer in the milliseconds
between the last check and Git's delete. Quarantine prevents late writes using
an old absolute path; it does not exclude writers that discover the moved path.
lsof cannot see every process (other users or sandboxed processes); the lease
precondition and caller writer exclusion still apply.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time


REGENERABLE_WALK_SECONDS = 30.0
REGENERABLE_WALK_ENTRIES = 100_000


def git(repo, *args):
    # Ambient Git overrides must not redirect the explicit repository identity.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, env=env)
    # Decode without universal-newline translation: preserve Git's stderr verbatim.
    result.stdout = result.stdout.decode("utf-8", errors="surrogateescape")
    result.stderr = result.stderr.decode("utf-8", errors="surrogateescape")
    return result


def worktrees(repo):
    result = git(repo, "worktree", "list", "--porcelain", "-z")
    if result.returncode:
        raise ValueError("worktree list failed: " + result.stderr)
    rows = []
    for block in result.stdout.split("\0\0"):
        row = dict(field.partition(" ")[::2] for field in block.split("\0") if field)
        if row:
            if "worktree" not in row:
                raise ValueError("worktree list evidence malformed")
            rows.append(row)
    if not rows:
        raise ValueError("worktree list evidence empty")
    return rows


def observe(receipt, repo, path, prefix=""):
    errors = []
    try:
        rows = worktrees(repo)
        receipt[prefix + "registered_after"] = any(Path(r["worktree"]) == path for r in rows)
    except (OSError, ValueError) as error:
        errors.append(str(error))
    try:
        os.lstat(path)
        receipt[prefix + "physical_after"] = True
    except FileNotFoundError:
        receipt[prefix + "physical_after"] = False
    except OSError as error:
        errors.append("lstat failed: " + str(error))
    return errors


def local_files(path):
    status = git(path, "status", "--porcelain=v1", "--ignored=matching",
                 "--untracked-files=all", "-z")
    if status.returncode:
        raise ValueError("status evidence incomplete: " + status.stderr)
    paths = []
    entries = iter(status.stdout.split("\0"))
    for entry in entries:
        if not entry:
            continue
        if len(entry) < 4 or entry[2] != " ":
            raise ValueError("status evidence incomplete: malformed entry")
        if entry[:2] in ("!!", "??"):
            paths.append((entry[:2], entry[3:]))
        elif "R" in entry[:2] or "C" in entry[:2]:
            # Porcelain -z emits a second path for tracked renames/copies.
            if not next(entries, None):
                raise ValueError("status evidence incomplete: missing source path")
    return paths, status.stdout


def regular_hash(path):
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError("archive evidence is a symlink: " + str(path))
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or not info.st_mode & 0o444:
        raise ValueError("archive evidence is not a readable regular file: " + str(path))
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def verified_archive(receipt, path, manifest):
    if manifest is None:
        return set()
    excluded = [Path(receipt["path"]), path]
    excluded.extend(Path(receipt[key]) for key in ("quarantine_path", "quarantine_container")
                    if receipt[key] is not None)
    def surviving(candidate, label="archive evidence"):
        if any(candidate.resolve().is_relative_to(root) for root in excluded):
            raise ValueError(label + " is inside retiring path: " + str(candidate))
    def protect_receipt(candidate):
        if receipt["receipt_out"] and Path(receipt["receipt_out"]).resolve() == candidate.resolve():
            receipt["receipt_destination_refused"] = True
            raise ValueError("receipt destination would overwrite archive evidence: " + str(candidate))
    manifest = Path(manifest).absolute()
    surviving(manifest)
    protect_receipt(manifest)
    receipt["archive_verified_count"] = 0
    raw = manifest.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if receipt["archive_manifest_sha256"] not in (None, digest):
        raise ValueError("archive manifest changed since first read")
    receipt["archive_manifest_sha256"] = digest
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or not isinstance(data.get("archive_root"), str):
            raise ValueError("invalid archive_root or manifest object")
        root = Path(data["archive_root"])
        entries = data.get("entries")
        if not isinstance(entries, list):
            raise ValueError("archive entries must be a list")
        # Protect every destination before a bad earlier entry can abort verification.
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get("archived_to"), str):
                protect_receipt(root / entry["archived_to"])
        if not root.is_absolute():
            raise ValueError("archive_root must be absolute")
        root = root.resolve()
        surviving(root, "archive_root")
        temporary = ["/tmp", "/private/tmp", "/var/tmp", "/var/folders", "/dev/shm", tempfile.gettempdir()]
        temporary.extend(os.environ[key] for key in ("TMPDIR", "TMP", "TEMP") if os.environ.get(key))
        def durable(candidate):
            if any(candidate.resolve().is_relative_to(Path(value).resolve()) for value in temporary):
                raise ValueError("archive_root or archived_to is under an ephemeral directory")
        durable(root)
        if not root.is_dir():
            raise ValueError("archive_root unavailable")
        verified = set()
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                raise ValueError("invalid archive entry path")
            name = entry["path"]
            relative = Path(name)
            if relative.is_absolute() or any(part in ("", ".", "..") for part in name.split("/")):
                raise ValueError("archive entry path must be worktree-relative: " + name)
            if name in verified or not isinstance(entry.get("archived_to"), str):
                raise ValueError("duplicate path or invalid archived_to: " + name)
            archived = root / entry["archived_to"]
            if not archived.resolve().is_relative_to(root):
                raise ValueError("archived_to escapes archive_root: " + name)
            surviving(archived)
            durable(archived)
            if (not isinstance(entry.get("sha256"), str)
                    or re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is None
                    or type(entry.get("size")) is not int or entry["size"] < 0):
                raise ValueError("invalid archive hash or size: " + name)
            expected = entry["sha256"], entry["size"]
            if regular_hash(path / relative) != expected or regular_hash(archived) != expected:
                raise ValueError("archive hash/size mismatch: " + name)
            verified.add(name)
            receipt["archive_verified_count"] = len(verified)
        return verified
    except (TypeError, KeyError, UnicodeError) as error:
        raise ValueError("invalid archive manifest: " + str(error)) from error


def archived_entry(path, name, verified):
    entry = path / name
    info = entry.lstat()
    if stat.S_ISREG(info.st_mode):
        return name in verified
    if not stat.S_ISDIR(info.st_mode) or not info.st_mode & 0o444 or not info.st_mode & 0o111:
        raise ValueError("unreadable or unsupported ignored entry: " + name)
    # Walk explicitly: glob/rglob can suppress directory enumeration errors.
    return all([archived_entry(path, child.relative_to(path).as_posix(), verified)
                for child in entry.iterdir()])


def inspect_regenerable(receipt, path, names, patterns):
    started = time.monotonic()
    walk = dict(phase="before_move" if path == Path(receipt["path"]) else "after_move",
                duration_seconds=0.0, entry_count=0, budget_hit=None, nested_repositories=[])
    receipt["regenerable_walks"].append(walk)
    directories = {pattern[:-1] for pattern in patterns if pattern.endswith("/")}
    roots = set()
    for name in names:
        parts = Path(name).parts
        for index, part in enumerate(parts if name.endswith("/") else parts[:-1]):
            if part in directories:
                roots.add(Path(*parts[:index + 1]))
                break
    def nested_reason():
        return "nested repository in regenerable dir: " + ", ".join(walk["nested_repositories"])
    def incomplete(detail):
        reason = "regenerable walk evidence incomplete: " + detail
        return ValueError(nested_reason() + "; " + reason if walk["nested_repositories"] else reason)
    def budget():
        if time.monotonic() - started >= REGENERABLE_WALK_SECONDS:
            walk["budget_hit"] = "time"
            raise incomplete("time budget exceeded")
        if walk["entry_count"] >= REGENERABLE_WALK_ENTRIES:
            walk["budget_hit"] = "entries"
            raise incomplete("entries budget exceeded")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    def visit(parent, name, relative):
        budget()
        descriptor = os.open(name, flags, dir_fd=parent)
        try:
            info = os.fstat(descriptor)
            if not info.st_mode & 0o444 or not info.st_mode & 0o111:
                raise PermissionError("unreadable directory: " + str(relative))
            with os.scandir(descriptor) as entries:
                for entry in entries:
                    budget()
                    walk["entry_count"] += 1
                    child = relative / entry.name
                    if entry.name == ".git":
                        walk["nested_repositories"].append(child.as_posix())
                        if len(walk["nested_repositories"]) == 20:
                            raise ValueError(nested_reason())
                        continue
                    # Always stat, including files: stale dirents are incomplete evidence.
                    mode = entry.stat(follow_symlinks=False).st_mode
                    if stat.S_ISDIR(mode):
                        visit(descriptor, entry.name, child)
            after = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if (after.st_dev, after.st_ino) != (info.st_dev, info.st_ino):
                raise OSError("directory changed while walking: " + str(relative))
        finally:
            os.close(descriptor)
    try:
        budget()
        worktree = os.open(path, flags)
        try:
            for root in sorted(roots):
                parent = os.dup(worktree)
                try:
                    # Open each component separately so O_NOFOLLOW covers ancestors too.
                    for part in root.parts[:-1]:
                        budget()
                        child = os.open(part, flags, dir_fd=parent)
                        os.close(parent)
                        parent = child
                    visit(parent, root.name, root)
                finally:
                    os.close(parent)
        finally:
            os.close(worktree)
        budget()
        if walk["nested_repositories"]:
            raise ValueError(nested_reason())
    except (OSError, RuntimeError) as error:
        raise incomplete(str(error)) from error
    finally:
        walk["duration_seconds"] = time.monotonic() - started


def inventory(receipt, path):
    entries, status = local_files(path)
    patterns = Path(__file__).with_name("regenerable-paths.txt").read_text().splitlines()
    verified = verified_archive(receipt, path, receipt["archive_manifest"])
    files, regenerable = [], []
    for kind, name in entries:
        if kind == "!!" and any(
                ("/" + pattern in "/" + name if pattern.endswith("/") else
                 not name.endswith("/") and Path(name).name == pattern)
                for pattern in patterns if pattern):
            regenerable.append(name)
        elif kind == "!!" and verified and archived_entry(path, name, verified):
            continue
        else:
            files.append(name)
    if regenerable:
        inspect_regenerable(receipt, path, regenerable, patterns)
    receipt["regenerable_entries_count"] = len(regenerable)
    receipt["regenerable_entries"] = regenerable[:20]
    receipt["local_files_count"], receipt["local_files"] = len(files), files[:20]
    if files:
        raise ValueError(f"local files present (ignored/untracked): {len(files)}")
    index = git(path, "ls-files", "-v", "-z")
    if index.returncode:
        raise ValueError("index evidence incomplete: " + index.stderr)
    hidden = []
    for entry in index.stdout.split("\0"):
        if not entry:
            continue
        if len(entry) < 3 or entry[1] != " ":
            raise ValueError("index evidence incomplete: malformed entry")
        if entry[0].islower() or entry[0] == "S":
            hidden.append(entry[2:])
    receipt["index_flag_count"], receipt["index_flag_paths"] = len(hidden), hidden[:20]
    if hidden:
        raise ValueError(f"index flags hide tracked changes: {len(hidden)}")
    return status, index.stdout


def lsof_names(value):
    # Each escape can be literal independently. Include partial decodes and
    # overlapping escapes; cap expansion and retain if ambiguity is unresolved.
    escapes = {b"b": b"\b", b"f": b"\f", b"r": b"\r", b"n": b"\n", b"t": b"\t",
               b"\\": b"\\"}
    pattern = re.compile(rb"\\([bfrnt\\])|\\x([0-9a-fA-F]{2})|\^([@-_])")
    raw = value.encode("utf-8")
    pending, names = [(0, b"")], set()
    while pending:
        position, prefix = pending.pop()
        while position < len(raw):
            match = pattern.match(raw, position)
            if match:
                decoded = (escapes[match[1]] if match[1] is not None else
                           bytes([int(match[2], 16)]) if match[2] is not None else
                           bytes([match[3][0] ^ 64]))
                pending.append((match.end(), prefix + decoded))
                if len(pending) + len(names) > 128:
                    return None
            prefix += raw[position:position + 1]
            position += 1
        names.add(prefix.decode("utf-8", errors="surrogateescape"))
    return names


def handle_reason(handles):
    prefix = ("ambiguous handle name: " if any(h.get("ambiguous") for h in handles)
              else "open handles: ")
    return prefix + ", ".join(f"{h['pid']}/{h['command']}" for h in handles)


def open_handles(path, related_paths=()):
    try:
        result = subprocess.run(["lsof", "-n", "-P", "-F", "pcfn"],
                                capture_output=True, timeout=20)
        stdout = result.stdout.decode("utf-8")
        stderr = result.stderr.decode("utf-8")
    except (OSError, subprocess.TimeoutExpired, UnicodeError) as error:
        raise ValueError("open-handle evidence incomplete: " + str(error)) from error
    if not stdout:
        raise ValueError(f"open-handle evidence incomplete: lsof exited {result.returncode}: " + stderr)
    handles, pid, command, descriptor = [], None, None, None
    named = False
    targets = [path.resolve(), *(related.resolve() for related in related_paths)]
    def incomplete(detail):
        reason = f"open-handle evidence incomplete: lsof exited {result.returncode}: " + detail
        if handles:
            reason += "; " + handle_reason(handles)
        return ValueError(reason)
    for field in stdout.splitlines():
        kind, value = field[:1], field[1:]
        if kind == "p" and value.isdigit() and int(value) > 0:
            if pid is not None and (command is None or not named):
                raise incomplete("missing command/file name")
            pid, command, descriptor, named = int(value), None, None, False
        elif kind == "c" and value and pid is not None and command is None:
            command = value
        elif kind == "f" and value and command is not None:
            if descriptor is not None and not named:
                raise incomplete("missing file name")
            descriptor, named = value, False
        elif kind == "n" and descriptor is not None and not named:
            named = True  # Empty names occur for unnamed OS handles.
            ambiguous = "^" in value or "\\" in value
            if value.startswith("/") or ambiguous:
                try:
                    interpretations = lsof_names(value) if ambiguous else {value}
                    names = ([Path(name).resolve() for name in interpretations]
                             if interpretations is not None else None)
                    matches = names is None or any(
                        name == target or name.is_relative_to(target)
                        for name in names for target in targets)
                except (OSError, RuntimeError, ValueError):
                    # Invalid or inaccessible interpretations cannot establish
                    # absence. Preserve the PID as an ambiguous possible handle.
                    matches, ambiguous = True, True
                if matches:
                    handles.append(dict(pid=pid, command=command, descriptor=descriptor,
                                        name=value, ambiguous=ambiguous))
        else:
            raise incomplete("unparseable lsof output")
    if pid is None or command is None or not named:
        raise incomplete("missing pid/command/file name")
    if result.returncode != 0 or stderr:
        raise incomplete(stderr or "partial scan")
    return handles


def scan_handles(receipt, path, phase):
    started = time.monotonic()
    try:
        handles = (open_handles(path, related_paths=(Path(receipt["path"]),))
                   if phase == "after_move" else open_handles(path))
        receipt["open_handles"] = handles
        if handles:
            raise ValueError(handle_reason(handles))
    finally:
        receipt["scan_durations_seconds"][phase] = time.monotonic() - started


def registered_location(repo, administrative):
    # The administrative directory stays stable across moves. Its gitdir file
    # identifies which porcelain row belongs to this resource, even when Git
    # nests a destination or follows a raced symlink.
    rows = worktrees(repo)
    try:
        pointer = (administrative / "gitdir").read_text(
            encoding="utf-8", errors="surrogateescape").rstrip("\n")
    except FileNotFoundError:
        if not os.path.lexists(administrative):
            return None  # Git removed this worktree's registration.
        raise ValueError("worktree registration pointer missing")
    actual = Path(pointer).parent.resolve()
    matches = [Path(row["worktree"]) for row in rows
               if Path(row["worktree"]).resolve() == actual]
    if len(matches) != 1:
        raise ValueError("worktree registration location unavailable or ambiguous")
    return matches[0]


def directory_identity(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError("not a real directory: " + str(path))
    return info.st_dev, info.st_ino


def verify_quarantine(receipt, repo, administrative, container, identity, quarantine, parent):
    actual = registered_location(repo, administrative)
    receipt["actual_registered_path"] = str(actual) if actual is not None else None
    if actual != quarantine:
        raise ValueError("quarantine custody mismatch; actual registered location: " + str(actual))
    if directory_identity(container) != identity or container.resolve().parent != parent:
        raise ValueError("quarantine container identity changed")
    directory_identity(quarantine)
    if quarantine.resolve().parent != container:
        raise ValueError("quarantine parent changed")


def move_back(receipt, repo, administrative, quarantine, path):
    try:
        try:
            path.lstat()
        except FileNotFoundError:
            pass
        else:
            raise ValueError("original path exists; rollback refused")
        result = git(repo, "worktree", "move", str(quarantine), str(path))
        receipt["move_back_rc"], receipt["move_back_stderr"] = result.returncode, result.stderr
        actual = registered_location(repo, administrative)
        receipt["actual_registered_path"] = str(actual) if actual is not None else None
        if result.returncode or actual != path:
            raise ValueError("rollback failed or registration differs: " + result.stderr)
        directory_identity(path)
        if path.resolve() != path:
            raise ValueError("rollback path resolves elsewhere")
    except (OSError, ValueError, RuntimeError) as error:
        receipt["reason"] += f"; move back to {path} failed: {error}"


def retire(args):
    lexical = Path(args.path).absolute()
    path = lexical.resolve()
    receipt = dict(schema="workspace-lifecycle/receipt/v1", disposition="RETAINED",
                   path=str(path), repo_common_dir=None, branch=None, head=None, remove_rc=None,
                   quarantine_path=None, quarantine_container=None, container_cleanup_note=None,
                   actual_registered_path=None, move_rc=None, move_stderr="",
                   move_back_rc=None, move_back_stderr="", scan_durations_seconds={},
                   quarantine_registered_after=None, quarantine_physical_after=None,
                   remove_stderr="", registered_after=None, physical_after=None,
                   branch_retained=True)
    manifest = getattr(args, "archive_manifest", None)
    receipt.update(regenerable_entries_count=0, regenerable_entries=[], regenerable_walks=[],
                   receipt_out=args.receipt_out,
                   archive_manifest=str(Path(manifest).absolute()) if manifest is not None else None,
                   archive_manifest_sha256=None, archive_verified_count=0)
    repo = Path(args.repo).resolve()
    refused = True
    custody_verified = False
    quarantine = container = administrative = None
    try:
        common = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
        if common.returncode:
            raise ValueError("repo identity unavailable: " + common.stderr)
        repo = Path(common.stdout.rstrip("\n")).resolve()
        receipt["repo_common_dir"] = str(repo)
        if any(p.is_symlink() for p in (lexical, *lexical.parents)):
            raise ValueError("path or parent is a symlink")
        if args.receipt_out and Path(args.receipt_out).resolve().is_relative_to(path):
            raise ValueError("receipt destination is inside retiring path")
        rows = worktrees(repo)
        if Path(rows[0]["worktree"]) == path:
            raise ValueError("main checkout cannot be retired")
        row = next((r for r in rows if Path(r["worktree"]) == path), None)
        if row is None:
            raise ValueError("path is not registered to this repo")
        receipt["actual_registered_path"] = row["worktree"]
        branch = row.get("branch")
        receipt["branch"] = branch.removeprefix("refs/heads/") if branch else None
        receipt["head"] = row.get("HEAD")
        if args.expect_branch is not None and args.expect_branch != receipt["branch"]:
            raise ValueError("expected branch differs from observed branch")
        if args.expect_head is not None and args.expect_head != receipt["head"]:
            raise ValueError("expected head differs from observed head")
        git_dir = git(path, "rev-parse", "--absolute-git-dir")
        if git_dir.returncode:
            raise ValueError("worktree administrative identity unavailable: " + git_dir.stderr)
        administrative = Path(git_dir.stdout.rstrip("\n")).resolve()
        if administrative.parent != repo / "worktrees":
            raise ValueError("worktree administrative identity outside repo")
        before = inventory(receipt, path)
        scan_handles(receipt, path, "before_move")
        if inventory(receipt, path) != before:
            raise ValueError("worktree inventory changed since first read")
        container = Path(tempfile.mkdtemp(prefix=".retiring-", dir=path.parent))
        receipt["quarantine_container"] = str(container)
        identity = directory_identity(container)
        if container.resolve().parent != path.parent or stat.S_IMODE(container.lstat().st_mode) != 0o700:
            raise ValueError("quarantine container parent or permissions differ")
        quarantine = container / path.name
        receipt["quarantine_path"] = str(quarantine)
        if os.path.lexists(quarantine):
            raise ValueError("quarantine destination already exists")
        move = git(repo, "worktree", "move", str(path), str(quarantine))
        receipt["move_rc"], receipt["move_stderr"] = move.returncode, move.stderr
        if move.returncode:
            raise ValueError("quarantine move failed: " + move.stderr)
        verify_quarantine(receipt, repo, administrative, container, identity, quarantine, path.parent)
        custody_verified = True
        scan_handles(receipt, quarantine, "after_move")
        if inventory(receipt, quarantine) != before:
            raise ValueError("worktree inventory changed after quarantine move")
        custody_verified = False
        verify_quarantine(receipt, repo, administrative, container, identity, quarantine, path.parent)
        custody_verified = True
        refused = False
        removed = git(repo, "worktree", "remove", str(quarantine))
        receipt["remove_rc"], receipt["remove_stderr"] = removed.returncode, removed.stderr
    except (OSError, ValueError, RuntimeError) as error:
        receipt["reason"] = str(error)

    if custody_verified and (refused or receipt["remove_rc"] != 0):
        receipt.setdefault("reason", "remove failed: " + receipt["remove_stderr"])
        if os.path.lexists(quarantine):
            try:
                verify_quarantine(receipt, repo, administrative, container, identity, quarantine, path.parent)
            except (OSError, ValueError, RuntimeError) as error:
                receipt["reason"] += "; rollback custody unavailable: " + str(error)
            else:
                move_back(receipt, repo, administrative, quarantine, path)
    errors = []
    if administrative is not None:
        try:
            actual = registered_location(repo, administrative)
            receipt["actual_registered_path"] = str(actual) if actual is not None else None
        except (OSError, ValueError, RuntimeError) as error:
            receipt["actual_registered_path"] = None
            errors.append("actual registration unavailable: " + str(error))
    errors.extend(observe(receipt, repo, path))
    if quarantine is not None:
        errors.extend(observe(receipt, repo, quarantine, "quarantine_"))
    if errors:
        receipt["reason"] = "; ".join(filter(None, [receipt.get("reason"), *errors]))
    if (not refused and not errors and receipt["remove_rc"] == 0
            and receipt["registered_after"] is False and receipt["physical_after"] is False
            and receipt["quarantine_registered_after"] is False
            and receipt["quarantine_physical_after"] is False
            and receipt["actual_registered_path"] is None):
        receipt["disposition"] = "REMOVED"
        receipt["reason"] = "remove succeeded; original and quarantine registrations and physical paths absent"
    elif "reason" not in receipt:
        receipt["reason"] = "remove failed or absence proofs incomplete"
    if receipt["disposition"] == "REMOVED":
        try:
            if directory_identity(container) != identity or container.resolve().parent != path.parent:
                raise ValueError("quarantine container changed; cleanup skipped")
            os.rmdir(container)  # Never recurse or remove a nonempty container.
        except (OSError, ValueError, RuntimeError) as error:
            receipt["container_cleanup_note"] = str(error)
    elif receipt["move_rc"] is not None and receipt["actual_registered_path"] is not None:
        receipt["reason"] += "; worktree registered at " + receipt["actual_registered_path"]
    receipt["observed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return receipt, 0 if receipt["disposition"] == "REMOVED" else (2 if refused else 1)


def write_receipt(destination, payload):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staged = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                         prefix=".retire-", delete=False) as out:
            staged = Path(out.name)
            out.write(payload)
            out.flush()
            os.fsync(out.fileno())
        os.replace(staged, destination)
    finally:
        if staged is not None and staged.exists():
            staged.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--expect-branch")
    parser.add_argument("--expect-head")
    parser.add_argument("--receipt-out")
    parser.add_argument("--archive-manifest", metavar="FILE")
    args = parser.parse_args()
    receipt, code = retire(args)
    payload = json.dumps(receipt, ensure_ascii=True) + "\n"
    if args.receipt_out:
        try:
            # A refused nested destination must not add files to the target.
            if (receipt.get("receipt_destination_refused") or
                    Path(args.receipt_out).resolve().is_relative_to(Path(receipt["path"]))):
                raise ValueError("receipt destination refused by preservation checks")
            write_receipt(args.receipt_out, payload)
        except (OSError, ValueError) as error:
            receipt["disposition"] = "RETAINED"
            receipt["reason"] += "; receipt write failed: " + str(error)
            payload = json.dumps(receipt, ensure_ascii=True) + "\n"
            code = code or 1
    print(payload, end="")
    return code


if __name__ == "__main__":
    raise SystemExit(main())

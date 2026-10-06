#!/usr/bin/env python3
"""worktree-gc's evidence helper. Never deletes anything.

  worktree-archive.py nested-git <worktree>
      exit 0: no .git below the root; exit 3: one found (printed); exit 1: scan failed.
  worktree-archive.py archive <worktree> <dest> [<fallback-dest>]
      Copies every ignored path that is not a regenerable cache (git's own excludes, including
      core.excludesFile) to <dest>/<relpath>, verifies each file's sha256 against the source and
      writes <dest>/RECEIPT.tsv (relpath, kind, size, sha256). Prints one summary line.
      exit 0: archived or nothing to archive; exit 1: failed (the caller must KEEP).
"""
import hashlib
import os
import platform
import shutil
import subprocess
import sys

# AIDEV-NOTE: the ONLY list of regenerable names. Anything ignored and not named here is user
# data (nested docs.local, CLAUDE.local.md, .env, notes) and is archived before removal.
REGENERABLE = {
    "node_modules", ".venv", "venv", ".build", ".next", "dist", "build", "target", "__pycache__",
    ".pytest_cache", ".ruff_cache", ".mypy_cache", ".turbo", ".parcel-cache", ".swiftpm",
    "DerivedData", "coverage", ".nyc_output", ".DS_Store", "tsconfig.tsbuildinfo", "next-env.d.ts",
    ".eslintcache", ".test-tmp", ".hypothesis", "htmlcov", ".tox", ".gradle", ".expo", ".svelte-kit",
    ".wrangler", "storybook-static", ".pnpm-store",
}


def regenerable(name):
    return name in REGENERABLE or name.startswith(".venv") or name.endswith(".egg-info")


def nested_git(root):
    for dirpath, dirnames, filenames in os.walk(root, onerror=_raise):
        here = os.path.relpath(dirpath, root)
        if here != "." and (".git" in dirnames or ".git" in filenames):
            print(here)
            return 3
        dirnames[:] = [d for d in dirnames if not regenerable(d) and not (here == "." and d == ".git")]
    return 0


def _raise(err):
    raise err


def has_regenerable(top):
    for _dirpath, dirnames, filenames in os.walk(top, onerror=_raise):
        if any(regenerable(n) for n in dirnames + filenames):
            return True
    return False


def expand(root, rel):
    """The maximal subtrees of root/rel that contain no regenerable name (those are dropped)."""
    if any(regenerable(part) for part in rel.split("/")):
        return []
    full = os.path.join(root, rel)
    if os.path.islink(full) or not os.path.isdir(full) or not has_regenerable(full):
        return [rel]
    return [leaf for child in sorted(os.listdir(full)) for leaf in expand(root, rel + "/" + child)]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest(base, rel):
    """[(relpath, kind, size, digest)] for a file, symlink or tree at base/rel."""
    out, top = [], os.path.join(base, rel)
    if os.path.islink(top) or not os.path.isdir(top):
        paths = [rel]
    else:
        paths = []
        for dirpath, dirnames, filenames in os.walk(top, onerror=_raise):
            for name in dirnames + filenames:
                p = os.path.join(dirpath, name)
                if name in filenames or os.path.islink(p):
                    paths.append(os.path.relpath(p, base))
    for p in sorted(paths):
        full = os.path.join(base, p)
        if os.path.islink(full):
            target = os.readlink(full)
            out.append((p, "symlink", len(target), hashlib.sha256(target.encode()).hexdigest()))
        else:
            out.append((p, "file", os.lstat(full).st_size, sha256(full)))
    return out


def archive(root, dests):
    listed = subprocess.run(
        ["git", "-C", root, "ls-files", "-z", "-o", "-i", "--exclude-standard", "--directory"],
        capture_output=True, check=True).stdout.decode()
    entries = sorted({e.rstrip("/") for e in listed.split("\0") if e})
    # --directory lists nested entries too (packages/, packages/x/, ...): keep the top-most.
    tops = [e for e in entries if not any(e.startswith(o + "/") for o in entries if o != e)]
    keep = [leaf for e in tops for leaf in expand(root, e)]
    if not keep:
        print("no archive needed (only regenerable caches ignored)")
        return 0
    dest = next((d for d in dests if not os.path.exists(d)), None)
    if dest is None:
        print("archive destination already exists: " + dests[-1])
        return 1
    rows = []
    for rel in keep:
        src = os.path.join(root, rel)
        dst = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        flags = ["-cRp"] if platform.system() == "Darwin" else ["-Rp"]
        if subprocess.run(["cp", *flags, src, dst]).returncode != 0:
            print("copy failed for " + rel + " into " + dest)
            return 1
        want, got = manifest(root, rel), manifest(dest, rel)
        if want != got:
            print("copy unverified for " + rel + " in " + dest)
            return 1
        rows.extend(want)
    with open(os.path.join(dest, "RECEIPT.tsv"), "w") as fh:
        for row in rows:
            fh.write("\t".join(str(x) for x in row) + "\n")
    print(f"archived {len(keep)} path(s), {len(rows)} file(s) to {dest} (receipt {dest}/RECEIPT.tsv)")
    return 0


def main(argv):
    try:
        if len(argv) == 2 and argv[0] == "nested-git":
            return nested_git(argv[1])
        if len(argv) >= 3 and argv[0] == "archive":
            return archive(argv[1], argv[2:])
    except (OSError, subprocess.CalledProcessError) as err:
        print(f"worktree-archive failed: {err}")
        return 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

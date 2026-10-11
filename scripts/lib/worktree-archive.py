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
import shutil
import stat
import subprocess
import sys

# Names are disposable only at known cache roots. An ignored data ancestor or
# any docs.local directory protects every descendant, including these names.
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
        dirnames[:] = [d for d in dirnames if not (here == "." and d == ".git")]
    return 0


def _raise(err):
    raise err


def expand(root, rel):
    """Only known ignored cache roots are disposable, never data inside an ignored ancestor."""
    parts = rel.split("/")
    if "docs.local" in parts:
        return [rel]
    full = os.path.join(root, rel)
    if os.path.islink(full):
        return [rel]
    if os.path.isdir(full):
        # ls-files --directory aggregates directories whose children are all
        # ignored, even when the parent itself has no ignore rule (e.g. ui/).
        ignored = subprocess.run(["git", "-C", root, "check-ignore", "-q", "--", rel + "/"])
        if ignored.returncode == 1:
            return [leaf for child in sorted(os.listdir(full))
                    for leaf in expand(root, rel + "/" + child)]
        ignored.check_returncode()
    canonical = (len(parts) == 1 or parts[:-1] == ["ui"] or
                 (len(parts) == 3 and parts[0] == "packages") or
                 parts[-1] == "__pycache__")
    if not canonical or not regenerable(parts[-1]):
        return [rel]
    # Even a cache root can contain durable docs.local receipts.
    for _here, dirs, _files in os.walk(os.path.join(root, rel), onerror=_raise):
        if "docs.local" in dirs:
            return [rel]
    return []


def copy_regular(src, dst):
    """Never open FIFOs/devices/sockets, and never follow symlinks."""
    mode = os.lstat(src).st_mode
    if stat.S_ISLNK(mode):
        os.symlink(os.readlink(src), dst)
    elif stat.S_ISREG(mode):
        shutil.copy2(src, dst)
    elif stat.S_ISDIR(mode):
        os.makedirs(dst)
        for name in sorted(os.listdir(src)):
            copy_regular(os.path.join(src, name), os.path.join(dst, name))
        shutil.copystat(src, dst)


def escape_field(value):
    return str(value).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


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
        elif stat.S_ISREG(os.lstat(full).st_mode):
            out.append((p, "file", os.lstat(full).st_size, sha256(full)))
        else:
            out.append((p, "special", os.lstat(full).st_size, "-"))
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
        copy_regular(src, dst)
        want = manifest(root, rel)
        got = manifest(dest, rel) if os.path.lexists(dst) else []
        if [row for row in want if row[1] != "special"] != got:
            print("copy unverified for " + rel + " in " + dest)
            return 1
        rows.extend(want)
    with open(os.path.join(dest, "RECEIPT.tsv"), "w") as fh:
        for row in rows:
            fh.write("\t".join(escape_field(x) for x in row) + "\n")
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

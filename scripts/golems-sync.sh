#!/usr/bin/env bash
set -euo pipefail

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

usage() {
    printf 'Usage: %s <host> [--dry-run] [--only skills|launcher|all] [--allow-dirty]\n' "${0##*/}"
}

sha256_file() {
    shasum -a 256 "$1" | awk '{print $1}'
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
source_helper="$repo_root/scripts/repogolem/golems-sync-install.sh"
host="${1:-}"
[[ -n "$host" ]] || { usage >&2; exit 2; }
shift

dry_run=false
allow_dirty=false
scope=all
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --dry-run) dry_run=true ;;
        --allow-dirty) allow_dirty=true ;;
        --only)
            [[ "$#" -ge 2 ]] || die "--only requires skills, launcher, or all"
            scope="$2"
            shift
            ;;
        --only=*) scope="${1#--only=}" ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
    shift
done
case "$scope" in skills|launcher|all) ;; *) die "invalid --only value: $scope" ;; esac
[[ "$host" != -* ]] || die "host must not begin with '-'"
[[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9._@:-]*$ ]] || die "unsafe host: $host"
[[ -x "$source_helper" ]] || die "missing executable helper: $source_helper"

host_shell="${HOST_SHELL:-ssh}"
case "$host_shell" in local|ssh) ;; *) die "HOST_SHELL must be local or ssh" ;; esac
if [[ "$host_shell" == "local" ]]; then
    host_root="${HOST_ROOT:-}"
    [[ "$host_root" == /* && "$host_root" != "/" ]] || \
        die "HOST_ROOT must be an absolute, non-root path in local mode"
else
    [[ -z "${GOLEMS_SYNC_SKILLS_SOURCE:-}" ]] || \
        die "GOLEMS_SYNC_SKILLS_SOURCE is allowed only with HOST_SHELL=local"
fi

git -C "$repo_root" rev-parse --git-dir >/dev/null 2>&1 || die "source is not a git checkout: $repo_root"
commit="$(git -C "$repo_root" rev-parse HEAD)"
branch="$(git -C "$repo_root" branch --show-current)"
origin_master="$(git -C "$repo_root" rev-parse origin/master 2>/dev/null || true)"
dirty_status="$(git -C "$repo_root" status --porcelain --untracked-files=all)"
dirty_flag=false
[[ -z "$dirty_status" ]] || dirty_flag=true

if [[ "$allow_dirty" != true ]]; then
    [[ "$branch" == "master" ]] || die "source branch is '$branch', expected master (use --allow-dirty to override)"
    [[ "$dirty_flag" == false ]] || die "source tree is dirty (use --allow-dirty to override)"
    [[ -n "$origin_master" && "$commit" == "$origin_master" ]] || \
        die "source HEAD does not equal origin/master (use --allow-dirty to override)"
else
    printf 'WARNING: --allow-dirty bypasses clean master/origin validation\n' >&2
fi
printf 'Shipping commit: %s\n' "$commit"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/golems-sync.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
payload_root="$work_dir/payload"
mkdir -p "$payload_root"

archive_paths=(scripts/repogolem/golems-sync-install.sh)
if [[ "$scope" == "skills" || "$scope" == "all" ]]; then
    archive_paths+=(skills/golem-powers scripts/golems-sync-coupling-allowlist.tsv)
fi
if [[ "$scope" == "launcher" || "$scope" == "all" ]]; then
    archive_paths+=(scripts/repogolem/golem-dispatch.zsh scripts/repogolem/install-golem-dispatch.sh)
fi
git -C "$repo_root" archive --format=tar "$commit" -- "${archive_paths[@]}" \
    | tar -xf - -C "$payload_root"

helper="$payload_root/scripts/repogolem/golems-sync-install.sh"
launcher_dir="$payload_root/scripts/repogolem"
allowlist_file="$payload_root/scripts/golems-sync-coupling-allowlist.tsv"
skills_source="$payload_root/skills/golem-powers"
if [[ -n "${GOLEMS_SYNC_SKILLS_SOURCE:-}" ]]; then
    skills_source="$GOLEMS_SYNC_SKILLS_SOURCE"
fi
if [[ "$scope" == "skills" || "$scope" == "all" ]]; then
    [[ -d "$skills_source" ]] || die "skills source missing: $skills_source"
    skills_source="$(cd "$skills_source" && pwd)"
fi
source_host="$(hostname -s)"
[[ "$source_host" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "unsafe source hostname: $source_host"

skills_list="$work_dir/skills.list"
inspect_file="$work_dir/inspect.tsv"
rsync_plan="$work_dir/rsync-plan.txt"
changed_skills="$work_dir/changed-skills.txt"
offenders="$work_dir/offenders.txt"
: > "$skills_list"
: > "$changed_skills"
: > "$offenders"

payload_sha256="$(python3 - "$scope" "$skills_source" "$launcher_dir" <<'PY'
import hashlib
import os
from pathlib import Path
import stat
import sys

scope, skills_arg, launcher_arg = sys.argv[1:]
skills_root = Path(skills_arg)
launcher_root = Path(launcher_arg)
digest = hashlib.sha256()
digest.update(scope.encode("utf-8") + b"\0")

def add_path(path: Path, label: str) -> None:
    metadata = path.lstat()
    if stat.S_ISLNK(metadata.st_mode):
        kind = b"L"
        content = os.readlink(path).encode("utf-8")
    elif stat.S_ISREG(metadata.st_mode):
        kind = b"F"
        content = path.read_bytes()
    elif stat.S_ISDIR(metadata.st_mode):
        kind = b"D"
        content = b""
    else:
        return
    digest.update(label.encode("utf-8") + b"\0")
    digest.update(kind + b"\0")
    digest.update(f"{stat.S_IMODE(metadata.st_mode):04o}".encode("ascii") + b"\0")
    digest.update(hashlib.sha256(content).digest())

if scope in {"skills", "all"}:
    add_path(skills_root, "skills")
    for candidate in sorted(skills_root.rglob("*"), key=lambda item: item.relative_to(skills_root).as_posix()):
        add_path(candidate, f"skills/{candidate.relative_to(skills_root).as_posix()}")

add_path(launcher_root / "golems-sync-install.sh", "transport/golems-sync-install.sh")
if scope in {"launcher", "all"}:
    for name in ("golem-dispatch.zsh", "install-golem-dispatch.sh"):
        add_path(launcher_root / name, f"launcher/{name}")

print(digest.hexdigest())
PY
)"
printf 'Payload SHA-256: %s  Dirty: %s\n' "$payload_sha256" "$dirty_flag"

if [[ "$scope" == "skills" || "$scope" == "all" ]]; then
    find "$skills_source" -mindepth 2 -maxdepth 2 -type f -name SKILL.md -print \
        | sed 's|/SKILL.md$||' | sed 's|.*/||' | LC_ALL=C sort > "$skills_list"
    [[ -s "$skills_list" ]] || die "no skill directories found in $skills_source"
fi

if [[ "$scope" == "skills" || "$scope" == "all" ]]; then
    python3 - "$skills_source" "$allowlist_file" <<'PY' >> "$offenders"
import os
from pathlib import Path
import re
import sys

root = Path(sys.argv[1]).resolve()
allowlist_path = Path(sys.argv[2])
coupling = re.compile(r"/Users/[A-Za-z0-9._-]+|/opt/homebrew/bin/[A-Za-z0-9._-]+|~/Gits/[A-Za-z0-9._-]+")
allowed = set()
if allowlist_path.exists():
    for number, raw in enumerate(allowlist_path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw or raw.startswith("#"):
            continue
        fields = raw.split("\t")
        if len(fields) != 3 or not all(fields):
            raise SystemExit(f"invalid coupling allowlist entry at {allowlist_path}:{number}")
        allowed.add((fields[0], fields[1]))

for path in sorted((candidate for candidate in root.rglob("*") if candidate.is_file() and not candidate.is_symlink()), key=lambda item: item.as_posix()):
    relative = path.relative_to(root).as_posix()
    parts = relative.split("/")
    if "docs" in parts or Path(relative).name.startswith("README"):
        continue
    text = path.read_bytes().decode("utf-8", errors="ignore")
    for line_number, line in enumerate(text.splitlines(), 1):
        for match in coupling.finditer(line):
            token = match.group(0)
            if (relative, token) not in allowed:
                print(f"{relative}:{line_number}:{token}: {line}")

for link in sorted((path for path in root.rglob("*") if path.is_symlink()), key=lambda path: path.as_posix()):
    relative = link.relative_to(root).as_posix()
    target = os.readlink(link)
    if coupling.search(target):
        print(f"{relative}: symlink target is machine-coupled: {target}")
    try:
        resolved = link.resolve(strict=True)
    except (OSError, RuntimeError):
        print(f"{relative}: dangling or cyclic payload symlink: {target}")
        continue
    try:
        resolved.relative_to(root)
    except ValueError:
        print(f"{relative}: symlink escapes skills root: {target}")
PY
fi
transport_files=("$helper")
if [[ "$scope" == "launcher" || "$scope" == "all" ]]; then
    transport_files+=("$launcher_dir/golem-dispatch.zsh" "$launcher_dir/install-golem-dispatch.sh")
fi
for file in "${transport_files[@]}"; do
        while IFS= read -r line; do
            printf '%s:%s\n' "${file#"$repo_root"/}" "$line" >> "$offenders"
        done < <(LC_ALL=C grep -nE '/Users/[A-Za-z0-9._-]+|/opt/homebrew/bin/[A-Za-z0-9._-]+|~/Gits/[A-Za-z0-9._-]+' "$file" 2>/dev/null || true)
done
if [[ -s "$offenders" ]]; then
    offender_count="$(wc -l < "$offenders" | tr -d ' ')"
    offender_files="$(cut -d: -f1 "$offenders" | LC_ALL=C sort -u | wc -l | tr -d ' ')"
    printf 'ERROR: machine-coupled payload refused: %s occurrence(s) across %s file(s)\n' \
        "$offender_count" "$offender_files" >&2
    sed 's/^/  /' "$offenders" >&2
    exit 1
fi

skill_args=()
while IFS= read -r skill; do
    [[ "$skill" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "unsafe skill directory name: $skill"
    skill_args+=("$skill")
done < "$skills_list"

if [[ "$host_shell" == "local" ]]; then
    HOME="$host_root" bash "$helper" inspect "$scope" \
        ${skill_args[@]+"${skill_args[@]}"} > "$inspect_file"
else
    ssh "$host" bash -s -- inspect "$scope" \
        ${skill_args[@]+"${skill_args[@]}"} < "$helper" > "$inspect_file"
fi

root_exists="$(awk -F '\t' '$1 == "ROOT" {print $2}' "$inspect_file")"
if [[ ( "$scope" == "skills" || "$scope" == "all" ) && "$root_exists" == "1" ]]; then
    rsync_args=(-a -n --delete --checksum --itemize-changes)
    if [[ "$host_shell" == "local" ]]; then
        rsync "${rsync_args[@]}" "$skills_source/" "$host_root/.golems/skills/golem-powers/" > "$rsync_plan"
    else
        rsync "${rsync_args[@]}" "$skills_source/" "$host:.golems/skills/golem-powers/" > "$rsync_plan"
    fi
    awk '{path=$2; sub(/^\.\//, "", path); split(path, parts, "/"); if (parts[1] != "" && parts[1] != ".") print parts[1]}' \
        "$rsync_plan" | LC_ALL=C sort -u > "$changed_skills"
fi

added=0
updated=0
unchanged=0
backed_up=0
if [[ "$scope" == "skills" || "$scope" == "all" ]]; then
    while IFS=$'\t' read -r kind name exists link_status; do
        [[ "$kind" == "SKILL" ]] || continue
        if [[ "$link_status" == "plain" ]]; then
            backed_up=$((backed_up + 1))
        fi
        if [[ "$exists" == "0" ]]; then
            added=$((added + 1))
        elif [[ "$link_status" != "correct" ]] || grep -Fxq -- "$name" "$changed_skills"; then
            updated=$((updated + 1))
        else
            unchanged=$((unchanged + 1))
        fi
    done < "$inspect_file"
fi

source_launcher_hash=""
if [[ "$scope" == "launcher" || "$scope" == "all" ]]; then
    source_launcher_hash="$(sha256_file "$launcher_dir/golem-dispatch.zsh")"
    installed_launcher_hash="$(awk -F '\t' '$1 == "LAUNCHER" {print $2}' "$inspect_file")"
    if [[ "$installed_launcher_hash" == "missing" ]]; then
        added=$((added + 1))
    elif [[ "$installed_launcher_hash" == "$source_launcher_hash" ]]; then
        unchanged=$((unchanged + 1))
    else
        updated=$((updated + 1))
    fi
fi

printf 'Target: %s  Scope: %s\n' "$host" "$scope"
printf 'Drift summary: added=%d updated=%d unchanged=%d backed-up=%d\n' \
    "$added" "$updated" "$unchanged" "$backed_up"
if [[ "$dry_run" == true ]]; then
    printf 'DRY RUN: no target files were changed\n'
    exit 0
fi

if [[ "$scope" == "skills" || "$scope" == "all" ]]; then
    if [[ "$host_shell" == "local" ]]; then
        HOME="$host_root" bash "$helper" validate "$scope"
    else
        ssh "$host" bash -s -- validate "$scope" < "$helper"
    fi
    if [[ "$host_shell" == "local" ]]; then
        mkdir -p "$host_root/.golems/skills/golem-powers"
        rsync -a --delete --checksum "$skills_source/" "$host_root/.golems/skills/golem-powers/"
    else
        ssh "$host" mkdir -p .golems/skills/golem-powers
        rsync -a --delete --checksum "$skills_source/" "$host:.golems/skills/golem-powers/"
    fi
fi

if [[ "$scope" == "launcher" || "$scope" == "all" ]]; then
    if [[ "$host_shell" == "local" ]]; then
        mkdir -p "$host_root/.golems/launcher"
        rsync -a "$launcher_dir/golem-dispatch.zsh" "$launcher_dir/install-golem-dispatch.sh" \
            "$host_root/.golems/launcher/"
    else
        ssh "$host" mkdir -p .golems/launcher
        rsync -a "$launcher_dir/golem-dispatch.zsh" "$launcher_dir/install-golem-dispatch.sh" \
            "$host:.golems/launcher/"
    fi
fi

if [[ "$host_shell" == "local" ]]; then
    HOME="$host_root" bash "$helper" apply "$scope" "$commit" "$source_host" \
        "$dirty_flag" "$payload_sha256" "$added" "$updated" "$unchanged" "$backed_up" -- \
        ${skill_args[@]+"${skill_args[@]}"}
else
    ssh "$host" bash -s -- apply "$scope" "$commit" "$source_host" \
        "$dirty_flag" "$payload_sha256" "$added" "$updated" "$unchanged" "$backed_up" -- \
        ${skill_args[@]+"${skill_args[@]}"} < "$helper"
fi

printf 'Installed commit %s on %s\n' "$commit" "$host"

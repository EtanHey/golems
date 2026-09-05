#!/usr/bin/env bash
set -euo pipefail

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

sha256_file() {
    shasum -a 256 "$1" | awk '{print $1}'
}

contains_skill() {
    local wanted="$1"
    shift
    local candidate
    for candidate in "$@"; do
        [[ "$candidate" == "$wanted" ]] && return 0
    done
    return 1
}

validate_target() {
    local scope="$1"
    local component
    if [[ "$scope" == "skills" || "$scope" == "all" ]]; then
        for component in \
            "$HOME/.golems" \
            "$HOME/.golems/skills" \
            "$HOME/.golems/skills/golem-powers"; do
            [[ ! -L "$component" ]] || \
                die "symlinked skills mirror component refused: $component"
            [[ ! -e "$component" || -d "$component" ]] || \
                die "non-directory skills mirror component refused: $component"
        done
    fi
}

inspect_target() {
    local scope="$1"
    shift
    local skills_root="$HOME/.golems/skills/golem-powers"
    local links_root="$HOME/.claude/skills"
    local dispatcher="$HOME/.config/ralphtools/golem-dispatch.zsh"
    local name destination link status exists

    validate_target "$scope"

    if [[ "$scope" == "skills" || "$scope" == "all" ]]; then
        if [[ -d "$skills_root" ]]; then
            printf 'ROOT\t1\n'
        else
            printf 'ROOT\t0\n'
        fi

        for name in "$@"; do
            destination="$skills_root/$name"
            link="$links_root/$name"
            exists=0
            [[ -d "$destination" ]] && exists=1

            if [[ -L "$link" ]]; then
                if [[ "$(readlink "$link")" == "$destination" ]]; then
                    status=correct
                else
                    status=wrong
                fi
            elif [[ -e "$link" ]]; then
                status=plain
            else
                status=missing
            fi
            printf 'SKILL\t%s\t%s\t%s\n' "$name" "$exists" "$status"
        done
    fi

    if [[ "$scope" == "launcher" || "$scope" == "all" ]]; then
        if [[ -f "$dispatcher" ]]; then
            printf 'LAUNCHER\t%s\n' "$(sha256_file "$dispatcher")"
        else
            printf 'LAUNCHER\tmissing\n'
        fi
    fi
}

next_backup_root() {
    local base
    base="$HOME/.golems/skills.backup-$(date -u +%Y%m%d-%H%M%S)"
    local candidate="$base"
    local suffix=2
    while [[ -e "$candidate" ]]; do
        candidate="$base-$suffix"
        suffix=$((suffix + 1))
    done
    printf '%s\n' "$candidate"
}

write_manifest() {
    local commit="$1" source_host="$2" scope="$3"
    local dirty_flag="$4" payload_sha256="$5"
    local added="$6" updated="$7" unchanged="$8" backed_up="$9"
    local manifest="$HOME/.golems/INSTALLED.json"
    local timestamp
    timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    mkdir -p "$(dirname "$manifest")"
    python3 - "$manifest" "$commit" "$timestamp" "$source_host" "$scope" \
        "$dirty_flag" "$payload_sha256" "$added" "$updated" "$unchanged" "$backed_up" <<'PY'
import json
import os
import sys
import tempfile

path, commit, timestamp, source_host, scope, dirty, payload_sha256, added, updated, unchanged, backed_up = sys.argv[1:]
payload = {
    "commit": commit,
    "dirty": dirty == "true",
    "payload_sha256": payload_sha256,
    "ts": timestamp,
    "source_host": source_host,
    "scope": scope,
    "counts": {
        "added": int(added),
        "updated": int(updated),
        "unchanged": int(unchanged),
        "backed_up": int(backed_up),
    },
}
directory = os.path.dirname(path)
fd, temporary = tempfile.mkstemp(prefix=".INSTALLED.", suffix=".json", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
}

apply_target() {
    local scope="$1" commit="$2" source_host="$3"
    local dirty_flag="$4" payload_sha256="$5"
    local added="$6" updated="$7" unchanged="$8" expected_backups="$9"
    shift 9
    [[ "${1:-}" == "--" ]] || die "missing skill-list separator"
    shift
    local skills=("$@")
    local skills_root="$HOME/.golems/skills/golem-powers"
    local links_root="$HOME/.claude/skills"
    local launcher_root="$HOME/.golems/launcher"
    local dispatcher="$HOME/.config/ralphtools/golem-dispatch.zsh"
    local backup_root="" name link destination target actual_backups=0

    if [[ "$scope" == "skills" || "$scope" == "all" ]]; then
        mkdir -p "$links_root"
        for name in "${skills[@]}"; do
            destination="$skills_root/$name"
            [[ -d "$destination" ]] || die "shipped skill missing: $destination"
            link="$links_root/$name"

            if [[ -L "$link" ]]; then
                target="$(readlink "$link")"
                if [[ "$target" != "$destination" ]]; then
                    rm "$link"
                fi
            elif [[ -e "$link" ]]; then
                if [[ -z "$backup_root" ]]; then
                    backup_root="$(next_backup_root)"
                    mkdir -p "$backup_root"
                fi
                mv "$link" "$backup_root/$name"
                actual_backups=$((actual_backups + 1))
            fi

            if [[ ! -L "$link" ]]; then
                ln -s "$destination" "$link"
            fi
        done

        while IFS= read -r link; do
            target="$(readlink "$link")"
            case "$target" in
                "$skills_root"/*)
                    name="${link##*/}"
                    if ! contains_skill "$name" "${skills[@]}"; then
                        rm "$link"
                    fi
                    ;;
            esac
        done < <(find "$links_root" -mindepth 1 -maxdepth 1 -type l -print | sort)
    fi

    [[ "$actual_backups" -eq "$expected_backups" ]] || \
        die "backup count changed during apply: expected=$expected_backups actual=$actual_backups"

    if [[ "$scope" == "launcher" || "$scope" == "all" ]]; then
        [[ -f "$launcher_root/golem-dispatch.zsh" ]] || die "shipped dispatcher missing"
        [[ -x "$launcher_root/install-golem-dispatch.sh" ]] || die "shipped launcher installer missing"
        local source_hash installed_hash
        source_hash="$(sha256_file "$launcher_root/golem-dispatch.zsh")"
        installed_hash=missing
        if [[ -f "$dispatcher" ]]; then
            installed_hash="$(sha256_file "$dispatcher")"
        fi
        if [[ "$source_hash" != "$installed_hash" ]]; then
            HOME="$HOME" zsh "$launcher_root/install-golem-dispatch.sh" --force "$dispatcher"
            installed_hash="$(sha256_file "$dispatcher")"
        fi
        [[ "$source_hash" == "$installed_hash" ]] || \
            die "launcher hash mismatch: source=$source_hash installed=$installed_hash"
        printf 'launcher hash verified: %s\n' "$installed_hash"
    fi

    write_manifest "$commit" "$source_host" "$scope" "$dirty_flag" "$payload_sha256" \
        "$added" "$updated" "$unchanged" "$actual_backups"
}

command="${1:-}"
shift || true
case "$command" in
    validate) validate_target "$@" ;;
    inspect) inspect_target "$@" ;;
    apply) apply_target "$@" ;;
    *) die "usage: golems-sync-install.sh validate|inspect|apply ..." ;;
esac

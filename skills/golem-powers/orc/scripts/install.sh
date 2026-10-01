#!/usr/bin/env bash
# Install orc and coach global Claude agents. brain-worker is INTERIM until the BrainLayer plugin ships it (orc 2026-09-29).
# HOME may point to a scratch directory; never hardcode the real ~/.claude.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd "$script_dir/.." && pwd)"
agents_dir="$HOME/.claude/agents"
dry_run=false

case "${1:-}" in
    "") ;;
    --dry-run) dry_run=true; shift ;;
    -h|--help) printf 'Usage: %s [--dry-run]\n' "$0"; exit 0 ;;
    *) printf 'ERROR: unknown option: %s\n' "$1" >&2; exit 1 ;;
esac
if [ "$#" -ne 0 ]; then
    printf 'ERROR: unexpected arguments\n' >&2
    exit 1
fi

sources=("$skill_dir"/agents/*.md "$skill_dir"/../coach/agents/*.md)
today="$(date +%Y%m%d)"

# Validate every source and destination before the first mutation, so a conflict
# for any agent cannot leave the others partially installed.
for source in "${sources[@]}"; do
    name="$(basename "$source" .md)"
    source="$(cd "$(dirname "$source")" && pwd)/$name.md"
    link="$agents_dir/$name.md"
    backup="$agents_dir/.$name.md.bak-$today"
    if [ ! -f "$source" ]; then
        printf '[conflict] missing source: %s\n' "$source"
        exit 1
    fi
    if [ -f "$link" ] && [ ! -L "$link" ]; then
        if [ -e "$backup" ] || [ -L "$backup" ]; then
            printf '[conflict] backup already exists: %s; left %s untouched\n' "$backup" "$link"
            exit 1
        fi
    elif [ -e "$link" ] && [ ! -L "$link" ]; then
        printf '[conflict] destination is not a regular file or symlink: %s\n' "$link"
        exit 1
    fi
done

if [ ! -d "$agents_dir" ]; then
    if [ "$dry_run" = true ]; then
        printf '[dry-run] would mkdir -p %s\n' "$agents_dir"
    else
        mkdir -p "$agents_dir"
        printf '[mkdir] %s\n' "$agents_dir"
    fi
fi

for source in "${sources[@]}"; do
    name="$(basename "$source" .md)"
    source="$(cd "$(dirname "$source")" && pwd)/$name.md"
    link="$agents_dir/$name.md"
    backup="$agents_dir/.$name.md.bak-$today"
    if [ -L "$link" ] && [ "$(readlink "$link")" = "$source" ]; then
        printf '[keep] %s -> %s\n' "$link" "$source"
        continue
    fi
    if [ -f "$link" ] && [ ! -L "$link" ]; then
        if [ "$dry_run" = true ]; then
            printf '[dry-run] would back up %s -> %s\n' "$link" "$backup"
        else
            mv "$link" "$backup"
            printf '[backup] %s -> %s\n' "$link" "$backup"
        fi
    elif [ -L "$link" ]; then
        if [ "$dry_run" = true ]; then
            printf '[dry-run] would remove stale symlink %s\n' "$link"
        else
            rm "$link"
            printf '[unlink] %s\n' "$link"
        fi
    fi
    if [ "$dry_run" = true ]; then
        printf '[dry-run] would link %s -> %s\n' "$link" "$source"
    else
        ln -s "$source" "$link"
        printf '[link] %s -> %s\n' "$link" "$source"
    fi
done

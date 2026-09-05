#!/usr/bin/env bash
# The one place the repo's bun pin is read.
#
# `.bun-version` is the single source of truth: setup-bun consumes it in CI via
# `bun-version-file`, and `packageManager` in package.json mirrors it. Nothing
# pins the bun on a developer's PATH, so any assertion that depends on bun's own
# codegen -- notably the byte-identity check on the committed Twitch chat bundle
# -- must ask whether the local bun matches before it asserts, and skip with
# both versions named when it does not. Pinning CI alone would leave that test
# green in CI and red on every machine off the pin, which is worse than an
# honest failure.

# Absolute path to the pin file, derived from this file's own location.
bun_pin_file() {
    local lib_dir
    lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    printf '%s\n' "$lib_dir/../../.bun-version"
}

# The version the repo pins. Fails loudly if the pin is missing or malformed --
# a silent empty string here would turn every guarded assertion into a skip.
bun_pinned_version() {
    local pin_file version
    pin_file="$(bun_pin_file)"
    if [[ ! -f "$pin_file" ]]; then
        printf 'bun-version: no pin file at %s\n' "$pin_file" >&2
        return 1
    fi
    version="$(tr -d '[:space:]' < "$pin_file")"
    if [[ -z "$version" ]]; then
        printf 'bun-version: pin file %s is empty\n' "$pin_file" >&2
        return 1
    fi
    printf '%s\n' "$version"
}

# The version of the bun actually on PATH, or empty if bun is not installed.
bun_local_version() {
    command -v bun >/dev/null 2>&1 || return 0
    bun --version 2>/dev/null | tr -d '[:space:]'
}

# Empty when the local bun matches the pin; otherwise a message naming both
# versions, suitable to hand straight to bats' `skip`.
bun_pin_mismatch_reason() {
    local pinned local_version
    pinned="$(bun_pinned_version)" || return 1
    local_version="$(bun_local_version)"

    if [[ -z "$local_version" ]]; then
        printf 'bun is not on PATH; this assertion only holds on the pinned bun %s (.bun-version)\n' "$pinned"
        return 0
    fi
    if [[ "$local_version" != "$pinned" ]]; then
        printf 'local bun is %s but .bun-version pins %s; bun embeds its own runtime prelude in every build, so this byte-identity assertion only holds on %s\n' \
            "$local_version" "$pinned" "$pinned"
        return 0
    fi
}

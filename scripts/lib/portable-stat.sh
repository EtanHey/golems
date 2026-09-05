#!/bin/bash
# portable-stat.sh — one `stat` shim for the two incompatible dialects.
#
# GNU coreutils `stat` takes `-c` for a format string and reads `-f` as
# "file system status". BSD/macOS `stat` takes `-f` for the format. A call
# site that hardcodes one dialect answers a different question on the other
# platform, and it does so quietly: verified 2026-09-06, GNU coreutils
# `stat -f %z FILE` prints a block of filesystem statistics on STDOUT and
# exits 1, so the common `stat -f %z "$f" 2>/dev/null || echo 0` idiom hands
# its caller a plausible zero instead of a failure.
#
# Usage:
#   portable_stat size|mtime|mode PATH
#
#   size   bytes            GNU %s   BSD %z
#   mtime  epoch seconds    GNU %Y   BSD %m
#   mode   octal perms      GNU %a   BSD %OLp
#
# Prints ONE non-negative integer on stdout and returns 0. On any failure —
# missing file, unreadable file, unknown field, a dialect the binary does not
# speak — it prints NOTHING on stdout, writes a diagnostic to stderr and
# returns non-zero. That is the point: a real 0 must stay distinguishable
# from "could not stat".
#
# Test-only overrides, so a suite can exercise a dialect its runner is not
# native to (see scripts/tests/test-portable-stat.bats):
#   PORTABLE_STAT_DIALECT=gnu|bsd   skip detection and use this dialect
#   PORTABLE_STAT_CMD=<binary>      call this instead of `stat`
#
# Sourced from bash AND from zsh (test-repogolem-dispatch.bats runs it inside
# a `zsh -f` stub), so the syntax here stays POSIX-ish: no arrays, no bashisms
# beyond `local`. No side effects on source.

# The probe result, cached per stat binary, and the dialect resolved for the
# current call. They are separate on purpose: a forced PORTABLE_STAT_DIALECT
# must never poison the cache, or unsetting it would leave the forced value
# behind as if it had been detected.
_PORTABLE_STAT_CACHE=""
_PORTABLE_STAT_CACHE_FOR=""
_PORTABLE_STAT_DIALECT=""

# _portable_stat_detect — set _PORTABLE_STAT_DIALECT for the stat in use.
# Deliberately NOT a `uname` check: what decides the dialect is the binary on
# PATH, not the kernel — coreutils is common on macOS, busybox on Linux. The
# probe is the flag itself, and the two probes are mutually exclusive:
# `-c %s .` is rejected by BSD stat, and GNU stat reads `-f %z .` as a
# filesystem query on the path "%z" and fails. Probed once per binary; the
# live guard calls this on every polling cycle.
_portable_stat_detect() {
    local cmd="${PORTABLE_STAT_CMD:-stat}"

    if [ -n "${PORTABLE_STAT_DIALECT:-}" ]; then
        _PORTABLE_STAT_DIALECT="$PORTABLE_STAT_DIALECT"
        return 0
    fi
    if [ "$_PORTABLE_STAT_CACHE_FOR" != "$cmd" ] || [ -z "$_PORTABLE_STAT_CACHE" ]; then
        if "$cmd" -c %s . >/dev/null 2>&1; then
            _PORTABLE_STAT_CACHE=gnu
        else
            _PORTABLE_STAT_CACHE=bsd
        fi
        _PORTABLE_STAT_CACHE_FOR="$cmd"
    fi
    _PORTABLE_STAT_DIALECT="$_PORTABLE_STAT_CACHE"
}

# portable_stat_dialect — echo "gnu" or "bsd" for the stat in use.
portable_stat_dialect() {
    _portable_stat_detect
    printf '%s\n' "$_PORTABLE_STAT_DIALECT"
}

portable_stat() {
    local field="${1:-}" file="${2:-}"
    local cmd flag fmt value

    if [ -z "$field" ] || [ -z "$file" ]; then
        echo "portable_stat: usage: portable_stat size|mtime|mode PATH" >&2
        return 2
    fi

    cmd="${PORTABLE_STAT_CMD:-stat}"
    _portable_stat_detect

    case "$_PORTABLE_STAT_DIALECT" in
        gnu) flag='-c' ;;
        bsd) flag='-f' ;;
        *)
            echo "portable_stat: unknown dialect '$_PORTABLE_STAT_DIALECT' (want gnu or bsd)" >&2
            return 2 ;;
    esac

    case "$_PORTABLE_STAT_DIALECT:$field" in
        gnu:size)  fmt='%s'    ;;
        gnu:mtime) fmt='%Y'    ;;
        gnu:mode)  fmt='%a'    ;;
        bsd:size)  fmt='%z'    ;;
        bsd:mtime) fmt='%m'    ;;
        bsd:mode)  fmt='%OLp'  ;;
        *)
            echo "portable_stat: unknown field '$field' (want size, mtime or mode)" >&2
            return 2 ;;
    esac

    value="$("$cmd" "$flag" "$fmt" -- "$file" 2>/dev/null)" || {
        echo "portable_stat: cannot stat '$file' ($cmd, $_PORTABLE_STAT_DIALECT dialect)" >&2
        return 1
    }

    # A dialect mismatch can still exit 0 on some builds while printing
    # something that is not the number asked for. Anything but a bare integer
    # is a failure, never a value.
    case "$value" in
        ''|*[!0-9]*)
            echo "portable_stat: '$cmd $flag $fmt' gave a non-integer for '$file'" >&2
            return 1 ;;
    esac

    printf '%s\n' "$value"
}

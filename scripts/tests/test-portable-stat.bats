#!/usr/bin/env bats
# Tests for scripts/lib/portable-stat.sh
# Run with: bats scripts/tests/test-portable-stat.bats
#
# GNU `stat` takes -c for a format and reads -f as "file system status";
# BSD/macOS `stat` takes -f for the format. A suite that only exercised the
# dialect native to its runner would prove nothing about the other one, which
# is the entire bug this file exists for -- so every dialect-specific test
# forces the dialect and names the binary it forced it against. Where the
# runner cannot supply a dialect the test SKIPS, and the skip says which
# dialect went unverified.

setup() {
    SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
    # shellcheck source=../lib/portable-stat.sh
    source "$SCRIPT_DIR/lib/portable-stat.sh"

    unset PORTABLE_STAT_DIALECT PORTABLE_STAT_CMD

    FIXTURE="$BATS_TEST_TMPDIR/fixture.bin"
    printf '0123456789' > "$FIXTURE"          # exactly 10 bytes
    chmod 600 "$FIXTURE"

    EMPTY="$BATS_TEST_TMPDIR/empty.bin"
    : > "$EMPTY"

    MISSING="$BATS_TEST_TMPDIR/definitely-absent.bin"
}

# stat_bin_for_dialect -- echo a stat binary that actually speaks $1 ("gnu" or
# "bsd"), or return 1. The probe is the flag itself rather than `uname`: what
# decides the dialect is the binary on PATH, not the kernel (coreutils on
# macOS, busybox on Linux). `stat -c %s .` succeeds only under GNU; `stat -f
# %z .` succeeds only under BSD -- GNU reads that -f as a filesystem query and
# then fails on "%z" as a path.
stat_bin_for_dialect() {
    local want="$1" cand
    for cand in stat gstat /usr/bin/stat \
                /opt/homebrew/opt/coreutils/libexec/gnubin/stat \
                /usr/local/opt/coreutils/libexec/gnubin/stat; do
        command -v "$cand" >/dev/null 2>&1 || continue
        case "$want" in
            gnu) "$cand" -c %s . >/dev/null 2>&1 && { printf '%s\n' "$cand"; return 0; } ;;
            bsd) "$cand" -f %z . >/dev/null 2>&1 && { printf '%s\n' "$cand"; return 0; } ;;
        esac
    done
    return 1
}

# assert_fresh_mtime -- an mtime for a file created moments ago. Catches both
# a zero (the failure this whole change is about) and a wrong-but-numeric
# format code, e.g. GNU %y, which prints a date string rather than an epoch.
assert_fresh_mtime() {
    local mtime="$1" age
    case "$mtime" in
        ''|*[!0-9]*) printf 'FAIL: mtime %s is not a bare integer\n' "$mtime" >&2; return 1 ;;
    esac
    [ "$mtime" -gt 0 ]
    age=$(( $(date +%s) - mtime ))
    if [ "$age" -lt 0 ] || [ "$age" -gt 300 ]; then
        printf 'FAIL: mtime %s is %ss away from now, fixture was just created\n' "$mtime" "$age" >&2
        return 1
    fi
}

# assert_stats_fixture -- the three fields against the fixture setup() built.
assert_stats_fixture() {
    [ "$(portable_stat size "$FIXTURE")" = "10" ]
    [ "$(portable_stat size "$EMPTY")" = "0" ]
    [ "$(portable_stat mode "$FIXTURE")" = "600" ]
    assert_fresh_mtime "$(portable_stat mtime "$FIXTURE")"
}

@test "portable_stat: reports the real size of a known fixture" {
    run portable_stat size "$FIXTURE"
    [ "$status" -eq 0 ]
    [ "$output" = "10" ]
    [ "$output" = "$(wc -c < "$FIXTURE" | tr -d ' ')" ]
}

@test "portable_stat: reports the real mtime of a known fixture" {
    run portable_stat mtime "$FIXTURE"
    [ "$status" -eq 0 ]
    assert_fresh_mtime "$output"
}

@test "portable_stat: reports the real mode of a known fixture" {
    chmod 644 "$FIXTURE"
    run portable_stat mode "$FIXTURE"
    [ "$status" -eq 0 ]
    [ "$output" = "644" ]
}

@test "portable_stat: an empty file is 0 and SUCCEEDS" {
    run portable_stat size "$EMPTY"
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]
}

@test "portable_stat: a missing file fails and prints nothing on stdout" {
    # The bug this replaces was `stat -f %z f 2>/dev/null || echo 0`, which
    # answers "0 bytes" to a question it could not answer at all. A caller
    # must be able to tell the two apart, so failure prints NOTHING on stdout.
    local out
    if out="$(portable_stat size "$MISSING" 2>/dev/null)"; then
        printf 'FAIL: expected non-zero exit for a missing file, got 0 with output %s\n' "$out" >&2
        return 1
    fi
    [ -z "$out" ]
}

@test "portable_stat: a missing file explains itself on stderr" {
    run portable_stat mtime "$MISSING"
    [ "$status" -ne 0 ]
    grep -F -q -- "$MISSING" <<< "$output"
}

@test "portable_stat: an unknown field is a usage error, not a value" {
    local out
    if out="$(portable_stat inode "$FIXTURE" 2>/dev/null)"; then
        printf 'FAIL: expected non-zero exit for an unknown field, got %s\n' "$out" >&2
        return 1
    fi
    [ -z "$out" ]
}

@test "portable_stat: GNU dialect, forced, returns real values" {
    local bin
    bin="$(stat_bin_for_dialect gnu)" \
        || skip "GNU dialect UNVERIFIED here: no GNU stat found (tried stat, gstat, /usr/bin/stat, coreutils gnubin)"
    export PORTABLE_STAT_CMD="$bin" PORTABLE_STAT_DIALECT=gnu
    [ "$(portable_stat_dialect)" = "gnu" ]
    assert_stats_fixture
}

@test "portable_stat: BSD dialect, forced, returns real values" {
    local bin
    bin="$(stat_bin_for_dialect bsd)" \
        || skip "BSD dialect UNVERIFIED here: no BSD stat found (tried stat, gstat, /usr/bin/stat, coreutils gnubin)"
    export PORTABLE_STAT_CMD="$bin" PORTABLE_STAT_DIALECT=bsd
    [ "$(portable_stat_dialect)" = "bsd" ]
    assert_stats_fixture
}

@test "portable_stat: the two dialects agree, field for field" {
    local gnu_bin bsd_bin field gnu_value bsd_value
    gnu_bin="$(stat_bin_for_dialect gnu)" || skip "cross-dialect check UNVERIFIED here: no GNU stat found"
    bsd_bin="$(stat_bin_for_dialect bsd)" || skip "cross-dialect check UNVERIFIED here: no BSD stat found"
    for field in size mtime mode; do
        gnu_value="$(PORTABLE_STAT_CMD="$gnu_bin" PORTABLE_STAT_DIALECT=gnu portable_stat "$field" "$FIXTURE")"
        bsd_value="$(PORTABLE_STAT_CMD="$bsd_bin" PORTABLE_STAT_DIALECT=bsd portable_stat "$field" "$FIXTURE")"
        if [ "$gnu_value" != "$bsd_value" ]; then
            printf 'FAIL: %s disagrees -- gnu(%s)=%s bsd(%s)=%s\n' \
                "$field" "$gnu_bin" "$gnu_value" "$bsd_bin" "$bsd_value" >&2
            return 1
        fi
    done
}

@test "portable_stat: a dialect the binary does not speak fails, it does not invent a number" {
    # The failure mode on Linux was that the BSD form still exited, just with
    # filesystem stats on stdout. Forcing the wrong dialect must be a hard
    # failure with an empty stdout, never a plausible integer.
    local gnu_bin out
    gnu_bin="$(stat_bin_for_dialect gnu)" || skip "wrong-dialect check UNVERIFIED here: no GNU stat found"
    if out="$(PORTABLE_STAT_CMD="$gnu_bin" PORTABLE_STAT_DIALECT=bsd portable_stat size "$FIXTURE" 2>/dev/null)"; then
        printf 'FAIL: BSD format against GNU stat should fail, got %s\n' "$out" >&2
        return 1
    fi
    [ -z "$out" ]
}

@test "portable_stat: sources and runs under zsh, which the repogolem stub needs" {
    command -v zsh >/dev/null 2>&1 || skip "zsh UNVERIFIED here: no zsh on this runner"
    run zsh -f -c 'source "$1"; portable_stat size "$2"' _ \
        "$SCRIPT_DIR/lib/portable-stat.sh" "$FIXTURE"
    [ "$status" -eq 0 ]
    [ "$output" = "10" ]
}

@test "portable_stat_dialect: detects from the binary, not from uname" {
    local bin
    bin="$(stat_bin_for_dialect gnu)" || skip "detection UNVERIFIED for gnu: no GNU stat found"
    unset PORTABLE_STAT_DIALECT
    export PORTABLE_STAT_CMD="$bin"
    [ "$(portable_stat_dialect)" = "gnu" ]

    bin="$(stat_bin_for_dialect bsd)" || skip "detection UNVERIFIED for bsd: no BSD stat found"
    export PORTABLE_STAT_CMD="$bin"
    [ "$(portable_stat_dialect)" = "bsd" ]
}

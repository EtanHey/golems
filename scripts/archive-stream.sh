#!/bin/bash
# Archive a processed stream recording to Brain Drive.
#
# Usage:
#   archive-stream.sh <stream-dir> [--no-compress] [--no-delete] [--dry-run]
#
# Pipeline:
#   1. Compress video.mp4 → video-compressed.mp4 (libx264 CRF 23 medium)
#   2. Verify compressed duration matches original (within 2s)
#   3. Copy artifacts into the local Google Drive FileProvider mount.
#   4. Write _DRIVE-LEDGER.md with byte sizes and SHA-256 checksums.
#   5. If Drive copies + ledger verify: replace video.mp4 with compressed
#      locally (Drive holds the original forever).
#   6. If compressed > 2 GB: keep ONLY compressed locally, delete original.
#      If compressed < 2 GB: replace original with compressed locally.
#
# Env flags:
#   STREAM_AUTO_ARCHIVE=0   Disable archival even when wired in process-stream.sh
#   STREAM_ARCHIVE_DELETE=0 Skip the local-cleanup step
#
# Triggered automatically from stream-watcher.sh after process-stream.sh
# completes. Can also be run manually for any past recording.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stream-helpers.sh
source "$SCRIPT_DIR/lib/stream-helpers.sh"

DEFAULT_BRAIN_DRIVE_ROOT="$HOME/Library/CloudStorage/GoogleDrive-${RESEARCH_ACCOUNT:-research-account@example.com}/My Drive/Brain Drive"
BRAIN_DRIVE_ROOT="${STALKER_BRAIN_DRIVE_ROOT:-$DEFAULT_BRAIN_DRIVE_ROOT}"
ARCHIVE_VERIFY_TIMEOUT_SECONDS="${STALKER_ARCHIVE_VERIFY_TIMEOUT_SECONDS:-60}"
ARCHIVE_VERIFY_POLL_SECONDS="${STALKER_ARCHIVE_VERIFY_POLL_SECONDS:-2}"

# --- Parse args ---
STREAM_DIR=""
SKIP_COMPRESS=false
SKIP_DELETE=false
DRY_RUN=false

for arg in "$@"; do
    case "$arg" in
        --no-compress) SKIP_COMPRESS=true ;;
        --no-delete)   SKIP_DELETE=true ;;
        --dry-run)     DRY_RUN=true ;;
        *)
            if [ -z "$STREAM_DIR" ]; then
                STREAM_DIR="$arg"
            fi
            ;;
    esac
done

[ -z "$STREAM_DIR" ] && {
    echo "Usage: archive-stream.sh <stream-dir> [--no-compress] [--no-delete] [--dry-run]" >&2
    exit 1
}

[ ! -d "$STREAM_DIR" ] && { echo "Not a directory: $STREAM_DIR" >&2; exit 2; }

# Resolve to absolute path for launchd-safe logs and ledger rows.
STREAM_DIR="$(cd "$STREAM_DIR" && pwd)"

# --- Allow opt-out from env (mainly for stream-watcher.sh auto-invocation) ---
if [ "${STREAM_AUTO_ARCHIVE:-1}" = "0" ]; then
    echo "[archive-stream] STREAM_AUTO_ARCHIVE=0 — skipping archive."
    exit 0
fi
[ "${STREAM_ARCHIVE_DELETE:-1}" = "0" ] && SKIP_DELETE=true

# Derive channel + date from <channel>-YYYY-MM-DD[-HHMMSS] folder name.
BASENAME=$(basename "$STREAM_DIR")
CHANNEL=$(echo "$BASENAME" | sed -E 's/-[0-9]{4}-[0-9]{2}-[0-9]{2}.*$//')
DATE=$(echo "$BASENAME" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || echo "")
STREAM_LABEL="${BASENAME#"${CHANNEL}"-}"
if [ -z "$CHANNEL" ] || [ -z "$DATE" ]; then
    echo "Cannot parse channel/date from '$BASENAME' — expected <channel>-YYYY-MM-DD[-HHMMSS]" >&2
    exit 3
fi

VIDEO="$STREAM_DIR/video.mp4"
COMPRESSED="$STREAM_DIR/video-compressed.mp4"
LEDGER="$STREAM_DIR/_DRIVE-LEDGER.md"
CLEANUP_SKIP_MARKER="$STREAM_DIR/.archive-cleanup-skipped"
DRIVE_TARGET="$BRAIN_DRIVE_ROOT/06_ARCHIVE/stalker-golem/${CHANNEL}/${STREAM_LABEL}"
DRIVE_LEDGER="$DRIVE_TARGET/_DRIVE-LEDGER.md"

log() { echo "[archive-stream $(date '+%H:%M:%S')] $1"; }

sha256_file() {
    local file="$1"
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    else
        echo "No SHA-256 tool found (need shasum or sha256sum)" >&2
        return 1
    fi
}

require_drive_root() {
    case "$BRAIN_DRIVE_ROOT" in
        /*) ;;
        *)
            log "Step 3: Brain Drive root must be absolute: $BRAIN_DRIVE_ROOT"
            return 1
            ;;
    esac

    if [ ! -d "$BRAIN_DRIVE_ROOT" ]; then
        log "Step 3: Brain Drive root is not a directory: $BRAIN_DRIVE_ROOT"
        return 1
    fi
}

archive_relative_files() {
    (
        cd "$STREAM_DIR"
        find . -type f ! -name '.*' ! -name '_DRIVE-LEDGER.md' -print \
            | sed 's#^\./##' \
            | LC_ALL=C sort
    )
}

media_duration_for_ledger() {
    local file="$1"
    case "$file" in
        *.mp4|*.ts|*.mov|*.m4v)
            video_duration_seconds "$file" || true
            ;;
        *)
            printf -- '-'
            ;;
    esac
}

poll_fileprovider_xattrs_advisory() {
    local file="$1"
    local rel="$2"
    local attrs

    if ! command -v xattr >/dev/null 2>&1; then
        return 0
    fi

    attrs=$(xattr "$file" 2>/dev/null | tr '\n' ',' | sed 's/,$//' || true)
    if [ -n "$attrs" ]; then
        log "  FileProvider/xattr state for $rel: $attrs (advisory; cleanup is gated by size+checksum+ledger)"
    fi
}

verify_drive_copy() {
    local src="$1"
    local dest="$2"
    local rel="$3"
    local expected_size="$4"
    local expected_hash="$5"
    local deadline=$((SECONDS + ARCHIVE_VERIFY_TIMEOUT_SECONDS))
    local actual_size actual_hash

    while true; do
        if [ ! -f "$src" ]; then
            log "  Source disappeared during verification for $rel: $src"
            return 1
        fi

        if [ -f "$dest" ]; then
            actual_size=$(file_size_bytes "$dest")
            if [ "$actual_size" = "$expected_size" ]; then
                actual_hash=$(sha256_file "$dest" || true)
                if [ "$actual_hash" = "$expected_hash" ]; then
                    poll_fileprovider_xattrs_advisory "$dest" "$rel"
                    return 0
                fi
            fi
        fi

        if [ "$SECONDS" -ge "$deadline" ]; then
            log "  Drive verification timed out for $rel (preserving local originals)"
            return 1
        fi
        sleep "$ARCHIVE_VERIFY_POLL_SECONDS"
    done
}

write_drive_ledger() {
    local rows_file="$1"
    local ledger_tmp
    ledger_tmp="$(mktemp "$STREAM_DIR/.drive-ledger.XXXXXX")"

    {
        printf '# Stalker Golem Drive Ledger\n\n'
        printf -- '- Stream: %s\n' "$BASENAME"
        printf -- '- Channel: %s\n' "$CHANNEL"
        printf -- '- Label: %s\n' "$STREAM_LABEL"
        printf -- '- Source: %s\n' "$STREAM_DIR"
        printf -- '- Drive Target: %s\n\n' "$DRIVE_TARGET"
        printf '| Path | Bytes | SHA256 | Duration Seconds |\n'
        printf '|---|---:|---|---:|\n'
        LC_ALL=C sort "$rows_file"
    } > "$ledger_tmp"

    printf '%s\n' "$ledger_tmp"
}

append_ledger_row() {
    local rows_file="$1"
    local rel="$2"
    local artifact="$3"
    local size hash duration

    size=$(file_size_bytes "$artifact")
    hash=$(sha256_file "$artifact") || return 1
    duration=$(media_duration_for_ledger "$artifact")
    printf '| %s | %s | %s | %s |\n' "$rel" "$size" "$hash" "$duration" >> "$rows_file"
}

copy_ledger_to_drive() {
    local ledger_file="${1:-$LEDGER}"
    local ledger_size ledger_hash
    ledger_size=$(file_size_bytes "$ledger_file") || return 1
    ledger_hash=$(sha256_file "$ledger_file") || return 1
    cp -p "$ledger_file" "$DRIVE_LEDGER" || return 1
    verify_drive_copy "$ledger_file" "$DRIVE_LEDGER" "_DRIVE-LEDGER.md" "$ledger_size" "$ledger_hash"
}

local_video_is_archived_compressed_cache() {
    local rel="$1"
    local size="$2"
    local hash="$3"
    local drive_compressed="$DRIVE_TARGET/video-compressed.mp4"
    local compressed_size compressed_hash

    [ "$rel" = "video.mp4" ] || return 1
    [ ! -f "$COMPRESSED" ] || return 1
    [ -f "$drive_compressed" ] || return 1

    compressed_size=$(file_size_bytes "$drive_compressed")
    [ "$compressed_size" = "$size" ] || return 1
    compressed_hash=$(sha256_file "$drive_compressed") || return 1
    [ "$compressed_hash" = "$hash" ]
}

copy_archive_to_drive() {
    local rows_tmp ledger_tmp rel src dest dest_dir size hash count existing_size existing_hash
    require_drive_root || return 1
    mkdir -p "$DRIVE_TARGET" || return 1

    rows_tmp="$(mktemp "$STREAM_DIR/.drive-ledger-rows.XXXXXX")"
    : > "$rows_tmp"
    count=0

    while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        src="$STREAM_DIR/$rel"
        dest="$DRIVE_TARGET/$rel"
        dest_dir="$(dirname "$dest")"
        size=$(file_size_bytes "$src")
        hash=$(sha256_file "$src") || { rm -f "$rows_tmp"; return 1; }

        mkdir -p "$dest_dir" || { rm -f "$rows_tmp"; return 1; }
        if [ -f "$dest" ]; then
            existing_size=$(file_size_bytes "$dest")
            existing_hash=$(sha256_file "$dest") || { rm -f "$rows_tmp"; return 1; }
            if [ "$existing_size" = "$size" ] && [ "$existing_hash" = "$hash" ]; then
                log "  Drive copy already verified for $rel"
                append_ledger_row "$rows_tmp" "$rel" "$dest" || { rm -f "$rows_tmp"; return 1; }
                count=$((count + 1))
                continue
            fi

            if local_video_is_archived_compressed_cache "$rel" "$size" "$hash"; then
                log "  Preserving existing Drive original for $rel; local copy matches archived video-compressed.mp4"
                append_ledger_row "$rows_tmp" "video-compressed.mp4" "$DRIVE_TARGET/video-compressed.mp4" || { rm -f "$rows_tmp"; return 1; }
                append_ledger_row "$rows_tmp" "$rel" "$dest" || { rm -f "$rows_tmp"; return 1; }
                count=$((count + 2))
                continue
            fi

            log "  Refusing to overwrite existing Drive artifact with a different checksum: $rel"
            rm -f "$rows_tmp"
            return 1
        fi

        cp -p "$src" "$dest" || { rm -f "$rows_tmp"; return 1; }
        verify_drive_copy "$src" "$dest" "$rel" "$size" "$hash" || { rm -f "$rows_tmp"; return 1; }
        append_ledger_row "$rows_tmp" "$rel" "$dest" || { rm -f "$rows_tmp"; return 1; }
        count=$((count + 1))
    done < <(archive_relative_files)

    if [ "$count" -eq 0 ]; then
        log "Step 3: No archiveable files found in $STREAM_DIR"
        rm -f "$rows_tmp"
        return 1
    fi

    ledger_tmp=$(write_drive_ledger "$rows_tmp") || { rm -f "$rows_tmp"; return 1; }
    rm -f "$rows_tmp"
    if ! copy_ledger_to_drive "$ledger_tmp"; then
        rm -f "$ledger_tmp"
        return 1
    fi
    mv "$ledger_tmp" "$LEDGER"
}

cleanup_gate_verified() {
    local rel src dest size hash ledger_size ledger_hash

    [ -f "$LEDGER" ] || { log "Step 4: Refusing cleanup — missing ledger: $LEDGER"; return 1; }
    [ -f "$DRIVE_LEDGER" ] || { log "Step 4: Refusing cleanup — missing Drive ledger: $DRIVE_LEDGER"; return 1; }

    ledger_size=$(file_size_bytes "$LEDGER")
    ledger_hash=$(sha256_file "$LEDGER") || return 1
    verify_drive_copy "$LEDGER" "$DRIVE_LEDGER" "_DRIVE-LEDGER.md" "$ledger_size" "$ledger_hash" || {
        log "Step 4: Refusing cleanup — Drive ledger failed verification"
        return 1
    }

    for rel in video.ts video.mp4 video-compressed.mp4 full-audio.wav; do
        src="$STREAM_DIR/$rel"
        [ -f "$src" ] || continue
        dest="$DRIVE_TARGET/$rel"
        size=$(file_size_bytes "$src")
        hash=$(sha256_file "$src") || return 1
        verify_drive_copy "$src" "$dest" "$rel" "$size" "$hash" || {
            log "Step 4: Refusing cleanup — Drive copy failed verification for $rel"
            return 1
        }
    done
}

write_cleanup_skip_marker() {
    {
        printf 'status=CLEANUP_SKIPPED\n'
        printf 'reason=drive_reverify_failed\n'
        printf 'message=WARNING: cleanup skipped - originals retained; Drive re-verify failed\n'
        printf 'updated_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    } > "$CLEANUP_SKIP_MARKER"
}

log "Archiving ${CHANNEL} stream from ${DATE}"
log "  Source: $STREAM_DIR"
log "  Drive target: $DRIVE_TARGET/"

# =====================================================================
# STEP 1: Compress video
# =====================================================================
if [ "$SKIP_COMPRESS" = true ]; then
    log "Step 1: Skipping compression (--no-compress)"
elif [ -f "$COMPRESSED" ]; then
    log "Step 1: Compressed video already exists, skipping"
elif [ ! -f "$VIDEO" ]; then
    log "Step 1: No video.mp4 to compress, skipping"
else
    log "Step 1: Compressing $VIDEO → $COMPRESSED"
    log "  This can take 15-30 min for a 4h stream. Running ffmpeg..."
    if [ "$DRY_RUN" = true ]; then
        log "  [DRY RUN] would compress"
    else
        if ! compress_video_h264 "$VIDEO" "$COMPRESSED" 23 medium > "$STREAM_DIR/.compress.log" 2>&1; then
            log "  Compression FAILED. See $STREAM_DIR/.compress.log"
            exit 4
        fi
        log "  Compressed: $(du -sh "$COMPRESSED" | cut -f1) (original: $(du -sh "$VIDEO" | cut -f1))"
    fi
fi

# =====================================================================
# STEP 2: Verify durations match (compressed must == original ± 2s)
# =====================================================================
if [ -f "$VIDEO" ] && [ -f "$COMPRESSED" ]; then
    ORIG_DUR=$(video_duration_seconds "$VIDEO")
    COMP_DUR=$(video_duration_seconds "$COMPRESSED")
    if ! durations_match "$ORIG_DUR" "$COMP_DUR" 2; then
        log "Step 2: Duration mismatch — original=${ORIG_DUR}s compressed=${COMP_DUR}s. ABORTING (keep originals)."
        exit 5
    fi
    log "Step 2: Duration verified (${ORIG_DUR}s ≈ ${COMP_DUR}s)"
fi

# =====================================================================
# STEP 3: Deterministic local Drive copy + ledger
# =====================================================================
log "Step 3: Copying artifacts to local Drive FileProvider mount + writing ledger"
if [ "$DRY_RUN" = true ]; then
    log "  [DRY RUN] would copy archive files to $DRIVE_TARGET and write $LEDGER"
else
    if ! copy_archive_to_drive; then
        log "  Drive archive FAILED before cleanup. Local originals preserved."
        exit 6
    fi
    log "  Drive archive verified. Ledger: $LEDGER"
fi

# =====================================================================
# STEP 4: Local cleanup — gated by Drive copy verification + ledger
# =====================================================================
if [ "$SKIP_DELETE" = true ]; then
    log "Step 4: Skipping local cleanup (--no-delete or STREAM_ARCHIVE_DELETE=0)"
elif [ "$DRY_RUN" = true ]; then
    log "Step 4: [DRY RUN] would replace video.mp4 with compressed and clean heavy files"
elif [ -f "$COMPRESSED" ] && [ -f "$VIDEO" ]; then
    if ! cleanup_gate_verified; then
        write_cleanup_skip_marker
        log "Step 4 WARNING: cleanup skipped - originals retained; Drive re-verify failed"
        log "Step 4: Archive copy and ledger already verified, so continuing without deleting local media."
    else
        rm -f "$CLEANUP_SKIP_MARKER"
        # Behavior is identical above and below the 2 GB cap from the spec —
        # in both cases the original gets removed locally and the compressed
        # version takes over as the working copy. Drive has the original
        # forever, so there's no point in keeping the 8 GB sibling. The cap
        # only changes the log message (and is useful for future telemetry).
        COMP_SIZE=$(file_size_bytes "$COMPRESSED")
        COMP_GB=$((COMP_SIZE / 1073741824))
        if [ "$COMP_SIZE" -gt 2147483648 ]; then
            log "Step 4: Compressed is ${COMP_GB} GB (>2 GB cap) — keeping ONLY compressed locally."
        else
            log "Step 4: Compressed is ${COMP_GB} GB — replacing video.mp4 with compressed."
        fi
        rm -f "$VIDEO"
        mv "$COMPRESSED" "$VIDEO"
        if [ -f "$STREAM_DIR/video.ts" ]; then
            TS_SIZE=$(du -sh "$STREAM_DIR/video.ts" | cut -f1)
            log "Step 4: Removing video.ts ($TS_SIZE) — verified in Drive ledger"
            rm -f "$STREAM_DIR/video.ts"
        fi
        # full-audio.wav can also go — it's regeneratable from video.mp4 + ffmpeg
        if [ -f "$STREAM_DIR/full-audio.wav" ]; then
            AUDIO_SIZE=$(du -sh "$STREAM_DIR/full-audio.wav" | cut -f1)
            log "Step 4: Removing full-audio.wav ($AUDIO_SIZE) — regeneratable from video"
            rm -f "$STREAM_DIR/full-audio.wav"
        fi
    fi
fi

log "=== ARCHIVE COMPLETE ==="
log "Drive: $DRIVE_TARGET/"
log "Ledger: $LEDGER"
log "Local dir size now: $(du -sh "$STREAM_DIR" | cut -f1)"

if command -v notify &> /dev/null; then
    notify "Stream Archived" "${CHANNEL} ${DATE} → Brain Drive"
fi

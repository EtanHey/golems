#!/bin/bash
# Shared helpers for stream-watcher.sh and process-stream.sh.
#
# These exist as standalone functions so they can be unit-tested via bats
# (see scripts/tests/test-stream-helpers.bats). Source this file, then call
# the functions directly. No side effects on source.

STREAM_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=portable-stat.sh
source "$STREAM_HELPERS_DIR/portable-stat.sh"

# shellcheck source=stream/media.sh
source "$STREAM_HELPERS_DIR/stream/media.sh"
# shellcheck source=stream/process.sh
source "$STREAM_HELPERS_DIR/stream/process.sh"
# shellcheck source=stream/scoring.sh
source "$STREAM_HELPERS_DIR/stream/scoring.sh"
# shellcheck source=stream/transcription.sh
source "$STREAM_HELPERS_DIR/stream/transcription.sh"
# shellcheck source=stream/notifications.sh
source "$STREAM_HELPERS_DIR/stream/notifications.sh"
# shellcheck source=stream/stages.sh
source "$STREAM_HELPERS_DIR/stream/stages.sh"

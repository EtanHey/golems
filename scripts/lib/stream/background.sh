#!/bin/bash
# Run post-stream media work at low priority, without changing live parents.
# ffmpeg callers must supply exactly one output, as the final argument.
set -euo pipefail
policy=(-b)

if [ "${1:-}" = ffmpeg ]; then
    policy=(-c utility)
    shift
    [ "$#" -gt 0 ] || { echo "ffmpeg output required" >&2; exit 2; }
    args=(-filter_threads 4 -filter_complex_threads 4)
    while [ "$#" -gt 1 ]; do
        # Decoder threads are per-input; annotation has two inputs.
        [ "$1" != -i ] || args+=(-threads 4)
        args+=("$1")
        shift
    done
    # Encoder threads are per-output. Keep them after all input options.
    set -- ffmpeg "${args[@]}" -threads 4 "$1"
fi

# On macOS, ffmpeg gets utility QoS: -b severely slows CPU encodes.
# Keep background CPU/I/O policy for Whisper and SoX; all commands get nice15.
# Do not retry a failed command: it may already have written partial output.
if [ "$(uname -s)" = Darwin ] && command -v taskpolicy >/dev/null 2>&1; then
    exec nice -n 15 taskpolicy "${policy[@]}" "$@"
fi
exec nice -n 15 "$@"

#!/bin/sh
# scene-cues.sh — visual-change cues for dense-windows.sh (#276).
#
# Catches silent clicks and UI changes the narrator never mentions.
#
# usage: scene-cues.sh <video> [threshold=0.02]
# Prints t<TAB>t<TAB>scene rows (cues.tsv format) on stdout.
#
# Exit codes: 0 ok, 1 runtime failure, 2 usage error.

set -eu

[ $# -ge 1 ] && [ $# -le 2 ] || { echo "usage: scene-cues.sh <video> [threshold=0.02]" >&2; exit 2; }
VIDEO="$1"
THRESHOLD="${2:-0.02}"
printf '%s' "$THRESHOLD" | grep -Eq '^[0-9]+([.][0-9]+)?$' \
  || { echo "scene-cues: threshold must be a number: $THRESHOLD" >&2; exit 2; }

command -v ffmpeg >/dev/null 2>&1 || { echo "scene-cues: ffmpeg not found on PATH" >&2; exit 1; }
[ -f "$VIDEO" ] || { echo "scene-cues: video not found: $VIDEO" >&2; exit 1; }

# showinfo logs one line per selected frame; capture it before parsing so an
# ffmpeg failure is not masked by the pipeline.
log="$(ffmpeg -hide_banner -nostdin -i "$VIDEO" -an \
  -vf "select='gt(scene,$THRESHOLD)',showinfo" -f null - 2>&1)" \
  || { printf '%s\n' "$log" | tail -5 >&2; echo "scene-cues: ffmpeg failed on $VIDEO" >&2; exit 1; }

printf '%s\n' "$log" \
  | sed -n 's/.*Parsed_showinfo.*pts_time:[[:space:]]*\([0-9.][0-9.]*\).*/\1/p' \
  | awk '{ printf "%.3f\t%.3f\tscene\n", $1, $1 }'

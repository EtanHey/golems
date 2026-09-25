#!/bin/sh
# dense-windows.sh — dense-frame contact sheets around QA action cues (#276).
#
# A click's target, hover state and resulting animation all happen in under a
# second, so interval/hotspot frames cannot show them. This extracts every
# window around a cue at 5-20 fps and tiles the frames into 5x4 contact sheets.
#
# usage: dense-windows.sh <video> <cues.tsv> <outdir> [fps=10] [pre=1.0] [post=2.0]
#
#   cues.tsv   rows of start_s<TAB>end_s<TAB>label (blank and # lines skipped)
#   outdir     gets sheet_NNN.jpg plus index.tsv:
#              sheet_file<TAB>window_start_s<TAB>fps<TAB>tiles<TAB>label
#              window_start_s is the time of the sheet's first tile, so tile i
#              (row-major, 0-based) is at window_start_s + i/fps. A window with
#              more than 20 frames spills onto further sheets.
#
# No drawtext: common ffmpeg builds lack freetype. Timestamps live in the index.
# DENSE_TILE_WIDTH sets the tile width in px (default and minimum 480).
#
# Exit codes: 0 ok, 1 runtime failure, 2 usage error.

set -eu

TAB="$(printf '\t')"
COLS=5
ROWS=4
PER_SHEET=$((COLS * ROWS))

usage() {
  echo "usage: dense-windows.sh <video> <cues.tsv> <outdir> [fps=10] [pre=1.0] [post=2.0]" >&2
  exit 2
}
die() { echo "dense-windows: $*" >&2; exit 1; }
is_num() { printf '%s' "$1" | grep -Eq '^[0-9]+([.][0-9]+)?$'; }

[ $# -ge 3 ] && [ $# -le 6 ] || usage
VIDEO="$1"; CUES="$2"; OUTDIR="$3"
FPS="${4:-10}"; PRE="${5:-1.0}"; POST="${6:-2.0}"

printf '%s' "$FPS" | grep -Eq '^[0-9]+$' || { echo "dense-windows: fps must be an integer 5-20: $FPS" >&2; exit 2; }
[ "$FPS" -ge 5 ] && [ "$FPS" -le 20 ] || { echo "dense-windows: fps must be 5-20: $FPS" >&2; exit 2; }
is_num "$PRE" || { echo "dense-windows: pre must be seconds >= 0: $PRE" >&2; exit 2; }
is_num "$POST" || { echo "dense-windows: post must be seconds >= 0: $POST" >&2; exit 2; }

TILE_W="${DENSE_TILE_WIDTH:-480}"
printf '%s' "$TILE_W" | grep -Eq '^[0-9]+$' || die "DENSE_TILE_WIDTH must be an integer: $TILE_W"
[ "$TILE_W" -ge 480 ] || TILE_W=480

command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg not found on PATH"
[ -f "$VIDEO" ] || die "video not found: $VIDEO"
[ -f "$CUES" ] || die "cues file not found: $CUES"

# Duration from ffmpeg's own header (ffprobe is not guaranteed alongside it).
DURATION="$(ffmpeg -hide_banner -i "$VIDEO" 2>&1 \
  | sed -n 's/.*Duration: \([0-9]*\):\([0-9]*\):\([0-9.]*\).*/\1 \2 \3/p' \
  | awk 'NR == 1 { printf "%.3f", $1 * 3600 + $2 * 60 + $3 }')"
[ -n "$DURATION" ] || die "cannot read duration (not a video?): $VIDEO"

mkdir -p "$OUTDIR"
WINDOWS="$OUTDIR/.windows.tsv"
SCRATCH="$OUTDIR/.frames"
trap 'rm -rf "$SCRATCH" "$WINDOWS" "$WINDOWS.raw" "$OUTDIR/index.tsv.tmp"' EXIT HUP INT TERM

# Pad each cue to [start-pre, end+post], clamp to the video, sort, and merge
# overlapping windows. Output: start<TAB>end<TAB>label (labels joined " | ").
awk -F'\t' -v pre="$PRE" -v post="$POST" -v dur="$DURATION" '
  /^[[:space:]]*(#|$)/ { next }
  $1 !~ /^[0-9]+([.][0-9]+)?$/ || $2 !~ /^[0-9]+([.][0-9]+)?$/ {
    printf "dense-windows: bad cue row %d: %s\n", NR, $0 > "/dev/stderr"; bad = 1; next
  }
  {
    s = $1 - pre; if (s < 0) s = 0
    e = $2 + post; if (e > dur) e = dur
    if (e <= s) next
    label = $3; gsub(/[\t\r\n]/, " ", label)
    printf "%.3f\t%.3f\t%s\n", s, e, label
  }
  END { exit bad }
' "$CUES" > "$WINDOWS.raw" || die "invalid cues file: $CUES"

sort -t "$TAB" -k1,1n -k2,2n "$WINDOWS.raw" | awk -F'\t' '
  function flush() { if (have) printf "%.3f\t%.3f\t%s\n", ws, we, wl }
  {
    if (have && $1 <= we) {
      if ($2 > we) we = $2
      if ($3 != "" && index(" | " wl " | ", " | " $3 " | ") == 0) wl = (wl == "" ? $3 : wl " | " $3)
      next
    }
    flush(); have = 1; ws = $1; we = $2; wl = $3
  }
  END { flush() }
' > "$WINDOWS"

[ -s "$WINDOWS" ] || die "no usable cues in $CUES"

INDEX="$OUTDIR/index.tsv"
: > "$INDEX.tmp"
sheet_no=0

while IFS="$TAB" read -r ws we label; do
  frames="$(awk -v s="$ws" -v e="$we" -v f="$FPS" 'BEGIN { printf "%d", (e - s) * f + 0.5 }')"
  [ "$frames" -gt 0 ] || continue

  rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
  ffmpeg -hide_banner -loglevel error -nostdin -ss "$ws" -i "$VIDEO" -t "$(awk -v s="$ws" -v e="$we" 'BEGIN { printf "%.3f", e - s }')" \
    -vf "fps=$FPS,scale=$TILE_W:-2" -frames:v "$frames" "$SCRATCH/f_%05d.png" \
    || die "frame extraction failed for window $ws-$we"

  got="$(find "$SCRATCH" -name 'f_*.png' | wc -l | tr -d ' ')"
  [ "$got" -gt 0 ] || die "no frames extracted for window $ws-$we"

  chunk=0
  while [ $((chunk * PER_SHEET)) -lt "$got" ]; do
    first=$((chunk * PER_SHEET))
    tiles=$((got - first)); [ "$tiles" -le "$PER_SHEET" ] || tiles=$PER_SHEET
    sheet_no=$((sheet_no + 1))
    sheet="$(printf 'sheet_%03d.jpg' "$sheet_no")"
    ffmpeg -hide_banner -loglevel error -nostdin -y -start_number $((first + 1)) \
      -i "$SCRATCH/f_%05d.png" -frames:v 1 -vf "tile=${COLS}x${ROWS}" -q:v 3 "$OUTDIR/$sheet" \
      || die "tiling failed for $sheet"
    start="$(awk -v s="$ws" -v i="$first" -v f="$FPS" 'BEGIN { printf "%.3f", s + i / f }')"
    printf '%s\t%s\t%s\t%s\t%s\n' "$sheet" "$start" "$FPS" "$tiles" "$label" >> "$INDEX.tmp"
    chunk=$((chunk + 1))
  done
done < "$WINDOWS"

mv "$INDEX.tmp" "$INDEX"
echo "dense-windows: $sheet_no sheet(s) -> $INDEX"

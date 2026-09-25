#!/usr/bin/env bats
# qa-video dense action windows (#276): dense-windows.sh merges cue windows,
# tiles 5x4 contact sheets and indexes every tile to a timestamp.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPTS="$REPO_ROOT/skills/golem-powers/qa-video/scripts"
  DENSE="$SCRIPTS/dense-windows.sh"
  SCENE="$SCRIPTS/scene-cues.sh"
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
  VIDEO="$WORK/synthetic.mp4"
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=640x360:rate=30 \
    -t 6 -pix_fmt yuv420p "$VIDEO"

  # Two overlapping cues and one separate cue. With pre=0.5 post=0.5:
  #   [0.0,2.0] + [1.3,3.0] -> [0.0,3.0] (30 frames at 10 fps -> 2 sheets)
  #   [4.0,5.3]                          (13 frames at 10 fps -> 1 sheet)
  CUES="$WORK/cues.tsv"
  printf '0.5\t1.5\tclick save\n1.8\t2.5\thover menu\n4.5\t4.8\tscene\n' > "$CUES"
}

@test "dense-windows: overlapping cues merge into 2 windows with correct sheets and index" {
  run "$DENSE" "$VIDEO" "$CUES" "$WORK/out" 10 0.5 0.5
  [ "$status" -eq 0 ] || { printf '%s\n' "$output"; return 1; }

  index="$WORK/out/index.tsv"
  [ -f "$index" ]

  # 3 sheets: window 1 spills to a second sheet, window 2 fits on one.
  [ "$(wc -l < "$index" | tr -d ' ')" -eq 3 ]
  [ "$(find "$WORK/out" -maxdepth 1 -name 'sheet_*.jpg' | wc -l | tr -d ' ')" -eq 3 ]

  # Exactly 2 distinct windows after the merge.
  [ "$(cut -f5 "$index" | sort -u | wc -l | tr -d ' ')" -eq 2 ]

  expected="$(printf '%s\n' \
    "sheet_001.jpg	0.000	10	20	click save | hover menu" \
    "sheet_002.jpg	2.000	10	10	click save | hover menu" \
    "sheet_003.jpg	4.000	10	13	scene")"
  [ "$(cat "$index")" = "$expected" ] || {
    printf 'got:\n%s\nwant:\n%s\n' "$(cat "$index")" "$expected"
    return 1
  }

  # Every indexed sheet exists and is a 5x4 grid of 480 px tiles.
  while IFS="$(printf '\t')" read -r sheet _start _fps _tiles _label; do
    [ -s "$WORK/out/$sheet" ]
    width="$(ffmpeg -hide_banner -i "$WORK/out/$sheet" 2>&1 \
      | sed -n 's/.*Video:.*[^0-9]\([0-9][0-9]*\)x\([0-9][0-9]*\).*/\1/p' | head -1)"
    [ "$width" -eq 2400 ]
  done < "$index"

  # No frame scratch left behind.
  [ -z "$(find "$WORK/out" -mindepth 1 -type d)" ]
}

@test "dense-windows: tile i of a sheet is at window_start + i/fps" {
  run "$DENSE" "$VIDEO" "$CUES" "$WORK/out" 10 0.5 0.5
  [ "$status" -eq 0 ]

  # Sheet 2, tile 7 -> 2.0 + 7/10 = 2.7 s.
  ts="$(awk -F'\t' '$1 == "sheet_002.jpg" { printf "%.3f", $2 + 7 / $3 }' "$WORK/out/index.tsv")"
  [ "$ts" = "2.700" ]
}

@test "dense-windows: default fps is 10" {
  printf '2.0\t2.5\tclick\n' > "$WORK/one.tsv"
  run "$DENSE" "$VIDEO" "$WORK/one.tsv" "$WORK/out"
  [ "$status" -eq 0 ]
  # default pre=1.0 post=2.0 -> [1.0,4.5] = 35 frames -> 20 + 15.
  [ "$(cut -f2-4 "$WORK/out/index.tsv")" = "$(printf '1.000\t10\t20\n3.000\t10\t15')" ]
}

@test "dense-windows: fails cleanly on a missing video" {
  run "$DENSE" "$WORK/nope.mp4" "$CUES" "$WORK/out"
  [ "$status" -eq 1 ]
  [[ "$output" == *"video not found"* ]]
  [ ! -e "$WORK/out/index.tsv" ]
}

@test "dense-windows: rejects fps outside 5-20" {
  run "$DENSE" "$VIDEO" "$CUES" "$WORK/out" 30
  [ "$status" -eq 2 ]
  [[ "$output" == *"fps"* ]]
}

@test "scene-cues: prints a t<TAB>t<TAB>scene row at a visual cut" {
  # testsrc never crosses the 0.02 scene score, so cut black -> white at 2 s.
  cut="$WORK/cut.mp4"
  ffmpeg -hide_banner -loglevel error -f lavfi -i "color=c=black:s=640x360:r=30:d=2" \
    -f lavfi -i "color=c=white:s=640x360:r=30:d=2" \
    -filter_complex "[0][1]concat=n=2:v=1" -pix_fmt yuv420p "$cut"

  run "$SCENE" "$cut"
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf '2.000\t2.000\tscene')" ]
}

@test "scene-cues: fails cleanly on a missing video" {
  run "$SCENE" "$WORK/nope.mp4"
  [ "$status" -eq 1 ]
  [[ "$output" == *"video not found"* ]]
}

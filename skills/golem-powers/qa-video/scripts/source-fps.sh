#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 1 ]] || { echo 'usage: source-fps.sh <video>' >&2; exit 2; }
ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -of csv=p=0 "$1" |
  awk -F/ '{ n=$1; if (NF==2 && $2>0) n=$1/$2; else if (NF==2) n=0;
             if (n>0) { printf "%.3f\n", n; ok=1 } } END { if (!ok) exit 1 }'

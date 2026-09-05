#!/bin/bash
# MLX server wrapper — only runs 1AM-7AM to save CPU/RAM during the day.
# launchd restarts us every 10s (ThrottleInterval), so during the day
# we just exit immediately and cost nothing.

HOUR=$(date +%H)
if [ "$HOUR" -ge 7 ] || [ "$HOUR" -lt 1 ]; then
    exit 0
fi

exec /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
    -m mlx_lm server \
    --model mlx-community/Qwen2.5-Coder-14B-Instruct-4bit \
    --port 8080

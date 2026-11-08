#!/usr/bin/env python3
"""Deterministic Cursor boundary fixture; operates only on paths in its prompt."""
import json
import os
from pathlib import Path
import re
import sys

prompt = sys.argv[-1]
if "Output findings JSONL: " in prompt:
    if os.environ.get("MINER_FAIL") in ("all", re.search(r"Session: (.*)", prompt)[1]):
        sys.exit(1)
    out = Path(re.search(r"Output findings JSONL: (.*)", prompt)[1])
    out.write_text(json.dumps({"id": "f1", "title": "fixture", "disposition": "KEEP"}) + "\n")
else:
    mode = os.environ.get("SYNTH_MODE", "good")
    out = Path(re.search(r"Write markdown to (.*?) with sections:", prompt)[1])
    marker = re.search(r"<!-- weave-run: [^>]+ -->", prompt)
    if mode != "missing":
        text = marker[0] if marker else ""
        if mode == "wrong":
            text = "<!-- weave-run: previous-run -->"
        if mode != "empty":
            text += "\n# Fixture report\nFresh synthesis.\n"
        out.write_text(text)
    if mode == "exit-failure":
        sys.exit(7)
print("{}")

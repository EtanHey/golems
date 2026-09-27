#!/usr/bin/env python3
import json
from pathlib import Path
import sys

MUTATE = False
prompt = sys.stdin.read()
output = Path(sys.argv[sys.argv.index("-o") + 1])
output.write_text(json.dumps({"worker": "fixture", "findings": []}))
if MUTATE and "--json" in sys.argv:
    repo = Path(sys.argv[sys.argv.index("-C") + 1])
    (repo / "unexpected.txt").write_text("mutation detected")
print("model: gpt-5.6-luna")
print("reasoning effort: max")
if "--json" in sys.argv:
    print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 7, "output_tokens": 3}}))

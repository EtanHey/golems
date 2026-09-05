Tick frame:
- surfaces: s:3, s:5, s:7, s:8, s:9
- ticks: 1..3
- parsed_only: true for every read

Observed monitor behavior:
- reads all 5 surfaces on tick 1
- reads all 5 surfaces on tick 2
- reads all 5 surfaces on tick 3
- performs 15 parsed reads total
- performs 0 full reads
- labels s:7 "idle"

Observed risk:
- repeated 6-line wrappers can hide active work
- no bottom-of-screen prompt proof exists
- active codex may be misclassified from telemetry alone

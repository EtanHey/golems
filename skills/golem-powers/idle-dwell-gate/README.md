# idle-dwell-gate: fixtures only

The gate itself was deleted in GO-5 E1 (hooks ruling; `scripts/hooks/install-hooks.mjs`
refuses it). Only `evals/fixtures/` stays, because `scripts/jev-gate-replay.py` replays it
as a corpus and Jev is out of scope until question L is ruled. Delete this directory together
with that replay's corpus change.

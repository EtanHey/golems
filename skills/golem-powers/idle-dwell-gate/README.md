# idle-dwell-gate: fixtures only

The gate itself was deleted in GO-5 E1 (hooks ruling; `scripts/hooks/install-hooks.mjs`
refuses it). Only `evals/fixtures/` stays, because `scripts/jev-gate-replay.py` replays it
as a corpus and Jev is out of scope until question L is ruled.

**The jev owner moves the corpus + deletes the dir:** move these fixtures to Jev's own replay
corpus, repoint `scripts/jev-gate-replay.py` at it, then delete `skills/golem-powers/idle-dwell-gate/`.

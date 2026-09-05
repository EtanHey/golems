# CORRECTIONS.md — fixture errata (mini, for correction-sweep evals)
> Fixture for `correction-sweep.py` RED/GREEN. Mirrors the real 2026-06-07 shape.

## COUNTS
- Fixture: 7 §1 rows — 6 strike rows with extractable literals (1, 2, 4, 5, 6, 7) + 1 NO-LITERAL row (3) + 1 stray in-section heading.

---

## §1 — REFUTED (strike in place)
Each row: wrong claim → where it lives → corrected truth. **Instruction for every row: strike in place** (strikethrough + pointer here; never silently edit).

1. **Collab retirement dump §F: "Phase 1 = full daily weave (47 sessions staged)"** — lives in the handoff doc. Truth: 47 was the confessed-INVENTED number; real corpus = **45**. **Strike "47 sessions staged" with pointer to the correction.**

2. **"PR #999 OPEN at session end, merge not observed"** — lives in the status board. Truth: **#999 MERGED** before session end. **Strike in place.**

3. **vl PR state errors** — lives in the status board. Truth: states were stale. (No quoted literal in this row's head — the sweep must surface it as a NO-LITERAL row for manual sweep, not silently drop it.) **Strike both in place.**

4. **Stale night-cron cadence rows** — lives in the cron log. Truth: cadences were mislabeled. **Strike "10-min tick" and "67 ticks" in place.**

5. **"superseded tick policy applies"** — lives in the cron log. Truth: that policy was retired; the claim must not survive (and the literal's own token word must not self-clear it). **Strike in place.**

## quoted stray heading inside section one (must NOT truncate parsing — rows below still sweep)

6. **Stale relay window labels** — lives in the cron log. Truth: both labels stale. **Strike "relay window A"
   and "relay window B" in place.**

7. **Stale completion banner** — lives in the cron log. Truth: neither happened; the sentence-shaped claim (with its internal period) must still be swept. **Strike "Phase one was done. All sessions staged" in place.**

---

## §2 — PARTIAL / corrections
1. Not swept — §2 rows are annotations, not strikes.

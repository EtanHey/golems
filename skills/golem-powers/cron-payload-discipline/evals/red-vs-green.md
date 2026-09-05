# cron-payload-discipline — Historical RED vs GREEN

## Publication status

HISTORICAL NON-COMPARABLE. The original synthetic scores and delta are
withdrawn because the effective runtime model and effort were not observed.
Original values remain available in git history.

## Method

The historical audit compared static responses without and with the skill. It
confirmed a qualitative failure shape in the no-skill arm:

- hardcoded state strings were accepted as current truth;
- prompt prose was treated as evidence;
- live queries appeared too late in payloads;
- missing frame metadata concealed stale ticks.

The skill added explicit rejection of hardcoded state, live-query-first behavior,
frame metadata, and rewrite requirements. A publishable performance claim
requires a provenance-complete rerun.

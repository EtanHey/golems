# `/weave` — eval design

> The weave is expensive (a multi-agent deep-mining fan-out). It earns its cost
> only if its findings convert to changes. This file defines how we prove that —
> the same `with_skill` vs `without_skill`, delta, 3-iteration discipline as the
> rest of `/skill-creator`, applied to the only metric that matters here.

## The metric under test

**Conversion-to-change** is reported with TWO denominators (both, always):

- **Strict (spec §4, the headline that governs SHIP/RETIRE) = converged ÷ TOTAL
  findings.** This is the original anti-waste metric ("0% conversion is
  token-waste, full stop") — `KEEP` confirmations stay in the denominator so the
  ratio can't be flattered by reclassifying findings as not-actionable.
- **Refined = converged ÷ actionable**, where actionable = converged + open
  (`DEEP-RESEARCH`,`FOLLOW-UP`) + dropped (`REJECTED`,`PARKED`,`DUPLICATE`);
  `KEEP` excluded (you can't "convert" a validated what-worked). Informative, but
  the strict number is the gate.
- **Converged** (numerator): `MERGED-PR`, `PR-FILED`, `PR-FIX`, `SKILL-NEW`,
  `SKILL-EDIT`. (`PR-FILED` = PR open, not yet merged; `FOLLOW-UP-FILED` = alias
  of `FOLLOW-UP`.)
- **Secondary:** token cost per acted-on finding = total weave tokens ÷ converged.
  This is the number that says whether a given weave was worth running.
- **Secondary:** corrections per 100 user messages, per model and bucket, emitted by
  `scripts/corrections-rate.py`. It measures model/harness behavior on the operator's
  real session corpus. It is **not** a SHIP/RETIRE gate for the weave skill itself.

`scripts/weave-ledger.py` computes the conversion-to-change and token-cost measures and flags
any finding routed to a disposition outside the vocabulary, or DROPPED without a reason.
`scripts/corrections-rate.py` computes the separate corrections-rate measurement.

## RED baseline — backtest the 2026-05-17 weave

The 2026-05-17 web-weave produced 6 citation-backed deep-research artifacts at
`$SKILL_CREATOR_ROOT/docs.local/handoffs/2026-05-17/web-weave/` (`gen-eval-safety.md`,
`launchd-python-plist.md`, `mcp-orphan-reaping.md`, `rrf-k-tuning.md`,
`sqlite-wal-busy.md`, `theo-video-mystery.md`). **That path is gitignored and
decaying** — to make the RED baseline reproducible, copy those 6 into the skill's
committed `evals/fixtures/baseline-2026-05-17/` before relying on the backtest.

**The backtest question:** of those 6, how many produced a merged PR or a real
skill change? (e.g. did `sqlite-wal-busy.md`'s ingestion-guard recs land? did
`rrf-k-tuning.md`'s k-sweep get run?) That ratio is the **RED baseline** — the
conversion rate when there was no weave *skill*, just an ad-hoc fan-out.

**Caveat (label it in the result):** the 2026-05-17 instance wove *web research*;
this skill mines *sessions*. Same methodology (iterative fan-out + synthesis),
different input. So the backtest is a valid baseline for "do weave findings
convert to merged changes?" but does NOT prove transfer of *quality* between
input types. State that explicitly.

## GREEN — does the weave-skill beat the baseline?

Run the weave through this skill (gate → mine → ledger → route) and measure the
conversion rate on the next sprint. **Gate:** the weave is only worth its tokens
if conversion-to-change clears the RED baseline by a real delta. A weave that
mines 50 sessions and converts 0 findings is token-waste the ledger now exposes.

| Condition | Action |
|-----------|--------|
| Conversion ≈ baseline | Weave isn't adding leverage — fix routing or retire the run cadence |
| Conversion > baseline + real delta | Weave earns its keep — keep the daily snowball |
| 0% conversion | Stop. The fan-out is diligence theater until findings get acted on |

## Topology eval — flat-N vs staged

Three arms (mirrors `with_skill`/`without_skill`/delta):
- **baseline:** no weave.
- **flat-N:** all miners at once, dedup only in aggregation.
- **staged (5→2→5):** later rounds read earlier findings.

Compare on **conversion-to-change per token**. Hypothesis: staged wins because
round-2 miners refine raw hits into actionable recs. Max 3 iterations before
flagging for human review (repo rule). See `references/topology.md`.

## SMOKE — static + live

**Static (every run)** — committed fixtures live in `evals/fixtures/`:
```bash
# automated regression coverage for the corrections-rate fixture contract
python3 -m unittest scripts/__tests__/test_corrections_rate.py

# clean fixture: every finding routed to a known disposition, drops have reasons
python3 scripts/weave-ledger.py --findings-dir evals/fixtures/findings-clean --strict
echo "expect 0 -> $?"
# violation fixture: an unknown disposition + a DROPPED finding with no reason
python3 scripts/weave-ledger.py --findings-dir evals/fixtures/findings-violations --strict
echo "expect 2 -> $?"

# corrections-rate fixture: stdout must reproduce expected.json byte-for-byte
diff -u evals/fixtures/corrections-rate/expected.json \
  <(python3 scripts/corrections-rate.py \
    evals/fixtures/corrections-rate/sample.jsonl \
    --denominators evals/fixtures/corrections-rate/denominators.json)
echo "expect 0 -> $?"

# unknown correction buckets are vocabulary violations (expect exit 2)
python3 scripts/corrections-rate.py \
  evals/fixtures/corrections-rate/unknown-bucket.jsonl \
  --denominators evals/fixtures/corrections-rate/denominators.json
echo "expect 2 -> $?"

# a corrected model may not disappear merely because its denominator is missing
python3 scripts/corrections-rate.py \
  evals/fixtures/corrections-rate/missing-denominator.jsonl \
  --denominators evals/fixtures/corrections-rate/missing-denominators.json
echo "expect 2 -> $?"

# zero user messages cannot produce a rate
python3 scripts/corrections-rate.py \
  evals/fixtures/corrections-rate/missing-denominator.jsonl \
  --denominators evals/fixtures/corrections-rate/zero-denominators.json
echo "expect 2 -> $?"
```
A green `--strict` run on the clean fixture (and a `2` on the violation fixture)
is the structural proof that "every finding reached a tracked disposition, every
drop states why" — the core claim of the skill.

The corrections-rate fixture proves the secondary measurement is deterministic,
retains zero-count buckets, labels the 40-message model `low-confidence`, and
fails closed on out-of-vocabulary buckets. The rate is recorded for comparison;
it does not replace conversion-to-change as the weave's gate.

**Live (flagship):** run a real weave over a 24h corpus, then read the
`ACTION-LEDGER.md` and confirm: (a) centerpieces were mined first, (b) high-imp
findings have dispositions, (c) the gen-10 large-plan tracks are populated from
real findings (not invented), (d) conversion-to-change is reported, not hidden.

## What "good" looks like

- Every finding has a disposition; every drop has a reason (0 violations).
- **The red-team fact-check (SKILL §4b) ran on the synthesis** — every load-bearing
  fact (anchored on what the operator said + fixed) was verified against the raw
  JSONLs; corrections are folded into the ledger; no unverified fact reached the
  plan or `brain_store`.
- The ledger's conversion-to-change is reported up front, even when it's bad.
- The terminal artifact is the **gen-10 large-plan** (tracks populated by mined
  findings) + the **self-QA-before-handoff gate**, not a pile of nice docs.
- The next day's weave starts from this run's retro
  (`$ORCHESTRATOR_ROOT/weave-records/retros/<date>.md` — retros + registry
  contain operator comms, they live in the private records repo) — the
  snowball compounds, or the skill failed its own thesis.

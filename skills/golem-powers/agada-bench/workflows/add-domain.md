# Workflow: add a new domain

> How to extend `/agada-bench` beyond the four validated domains (TechGym / Freelance / Recruiting / Architecture). Use BEFORE running full-sweep on a session for an unseen domain.

---

## When to use

- The session is from a domain not in `references/prior-runs.md`'s validated set.
- Tonight's runs were all about Etan-flavored content (lectures, freelance, recruiting). If you're benching e.g. a music-production session or a Hebrew-only session, run this first.

## When NOT to use

- The domain matches one of the four validated. Just run `workflows/full-sweep.md`.
- You're not changing the rubric — adding a domain doesn't always require a rubric edit, just provenance entry.

---

## Step 1 — Run a 5-row dry-run

Extract a tiny corpus (≤ 10 brain_search calls) from the new domain session and dispatch ONE judge (claudeJudge) only. Inspect the output:

```bash
python scripts/extract-corpus.py \
  --session <new-domain-session.jsonl> \
  --output /tmp/agada-dry-run-<domain>/phase-0b-corpus/ \
  --limit 10

python scripts/dispatch-judges.py \
  --corpus /tmp/agada-dry-run-<domain>/phase-0b-corpus/corpus.jsonl \
  --rubric $HOME/.golems/skills/golem-powers/agada-bench/references/grading-rubric.md \
  --judges claude \
  --output-dir /tmp/agada-dry-run-<domain>/phase-1-judgments/
```

Inspect `phase-1-judgments/claude.jsonl`. Look for:

| Signal | Interpretation |
|---|---|
| `cant-tell` rate > 30% | Rubric's examples don't cover this domain. Add domain-specific examples to `references/grading-rubric.md` §5 BEFORE running full panel. |
| Hebrew/RTL content unhandled | Verify §6 Anti-Pattern #3 covers this run's language mix. |
| FM tags entirely empty across all rows | Either the corpus is unusually clean (good!) OR the rubric's FM catalog doesn't map to this domain's failure modes. Inspect chunks manually. |
| Average confidence < 60 | Judge is uncertain. Likely rubric mismatch. STOP and iterate rubric. |

If all four signals are absent → proceed to Step 2. If any are present → iterate the rubric/FM catalog with a domain-specific example added; document the addition in `references/grading-rubric.md`'s version footer.

---

## Step 2 — Add a domain entry to prior-runs.md

Open `references/prior-runs.md` and add:

```markdown
### <domain>

- First validated: <date>
- Session source: <path to session JSONL>
- Corpus size: <N rows>
- Notable FMs: <list>
- Rubric version used: v1.1 (or v1.1.<patch> if you iterated)
- Output dir: <output dir>
- Verdict: <GOLD_LOCKED / IN_PROGRESS>
```

This is provenance for future replay. Don't skip it.

---

## Step 3 — Run the full sweep

```bash
bash scripts/run-agada.sh \
  --session <new-domain-session.jsonl> \
  --domain <new-domain> \
  --output $ORCHESTRATOR_ROOT/docs.local/plans/2026-MM-DD-agada-<runlabel>-<domain>/
```

Same as `workflows/full-sweep.md`. The only thing the new-domain check adds is the upstream rubric-fit validation.

---

## Step 4 — Post-run review

After the run completes, compare:

| Metric | Validated domain baseline (avg of TechGym/Freelance/Recruiting/Architecture) | New domain |
|---|---|---|
| Unanimous-3 rate | 56–66% | ? |
| Pending-RT density | 1–9% | ? |
| FM12 rate | 0% | ? |
| κ̄ | ≈ 0.50 | ? |

If new-domain metrics are wildly off from baseline → the rubric needs a domain-specific addendum. File this as a v2 candidate in `references/roadmap-v2.md` (the per-domain calibration W1.3 deferred bucket is the right home).

If new-domain metrics are within ~10% of baseline → the rubric generalizes. Mark the domain as validated in `references/prior-runs.md`.

---

## What NOT to do

- **Do NOT edit the canonical rubric** at `references/grading-rubric.md` without bumping the version string. The rubric version is part of every gold-locked corpus's provenance.
- **Do NOT skip the dry-run.** Running the full 3-judge panel on an unvalidated domain and getting back garbage costs ~$X in API calls; a 10-row claude-only dry-run costs ~$0.10.
- **Do NOT promote a new domain to "validated" after one run.** Run twice on different sessions in the same domain. Compare. Only then mark validated.

---

## Composability

This workflow is referenced by:
- `SKILL.md` ("When NOT to use" — pointer back here when a new domain shows up).
- `references/prior-runs.md` (procedure for adding entries).

---

## Provenance

- Design: `$ORCHESTRATOR_ROOT/docs.local/designs/2026-05-16-agada-bench-as-skill.md` §"Stays per-run" row "domain label".
- The four validated domains come from `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/` (Run 1–4).

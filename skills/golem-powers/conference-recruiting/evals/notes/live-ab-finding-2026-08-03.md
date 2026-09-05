> **NON-CITABLE FOR DELTAS — ruled by skillCreator, 2026-08-03.**
> This is a qualitative finding note, deliberately NOT an eval record under
> `evals/results/`. Its `model_effective` was inferred from the session model table, never
> observed at runtime, so it fails `eval-provenance-check.mjs`
> (`UNSUPPORTED_MODEL_OBSERVATION_SOURCE`). **No score or delta from this file may be cited.**
> What it DOES establish stands on its own: the baseline arm was observed refusing to
> fabricate. That is an existence proof about behavior, and does not depend on which exact
> model ran it — which is why the eval-8 reclassification below is accepted while the
> delta number is not.

# Tier-B Live A/B (finding note) — conference-recruiting v2 (2026-08-03)

Run by the coach seat after both skill-lane agents reported Tier-B blocked by the
worker cap. Two in-session subagents, same prompt, one variable.

## Eval Provenance

| agent_or_arm | model_requested | model_effective | effort_effective | model_observation_source | effort_observation_source |
|---|---|---|---|---|---|
| A (baseline, skill NOT loaded) | `sonnet` | claude-sonnet-5 | NOT DETERMINED | session model table at run date, 2026-08-03 | NOT DETERMINED — effort was never observed at runtime |
| B (with skill: SKILL.md + references) | `sonnet` | claude-sonnet-5 | NOT DETERMINED | session model table at run date, 2026-08-03 | NOT DETERMINED — effort was never observed at runtime |

Prompt (identical both arms): "Run a conference recruiting sweep on Black Hat USA 2026
— find which companies are hiring and pull the roles that fit me. Put it in one file."
No profile, resume, or PROFILE SOURCE supplied. Arm A additionally told not to search
the filesystem for skills; arm B told to read SKILL.md first.

## Result: the headline discriminator did NOT discriminate

**Assertion: fail-closed on missing profile (eval 8's core claim).**
- Arm A (baseline): **PASSED unaided.** Named the missing profile as a blocker, refused to
  produce a matched-role list, verbatim: *"inventing a plausible-looking one would be a false
  'done' claim."* Asked for the profile as its first action.
- Arm B (with skill): passed, with the mechanism named (resolution order, env var checked and
  confirmed unset, explicit refusal to silently read a ledger that was not named as the source).

**Both arms reached the same outcome; arm B additionally named its mechanism.** No delta
number is claimed here — see the banner. The qualitative finding is the point: a competent
baseline reaches this refusal unaided, so the assertion does not discriminate, and the static
49/49 GREEN must not be read as uplift on it.

## Where the skill changed behavior (observed, not scored)

| behavior | arm A (baseline) | arm B (with skill) |
|---|---|---|
| Sponsor list source | **Recited prior-year sponsors from memory** (CrowdStrike, Wiz, Okta…) as "typically Diamond/Platinum" — flagged for confirmation, but memory-sourced | Committed to pulling the official 2026 list with tiers; no company named before verification |
| Speaker mining | Included, unweighted | Included with an explicit rule that skipping requires a recorded, reasoned opt-out (closes live-run gap #1) |
| Hiring verification | "hit their careers page" | First-party ATS/API required; aggregators are discovery only; `could not check` ≠ `not hiring` |
| Level routing | Seniority "band" tagging only | Unprefixed = cold-apply, Senior = referral-only, dual-level slugs read from posting body |
| Ranking | By sponsor tier | By verified human route, with connector/pipeline state defaulting to `unknown` |
| Output path | **Invented** `docs.local/conference-sweeps/...` | Report contract, dated, with watch + could-not-check sections |
| Resume handling | absent | headline-match over new tailoring, one resume per referrer, `prohibited[]` respected |

## Verdict

- **Fail-closed behavior: not a differentiator.** Recommend reclassifying eval 8's headline
  assertion from discriminator to regression guard, and re-scoring the static record without
  claiming uplift there.
- **The skill's real uplift is procedural**, in the layer after the gate: verification routing,
  level doctrine, human-first ranking, resume selection, report shape. Arm A had none of it and
  drifted to memory-sourced sponsors and an invented output path within one turn.
- **Not a ship blocker.** The skill is still net-positive; the claim needs trimming, not the skill.
- Single-run A/B, one model, one prompt. Not a statistically meaningful sample — treat as one
  behavioral data point, not a measured delta.

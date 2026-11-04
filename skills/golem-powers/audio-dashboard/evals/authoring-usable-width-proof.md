# Authoring and usable-width proof

Status: source regression passes; instruction experiment remains ITERATE.
No production, publication, native-device or audio-quality acceptance is claimed.

## Real renderer regression

The canonical renderer uses 309px of prose at a 375px usable viewport, matching
390px minus a classic 15px scrollbar. This is a usable-width proxy, not a served iframe test.
No styles, font sizes, line caps, clipping rules or scrollbar settings changed.

Synthetic copy: “The saved report shows which checks passed and which ones still need attention.”
Short control: “Read the saved report.”

| Copy | 375px lines | 390px lines | 1280px lines | Old guard | New guard |
|---|---:|---:|---:|---|---|
| Synthetic boundary | 3 | 2 | 1 | PASS (missed 375px) | REJECTED |
| Short control | 1 | 1 | 1 | PASS | PASS |

The regression test failed at base `3c035fb4ee5b1dd4c993ab31558982d0d3408165`
with expected REJECTED / received PASS. After the guard change the focused suite
passed 8 tests, 0 failures, 72 assertions. Full `bun run test:spine-gates` passed
1141 tests, skipped 2 historical private controls, failed 0 (1143 tests / 52 files).
Owned muted Chromium contexts blocked network requests and closed after measurement.

Reproduce: `bun install`, then
`bun test skills/golem-powers/audio-dashboard/evals/decision-flow-visual-prose.test.mjs`.

## Bounded instruction experiment

One composite containing three authoring cases, n=1 per arm. Actual skill-free
baseline versus this branch's explicit skill source; empty tool allowlists;
SC-1 API-key cells. Haiku 5.5/high smoke, Sonnet 5.5/high arms,
Opus 5.5/high pinned semantic judge with verified hashes and verbatim quotes.
Prior supplied facts, expected outputs, weights and hostile controls were preserved;
layout acceptance was strengthened to require 375/390/1280 for every authored card.

| Assertion | Weight | Without skill | With skill |
|---|---:|---|---|
| C1 grounded facts | 25 | FAIL | PASS |
| C2 source retention | 25 | FAIL | PASS |
| C3 native answer contract | 20 | FAIL | PASS |
| S1 real render and layout | 20 | FAIL | PASS |
| Q1 bounded panels and attribution | 10 | FAIL | PASS |
| Weighted score | 100 | 0% | 100% |

The baseline returned a tool-shaped string instead of JSON; no tool executed.
Candidate prose measured 2/2/2 lines at 375 and 390, 1/1/1 at 1280.
Deleting sources and falsifying discovery attribution both fail their controls.
The intended unchanged-choice control fails in the baseline and passes in the
candidate, so experiment acceptance is **ITERATE**, despite candidate assertion
acceptance. No broad SHIP claim or significance inference follows from this n=1.
Previous 25%/55% results remain historical evidence, not overwritten by this run.

Exactly one smoke, one pair and three judgments; no transport retries or extra
paid passes. New recorded list cost $0.19235865. Additional budget accounting
including $0.20 reserve is $0.39235865; cumulative accounting is $1.75282340,
below $2.86046475. Original unknown-attempt reserves remain in that cumulative total.
Private prompts, outputs and dashboard imagery are excluded from this proof.

## Byte pins

- Branch skill SHA256: `f8c925bc38c8b294cc2b10ce9266f136f3c781e7ac6d0cf1fc7f38c74fbc48df`
- Guard SHA256: `c0efaf07ff8b42715f09c131c35b3221ddd5fe56af407f022f0758895af6746e`
- Regression SHA256: `631bd520acd93ea38cdcc8012e6703e91503c60bade21aacd127b22439b5f35e`
- Prompt SHA256: `ffda9d3801f750e2405dc4afb74bda188fe2a03e1dca975b05cba40b8bade5eb`
- Spec SHA256: `494031cf8b6bab5957872d58d89070e95523625395b5fdfde3b4c642d214a5fa`
- Final score SHA256: `f0c2040f5701b44bf3174493e4ed6c5bc53314ece5436c2cf80ba7ac1d35d0d0`

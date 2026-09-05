---
name: install-runbook-linter
description: "Lint a macOS onboarding runbook for privilege-correctness. Triggers: install runbook, fresh-Mac onboarding, brew cask runbook, admin/Standard user split, happy-camper onboarding."
---

# Install-Runbook Linter

A macOS onboarding runbook is **false-green** when it reads fine to a human but assigns
admin-only steps to a Standard (non-admin) user — the gen16 audit failed exactly here (a
Standard user couldn't `brew install`). This skill turns that audit into a **mechanical,
replayable gate**: `runbook_lint.py` parses a runbook and reports privilege-correctness
violations, with RED→GREEN fixtures (`fixtures/`, `tests/`).

## Scope

The lint runs before the runbook ships.

## Run it

```bash
python3 lint_cli.py path/to/onboarding-RUNBOOK.md   # exit 1 if any violation
python3 -m pytest tests/                            # the RED→GREEN gate
```

## Rules

| Rule | What it catches |
|------|-----------------|
| `privileged-in-standard-phase` | A privileged command (`brew tap`/`trust`/`install`, `--cask`, `sudo`, `npm install -g`) inside a **Standard-tagged** phase. Scans **only fenced code blocks**, so prose prohibitions ("happy-camper must not run `brew install`") and comments never false-fire. `npm install -g` is exempt when the runbook establishes a **per-user npm prefix** (then it writes to user space). |
| `cask-before-prereqs` | A `brew install --cask` with no Prerequisites / Phase-0 preflight section earlier in the document. |
| `receipt-not-bundle-verify` | End-state verification that trusts the cask **receipt** (`brew list --cask`) but never checks the **on-disk bundle** (`/Applications/…app`, `--version`, a bundle `ls`). A receipt is false-green; the on-disk bundle is the truth. |
| `inconsistent-identifier-spelling` | Load-bearing identifiers spelled in near-duplicate forms, such as `happy-camper` vs `happy-campep` or `VoiceBar` vs `Voicebar`. Scans prose and code, but only treats code/code-span identifiers and CamelCase names as load-bearing so heading prose does not false-fire. |
| `prereq-incompleteness` | Developer tools used in fenced code (`bun`, `brew`, `rustup`, `node`, `git`, etc.) but not named in a Prerequisites / preflight section. |

## Phase classification

Phases are split on `## …` headers and tagged `admin` / `standard` / `neutral`
from role cues (`admin`, `machine-wide` vs `Standard`, `happy-camper`, `user space`,
`without admin`). A header naming the Standard user wins (it's the privilege-sensitive one).

## Validated against the real artifact

The linter was replayed against the gen17 happy-camper onboarding runbook. The Happy
Campr company/launcher name is intentionally distinct from the `happy-camper` account,
while genuine account typos still trip `fixtures/red-runbook.md`. That delta is the gate:
RED on the bad fixture, no noisy findings on the known good patterns, and concrete line
numbers for real drift.

## Why a linter, not prose

Per the gen-18 doctrine (build the gate, not the prose): a runbook reviewed by eye drifts;
a runbook gated by `lint_cli.py` in CI cannot ship a Standard-user `brew install` or a
receipt-only "verification" again.

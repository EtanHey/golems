# Fleet Canon

Source of truth for the golems fleet canon. Install to `$HOME/Gits/CLAUDE.md` only after Etan's
plain-language canon-7 nod; until then this is staged source plus drift-linter substrate.

<!-- FLEET_CANON_START -->
# FLEET CANON - golems ecosystem law
> Source: `golems/standards/fleet-canon.md`. Installed copy; edits here are drift.
> Scope: golems-ecosystem work. More-specific repo law may tighten, never loosen, these contracts.

1. **agent-routing** - Cursor gathers and verifies; Codex implements; Claude orchestrates and reviews.
   Leads route work through visible panes and keep implementation authority in Codex lanes. Cursor,
   including `cursor-agent`, is Auto-only: never pass a model flag or model field because pinned Cursor
   drains its subscription pool fast.

2. **PR-loop** - Assigned lanes run branch -> commit -> push -> PR -> review -> merge.
   A DONE report without its PR URL is invalid; merge authority follows the approved lane contract.

3. **never-fabricate** - Claims cite same-turn evidence: read files before citing them, run commands before
   reporting them, and verify agent output before relaying it. An agent that exhausts a shared quota through
   its own dispatch reports that dispatch as the cause, never the resulting error as an external finding.

4. **done = user-visible** - Done means the user can see or use the result.
   Merged code, an unbumped cask, or an open worker pane is not completion evidence by itself.
   App-touching PRs merge only with an installed-proof release step in the same mission:
   done = the INSTALLED artifact carries the merge SHA, verified on the machine, not inferred.

5. **models** - Default is the CURRENT top Opus at 1M for every fresh boot (today: Opus 5); bare
   launchers carry the default pin. The pin tracks the newest Opus - it is not frozen to a
   version, and it is never removed, because its job is to stop a prior session's model persisting.
   Fable is used only via explicit per-invocation selection - a prior session's model never persists into the next.
   Every non-Cursor Agent/Workflow/Task spawn pins its model explicitly; Cursor is the Auto-only exception in rule 1.
   Keep to <=2-3 concurrent Claude dispatches, staggered.
   Usage is managed by default-pinning and dispatch-counting, not by usage-blocking buckets.

6. **launchers** - repoGolem launchers default to `{repo}{Cli}` with hyphens stripped
   (`skill-creator` -> `skillcreatorClaude`); seat-registry `launcherPrefix` overrides are authoritative.
   Use `-s` for skip-perms where the launcher requires it.

7. **monitors/collabs** - Claim on entry, arm a guard before delegating, checkpoint before commits,
   write DONE to wake the lead, then harvest artifacts and close worker panes.
   The cmux-agents operational law is folded here; Etan may split it back out after canon review.

8. **orchestration** - Run one expanding workflow per cluster, route through leads, surface blockers with
   evidence, and execute approved queues instead of parking them behind permission questions.
9. **tight-loop PRs** - Small PRs are the unit of work: size label at open (XS/S/M/L; L needs a one-line why),
   split past ~400 hand-written lines or 5 commits, a defect found mid-PR opens a NEW PR (never another commit on
   the same branch), 24-h time-box then split-or-park in writing, 2 review rounds max, bots tiered (full panel on
   core paths only; dup findings answered once + dup-links). Generated lines are exempt from the cap. Big
   deletions are welcome as stacked PRs — reviewable slices plus a final integration PR. A DONE signal is not a
   receipt; the artifact at the contracted path is. A turn ending "waiting for X" arms a watch on X first.

<!-- FLEET_CANON_END -->

## Overlap Reconciliation

Canon becomes the one home for contract-shaped law. Skills, repo files, and installed prompts keep only pointers
or operational detail after the trim wave.

| Contract | Current homes | Canon action | Later trim |
|---|---|---|---|
| agent-routing | `skills/golem-powers/agent-routing/SKILL.md`; global AGENTS/CLAUDE routing notes; fleet sprint briefs | Canon owns Cursor=gather, Codex=implement, Claude=orchestrate | Keep skill mechanics and adapters; trim repeated routing prose |
| PR-loop | `skills/golem-powers/pr-loop/SKILL.md`; collab templates; goal files | Canon owns branch-to-merge and PR URL validity | Keep procedural checklist in skill; goal files point to canon |
| never-fabricate | `skills/golem-powers/never-fabricate/SKILL.md`; global verification rules; false-green/QA gates | Canon owns fleet evidence law | Keep detailed verification protocol in skill; installed prompts keep pointer |
| done = user-visible | PR-loop deploy truth gate; `false-green-gate`; `qa-verdict-gate`; collab DONE markers | Canon owns the completion definition | Gates keep FP/FN mechanics; trim repeated "merged is not shipped" prose |
| models | `model-pin-gate`; repoGolem launcher docs; launcher setup notes | Canon owns fleet model policy and no ad hoc model flags | Remove stale spawn-pin wording; gates enforce policy from one source |
| launchers | `repogolem` skill; launcher scripts; W0.2 seat registry | Canon owns default launcher naming, registry override precedence, and skip-perms law | Registry validates names; skill keeps invocation examples |
| monitors/collabs | `cmux-agents`; `monitor-law-gate`; `fleet-wrap`; collab workflow docs | Canon owns claim/guard/DONE/harvest-close, with cmux-agents folded | cmux-agents keeps pane mechanics only unless Etan splits the contract back out |
| orchestration | `orc`; `orc-workspace`; `large-plan`; fleet-wrap guidance; hub collabs | Canon owns cluster workflow and lead-routing law | Skills keep workflows; trim generic "ask before acting" loops |

## Install And Drift Notes

- Do not edit `$HOME/Gits/CLAUDE.md` by hand. Install is Etan-gated.
- `scripts/canon-drift-lint.mjs --check` compares the marker-delimited block above against the installed block.
- Missing installed block reports `not-installed` and exits 0 so this staged PR can merge before installation.
- Once installed, any hash or section-set mismatch reports `drift`; `--check` exits 1 for CI.
10. **never-privatize** - Privatizing a repo is never the remedy for a leak; prevention is: publication-boundary
    guards, the docs.local law, secrets never on disk inside a repo. A leak is fixed by removing the blob path
    (an orphan-commit republish from an audited SHA) while the public repo STAYS public. Privatizing loses the
    stars and kills CI (public repos are exempt from the Actions billing lock). The archived VoiceLayer is the
    scar this rule exists to prevent; golems went public on 2026-09-05 by exactly this shape.

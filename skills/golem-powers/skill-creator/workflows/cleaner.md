# Skill Library Cleaner — skill-creator workflow

> **When this fires:** sprint-level library hygiene check, post-merge audit of the golem-powers tree, OR when any of the 9 detection rules trip on `skill-creator/scripts/cleaner-*.sh`. NOT per-PR.

> **Why this exists:** the 2026-05-28 skill-recon (5 reports) surfaced 14 dedup candidates, 11 description bloat tail entries, 10 dead/deprecated skills, 6 orphan registrations (incl. SHIP-2 + SHIP-4), 60% of skills missing ##Composition sections, and 1 active SoT violation (SHIP-1 deployed symlink → worktree, not main). Without a structural cleaner, the library accumulates drift faster than ad-hoc sweeps can fix it.

> **Why a workflow of skill-creator (not a standalone skill):** per Etan-direct 2026-05-28, packaging this as `/skill-cleaner` would add another top-level entry to the boot context — exactly the bloat the cleaner is supposed to fix. Lives under `skill-creator/workflows/` so it loads only when `/skill-creator` is invoked (Tier-2 progressive disclosure).

---

## 9 Detection Rules

Run via `$HOME/.golems/skills/golem-powers/skill-creator/scripts/cleaner-<rule>.sh`. Each script prints flagged skills to stdout with severity. Compose results into a single report at `docs.local/skill-cleaner/<YYYY-MM-DD>-scan.md`.

### Rule 1 — Duplicate / trigger overlap
**Script:** `cleaner-detect-dupes.sh`
**Detects:** two or more skills whose trigger keyword sets overlap by ≥50% (after lowercasing + tokenizing the `description:` Triggers section).
**Severity:** WARN (some overlap is intentional — flag for human review).
**Known dupes** (per recon-01): retired CLI-agent launcher skill ↔ cmux-agents, retired structural-authoring skill ↔ skill-creator, claude-web-research ↔ claude-desktop-research (already deprecated), retired review-router ↔ coderabbit, golem-install ↔ wizard, linkedin-post ↔ maintenance/workflows/linkedin.

### Rule 2 — Description bloat (>700 chars hard cap)
**Script:** `cleaner-detect-bloat.sh --descriptions`
**Detects:** `description:` strings >700 chars (Codex silently truncates at ~1024 — 700 is the safety margin).
**Severity:** BLOCKER at >700; WARN at >500.
**Known offenders** (per recon-02): skill-creator (934ch), gemini-research (881ch), agada-bench (816ch), convex (808ch), worktrees (759ch), large-plan (756ch), retired structural-authoring skill (733ch), 1password (719ch), retired CLI-agent launcher skill (716ch), github (701ch), skills (692ch).
**Fix:** Steinberger-style rewrite (Action + object + tool, drop grammar, lead with keywords). Target ≤250ch.

### Rule 3 — Body + extras bloat (>5K tokens target)
**Script:** `cleaner-detect-bloat.sh --bodies`
**Detects:** SKILL.md body + workflow/adapter/reference subtree total token estimate (chars/4) >5K tokens.
**Severity:** WARN (body loads only on invocation, but bloat compounds).
**Known offenders** (per recon-02): agada-bench (~27K extras), skill-creator (~14K extras), maintenance (~12K), coach (~12K), large-plan (~10K), cmux-agents (~10K), 1password (~7K), golem-install (~7K), claude-desktop-research (~7K), convex (~7K).
**Fix:** split workflows into smaller workflow files OR trim duplicative content; promote rarely-loaded references to a separate skill.

### Rule 4 — Dead skill (zero invocations)
**Script:** `cleaner-detect-dead.sh`
**Detects:** skills with 0 explicit `/<skill>` slash invocations across the 50 most-recent `~/.claude/projects/**/*.jsonl` files AND no BrainLayer mention in the last 30 days.
**Severity:** WARN (don't auto-archive — some skills auto-trigger from description match, false-negative).
**Known dead candidates** (per recon-03 after false-negative filtering): interview-practice, video-showcase, stitch-design, plan-validate, figma-loop, test-plan, git-guardian, review-router, github-research, linkedin-post (duplicate of `_archive/`).
**URGENT time-sensitive:** claude-web-research alias retires 2026-05-30. Delete by then.

### Rule 5 — Description-body drift (CRITICAL on load-bearing skills)
**Script:** `cleaner-detect-drift.sh`
**Detects:** frontmatter `description:` mentions another skill by name (e.g., "Runs CodeRabbit first") but the body has zero `/coderabbit` references.
**Severity:** BLOCKER on load-bearing skills (`/pr-loop`, `/never-fabricate`, `/coderabbit`, `/skill-creator`); WARN elsewhere.
**Known drift** (per recon-05): the old commit skill drifted by leaking `cr review --plain` directly; this is now covered by `/pr-loop` step 5.
**Fix:** add `## Composition` section to the body that explicitly hands off to the named skill.

### Rule 6 — Missing ##Composition section
**Script:** `cleaner-detect-composition.sh`
**Detects:** SKILL.md root has no `^## (Composition|Integration|Cross-link|Related|See Also)` section AND the skill writes/spawns/reports (heuristic: description contains write|spawn|commit|deploy|report|audit).
**Severity:** WARN (60% of skills lack this per recon-05; some pure-reference skills legitimately don't need one).
**Known offenders** (per recon-05 Class B): commit, coderabbit, retired structural-authoring skill, qa-video, nightly-journal, wispr-mining, linkedin-post, obsidian, interview-practice, presentation-builder, convex, railway, github, test-plan, plan-validate, ecosystem-health, voice-sessions, coach.
**Fix:** add a `## Composition` section near the end with 3-5 bullet links to upstream/downstream skills.

### Rule 7 — Trigger-coverage gaps (false negatives)
**Script:** `cleaner-detect-coverage-gaps.sh`
**Detects:** recurring bash patterns in recent JSONLs (>20 invocations across last 10 sessions) where no skill description's Triggers list matches the pattern's keyword head.
**Severity:** INFO (suggests a new workflow/skill or trigger-phrasing expansion).
**Known gaps** (per recon-04): PR-watch (~150 bash calls/session polling `gh pr view --json state,mergeable,reviewDecision`), bl-status one-liner (~60 calls/session), tick logger (`printf '[%s] [tick]'`), `pgrep -fl BrainBarDaemon`, telegram-send, mcp-reaper.
**Fix:** add workflows to existing skills (e.g., `pr-loop/workflows/watch.md`) OR write new compact skills (~250ch description).

### Rule 8 — Orphan registration
**Script:** `cleaner-detect-orphan-symlinks.sh`
**Detects:** any `$HOME/.golems/skills/golem-powers/<skill>/SKILL.md` that has NO corresponding symlink at `~/.claude/skills/<skill>`.
**Severity:** BLOCKER (the skill is invisible to the harness — cannot trigger).
**Known orphans** (per recon-04 Section F, after the loop consolidation): cron-payload-discipline, architectural-conformance-audit, brain-store-fallback, deploy-verify. Retired loop-monitor guidance now lives inside cron-payload-discipline. **This includes our own SHIP-2 (brain-store-fallback) and SHIP-4 (architectural-conformance-audit) — the most embarrassing class.**
**Fix:** symlink them into `~/.claude/skills/` via the install script. One-line fix per orphan; biggest immediate ROI in the library.

### Rule 9 — SoT (Source-of-Truth) violation
**Script:** `cleaner-detect-worktree-symlinks.sh`
**Detects:** any symlink in `~/.claude/` or `~/.codex/` (or other user-global config) whose target path contains `worktrees/` (i.e., points at a feature branch, not a merged-to-main canonical path).
**Severity:** BLOCKER (user-global config MUST point to merged-to-main paths; worktree targets are unstable and disappear on branch deletion).
**Known SoT violations** (per SHIP-1 disaster): `~/.claude/hooks/frustration-capture-prompt.py` → `~/.config/superpowers/worktrees/golems/feat-frustration-capture-hook-ship1/skills/golem-powers/frustration-capture/hooks/frustration-capture-prompt.py`. Should point to `$HOME/.golems/skills/golem-powers/frustration-capture/hooks/frustration-capture-prompt.py`.
**Fix:** `ln -sf <main-path> <user-global-path>` to repoint at the merged-to-main canonical path. Then remove the orphan worktree.
**Why this rule exists:** prevents the merge-but-not-deployed class of bug. If a fix lands on main but the deployed symlink still points at the worktree, the fix is invisible to the user. This was the SHIP-1 root cause and cost ~3 evals worth of independent confirmations.

---

## Running the Cleaner

### One-shot scan (recommended cadence: weekly + post-multi-PR sprint)

```bash
cd $HOME/.golems/skills/golem-powers/skill-creator/scripts
./cleaner-detect-orphan-symlinks.sh > /tmp/cleaner-rule8.txt
./cleaner-detect-worktree-symlinks.sh > /tmp/cleaner-rule9.txt
./cleaner-detect-bloat.sh --descriptions > /tmp/cleaner-rule2.txt
./cleaner-detect-bloat.sh --bodies > /tmp/cleaner-rule3.txt
./cleaner-detect-dupes.sh > /tmp/cleaner-rule1.txt
./cleaner-detect-drift.sh > /tmp/cleaner-rule5.txt
./cleaner-detect-composition.sh > /tmp/cleaner-rule6.txt
./cleaner-detect-dead.sh > /tmp/cleaner-rule4.txt
./cleaner-detect-coverage-gaps.sh > /tmp/cleaner-rule7.txt
```

Combine into a daily report at `$HOME/Gits/golems/docs.local/skill-cleaner/$(date +%Y-%m-%d)-scan.md`.

### Priority order for fixes

1. **Rule 8 (orphan registration)** — highest ROI; one-line symlink fixes 6 invisible skills.
2. **Rule 9 (SoT violation)** — prevents recurrence of SHIP-1 class deployment bugs.
3. **Rule 4 (dead skill, time-sensitive)** — claude-web-research alias 2026-05-30 deadline.
4. **Rule 1 (duplicates)** — collapse duplicate launcher/orchestration skills into cmux-agents and the retired structural-authoring skill → skill-creator.
5. **Rule 5 (drift)** — keep `/pr-loop` description/body alignment load-bearing.
6. **Rule 2 (description bloat)** — Steinberger-style compact rewrites on top-25.
7. **Rule 3 (body bloat)** — surgical trim on agada-bench / skill-creator / orc.
8. **Rule 6 (composition section)** — bulk-add ##Composition sections to 42 skills.
9. **Rule 7 (coverage gaps)** — add pr-loop/workflows/watch.md + bl-status one-liner.

## What this workflow does NOT do

- It does NOT auto-fix anything. Detection only. Fixes go through PRs.
- It does NOT modify SKILL.md frontmatter or bodies. That's manual editing per the proposed fix.
- It does NOT decide which dupe to keep when collapsing — that's a human judgment call.
- It does NOT touch `~/.claude/settings.json` or any user-global config files automatically (Rule 9 only DETECTS violations).

## Composition

- `/skill-creator` — this workflow lives under it; parent skill loads cleaner.md on demand.
- `/brain-store-fallback` (SHIP-2 — once registered per Rule 8) — store scan results at importance >=7 with tag `[skill-cleaner-scan, <YYYY-MM-DD>]`.
- `/never-fabricate` — every flagged-skill claim cites the script output verbatim; no synthesized findings.
- `/skill-creator` — fix-side workflows for Rule 2/3/5/6 use skill-creator templates.
- `/pr-loop` — every cleanup PR uses the standard pr-loop; auto-merge per Etan-direct on green CI + clean CodeRabbit.
- `/orc` — orc invokes this workflow during periodic ecosystem health sweeps and after multi-PR sprints.

## DONE STATE (per scan)

A scan is fully complete when:
1. ✅ All 9 detection scripts have run successfully
2. ✅ Combined report exists at `docs.local/skill-cleaner/<YYYY-MM-DD>-scan.md`
3. ✅ `brain_store` succeeded at importance >=7 with `skill-cleaner-scan` tag (or fallback file per `/brain-store-fallback`)
4. ✅ Priority order documented in the report
5. ✅ For each BLOCKER finding, a PR is either open OR a justified deferral is documented

A cleanup PR is fully complete when:
1. ✅ Specific rule violation resolved (re-run script confirms)
2. ✅ Eval evidence in PR body (before/after counts)
3. ✅ CI green + CodeRabbit clean (auto-merge per Etan-direct on non-UI markdown PRs)
4. ✅ brain_store at importance >=7 with `[skill-cleaner-fix, rule-N, <skill-name>]` tag

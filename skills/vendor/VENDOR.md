# Pinned design skills

Status: upstream bytes copied without edits; usage policy is a separate DRAFT.

| Owner | Source | Pinned commit | License |
| --- | --- | --- | --- |
| Anthropic | https://github.com/anthropics/skills | dbd4588f9e1033efb41dad4bef2f7947c8993d44 | Apache-2.0, frontend-design/LICENSE.txt |
| Emil Kowalski | https://github.com/emilkowalski/skills | 2d228630ba1446365f614a108cb8252f1feda202 | MIT, LICENSE in each skill |

Only the five named Emil skills are included. `animate` references `pick-ui-library`,
which is not installed: use existing repo dependencies and never fetch it. No selected folder has scripts.
Read all SKILL.md, recipes, references and licenses before refreshing. UI code examples
are inert at installation. External URLs (easing.dev, easings.co, author/library sites)
are references, not install-time fetches. `improve-animations` is audit mode only;
its execute mode is **never** used in the fleet. Write plans under
`docs.local/animation-plans/` and send them to the lead for routing. Use quick or
standard, with at most two authorized read-only helpers under normal routing.
Bare Emil invocations stop at a greeting; include the concrete task. `review-animations` is explicit-only in Claude.
Codex 0.164 discovery exposes enabled:true with no implicit-invocation policy;
auto-trigger suppression there is UNPROVEN. Invoke this skill explicitly in briefs.

Install: use golem-install's `repoint-skills.mjs --source <golem-powers> --vendor-skills`
(dry-run), then `--apply`. It verifies manifest hashes, copies a durable pinned payload
under ~/.golems/vendor/design-skills/, and links the providers selected in manifest.json (with per-skill overrides).
Claude keeps its official auto-updating frontend-design plugin and gets only Emil.
Codex gets all six vendored skills; Cursor gets all six for review-only use.
Gemini/agy get none. Add providers only after authorization.
Do not use ~/.agents/skills because Gemini/agy exposure is forbidden.

Refresh: `.github/workflows/design-skill-updates.yml` checks both upstreams daily
at 06:43 UTC and via manual dispatch. It copies only the six selected skill payloads
as inert data, updates manifest hashes and the VENDOR pins above, and opens a PR.
It never installs, runs upstream code, or merges. Immutable upstream-pair branches
and all-state PR lookup avoid force-pushes, duplicate proposals and reopening rejects.
Read every changed instruction/reference before merge; normal CI and independent
review apply. New scripts/types or removed files fail the copier for manual review.
Activation also needs the repository Actions setting "Allow GitHub Actions to
create and approve pull requests"; it was false at implementation time. Keep
default token permissions read, and grant write only to the proposal job.
GitHub may require approval before token-created PR workflows run:
https://docs.github.com/en/actions/concepts/security/github_token

Manual check: `node skills/golem-powers/golem-install/scripts/vendor-skills.mjs
--check-upstream` (exit 3 drift, 2 query error). Copier: `node .../refresh-vendor.mjs
<anthropic-clone> <emil-clone> <expected-sha-A> <expected-sha-E> [--apply]`;
without --apply it writes nothing. Proposed bytes are not approval to install.
Back up old installed links before switching changed payloads; conflicts require
explicit retirement. Claude's official frontend-design plugin updates independently.

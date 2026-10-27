# Pinned design skills

Status: upstream bytes copied without edits; usage policy is a separate DRAFT.

| Owner | Source | Pinned commit | License |
| --- | --- | --- | --- |
| Anthropic | https://github.com/anthropics/skills | dbd4588f9e1033efb41dad4bef2f7947c8993d44 | Apache-2.0, frontend-design/LICENSE.txt |
| Emil Kowalski | https://github.com/emilkowalski/skills | 2d228630ba1446365f614a108cb8252f1feda202 | MIT, LICENSE in each skill |

Only the five named Emil skills are included. `animate` references `pick-ui-library`,
which is not installed: do not silently fetch it. No selected folder has scripts.
Read all SKILL.md, recipes, references and licenses before refreshing. UI code examples
are inert at installation. External URLs (easing.dev, easings.co, author/library sites)
are references, not install-time fetches. `improve-animations execute` asks for a
worker; existing routing and child limits win. Bare Emil invocations stop at a greeting;
include the concrete task. `review-animations` is explicit-only in Claude; see live
Codex 0.164 discovery exposes enabled:true with no implicit-invocation policy;
auto-trigger suppression there is UNPROVEN. Invoke this skill explicitly in briefs.

Install: use golem-install's `repoint-skills.mjs --source <golem-powers> --vendor-skills`
(dry-run), then `--apply`. It verifies manifest hashes, copies a durable pinned payload
under ~/.golems/vendor/design-skills/, and links the providers selected in manifest.json (with per-skill overrides).
Claude keeps its official auto-updating frontend-design plugin and gets only Emil.
Codex gets all six vendored skills; Cursor gets all six for review-only use.
Gemini/agy get none. Add providers only after authorization.
Do not use ~/.agents/skills because Gemini/agy exposure is forbidden.

Refresh: `/whats-new` can run `bun skills/golem-powers/golem-install/scripts/vendor-skills.mjs
--check-upstream` (read-only git ls-remote; exit 3 = drift, 2 = query error).
Review new upstream instructions first, copy the selected folders and licenses, update
the SHAs and file hashes, run the fan-out tests and fresh native discovery, and use a PR.
No remote installer or automatic update is executed. Local hash drift exits nonzero.

Updater (dry-run first): after cloning and reading both new upstream skill sources,
run `bun skills/golem-powers/golem-install/scripts/refresh-vendor.mjs <anthropic-clone>
<emil-clone> <reviewed-anthropic-sha> <reviewed-emil-sha>`; add `--apply` only after
review. It checks selected source cleanliness and exact reviewed HEADs, refuses
scripts/new file types or removed files, refreshes copied bytes, hashes and VENDOR pins.
Then test and open a PR. Back up old installed links before switching changed payloads;
installer conflicts require explicit retirement, never automatic overwrites.
Claude's official frontend-design plugin updates itself independently.

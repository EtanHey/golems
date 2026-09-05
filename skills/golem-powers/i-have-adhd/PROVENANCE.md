# i-have-adhd — provenance & review

- **Source:** https://github.com/ayghri/i-have-adhd (MIT, author Ayoub Ghriss / @ayghri)
- **Reviewed commit:** `72c33eee81ea439cf01991e93729adfce2ffc99e` (2026-07-19)
- **Repo signal at review:** 2,878 stars, not a fork, active (pushed 2026-07-19).
- **Reviewed by:** skill-creator subagent (orc-driver), 2026-07-19.
- **Security verdict:** SAFE-WITH-EDITS. Instruction-only skill — no scripts, no hooks,
  no network calls, no credential/filesystem access, no obfuscation, no hidden unicode/bidi,
  logo.png is a clean 256x256 PNG with no appended payload. Full evidence in the install report.

## Edit made on install (only change vs upstream)

Upstream `SKILL.md` frontmatter `description` forced fleet-wide auto-trigger:
"Use this skill whenever responding to ANY user message ... Trigger even on casual messages
and even when the user did not explicitly ask for brevity."

That would auto-load the skill for every agent via Skill-tool description matching, silently
pre-deciding the invoke-only-vs-auto-load question. Replaced with an **invoke-only** description.
The full rule body (rules 1-10, "When to break the rules", "Pre-send check") is **verbatim** upstream.

## Not copied (upstream distribution wrappers, not part of a golem skill)

`.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/marketplace.json`, `INSTALL.md`, `logo.png`.
Note: `.agents/plugins/marketplace.json` carried `"authentication": "ON_INSTALL"` — a declarative
policy field for the upstream plugin registry, irrelevant to our copy-the-markdown install; omitted.

# Gemini gatherers (agy)

Resolve `gemini.gather.text` or `gemini.gather.visual` from the golems checkout:
`{repo}Gemini -m $(node scripts/model-roles.mjs gemini.gather.text --field launcher_tier)`
(use the visual role for frame/OCR batches). Verify bare launcher defaults against the config. Use `-m pro` or
`-m pro-high` only when explicitly requested; both select `Gemini 3.1 Pro (High)`.
The qa-video eval scored Flash-High 22/22; Pro-High skimmed (14 and 7).
Verify the effective model from agy output or session metadata after launch.

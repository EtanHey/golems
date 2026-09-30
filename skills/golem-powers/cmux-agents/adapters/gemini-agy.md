# Gemini gatherers (agy)

Resolve `gemini.gather.text` or `gemini.gather.visual` from the golems checkout:
`{repo}Gemini -m $(node scripts/model-roles.mjs gemini.gather.text --field launcher_tier)`
(use the visual role for frame/OCR batches). Verify bare launcher defaults against the config. Use `-m pro` or
`-m pro-high` only when explicitly requested; both select `Gemini 3.1 Pro (High)`.
The qa-video eval scored Flash-High 22/22; Pro-High skimmed (14 and 7).
Verify the effective model from agy output or session metadata after launch.

On launch, repoGolem replaces the project MCP map and prunes shared AGY entries
that no registry project declares, including entries created with `agy mcp add`.
It prints removed server names to stderr. To keep a shared server, define it in
`mcpDefinitions` and declare its name in the project's `mcps` registry list.
Retired bank servers are always removed.

AGY passes config env values literally. repoGolem omits credential keys and
secret references so MCP children inherit the launcher's exported environment.
HTTP credential headers are omitted too; they need a lead decision because
headers cannot inherit an environment value.

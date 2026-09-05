---
name: audit-skill
description: Audit golem-powers skill structure before deploy
---

# Audit Skill Structure

Use this workflow when creating, editing, or validating a golem-powers skill before
shipping it. It preserves the retired structural-audit coverage inside
`/skill-creator`.

## 1. Locate the Skill

Work from the repository copy first:

```bash
SKILL_PATH="skills/golem-powers/YOUR_SKILL_NAME"
ls -la "$SKILL_PATH"
```

Check:
- [ ] `SKILL.md` exists
- [ ] `evals/evals.json` exists for active skills
- [ ] `scripts/` exists when the skill has `execute:` frontmatter
- [ ] `workflows/`, `references/`, and adapters are referenced from `SKILL.md`
      when present

## 2. SKILL.md Frontmatter

```bash
head -20 "$SKILL_PATH/SKILL.md"
```

Check:
- [ ] YAML frontmatter delimiters are present
- [ ] `name:` matches the directory name
- [ ] `description:` says when to use the skill, includes triggers, and stays
      under the active Codex truncation budget
- [ ] `execute:` points to a real script, unless this is intentionally a
      documentation-only meta-skill
- [ ] `NOT for:` / anti-trigger guidance routes users to the right neighboring
      skill
- [ ] invocation mode is deliberate: either model-invoked (no
      `disable-model-invocation`) or user-invoked-only (`disable-model-invocation: true`)
- [ ] **user-invoked-only skills carry the Codex sidecar** — `openai.yaml` with
      `allow-implicit-invocation: false` in the same skill dir

```bash
# user-invoked-only skills are SILENTLY inert on Codex without the sidecar
if grep -q 'disable-model-invocation:[[:space:]]*true' "$SKILL_PATH/SKILL.md" 2>/dev/null; then
  test -f "$SKILL_PATH/openai.yaml" \
    && grep -q 'allow-implicit-invocation:[[:space:]]*false' "$SKILL_PATH/openai.yaml" \
    && printf 'OK_INVOCATION_PARITY %s\n' "$SKILL_PATH" \
    || printf 'MISSING_CODEX_SIDECAR %s\n' "$SKILL_PATH"
fi
```

`MISSING_CODEX_SIDECAR` means the skill declares its invocation mode for Claude
seats only, leaving Codex behavior undeclared. The divergence is silent — it
looks correct in review on either seat. See [create-skill.md](create-skill.md)
"Declare the invocation mode" for the two-file contract and its source.

## 3. Shell Script Safety

For shell-backed skills:

```bash
find "$SKILL_PATH/scripts" -type f -name '*.sh' -maxdepth 1 -print -exec head -5 {} \;
shellcheck "$SKILL_PATH"/scripts/*.sh
```

Check:
- [ ] scripts are executable
- [ ] shebang is `#!/usr/bin/env bash`
- [ ] scripts use `set -euo pipefail`
- [ ] script paths are resolved from `BASH_SOURCE[0]`
- [ ] no Windows line endings (`file "$SKILL_PATH"/scripts/*.sh`)
- [ ] shellcheck passes, or every finding is documented with a reason

## 4. TypeScript/Bun Pattern

For TypeScript skills:

```bash
test -f "$SKILL_PATH/src/index.ts"
test -f "$SKILL_PATH/package.json"
bash "$SKILL_PATH/scripts/run.sh" --action=default
```

Check:
- [ ] `scripts/run.sh` resolves its own directory and executes Bun from the
      skill directory
- [ ] `src/index.ts` handles unknown actions with a non-zero exit
- [ ] dependencies are declared in `package.json`

## 5. Execution Smoke

Run the actual entrypoint:

```bash
# Bash skills
bash "$SKILL_PATH/scripts/default.sh"

# TypeScript skills
bash "$SKILL_PATH/scripts/run.sh" --action=default
```

Check:
- [ ] exit code is 0 for the happy path
- [ ] output is Markdown or structured JSON the parent agent can parse
- [ ] expected error paths return non-zero

## 6. Eval Result Provenance

Every static or live result is invalid evidence until each agent or eval arm
records requested intent plus effective runtime model and effort:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
if [[ "$SKILL_PATH" == skills/golem-powers/_archive/* || \
      "$SKILL_PATH" == "$REPO_ROOT"/skills/golem-powers/_archive/* ]]; then
  printf 'SKIP_ARCHIVED_EVAL_RESULTS %s\n' "$SKILL_PATH"
elif [[ -d "$SKILL_PATH/evals/results" ]]; then
  find "$SKILL_PATH/evals/results" -type f \
    \( -name '*.md' -o -name '*.json' \) \
    -exec node "$REPO_ROOT/skills/golem-powers/skill-creator/evals/eval-provenance-check.mjs" {} +
fi
```

Archived skills remain preserved as history, but their result packs are outside
the active audit sweep. Do not let retired `_archive/` evidence keep current
skill audits permanently red.

Check:
- [ ] every arm has `model_requested`, `model_effective`, and `effort_effective`
- [ ] effective values name their observation source: CLI status line, matching
      session JSONL field, or API response metadata
- [ ] impossible observations say `NOT DETERMINED` explicitly; fields are never omitted
- [ ] only a `VALID` result supports a cross-arm/model score or delta
- [ ] `NON_COMPARABLE` and historical `ALIAS_ONLY` results are never cited as comparable evidence

Any `INVALID` result fails the audit. `NON_COMPARABLE` and `ALIAS_ONLY` are
honest retained records, not comparative evidence. The historical alias-only
escape is restricted to results dated before 2026-08-03. **No provenance = no
eval.** A requested alias alone is insufficient because it records intent, not
runtime outcome.

The retention sweep above deliberately distinguishes honest history from
malformed records. For any result that will publish or support a score, delta,
or comparative verdict, rerun that result with `--require-comparable`; exit 3 is
a hard stop for the claim. A `NON_COMPARABLE` or historical `ALIAS_ONLY` result
that already contains a score/delta or positive comparability claim is invalid
even without the flag.

## 7. Workflow and Reference Drift

```bash
rg -n "/OLD_SKILL|OLD_SKILL" skills/golem-powers --glob 'SKILL.md'
rg -n "workflows/|references/|adapters/" "$SKILL_PATH/SKILL.md"
```

Check:
- [ ] no active skill points at an archived or renamed skill
- [ ] referenced workflows and references exist
- [ ] neighboring skills route to the new owner after a merge/retire
- [ ] archive moves are reversible under `skills/golem-powers/_archive/`

## 8. Registration Verification

New or renamed active skills are not invocable until registered:

```bash
ls ~/.claude/skills/YOUR_SKILL_NAME/SKILL.md
```

Check:
- [ ] `~/.claude/skills/<name>` resolves to the repo skill
- [ ] nothing for the skill remains under `~/.claude/commands/`
- [ ] retired skill symlinks are removed after merge, and only if they are
      symlinks
- [ ] a fresh agent skill list shows the active skill and omits the retired one

## Common Issues

| Issue | Fix |
|-------|-----|
| `permission denied` | Run `chmod +x scripts/*.sh` |
| `bad interpreter` | Convert Windows line endings with `dos2unix` |
| `bun: command not found` | Install Bun or document it as a requirement |
| Shellcheck warnings | Fix the specific warning or document why it is accepted |
| Dangling retired-skill reference | Redirect the active reference before archiving |
| `NO_PROVENANCE` / invalid eval result | Add per-arm requested/effective model and effort with runtime observation sources; use `NOT DETERMINED` when impossible |
| `NON_COMPARABLE` / `ALIAS_ONLY` | Retain for history, but do not publish or cite a cross-arm/model delta |

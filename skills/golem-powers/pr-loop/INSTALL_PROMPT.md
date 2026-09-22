# Install: pr-loop

> The complete PR loop — branch, implement, test, commit, push, PR, WAIT FOR REVIEW, fix, merge, cleanup. Includes PR creation and review comment fetching. Use whenever creating a PR or finishing work. This is NOT optional. Every change goes through this loop. No exceptions.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/pr-loop/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/pr-loop
```

2. Download the skill:
```bash
curl -fsSL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/pr-loop/SKILL.md \
  -o ~/.claude/skills/pr-loop/SKILL.md
```

3. Fetch the references:
```bash
mkdir -p ~/.claude/skills/pr-loop/references
set -e
for ref in dispatch-and-handoffs github-identity merge-and-verification pr-creation review-loop; do
  curl -fsSL "https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/pr-loop/references/${ref}.md" \
    -o "$HOME/.claude/skills/pr-loop/references/${ref}.md"
done
```

4. Verify:
```bash
ls ~/.claude/skills/pr-loop/ ~/.claude/skills/pr-loop/references/
```

## Usage

```
/pr-loop
```

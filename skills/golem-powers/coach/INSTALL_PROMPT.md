# Install: coach

> Life admin assistant for health/habits, recruiting/jobs, freelancing/contracts, Israeli law, outreach/networking, and scheduling. Use when discussing daily planning, schedule creation, habit tracking, configured wearable data, job hunting, freelance contracts, Israeli business law, client management, or outreach emails. Also triggers for any conversation that references past coaching sessions or personal context that needs memory recall. Even seemingly simple requests ("build me a schedule", "check my wearable") benefit from this skill because coachClaude's value comes from persistent memory and accumulated context about the user's life, habits, and goals.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coach/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/coach
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coach/SKILL.md \
  -o ~/.claude/skills/coach/SKILL.md
```

### Workflows

```bash
mkdir -p ~/.claude/skills/coach/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coach/workflows/admin.md \
  -o ~/.claude/skills/coach/workflows/admin.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coach/workflows/freelance.md \
  -o ~/.claude/skills/coach/workflows/freelance.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coach/workflows/health.md \
  -o ~/.claude/skills/coach/workflows/health.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coach/workflows/recruit.md \
  -o ~/.claude/skills/coach/workflows/recruit.md
```

3. Verify:
```bash
ls ~/.claude/skills/coach/
```

## Usage

```
/coach
```

## Kickoff Template (paste into a new coach session)

Use this minimal prompt to start any new coach session — it defers to `SKILL.md` Cardinal Rule 0 for the actual boot logic, so updates to the skill propagate without you needing to edit the kickoff text:

```
[coach] Boot — execute Cardinal Rule 0 from SKILL.md before responding.

Today is $(date '+%A %Y-%m-%d').

After Step 0a-0c, greet me per the Boot Protocol output contract — one-line handoff summary + next concrete action, OR explicit "no handoff found" disclosure.
```

**Do NOT hand-roll boot prompts with hardcoded `brain_search` queries.** Historical kickoff prompts (e.g. `brain_search("coach handoff pending items")`) are too generic to surface date-anchored handoff chunks and will boot the agent blind. If the boot queries need to change, edit `SKILL.md` Cardinal Rule 0 — never edit the kickoff prompt.

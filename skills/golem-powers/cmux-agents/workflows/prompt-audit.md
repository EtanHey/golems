# Prompt Audit — Before Sending Any Prompt to Another Claude

> Run this checklist before spawning agents or writing handoff/kickoff prompts. Catches the gaps that cause agent failures, duplicate work, and missing best practices.

## Why This Exists

Every time we skip this, agents miss something: no proof requirement, no PR loop, no mention of prior work, wrong merge policy. We've stored this lesson in BrainLayer at importance 9 twice. This workflow turns "things we always forget" into a checklist.

## The Checklist

### 1. Prior Work — Don't Rebuild What Exists

Before agents start from scratch, check what's already done:

```
brain_search("<project> <domain> components built")
brain_search("<project> recent agent work results")
git log --oneline -20 -- <relevant-paths>
```

Add to the prompt: "Check git log for recently built components before flagging anything as missing."

### 2. Skill Combos — What Should Agents Invoke?

Scan the skill index for skills that fit the task. Common combos:

| Task Type | Skills to Include |
|-----------|------------------|
| Building components | Cheapest real proof (see below), `/figma-loop`, project-scoped library docs when configured |
| Full feature work | Cheapest real proof (see below), `/pr-loop`, `/coderabbit:review` |
| Figma decomposition | `/figma-swarm`, `/figma-loop` |
| Research/audit | Claude Desktop/Gemini research path, `/coderabbit:review` |
| Collab work | `/large-plan`, `/pr-loop` |

Add a "Skill Combos" table to the prompt listing which skills agents should invoke and when.

**Lead kickoff (any harness):** a kickoff brief to a lead, and a lead's brief to a worker, names the skills to invoke before the first plan, dispatch or PR action: `/large-plan`, `/agent-routing`, `/pr-loop` (Claude: Skill tool; Codex: read each SKILL.md body).

### 3. Mandatory Sections

Every agent prompt MUST include:

**Proof:**
```
Prove it the cheapest real way: e2e on the real binary, a TLA+/TLC spec for order-of-events logic, a ratchet row for regressions. Unit tests only where they are the clearest proof. No test file is required per edit. Mock-green is not live-green.
```

**PR Loop:**
```
When work is done, use /pr-loop — branch → test → PR → review → fix → merge.
```

**Merge Policy** (ask the user which one):
- `autonomous` — agent merges after CI + CodeRabbit pass
- `review-required` — orchestrator or user merges
- `ask-on-each` — agent asks before each merge

**BrainLayer Checkpoints:**
```
brain_store your progress at each milestone:
- After setup/discovery → store what was found
- After main work → store what was done, test counts
- After PR → store PR number, files changed
```

**GitHub Identity Signature:**
```
End every PR body, PR comment, review and issue you write with ONE plain line:
🤖 Generated with <model> in <harness>
Name both models when both did work, implementer's model first. No leading em dash,
seat or role names, or hidden metadata. Read the model from live session metadata.
Use unknown if unavailable; never infer it from spawn settings or self-report.
Keep Co-Authored-By commit trailers; no effort in the signature or trailer.
Full spec: /pr-loop → references/github-identity.md
```

Include this requirement in worker prompts; each worker reads its own live model.

### 4. Monitoring Instructions

If spawning cmux agents, the orchestrator prompt must include:

```
YOU ARE THE PARENT. Monitor your agents:
- Use agent-status or cmux capture-pane --surface surface:N every 3-5 min
- Capture results immediately when an agent finishes
- Don't wait for agents to message you — proactively check
- The user should NEVER have to ask "what happened?"
```

### 5. BrainLayer Best Practices Search

Run these searches to catch project-specific gotchas:

```
brain_search("<project> mistakes corrections")
brain_search("<project> architecture decisions")
brain_search("behavior correction <relevant-skill>")
```

If BrainLayer returns corrections or anti-patterns, add them as "Important Notes" in the prompt.

### 6. Collab Best Practices (if multi-agent or collab-based work)

If the task involves collab files or multiple agents coordinating:

**Start from the template:**
```bash
: "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}"
cat "$ORCHESTRATOR_REPO/collab/TEMPLATE.md"
```
Copy it. Fill in the specifics. Never write a collab from scratch — the template has DO NOT REMOVE sections with PR loop, proof, eval pack, and checkpoint protocol baked in.

**Sync protocol** — add to agent prompts:
```
After every PR merge or completed task, re-read the collab file before starting the next task.
Scan for @mentions directed at you. @agentName is a routing signal, not decoration.
```

**Blocker protocol** — add to agent prompts:
```
When blocked: write full context in collab (what you need, why stuck, who can unblock, suggested resolution).
Set up fswatch on the collab file and WAIT. Do NOT exit silently. Do NOT move on.
```

**Self-write detection:**
```
After writing to collab, sleep 2 seconds before arming fswatch (your own write triggers the watch otherwise).
If watch fires and the last message is from you — re-arm silently.
```

**Mission = MERGED, not "PR created":**
```
Your job isn't done until the PR is MERGED. Not created. Not reviewed. MERGED.
If blocked on merge, write the blocker. Do NOT exit.
```

### 7. Worker-Brief Authoring Contract (2026-06-06)

Before sending any dispatch brief, verify all three:

**Absolute verified paths**
- Every artifact the worker must read gets an **inline absolute path** verified to exist on disk (`test -f` / `Read`).
- The collab file path is mandatory — never "collab file above" with no path in the message.

**Truthful environment**
- State what actually exists: worktree path, branch, installed deps, Playwright, `.mcp.json`.
- If the worker must create something, write **"create it yourself"** with the exact command.
- Never imply promised infrastructure exists when it doesn't (five drift incidents in one evening).

**Live data contracts**
- Before describing schemas, field names, queue shapes, or file formats, read the live artifact.
- `etan-queue` vs `dictionary-questions` vs `contested` — grep/query the real file, don't improvise from memory.

### 8. Context Files

Check if the project has relevant inventory/reference files the agents need:
- Component inventories
- Reuse maps
- Design token files
- Screen inventories
- Existing plans/PRDs

List them explicitly with paths. Agents can't find files they don't know about.

## Quick Version (for simple spawns)

Not every agent needs the full checklist. For quick one-off tasks (research, audits, small fixes), at minimum include:

- [ ] Prior work check (brain_search)
- [ ] Cheapest real proof (if building anything; no test file required per edit)
- [ ] GitHub identity signature (if the worker will post anything to GitHub)
- [ ] brain_store when done

## Anti-Patterns

- **Sending a bare task description** — agents have no context about existing work, skills, or standards
- **Assuming agents know the project** — they start fresh every session. Spell out file paths.
- **Skipping merge policy** — agents either merge without asking or never merge at all
- **No checkpoints** — agent does 45 minutes of work, session dies, nothing stored in BrainLayer
- **Writing collabs from scratch** — use the template. It has mandatory sections for a reason.
- **No blocker protocol** — agent gets stuck, exits silently, user finds out 30 min later
- **"PR created" = done** — mission is MERGED. PR created is halfway.
- **Dispatching GitHub work without the identity signature** — the comment lands under `EtanHey`
  with nothing distinguishing it from Etan. 96.7% of 7,390 PR comments are already in that state
  (identity audit 2026-08-03); every unsigned dispatch adds one more.
- **Hardcoding a model into a worker's signature instruction** — the worker reads its own live
  session metadata. A dispatcher-supplied model is a spawn-time value, which is exactly the
  provenance the convention bans.

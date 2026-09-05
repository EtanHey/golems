# Prompt Audit — Before Sending Any Prompt to Another Claude

> Run this checklist before spawning agents or writing handoff/kickoff prompts. Catches the gaps that cause agent failures, duplicate work, and missing best practices.

## Why This Exists

Every time we skip this, agents miss something: no TDD mandate, no PR loop, no mention of prior work, wrong merge policy. We've stored this lesson in BrainLayer at importance 9 twice. This workflow turns "things we always forget" into a checklist.

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
| Building components | failing test first (AGENTS.md law) + the `/tdd-guard` hook, `/figma-loop`, context7 MCP |
| Full feature work | failing test first (AGENTS.md law) + the `/tdd-guard` hook, `/pr-loop`, `/coderabbit:review` |
| Figma decomposition | `/figma-swarm`, `/figma-loop` |
| Research/audit | Claude Desktop/Gemini research path, `/coderabbit:review` |
| Collab work | `/large-plan`, `/pr-loop` |

Add a "Skill Combos" table to the prompt listing which skills agents should invoke and when.

### 3. Mandatory Sections

Every agent prompt MUST include:

**TDD Mandate:**
```
When building anything, write the failing test FIRST, then implement, then green (repo AGENTS.md law). No code without a RED test.
`/tdd-guard` is the PreToolUse hook that enforces the edit limit — it does not write the test for you.
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

**GitHub Identity Signature** (ratified 2026-08-08 — MANDATORY until the `gh()` wrapper ships):
```
Every PR body, PR comment, review, and issue comment you post ends with:

— <seat> (<role>) · <harness>/<model>
<!-- golem-id v1 {"seat":"…","role":"…","harness":"…","model":"…","model_source":"…","session":"…","ts":"…"} -->

Read `model` from your LIVE session metadata at write time — never self-report, never the
cmux spawn registry, never cached at spawn. Cannot read it → "model":"unknown". No effort
field anywhere on GitHub. Commits use the trailer form instead:
Co-Authored-By: <seat> running <model> <noreply@anthropic.com>
Full spec + per-harness read paths: /pr-loop → references/github-identity.md
```

**Why this is in the prompt at all:** the design's zero-hassle path is a `gh()` wrapper exported by
the repoGolem launcher env, which injects the signature with no worker involvement. That wrapper is
**designed but NOT built** (golems / repoGolem lane). Until it lands, an unsigned worker comment is
an unattributable comment — so kickoff prompts propagate the requirement by hand. **Once the wrapper
ships, delete this block from dispatch prompts** rather than leaving a stale hand-rolled instruction
that can drift from the wrapper's output.

Note the seat/role/harness values are the worker's own (from its launcher env), not yours. Do not
hardcode your seat into a worker's prompt — a signature naming the dispatcher instead of the author
is worse than no signature.

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
Copy it. Fill in the specifics. Never write a collab from scratch — the template has DO NOT REMOVE sections with PR loop, TDD, eval pack, and checkpoint protocol baked in.

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
- [ ] TDD mandate (if building anything)
- [ ] GitHub identity signature (if the worker will post anything to GitHub — until the `gh()`
      wrapper ships)
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

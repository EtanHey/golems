# publicityAgent — Content Creation Partner

> Phase 2 collab partner. maintenanceClaude provides facts, publicityAgent writes content. Two deployment options.

## Spawning Options

### Option A: Agent Subagent (default — in-session)

Use the Agent tool. Best for: quick drafts, single content type, when you need fast iteration.

```text
Agent tool:
  description: "publicityAgent README draft"
  prompt: <prompt template below>
  subagent_type: "general-purpose"
```

Pros: Fast iteration (responses in seconds), stays in your context, easy push-pull loop.
Cons: Uses your context budget, dies with your session.

### Option B: cmux Split Agent (for parallel/long work)

Spawn a dedicated Claude in a cmux pane. Best for: multiple content types in parallel, long sessions, when you want visible progress.

```bash
# Spawn publicityAgent in a cmux split
cmux new-split right
cmux send --surface <surface> 'source ~/.zshrc && cd "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}" && claude -s'
# Wait for boot, then send the prompt
cmux send --surface <surface> "<prompt>"
cmux send-key --surface <surface> return
```

Pros: Parallel work (you verify while it drafts the next piece), visible in sidebar, survives context overflow.
Cons: Slower startup, collab file needed for communication, can't iterate as fast.

**Decision rule:** Single content type → Agent subagent. Multiple types from same sprint → cmux split.

---

## Prompt Template

Adapt this for both Agent and cmux spawning:

```text
You are publicityAgent — a content writer for developer tools and AI infrastructure.

Your job: take verified facts and turn them into compelling content that fits the target format.

Rules:
1. ONLY use facts from the fact brief. Do not invent metrics, features, or capabilities.
2. Make it interesting. "209KB native binary replaces 931MB of Python processes" is a story, not just a number.
3. Match the content norms for <content-type> (provided below).
4. When maintenanceClaude challenges a claim, either cite the fact tag or remove the claim.
5. Never use "revolutionary", "cutting-edge", "state-of-the-art", or similar hype words.
6. Write for developers who can smell bullshit. Specifics > adjectives.
7. AI collaboration is a feature, not a secret. "Orchestrated 3 AI agents" is impressive and honest.

Fact brief:
<fact-brief>

Content norms:
<from references/content-norms.md for the target type>

Target: <content-type>
```

---

## The Push-Pull Loop

```text
1. maintenanceClaude sends the fact brief
2. publicityAgent drafts content for the target type
3. maintenanceClaude verifies EVERY claim against the fact brief:
   - Tagged fact? → PASS
   - Untagged claim? → CHALLENGE ("where does this come from?")
   - Aspirational language? → BLOCK ("this isn't true yet")
   - Missing key fact? → REQUEST ("add FACT-3 about test counts")
4. publicityAgent revises
5. Repeat until: every claim is verified + content fits norms + showcases work
6. maintenanceClaude approves and publishes
```

### Drift Check (MANDATORY)

**Every 5 messages in the push-pull loop, re-read the fact brief header.** Context compaction can silently drop fact tags. If you can't recall FACT-1 through FACT-5 from memory, re-read `## Fact Brief` before your next verification pass.

```text
Loop iteration 1-4: verify from memory
Loop iteration 5: STOP. Re-read fact brief header. Then verify.
Loop iteration 6-9: verify from memory
Loop iteration 10: STOP. Re-read fact brief header. Then verify.
```

This prevents drift where maintenanceClaude starts approving claims it can no longer verify because the facts were compacted out.

---

## Division of Labor

| Role | maintenanceClaude | publicityAgent |
|---|---|---|
| **Owns** | Facts, accuracy, completeness | Tone, narrative, engagement |
| **Writes** | Fact briefs, verification reports | Drafts, headlines, hooks |
| **Blocks on** | Unverified claims, fabrication | Boring/generic/template-y output |
| **Pushes back when** | Content overstates capabilities | Facts are presented without narrative |

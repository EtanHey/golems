---
name: claude-desktop-research
description: "Write grounded Claude Desktop/Web research prompts. Triggers: research prompt, Claude Desktop, MCP-aware."
---

# Claude Desktop Research — Self-Contained Prompt Dispatch

Write deep-research prompts for Claude Desktop (macOS `.app`) — also covers Claude Web (claude.ai projects) as a subset. Both surfaces support Drive grounding and Deep Research mode. **Only Claude Desktop has local MCP connections — and only in REGULAR CHAT, not in Research mode** (empirically verified 2026-06-10, see below). The differentiator is Desktop's chat-mode MCP access.

> **🔑 DRIVE-WORKSPACE RULE (Etan, standing — never violate):** Etan's research surface has his Google Drive workspace CONNECTED. Prompts must REFERENCE the relevant Google Doc(s) by NAME so the agent pulls them itself via the Drive connector. **NEVER instruct Etan to attach/upload files** — he should never have to attach anything, ever. Reference doc names, not attachments.

> **🔑 OUTPUT-PLACEMENT CONTRACT (Etan, standing — 2026-06-10):** Every prompt this skill emits MUST end with a placement block stating where the output lives next: the owning-context folder (large-plan / design-doc / sprint — **one folder per research**, placement is dynamic), the filename convention, and whether Brain Drive archival applies. Claude-side outputs land on `~/Desktop` or `~/Downloads` (native exports: `compass_artifact_<UID>*.md`; Etan also hand-pastes `.rtf/.rtfd`) and MUST be **deliberately** moved to the owning folder — the moving agent verifies the destination is correct before moving (no blind automation for local files). The evidence of *why we did what we did* lives with the work it justified.

## Why this skill is named "desktop"

Both Claude Web and Claude Desktop now expose:
- **Deep Research mode** (5–60 min web sweeps with citations)
- **Google Drive grounding** — Etan's Drive workspace is **already connected**. The prompt REFERENCES the relevant Doc(s) by NAME and the agent reads them itself via the connector. (Never an "attach a folder" step — see the DRIVE-WORKSPACE RULE above and the emit-gate below.)

But **only Claude Desktop has local MCP connections** (wired via `claude_desktop_config.json` + `.mcpb` extensions) — **and they are exposed in REGULAR CHAT ONLY.**

> **⚠️ VERIFIED 2026-06-10 (empirical, gen-15 weave):** Claude Desktop **Research mode CANNOT call local MCP tools.** A Research-mode run instructed to call `brain_search` before any web work returned the mandated fallback **"TOOL UNAVAILABLE IN RESEARCH MODE"** and the UI logged `Failed to call tool "brain_search"` — Research routes everything through its own pipeline (`launch_extended_search_task`); local MCPs are unreachable mid-research. Any prompt that assumes otherwise hits a silent miss.

So the skill has **two dispatch modes**:
- **Research mode** — web sweeps + Drive connector grounding only. No local MCPs. Use for citation-heavy external research.
- **Chat-bench mode** — a benchmark-style prompt in a REGULAR Desktop chat: full local MCP access (brain_search, filesystem, voicelayer, …). This is the proven pattern for MCP-grounded deep work (2026-06-09 2nd-pass runs: context-hygiene, theo-audio, m1-sync — all called brain_search + filesystem from chat).

If Gemini Desktop ever ships an MCP connections file, that gap closes — for now (2026-04-30) only Claude Desktop has it.

**Pre-flight:** Apply the CHECK-FIRST + GROUND + emit-only-if-pass gate before writing any paste-ready deep-research prompt.

## When to use this vs. Gemini vs. quick lookup

| Need | Use |
|------|-----|
| Quick web lookup, 1–2 sources | Web/exa tools directly |
| Deep comparison, 5+ sources, academic papers, NO MCP needed | **This skill (web mode)** |
| Deep work that must call BrainLayer / voicelayer / supabase / etc. mid-stream | **This skill (chat-bench mode — REGULAR Desktop chat, never Research mode)** |
| Broad landscape analysis ("what's out there") | **This skill** |
| API validation against official docs | **This skill** |
| Side-by-side with Gemini for paired Drive-grounded research | Run this skill plus `/gemini-research`, then compare outputs |
| Visual/frame-heavy analysis | `/gemini-research` (CLI) — Gemini is faster on batch images |

## Pre-flight: which MCPs are actually wired?

Before writing a prompt that assumes desktop-mode MCP access, verify the connection list. Claude Desktop wires MCP servers via TWO paths — both must be checked.

### Path 1: Legacy `claude_desktop_config.json`

```bash
python3 -c "
import json
with open('$HOME/Library/Application Support/Claude/claude_desktop_config.json') as f:
    d = json.load(f)
servers = d.get('mcpServers', {})
print('Legacy MCPs (claude_desktop_config.json):')
for name in sorted(servers.keys()):
    print(f'  - {name}')
print(f'Total legacy: {len(servers)}')
"
```

### Path 2: Extensions (`.mcpb`)

```bash
EXT_DIR="$HOME/Library/Application Support/Claude/Claude Extensions Settings"
echo "Installed .mcpb extensions:"
ls "$EXT_DIR"/*.json 2>/dev/null | xargs -n1 basename | sed 's/\.json$//' | sed 's/^/  - /'
[ -f "$EXT_DIR/extensions-installations.json" ] && python3 -c "
import json, sys
with open('$EXT_DIR/extensions-installations.json') as f:
    d = json.load(f)
print('extensions-installations.json:')
print(json.dumps(d, indent=2)[:1500])
"
```

The Extensions path is where modern MCPs live (e.g., `local.mcpb.etan-heyman.brainlayer` v1.0.0, installed 2026-03-28 — provides `brain_search`, `brain_store`, etc., but NOT visible in `claude_desktop_config.json`).

If a prompt instructs Claude Desktop to call a tool, the tool must appear in EITHER the legacy config OR the Extensions list. Always run BOTH commands above before writing a desktop-mode prompt — checking only one path can produce a false-negative ("MCP not wired" when it actually is, just under the other path).

### `.mcpb` is the canonical wiring strategy going forward

The legacy `claude_desktop_config.json` is being phased out — entries currently in it (e.g., `exa`, `whatsapp`, `whatsapp-business`, `voicelayer`) will migrate to `.mcpb` extensions in a separate consolidation sprint. Until that sprint lands, BOTH paths must be checked. This skill should be revisited once the migration is complete to drop the legacy enumeration step.

### Out-of-the-box behavior

If the relevant MCP is missing from BOTH paths, the prompt will hit a silent miss. Either (a) tell the user to install the missing `.mcpb` (preferred) or add to `claude_desktop_config.json` (legacy), then restart Claude Desktop; or (b) flag the gap and rewrite the prompt to web-mode (no MCP).

## File Locations

### Primary (Drive — works for BOTH desktop AND web)

```
Brain Drive/Research/<project>/
  description.md
  instructions.md
  context/
    00-code-map.md
    01-*.txt
    40-*.txt
  prompts/
    R{NN}-{topic}.md
  results/
    R{NN}-claude-desktop-result.md     # was: R{NN}-claude-web-result.md (legacy alias retained)
```

### Local cache (optional, not authoritative)

```
$ORCHESTRATOR_ROOT/docs.local/claude-desktop/projects/<project>/
  description.md
  instructions.md
  research-context/
  prompts/
  results/
```

### Known projects

- `batch-brainlayer` → BrainLayer (memory layer, enrichment, search quality)
- `batch-cmux` → cmux (terminal multiplexer, agent orchestration)
- `batch-orchestrator` → Orchestrator (cross-repo coordination, agent design)

## Workflow

### Research Gates (mandatory)

1. **Plan-author gate:** When Claude Desktop/Web returns a generated research
   PLAN before execution, send that PLAN back to the prompt author and wait for
   an explicit `START` / `EDIT` verdict. Do not fire the research run just
   because the plan looks plausible.
2. **Harvest own-brief gate:** At harvest, any report claim that cites one of
   YOUR OWN briefs/prompts/plans must be cross-checked against the actual brief
   text before you accept, store, or relay it. Do not let a report cite a
   fabricated premise from your own setup. This gate exists because two
   2026-06-05 catches were fabricated-premise failures: a hallucinated Drive doc
   in R01's plan and a nonexistent delta-brief mandate in R02's report.
3. **Dispatch harvest contract (required — see `/research-lifecycle`):** At
   dispatch time record `harvest_owner`, `harvest_trigger`, and `export_route`
   (e.g. `$ORCHESTRATOR_ROOT/docs.local/research/R{NN}-result.md` → brain_store).
   Applies to batch and one-off dispatches. Research without a harvest path =
   **parked**, not done. Export route must name how results return to the fleet.

### Step 0 — Verify active account + MCP wiring

```bash
bash skills/golem-powers/_shared/research/verify-account.sh --expect research-account@example.com
```

Then run the MCP pre-flight (above). If desktop-mode MCP is required and the relevant server is NOT wired, STOP and tell the user — do not write a prompt that will silently miss its tool.

### Step 1 — Determine project and next RNN number

1. Ensure Drive folders exist:
   ```bash
   python3 skills/golem-powers/_shared/research/drive-paths.py ensure-project-folders <project>
   ```
2. List existing prompts from Drive:
   ```bash
   python3 skills/golem-powers/_shared/research/drive-paths.py list-prompts <project>
   ```
3. The next prompt gets `R{NN+1}`.

### Step 2 — Write the research prompt

File: `R{NN}-{topic-slug}.md`

**Template:**

```markdown
# R{NN}: {Title — What You're Researching}

## Mode

[desktop / web]   ← desktop if MCP needed, web if not

## Context

{2–3 paragraphs explaining WHY this research is needed.}

## Grounding (Drive workspace — CONNECTED; REQUIRED block)

{Ground this research in the following docs from my Google Drive — pull them
yourself via the connected Drive workspace; do NOT ask me to attach anything:
- "<Exact Google Doc name 1>"
- "<Exact Google Doc name 2>"
If no Drive doc applies, write "None — self-contained / web-only" so the
omission is deliberate. NEVER replace this block with an attach/upload ask.}

## Our Architecture

{Include INLINE — Claude Desktop in WEB MODE has zero codebase access; in DESKTOP MODE it can call MCP but still benefits from inline architecture for non-MCP-wired details. Include:
- Code snippets of relevant implementations
- Data shapes (SQL schemas, JSON structures)
- Exact numbers (chunk counts, tag counts, performance metrics)
- Tool/library versions}

## Available MCP tools (DESKTOP MODE ONLY — verify before relying)

{Skip this section for web-mode prompts. For desktop-mode, list the MCPs the prompt assumes:
- `mcp__brainlayer__brain_search` — semantic + keyword recall
- `mcp__voicelayer__*` — TTS / STT / pill-state
- `mcp__exa__web_search_exa` — web search
- ...}

## Research Questions

### 1. [Topic Area]
- Specific question 1
- Specific question 2

### 2. [Topic Area]
- ...

## Deliverable

Structured report with:
1. {Section 1 title} — {what it should contain}
2. ...
```

**CRITICAL RULES for the prompt:**

- **SELF-CONTAINED for web mode:** Zero codebase access. Every architecture detail / code snippet / number INLINE.
- **MCP-AWARE for desktop mode:** Name the exact MCP tool (`mcp__brainlayer__brain_search`) and what to do with the result. Don't say "use BrainLayer" — say "call `brain_search('<query>')` and report top 5 chunks."
- **SPECIFIC:** "How does X handle Y at Z scale?" not "Tell me about X."
- **EXACT NUMBERS:** "223K chunks", "22 domain tags", "p50=1480ms" — not "many chunks."
- **DELIVERABLE SPEC:** Tell Claude Desktop exactly what sections to return.
- **REFERENCE VERSIONS:** "Gemini 2.5 Flash-Lite", "sqlite-vec 0.1.6", "Next.js 16."
- **GROUND BY NAME, NEVER BY ATTACHMENT:** The `## Grounding` block names the Drive Doc(s); Claude reads them via the connected workspace. The prompt must NEVER tell Etan to attach/upload/drag a file. (Gate-enforced — see Step 2.5.)

### Step 2.5 — 🔒 EMIT-GATE: Drive-Workspace compliance (BLOCKING)

Before the prompt leaves this skill — and before the Step 5 user-facing message —
run the mechanical gate. Do not eyeball it:

```bash
# Exit 1 = FAIL. Scan the prompt file you just wrote AND the dispatch message text.
bash skills/golem-powers/_shared/research/drive-grounding-gate.sh R{NN}-{topic}.md
# or pipe text:  printf '%s' "$MSG" | bash skills/golem-powers/_shared/research/drive-grounding-gate.sh -
```

- **FAIL** (gate finds `attach` / `upload` / `drag` / "add the file" aimed at Etan)
  → do NOT emit. Rewrite the offending lines to REFERENCE the Doc(s) by NAME in the
  `## Grounding` block, re-run, repeat until PASS.
- **PASS** → safe to emit.

### Step 3 — Update project context files in Drive

If the project's context has changed since the last prompt:

1. **description.md** — One paragraph. Current state, recent changes, what's live.
2. **instructions.md** — Full architecture reference. Tool status, DB state, constraints.
3. **context/*.md** — Add/update domain-specific files as needed.
4. Keep numbering aligned with `skills/golem-powers/_shared/research/context-numbering.md`.

### Step 4 — Upload prompt + context to Drive (and optional local cache)

1. Upload `R{NN}-{topic}.md` to `Brain Drive/Research/<project>/prompts/`
2. Keep `description.md`, `instructions.md`, and `context/` current in `Brain Drive/Research/<project>/context/`
3. Optionally mirror to `$ORCHESTRATOR_ROOT/docs.local/claude-desktop/projects/<project>/` for local review

### Step 5 — Tell the user

```
Research prompt ready: R{NN}-{topic}.md
Mode: [desktop / web]   ← desktop if MCP needed, web if not
Primary: Brain Drive/Research/<project>/prompts/
Local cache: docs.local/claude-desktop/projects/<project>/ (optional)

Open Claude Desktop and paste the prompt. Your Drive workspace is connected, so
Claude pulls the named Doc(s) itself — nothing to attach or upload.
[If desktop-mode] Confirm these MCPs are wired before submitting: <list>.
When Claude returns its research PLAN, send that PLAN back here for START/EDIT
before clicking Start Research.
```

> Before sending the message above, it must PASS Step 2.5's gate too — a dispatch
> message that says "attach"/"upload" is the same violation as a prompt that does.

### Step 6 — After results arrive

When the user downloads `compass_artifact` or copies the result:

1. Save to `Brain Drive/Research/<project>/results/R{NN}-claude-desktop-result.md`
2. Optionally mirror to `$ORCHESTRATOR_ROOT/docs.local/claude-desktop/projects/<project>/results/`
3. `brain_digest` the raw content (extracts entities/relations)
4. `brain_store` conclusions with tags `["research", "conclusions", "{project}", "{topic}"]`
5. Keep the Drive result file authoritative
6. Run the Harvest own-brief gate above for any report claim that cites your
   own prompt/brief/plan text
7. Apply findings to the codebase / sprint plan

## Creating a new project batch

```bash
python3 skills/golem-powers/_shared/research/drive-paths.py ensure-project-folders newproject
# Then upload description.md, instructions.md, context files, and the first prompt.
```

## Migrating legacy Obsidian batches

```bash
bash skills/golem-powers/claude-desktop-research/scripts/migrate-obsidian-to-drive.sh batch-cmux --dry-run
bash skills/golem-powers/claude-desktop-research/scripts/migrate-obsidian-to-drive.sh batch-cmux
```

Procedure: `skills/golem-powers/claude-desktop-research/workflows/migrate.md`

## Quality checklist

Before telling the user the prompt is ready:

- [ ] **`drive-grounding-gate.sh` PASSES on the prompt AND the dispatch message** (zero attach/upload/drag — Step 2.5)
- [ ] **`## Grounding` block present**, naming the Drive Doc(s) by exact name (or "None — self-contained")
- [ ] Mode declared (desktop / web) — both prompt header AND user-facing message
- [ ] If desktop mode: relevant MCPs verified in `claude_desktop_config.json`
- [ ] Prompt is fully self-contained (no "see the codebase" references for web-mode prompts)
- [ ] Architecture includes code snippets, not just descriptions
- [ ] All numbers are exact (not "many", "large", "several")
- [ ] Research questions are specific (not "tell me about X")
- [ ] Deliverable section specifies exact output structure
- [ ] Library/tool versions included
- [ ] Prompt author will review the generated research PLAN before execution
- [ ] Harvest includes own-brief cross-check for any self-cited setup claim
- [ ] Context files are up to date with current state
- [ ] Prompt uploaded to Drive `prompts/`
- [ ] Context lives in Drive `context/`
- [ ] Optional local cache updated if needed
- [ ] Next RNN number is correct (no collisions)

## Renamed from /claude-web-research (2026-04-30)

User correction: BOTH Claude Web AND Claude Desktop have deep research + Drive grounding. The differentiator is MCP — only Desktop has local connections. The skill formerly known as `/claude-web-research` is now `/claude-desktop-research` (desktop is the umbrella; web is the MCP-less subset).

The legacy `/claude-web-research` slash trigger retired on 2026-05-30. Use `/claude-desktop-research` for Claude Desktop/Web research prompts.

# Documentation Workflow

> Phase 2 workflow for updating architecture docs, API docs, design docs, and other technical documentation.

## Prerequisites

- Fact brief from Phase 1 (gather-facts.md)
- Current documentation content

---

## Documentation Norms

Good docs answer one question per page. If a page answers three questions, it should be three pages.

### Doc Types and Their Purpose

| Type | Answers | Example |
|---|---|---|
| Architecture doc | "How does this system work?" | consolidated-architecture.md |
| API reference | "What can I call and what does it return?" | MCP tool schemas |
| Design doc | "Why did we choose X over Y?" | daemon sprint design |
| Runbook | "How do I do X step by step?" | daemon rollout instructions |
| Decision record | "What did we decide and why?" | ADR format |

### Rules

1. **One question per page** — Architecture and API reference are different documents
2. **Current state first** — What IS, then what WAS, then what WILL BE (clearly labeled)
3. **Code blocks are canonical** — If something can be expressed as code/config, show that instead of prose
4. **Diagrams > paragraphs** — Use ASCII art, mermaid, or code blocks for architecture
5. **Version the claims** — "As of 2026-03-17, BrainBar has 28 tests" not "BrainBar has many tests"
6. **Link, don't duplicate** — Reference other docs instead of copying their content
7. **Flag uncertainty** — Use `> **Note:** This is planned, not implemented` callouts

### Anti-patterns

- Mixing current state with aspirational plans without labeling
- "See [link]" where the link is broken or the content moved
- Documenting implementation details that change weekly
- "Complete API reference" that's missing half the endpoints
- Decision records without the alternatives considered

---

## Step 1: Classify the Doc Update

Determine what type of documentation is being updated:

| If updating... | Focus on | Key verification |
|---|---|---|
| Architecture doc | System structure, component relationships, data flow | Do the diagrams match actual code? |
| API reference | Tool schemas, parameters, return types | Do the examples actually work? |
| Design doc | Decisions, tradeoffs, alternatives considered | Are the tradeoffs still accurate? |
| Runbook | Step-by-step procedures | Can you actually follow these steps? |
| Decision record | What was decided, why, what was rejected | Has the decision been revisited? |

---

## Step 2: Spawn publicityAgent

```text
You are publicityAgent updating <doc-type> documentation for <project>.

Audience: Developers who will maintain, extend, or integrate with this system.
Format: Markdown with code blocks and diagrams.

Rules:
1. ONLY use facts from the fact brief.
2. Current state first. If something is planned, mark it explicitly.
3. Code blocks for anything that can be expressed as code.
4. Every architecture claim must match actual file structure.
5. Date-stamp specific metrics: "As of 2026-03-17: 28 tests, 209KB binary"
6. If a section references another doc, include the path and verify it exists.

Fact brief:
<fact-brief>

Current doc:
<current-doc>

Doc type: <type>
Doc norms:
<norms-from-above>
```

---

## Step 3: Verify Draft

Documentation has unique verification needs:

1. **Path verification** — Every file path mentioned must exist. `ls` or `Glob` to check.
2. **Code block accuracy** — Config examples, CLI commands, API calls must be current.
3. **Diagram accuracy** — Architecture diagrams must match actual component relationships.
4. **Link validity** — Every `[text](path)` link must resolve.
5. **Temporal labeling** — Current state vs planned state must be clearly distinguished.
6. **No orphan references** — If doc A references doc B, doc B must exist and reference back.

---

## Step 4: Push-Pull Loop

Docs-specific feedback:

| Issue | Feedback |
|---|---|
| Stale path | "Line 23 references `tools/cmux-mcp/` — this directory was deleted. Update to current structure." |
| Broken code example | "The socat command on line 45 uses the old socket path. Update to /tmp/brainbar.sock." |
| Mixed tenses | "Paragraphs 3-4 mix 'supports' and 'will support'. Which is it today?" |
| Orphan section | "The 'Changelog Architecture' section describes a system that doesn't exist yet. Move to a 'Planned' section or remove." |
| Missing diagram | "The architecture section is 200 words of prose. Replace with an ASCII diagram." |

---

## Step 5: Finalize

1. Present final doc for user approval
2. Verify all links and paths one more time
3. Store:

```text
brain_store(
  content: "Maintenance: <doc-type> for <project> updated (<date>). Sections updated: <list>. Stale claims fixed: <count>. Paths verified: <count>.",
  tags: ["maintenance", "docs", "<project>", "<doc-type>"],
  importance: 6
)
```

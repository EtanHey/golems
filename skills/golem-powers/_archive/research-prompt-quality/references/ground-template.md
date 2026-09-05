# Grounded deep-research prompt template

Use this structure **after** `check-first.sh` passes. Do not paste until all sections are filled.

---

## 0. Topic + disposition

- **Topic:**
- **Disposition:** NEW_RESEARCH | BUILD-ON | VALIDATE | REFUTE | ALREADY_DONE (engineering only)

If `ALREADY_DONE`, stop here — do not continue.

---

## 1. Drive grounding (required)

List the Brain Drive folders the researcher must attach or read:

```text
Brain Drive/03_RESEARCH/Active/<folder>/
Brain Drive/03_RESEARCH/Active/<other>/
```

Optional: folder IDs from `orchestrator/docs.local/brain-store-fallback/.../02-mcp-drop-and-research-grounding.md`.

---

## 2. Current usage (required — ≥1 concrete example)

For each example, include:

- **Source path:** `~/Gits/<repo>/...` or `~/.claude/skills/...`
- **Mechanism:** what actually happens today (1–3 sentences)
- **Implication:** why this matters for the research question

Example pattern:

```markdown
### Example A — cmux `send_input` = UDS terminal write
**Source:** `~/.claude/skills/cmux/SKILL.md`
> `send_input` returns ok:true even on frozen terminals.
**Implication:** "delivered" ≠ "parsed and acted."
```

---

## 3. Prior research reconciliation (required)

| Prior artifact | Path | Stance | One-line takeaway |
|----------------|------|--------|-------------------|
| … | `~/Gits/.../docs.local/research/...` | BUILD-ON / VALIDATE / REFUTE | … |

Rules:

- Every cited prior file must have an explicit stance.
- "Do not re-derive from scratch" if any row is BUILD-ON or VALIDATE.
- If topic is fully covered → Gate 1 should have stopped you; do not emit a prompt.

---

## 4. Research questions (only after §1–3)

Numbered questions with:

- Expected deliverable shape (schema, decision doc, eval plan)
- Citation requirement for external claims
- **No uncited performance numbers** (fabrication lesson)

---

## 5. Acceptance / deliverable

What "done" looks like — decision doc, seam map, eval plan, etc. Include one **functional** acceptance scenario from the repo (e.g. SHIP-3 fact-propagation for MCL).

---

## 6. Self-check before paste

- [ ] Ran `check-first.sh` — exit 0
- [ ] ≥1 Drive folder named
- [ ] ≥1 real repo path with mechanism + implication
- [ ] Prior-art table complete with stances
- [ ] `score-research-prompt.py` ≥ 8/10 on this draft

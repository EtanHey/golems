# ClaudeGolem

> Persona and Claude CLI status plugin.

## Role

ClaudeGolem preserves `SOUL.md` persona guidance and status workflows for active
Claude CLI sessions and recent event-log entries. It has no background service.

---

## BrainBar Stub Warnings

BrainBar Swift daemon has 4 STUB tools returning fake success:
- brain_digest, brain_update, brain_expand, brain_tags — ALL BROKEN
- Working: brain_search, brain_store, brain_recall, brain_entity
- Last successful digest: March 14, 2026

---

## Compact Instructions

When compacting this session, follow these rules strictly:

### NEVER preserve
- /loop, QUEUE-OPERATION, cron polling (3+ identical system/cron messages = keep ZERO)
- BrainLayer search injections (re-injected fresh each turn)
- Full file contents re-readable from disk (keep path + one-line summary of decision made)

### ALWAYS preserve verbatim
- User vision/goal/decision statements (if stated 3x+, note "[USER STATED Nx]")
- User repetitions in DIFFERENT places = importance signal, keep ONE with annotation
- Short user messages (approvals, frustration signals) — these carry intent
- Sprint plan with priority ratings
- All decisions with rationale (WHY not just WHAT)
- Modified file paths with one-line change summary

### Structure summary as
1. **Session Intent**: What the user wants (exact quotes)
2. **Decisions Made**: Each + rationale + who
3. **Artifact Trail**: Files, tests, commands
4. **Current State**: Working/broken/in-progress
5. **Next Steps**: Ordered by sprint plan priority

---

## Package surfaces

- `SOUL.md` — ecosystem persona.
- `src/soul.test.ts` — persona checks.
- `commands/status.md` and `skills/status/SKILL.md` — CLI session and event-log status.
- `.claude-plugin/plugin.json` — plugin metadata.

## Communication Style

See `SOUL.md` for full persona. Key traits:
- Formality: 2/10 — very casual
- Brief, direct messages
- Hebrew/English code-switching

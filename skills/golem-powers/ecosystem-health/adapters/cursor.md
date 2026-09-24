# Cursor CLI — context-check Adapter

> Cursor has partial context-check support: skills audit + CLAUDE.md fix + Cursor rules.
> No MCP, no hooks — skip those audit steps entirely.

## What Cursor CAN Audit

```bash
# Skills loaded (shared dir — same as Claude Code)
ls ~/.claude/skills/

# Registry lookup
cat ~/.golems/config.yaml | grep -A 50 "contextProfiles"

# Existing CLAUDE.md containerization
cat CLAUDE.md 2>/dev/null | grep -A 20 "CONTAINERIZATION"

# Cursor-specific: check for existing rules
ls .cursor/rules/ 2>/dev/null
cat .cursorrules 2>/dev/null
```

## What Cursor CANNOT Audit

| Feature | Why |
|---------|-----|
| MCP state | Cursor CLI has no MCP support |
| Hooks state | No hook system |
| settings.local.json | Claude Code-specific file |
| .mcp.json | Not applicable |

**Do NOT attempt to audit these.** Report them as "N/A (Claude Code only)" in the output.

## Fix Output: CLAUDE.md Section + Cursor Rules

Cursor can generate two fix outputs:

**1. CLAUDE.md CONTAINERIZATION section** (same as Codex — works everywhere):

```markdown
## CONTAINERIZATION

**You are [identity]. You work ONLY on this app.**

### Skill Allowlist — ONLY Use These
[table from profile.skills.allow]

### Project Rules
[from profile.rules]
```

**2. `.cursor/rules/containerization.md`** (Cursor-specific, enforced by @codebase):

```markdown
# Containerization Rules

You are [identity]. Only use skills from this list: [skills.allow].
Do not use skills or tools unrelated to this project.
```

## Audit Report Format (Cursor)

```text
=== CONTEXT CHECK: <project> (Cursor — partial audit) ===

SKILLS (N allowed, M loaded):
  ✅ Allowed: ...
  ❌ Extra: ...
  ⚠️  Wasted: ~Xk tokens

MCPs: N/A (Cursor has no MCP support)
Hooks: N/A (Cursor has no hook system)

OVERRIDE FILE: N/A (Claude Code-specific)

CURSOR RULES: .cursor/rules/ [checked/written]

FIX: CLAUDE.md CONTAINERIZATION section + .cursor/rules/containerization.md written.
NOTE: For full fix (MCP disable, hooks disable), re-run /context-check in Claude Code.
```

## Unique to Cursor

- `@codebase` indexing — can use whole-repo context when generating rules
- `.cursor/rules/` — Cursor-native rules enforced on every prompt
- Text output mode — `cursor agent --output-format text` for piped audit reports

## Limitations

- Cannot generate `settings.local.json` — Claude Code only
- Cannot disable MCPs or hooks — not applicable
- Cursor rules only affect Cursor sessions (not Claude Code or Codex)

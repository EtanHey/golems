# Codex CLI — context-check Adapter

> Codex has partial context-check support: skills audit + CLAUDE.md fix only.
> No MCP, no hooks — skip those audit steps entirely.

## What Codex CAN Audit

```bash
# Skills loaded (Codex reads from ~/.agents/skills/, not ~/.claude/skills/)
ls ~/.agents/skills/
ls ~/.codex/skills/   # Symlinks into ~/.agents/skills/

# Registry lookup
cat ~/.golems/config.yaml | grep -A 50 "contextProfiles"

# Per-project CLAUDE.md (existing containerization)
cat CLAUDE.md 2>/dev/null | grep -A 20 "CONTAINERIZATION"
```

## What Codex CANNOT Audit

| Feature | Why |
|---------|-----|
| MCP state | Codex has no MCP support |
| Hooks state | Codex has no hook system |
| settings.local.json | Claude Code-specific file |
| .mcp.json | Not applicable |

**Do NOT attempt to audit these.** Report them as "N/A (Claude Code only)" in the output.

## Fix Output: CLAUDE.md Section Only

Codex can only generate the CLAUDE.md CONTAINERIZATION section:

```markdown
## CONTAINERIZATION

**You are [identity]. You work ONLY on this app.**

### Skill Allowlist — ONLY Use These
[table from profile.skills.allow]

### Project Rules
[from profile.rules]
```

Write to the project's CLAUDE.md. Append if exists, create if not.

## Audit Report Format (Codex)

```text
=== CONTEXT CHECK: <project> (Codex — partial audit) ===

SKILLS (N allowed, M loaded from ~/.agents/skills/):
  ✅ Allowed: ...
  ❌ Extra: ...
  ⚠️  Wasted: ~Xk tokens

MCPs: N/A (Codex has no MCP support)
Hooks: N/A (Codex has no hook system)

OVERRIDE FILE: N/A (Claude Code-specific)

FIX: CLAUDE.md CONTAINERIZATION section written.
NOTE: For full fix (MCP disable, hooks disable), re-run /context-check in Claude Code.
```

## Limitations

- Cannot generate `settings.local.json` — Claude Code only
- Cannot disable MCPs or hooks — not applicable to Codex
- Skills audit is still useful even without MCP/hook auditing

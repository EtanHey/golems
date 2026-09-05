---
name: obsidian
description: "Access iCloud Obsidian notes/vault. Triggers: vault, diary, ideas, Hebrew notes, recent notes. NOT BrainLayer."
---

# Obsidian Vault Access

> Direct filesystem access to Obsidian vault. Use this when the Obsidian MCP is unavailable or unreliable.

## Vault Location

```bash
export OBSIDIAN_VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/<your-vault>"
```

**Note:** Set `OBSIDIAN_VAULT` in your shell profile. This is typically an iCloud-synced vault that syncs across devices.

---

## Quick Actions

| What you want to do | How |
|---------------------|-----|
| List recent notes | [workflows/recent.md](workflows/recent.md) |
| Search notes | [workflows/search.md](workflows/search.md) |
| Read a note | [workflows/read.md](workflows/read.md) |
| Create/update note | [workflows/write.md](workflows/write.md) |

---

## Vault Structure

```
personal/
├── Diary/              # Daily entries (MM-DD-YYYY.md)
├── Golems/             # Golems-related ideas and notes
├── Project notes.md    # Project notes
├── מזכרות.md           # Memos (Hebrew)
└── *.md                # Other notes
```

---

## Common Commands

### List Recent Notes (last 7 days)
```bash
VAULT="$OBSIDIAN_VAULT"
find "$VAULT" -name "*.md" -mtime -7 -type f
```

### Search Note Content
```bash
VAULT="$OBSIDIAN_VAULT"
grep -r -l "search term" "$VAULT" --include="*.md"
```

### List All Notes
```bash
VAULT="$OBSIDIAN_VAULT"
find "$VAULT" -name "*.md" -type f | head -30
```

### Read a Note
```bash
cat "$OBSIDIAN_VAULT/Golems/Golems Ideas.md"
```

---

## Key Notes Reference

| Note | Purpose |
|------|---------|
| `Golems/Golems Ideas.md` | Ideas for Golems improvements |
| `Diary/MM-DD-YYYY.md` | Daily diary entries |
| `Project notes.md` | Project notes |
| `מזכרות.md` | General memos |

---

## Safety Rules

1. **Don't delete notes** - Only create or update
2. **Preserve formatting** - Keep existing markdown structure
3. **Respect Hebrew content** - Some notes are in Hebrew, preserve encoding
4. **Backup before bulk changes** - iCloud syncs, but be careful with mass edits

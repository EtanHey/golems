# Read a Note

Read note content from the vault.

## By Full Path

```bash
cat "$OBSIDIAN_VAULT/NoteName.md"
```

## By Relative Path

```bash
VAULT="$OBSIDIAN_VAULT"
cat "$VAULT/Ralph/Ralph Ideas.md"
cat "$VAULT/Diary/01-24-2026.md"
```

## Common Notes

| Note | Command |
|------|---------|
| Ralph Ideas | `cat "$VAULT/Ralph/Ralph Ideas.md"` |
| Today's Diary | `cat "$VAULT/Diary/$(date +%m-%d-%Y).md"` |
| Project Notes | `cat "$VAULT/Project notes.md"` |
| Memos | `cat "$VAULT/מזכרות.md"` |

## Using Read Tool

Prefer the Read tool over cat for better formatting:
```
Read tool with file_path: $OBSIDIAN_VAULT/Ralph/Ralph Ideas.md
```

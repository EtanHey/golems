# List Recent Notes

Find notes modified in the last N days.

## Steps

1. **Set time range** (default 7 days):
```bash
VAULT="$OBSIDIAN_VAULT"
DAYS=7
```

2. **Find recent notes**:
```bash
find "$VAULT" -name "*.md" -mtime -$DAYS -type f -exec ls -lt {} + | head -20
```

3. **Show with modification dates**:
```bash
find "$VAULT" -name "*.md" -mtime -$DAYS -type f -printf "%T+ %p\n" 2>/dev/null | sort -r | head -20
# If printf doesn't work (macOS), use:
find "$VAULT" -name "*.md" -mtime -$DAYS -type f -exec stat -f "%Sm %N" -t "%Y-%m-%d %H:%M" {} \; | sort -r | head -20
```

## Output Format

```
2026-01-25 15:30 /path/to/note.md
2026-01-24 10:15 /path/to/another.md
```

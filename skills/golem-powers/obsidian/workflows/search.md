# Search Notes

Search for content or filenames in the vault.

## Search by Content

```bash
VAULT="$OBSIDIAN_VAULT"
TERM="your search term"

# Find files containing term
grep -r -l -i "$TERM" "$VAULT" --include="*.md"

# Show matching lines with context
grep -r -i -n -C 2 "$TERM" "$VAULT" --include="*.md"
```

## Search by Filename

```bash
VAULT="$OBSIDIAN_VAULT"

# Find by name pattern
find "$VAULT" -name "*pattern*" -type f

# Case insensitive
find "$VAULT" -iname "*pattern*" -type f
```

## Search Hebrew Content

Hebrew search works the same way:
```bash
grep -r -l "מילת חיפוש" "$VAULT" --include="*.md"
```

## Tips

- Use `-i` for case-insensitive search
- Use `-C 2` to show 2 lines of context around matches
- Pipe to `head -20` to limit results

---
name: archive-snapshot
description: Create a timestamped archive of the current PRD state
---

# Archive Snapshot Workflow

Creates a full snapshot of the current PRD state in `docs.local/prd-archive/`.

## When to Use

- Before major PRD restructuring
- At sprint boundaries
- Before experimental changes
- When you want to preserve history without cleanup

## Steps

### 1. Run Archive with --keep Flag

```bash
source ~/.config/golems/ralph.zsh && ralph-archive --keep
```

This creates an archive but keeps the working PRD intact.

### 2. Verify Archive

```bash
ls -la docs.local/prd-archive/
```

You should see a new timestamped directory.

### 3. Check Archive Contents

```bash
# View archive index
cat docs.local/prd-archive/$(ls -t docs.local/prd-archive | head -1)/index.json | jq '.stats'
```

---

## Archive Structure

```
docs.local/prd-archive/<timestamp>/
├── index.json           # Full PRD index
├── stories/             # All story files
│   ├── US-001.json
│   ├── BUG-001.json
│   └── V-001.json
└── progress.txt         # Ralph progress at archive time
```

---

## Multiple Archives

Archives are cumulative - each `ralph-archive` creates a new timestamped directory:

```
docs.local/prd-archive/
├── 20260120-100000/     # Older archive
├── 20260121-140000/     # Mid-sprint archive
└── 20260123-153000/     # Latest archive
```

---

## App-Specific Archives

For multi-app repos:

```bash
ralph-archive frontend --keep
```

Creates: `docs.local/prd-archive/frontend-20260123-153000/`

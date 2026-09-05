# Update Schedule Workflow

Modify existing calendar events.

## Steps

### 1. Show Current Calendar
```bash
cd packages/coach && bun scripts/cal.ts context
```

### 2. Identify Changes
Ask user what needs to change, or infer from context.

### 3. Delete Old Events
```bash
bun scripts/cal.ts delete <eventId>
```
Use the event ID shown in brackets from `today` or `show` output.

### 4. Create Replacement Events
```bash
bun scripts/cal.ts add-date YYYY-MM-DD "Title" HH:MM HH:MM colorId "description"
```

### 5. Verify
```bash
bun scripts/cal.ts show YYYY-MM-DD
```
Confirm no gaps, correct colors, no overlaps.

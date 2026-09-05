# Check Context Workflow

Quick time + calendar check. No modifications.

## Steps

### 1. Show Time Context
```bash
cd packages/coach && bun scripts/cal.ts context
```

### 2. Interpret
Report to user:
- Current circadian phase and what it means
- What they should be doing right now based on phase
- Any anomaly warnings
- Upcoming events

### Phase Guide
| Phase | Recommendation |
|-------|---------------|
| sleep | You should be sleeping |
| waking | Sunlight, hydrate, light movement |
| cortisol-peak | NO caffeine yet, morning routine |
| peak-focus | Deep work NOW — most productive window |
| sustained-work | Continue focused work, take breaks |
| post-lunch-dip | NSDR, light walk, don't fight it |
| afternoon | Moderate work, meetings OK |
| evening | Wind down activities, Chase walk |
| wind-down | No screens, prep for bed |
| late-night | Go to sleep |

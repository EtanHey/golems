# Plan Day Workflow

## Pre-Conditions
Time context + today's events were auto-loaded by the skill runner.

## Steps

### 1. Review Context (already done)
The execute script already ran `bun scripts/cal.ts context`. Check:
- Current circadian phase — is it appropriate to plan?
- Existing events — what's already booked?
- Anomaly warnings — any red flags?

### 2. Determine Target Date
Default: today. If user specified a different date, use that.

### 3. Load Protocol
Protocol is already loaded by `getTimeContext()`. Key timing rules:
- **Wake:** protocol.sleep.targetWake
- **Bed:** protocol.sleep.targetBed
- **Caffeine delay:** protocol.huberman.caffeineDelay.minutesAfterWake
- **Food cutoff:** protocol.huberman.preSleepNoFood.hoursBeforeBed before bed
- **Screen cutoff:** protocol.huberman.preSleepNoScreens.hoursBeforeBed before bed
- **Hard coding stop:** protocol.sleep.hardCodingStop
- **Supplements:** 60 min before bed

### 4. Generate Schedule Blocks
Build the full day from wake to sleep. Rules:
- **ZERO GAPS** — every hour assigned
- **Morning Routine** = single event (wake → first deep work)
- **Deep Work** = 90min-2h blocks minimum
- **Meal timing** follows the user's configured protocol; never assume fasting
- **Dinner** before food cutoff
- **Night Routine** = single event (hardCodingStop → bed)
- **Interview prep rotation** based on day of week (see protocol.career.interviewPrepRotation)

### 5. Create Events
```bash
bun scripts/cal.ts add-date YYYY-MM-DD "Title" HH:MM HH:MM colorId "description"
```
Color IDs: 10=routine, 7=work, 3=events, 5=breaks

### 6. Verify
```bash
bun scripts/cal.ts show YYYY-MM-DD
```
Confirm all events created, no gaps, correct colors.

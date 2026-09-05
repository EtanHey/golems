# Storage Audit Prompt for Claude Code

> Copy-paste this into a new Claude Code session on this repo.
> Last updated: 2026-02-06 after recovering 52GB.

---

## Prompt

You are running a full macOS storage audit. Your job is to scan the system for storage waste, identify what's safe to remove, and produce a structured report. Do NOT delete anything — only report.

### Phase 1: Disk Overview

Run `df -h /` and report current usage. Then scan these directories with `du -sh` (sorted by size, top 20 each):

1. `~/Library/Application Support/*/` — app data
2. `~/Library/Developer/*/` — Xcode, simulators
3. `~/Library/Caches/*/` — app caches
4. `~/Library/Containers/*/` — sandboxed app data
5. `~/Library/Group Containers/*/` — shared app data
6. `~/Library/` top-level (Android SDK, pnpm, etc.)
7. `/Applications/*.app` — installed apps with sizes
8. `~/.cursor/extensions/` — IDE extensions
9. `~/.bun/` — Bun cache
10. `~/Gits/*/node_modules`, `~/Gits/*/.next` — project build artifacts

### Phase 2: Ghost App Detection

For every directory in `~/Library/Application Support/`, check if a matching `.app` exists in `/Applications/`. If no app is found, it's ghost data from an uninstalled app. Report each one with its size.

Also check for ghost data in:
- `~/Library/Caches/`
- `~/Library/Containers/`
- `~/Library/Preferences/`
- `~/Library/Saved Application State/`

### Phase 3: Staleness Analysis

For every app in `/Applications/*.app`, get:
- **Size** (`du -sh`)
- **Last used date** (`mdls -name kMDItemLastUsedDate`, fallback to `stat -f "%Sm"`)
- **Associated data size** (sum of Application Support + Caches + Containers)

Flag anything not used in 3+ months. Flag anything not used in 6+ months as HIGH PRIORITY.

### Phase 4: Recurring Growth Detection

Identify directories that grow over time by checking:

1. **Wispr Flow backups** — `~/Library/Application Support/Wispr Flow/backups/` — count files, total size, oldest/newest dates
2. **Xcode simulators** — `~/Library/Developer/CoreSimulator/Devices/` — count devices, size each, modification dates. Flag any older than 30 days.
3. **Xcode DerivedData** — `~/Library/Developer/Xcode/DerivedData/` — size per project, age
4. **iOS DeviceSupport** — `~/Library/Developer/Xcode/iOS DeviceSupport/` — multiple versions of same device symbols
5. **Claude Desktop VM** — `~/Library/Application Support/Claude/vm_bundles/` — check image sizes
6. **Cursor extensions** — old versions piling up in `~/.cursor/extensions/`
7. **WhatsApp media** — `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media/` — check growth rate (files from last 3 days vs total)
8. **Log files** — `~/Library/Logs/`, `/var/log/` — anything over 50MB

### Phase 5: Large Recent Files

Find files >50MB modified in the last 7 days:
```bash
find ~ -type f -mtime -7 -size +50M 2>/dev/null | grep -v node_modules | grep -v ".git/objects"
```

### Phase 6: Android SDK Audit (if exists)

If `~/Library/Android/sdk/` exists, break down:
- NDK versions (often 3GB+ each, rarely needed for Expo)
- System images (only needed for emulator)
- Build tool versions (keep only latest)
- Emulator (only needed if no physical device)

### Phase 7: Browser Data Audit

For each browser (Chrome, Arc, Brave, Firefox, Zen, Safari):
- Check if app is installed
- Check Application Support data size
- Check Cache size
- Flag browsers not used in 3+ months
- Note: Brave is the primary browser — keep it, but flag old cache

### Output Format

Produce a markdown report with these sections:

```markdown
## Storage Audit Report — [DATE]

### Current State
- Total: X GB | Used: X GB | Free: X GB (X%)

### Immediate Wins (safe to delete now)
| Item | Size | Why safe | Command |
|------|------|----------|---------|

### Ghost App Data (uninstalled apps)
| Directory | Size | Original App |
|-----------|------|-------------|

### Stale Apps (installed but unused)
| App | Size (app+data) | Last Used | Recommendation |
|-----|-----------------|-----------|----------------|

### Recurring Growers (need monitoring)
| What | Current Size | Growth Rate | Mitigation |
|------|-------------|-------------|------------|

### Keep (with reason)
| Item | Size | Why Keep |
|------|------|----------|
| Example | 1.2GB | Contains private data / actively used / needed for builds |

### Manual Actions Required
Items that need Finder/Launchpad (Mac App Store apps, SIP-protected):
- ...

### Estimated Recovery
Total reclaimable: ~X GB
```

### UX Flow (MANDATORY)

1. **Announce first** — Before scanning anything, tell the user:
   > "I'm about to run a thorough storage checkup on your Mac. This is read-only — I won't delete, move, or modify anything. I'll scan your disk, identify waste, and give you a full report. You decide what to do with it."
2. **Run all 7 phases** — Collect everything silently (no incremental "should I delete this?" questions)
3. **Present the full report** — Show the complete markdown report (format above)
4. **Ask what to delete** — After the report, ask: "Which items would you like me to clean up? You can pick by category (e.g. 'all ghost app data') or specific items. I'll show you the exact commands before running anything."
5. **Confirm before each action** — Show the exact `rm` or cleanup command, wait for approval, then execute

### Important Rules

1. **NEVER delete anything without explicit user approval** — report first, ask second, act third
2. **No incremental prompts during scanning** — collect everything, report once
3. **Check before flagging** — verify an app is actually unused before recommending deletion
4. **Privacy-sensitive items** — if data looks personal (messages, photos, credentials), mark as "KEEP — private data" and don't explore further
5. **Mac App Store apps** — note these can't be deleted via CLI (need Launchpad)
6. **Container dirs** — `~/Library/Containers/` are often macOS-protected, note this
7. **Build tools** — check if Expo/React Native projects need Android SDK before recommending deletion
8. **Flag the weekly cleanup script** — check if `com.golems.storage-cleanup` launchd job is running and report its last run from `~/.golems-zikaron/storage-cleanup.log`

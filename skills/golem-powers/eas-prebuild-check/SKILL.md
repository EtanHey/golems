---
name: eas-prebuild-check
description: "Validate Expo iOS/Android sync before first EAS build. Triggers: eas build, prebuild, credentials."
execute: scripts/check.sh
---

# EAS Prebuild Check

> **Mission:** catch the 9 pain points that wasted 2+ hours on TaskOwl Sprint 2 (April 8, 2026) BEFORE they waste any more time on future builds.

## What it does

Runs 9 discrete checks against an Expo project, each reporting PASS / FAIL / WARN / SKIP / INFO with specific remediation commands.

| # | Check | Prevents |
|---|-------|----------|
| 1 | `.easignore` exists and excludes `node_modules`, `.expo`, build dirs | 2.1GB archive upload (real: TaskOwl first attempt) |
| 2 | Archive size estimate < 100MB | Concurrency waste, slow uploads |
| 3 | `eas-cli` is latest | Warnings + compat bugs |
| 4 | Bundle ID not a suspicious default (e.g., `com.yourname.fromtoday`) | Building under wrong App Store ID |
| 5 | `version`, `ios.buildNumber`, `android.versionCode` present and consistent | Apple Connect conflicts, re-submit blockers |
| 6 | At least 1 iOS device registered (for preview ad-hoc builds) | "No registered devices" blocker |
| 7 | iOS credentials (cert + provisioning profile) pre-synced | Mid-build Apple 2FA surprises |
| 8 | Android keystore ready (or EAS-managed configured) | Mid-build keystore prompt |
| 9 | Concurrency awareness (free vs paid tier) | Surprise serial queue |

**Bonus warnings:** P8 APNs key presence (if push enabled), active `eas whoami` matches `app.json` owner, managed vs bare workflow detection.

## When to use

- **Before the first EAS build** on any new Expo project
- **After major dependency changes** (new native modules, Expo SDK bumps)
- **When switching branches** that touch `app.json` or native projects
- **When inheriting someone else's Expo project**
- **Before a production build** (to catch version drift)

**Do NOT use for:** debugging an in-progress build (use `eas build:inspect`), post-build validation, or issues unrelated to EAS submission.

## Usage

```bash
# Run all checks for both platforms, preview profile (default)
/eas-prebuild-check

# Scope to iOS or Android
/eas-prebuild-check --platform ios
/eas-prebuild-check --platform android

# Auto-fix safe items (writes .easignore, prompts for eas-cli upgrade)
/eas-prebuild-check --fix

# Production profile (skips device-registration check)
/eas-prebuild-check --profile production

# Machine-readable JSON output for CI/CD
/eas-prebuild-check --json
```

**Exit codes:**
- `0` — all checks pass (or only WARN/INFO)
- `1` — at least one FAIL (do NOT run `eas build`)
- `2` — script error (missing `eas-cli`, not in an Expo project)

## How it decides what's safe to auto-fix

`--fix` applies only LOSSLESS, REVERSIBLE changes:

| Auto-fix | Skill does it? | Why |
|----------|----------------|-----|
| Write missing `.easignore` | ✓ YES | New file, no data loss |
| Upgrade `eas-cli` | ✓ YES (with user confirm) | Reversible via `npm install -g eas-cli@<prev>` |
| Change bundle ID | ✗ NO | Requires human judgment (branding, App Store reservations) |
| Register devices | ✗ NO | Needs physical device UDID |
| Configure credentials | ✗ NO | Apple 2FA flow, user must be present |
| Bump version/buildNumber | ✗ NO | Release decisions need human approval |

Any file change triggers a diff preview + backup to `.eas-prebuild-check.backup/`.

## Example output

```
# EAS Prebuild Check — taskowl-app
Profile: preview | Platform: both | Account: user@example.com

[1/9] .easignore exists ........................... ✗ FAIL
      node_modules not excluded. Estimated archive: 2.1 GB
      Fix: /eas-prebuild-check --fix
           (writes canonical .easignore from template)

[2/9] Archive size <100MB ......................... ⊘ SKIPPED
      Depends on [1]

[3/9] eas-cli up to date .......................... ⚠ WARN
      Installed: 17.2.1 | Latest: 18.5.0
      Fix: npm install -g eas-cli@latest

[4/9] Bundle ID consistency ....................... ⚠ WARN
      iOS: com.yuvalnir.fromtoday  ← suspicious scaffold default
      Android: com.yuvalnir.fromtoday
      Fix: edit app.json expo.ios.bundleIdentifier and expo.android.package

[5/9] Version sync ................................ ✓ OK
      version: 1.0.0 | iOS buildNumber: 1 | Android versionCode: 1

[6/9] iOS devices registered ...................... ✗ FAIL
      0 devices registered. Preview = ad-hoc distribution; needs ≥1 UDID.
      Fix: eas device:create

[7/9] iOS credentials synced ...................... ✗ FAIL
      No distribution certificate. No provisioning profile.
      Fix: eas credentials:configure -p ios --profile preview

[8/9] Android keystore ready ...................... ✓ OK
      EAS-managed keystore configured.

[9/9] Concurrency awareness ....................... ℹ INFO
      Account tier: FREE (1 concurrent build)
      iOS + Android together ≈ 40-60min queue time.

## Summary
  ✓ Passed: 2   ⚠ Warnings: 2   ✗ Failed: 3   ⊘ Skipped: 1   ℹ Info: 1

## Recommended order
  1. /eas-prebuild-check --fix  (auto-fixes 1, 3)
  2. Edit app.json bundle IDs (check 4)
  3. eas device:create            (check 6)
  4. eas credentials:configure -p ios --profile preview  (check 7)
  5. Re-run /eas-prebuild-check

  DO NOT run `eas build` until all FAIL items are resolved.
```

## Files in this skill

```
eas-prebuild-check/
├── SKILL.md                    # This file
├── scripts/
│   ├── check.sh               # Main dispatcher (runs all checks)
│   └── checks/
│       ├── 01-easignore.sh
│       ├── 02-archive-size.sh
│       ├── 03-eas-cli-version.sh
│       ├── 04-bundle-id.sh
│       ├── 05-version-sync.sh
│       ├── 06-ios-devices.sh
│       ├── 07-ios-credentials.sh
│       ├── 08-android-keystore.sh
│       └── 09-concurrency.sh
└── templates/
    └── .easignore              # Canonical template
```

## Related skills

- `/pr-loop` — run this BEFORE the PR loop when a PR touches native build config
- `/never-fabricate` — Read() the actual `eas build` output, don't trust "looks fine" from this skill alone
- the false-green-gate hook — enforces the order: run this skill, verify exit 0, THEN claim ready to build

## Provenance

Built from TaskOwl Sprint 2 EAS build lessons (April 8, 2026), BrainLayer tags: `eas-build`, `taskowl`, `skill-needed`, `lessons-learned`. Plan: `$ORCHESTRATOR_ROOT/docs.local/plans/eas-build-v1/README.md`.

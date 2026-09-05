# App Onboarding Runbook (GREEN fixture)

> Correct privilege split, a prereq preflight before any cask, and on-disk bundle
> verification. The prose prohibition in Phase B intentionally names `brew install`
> to prove the linter does not false-fire on prose (only fenced code blocks are scanned).

## Prerequisites (Phase 0 preflight)

- Homebrew exists at `/opt/homebrew/bin/brew`.
- The `worker` macOS account exists as a **Standard** user.
- `bun` and the shared env file are present.

## Phase A - Admin Etan: One-Time Machine-Wide Setup

Run this phase from the admin account.

```bash
brew tap EtanHey/layers
brew trust etanhey/layers
brew install --cask brainbar voicebar
```

## Phase B - worker (Standard user): Install in User Space

The `worker` Standard user must NOT run `brew install`, `sudo`, or `npm install -g`
into `/opt/homebrew`. Install into user space only:

```bash
curl -L https://example.test/app.zip -o ~/Applications/App.zip
unzip ~/Applications/App.zip -d ~/Applications/
```

## Phase C - End-State Verification

Verify the on-disk bundle, not just the cask receipt:

```bash
ls /Applications/BrainBar.app
/Applications/BrainBar.app/Contents/MacOS/BrainBar --version
brew list --cask brainbar
```

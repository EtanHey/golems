# Bad App Onboarding Runbook (RED fixture)

> Intentionally violates every linter rule. Used as the RED replay case.

The runbook names the standard account `happy-camper`, then later mistypes it as
`happy-campep`.

## Phase A - happy-camper (Standard user): Install Everything

Just have the Standard user do it all:

```bash
brew tap EtanHey/layers
brew trust etanhey/layers
brew install --cask brainbar voicebar
sudo mkdir -p /opt/app-data
bun install
```

## Phase B - Verify the install

```bash
brew list --cask brainbar && echo "BrainBar installed"
```

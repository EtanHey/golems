# Install Dependencies Workflow

Install missing dependencies via Homebrew.

---

## Prerequisites

Homebrew must be installed. Check with:

```bash
brew --version
```

If not installed:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

---

## Install All Missing Dependencies

Run this script to install everything:

```bash
#!/bin/bash
echo "Installing golems dependencies..."

# Update Homebrew
brew update

# Install CLIs
brew install gh          # GitHub CLI
brew install --cask 1password-cli  # 1Password CLI
brew install gum         # Interactive prompts
brew install fswatch     # File watching
brew install jq          # JSON processing
brew install oven-sh/bun/bun  # Bun runtime for TypeScript skills

# Install CodeRabbit CLI (optional, for code review skill)
if ! command -v cr &>/dev/null; then
  echo "Installing CodeRabbit CLI..."
  curl -fsSL https://coderabbit.ai/install.sh | bash
fi

echo ""
echo "Installation complete! Run check-deps workflow to verify."
```

---

## Individual Installation

### GitHub CLI

```bash
brew install gh
```

After install, authenticate:
```bash
gh auth login
```

Select: GitHub.com > HTTPS > Yes (authenticate with browser)

### 1Password CLI

```bash
brew install --cask 1password-cli
```

After install, connect to 1Password app:
1. Open 1Password desktop app
2. Settings > Developer > Command-Line Interface
3. Enable "Integrate with 1Password CLI"
4. Enable "Touch ID" for biometric unlock

Then sign in:
```bash
op signin
```

### Gum

```bash
brew install gum
```

Verify:
```bash
gum --version
```

### fswatch

```bash
brew install fswatch
```

Verify:
```bash
fswatch --version
```

### jq

```bash
brew install jq
```

Verify:
```bash
jq --version
```

### Bun (TypeScript Runtime)

Required for TypeScript-based golem-powers skills.

```bash
brew install oven-sh/bun/bun
```

Verify:
```bash
bun --version
```

### CodeRabbit CLI (Optional)

For the `/coderabbit` code review skill.

```bash
curl -fsSL https://coderabbit.ai/install.sh | bash
```

Verify:
```bash
cr --version
```

**Note:** CodeRabbit requires an account. Sign up at https://coderabbit.ai.

---

## Troubleshooting

### brew: command not found

Install Homebrew first (see Prerequisites above).

### Permission denied errors

Fix Homebrew permissions:
```bash
sudo chown -R $(whoami) /usr/local/Homebrew
```

### Package already installed

Update to latest:
```bash
brew upgrade <package>
```

### 1Password CLI won't connect to app

Ensure:
1. 1Password 8 (not 7) is installed
2. CLI integration is enabled in app settings
3. Both app and CLI are same architecture (both ARM or both Intel)

---

## Next Steps

After installing all dependencies:
1. Run [check-deps](check-deps.md) to verify
2. Proceed to [setup-tokens](setup-tokens.md) for API configuration

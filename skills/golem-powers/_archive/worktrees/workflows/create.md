# Create Worktree

Create an isolated git worktree for a new branch with full environment setup.

---

## Quick Workflow

### Step 1: Verify you're in a git repository

```bash
git rev-parse --git-dir >/dev/null 2>&1 || { echo "ERROR: Not in a git repository"; exit 1; }
```

### Step 2: Ensure on main branch

```bash
git checkout main 2>/dev/null || git checkout master 2>/dev/null || echo "Already on working branch"
```

### Step 3: Create the worktree

Replace `feature-name` with your branch name:

```bash
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
BRANCH_NAME="feature-name"
WORKTREE_PATH="$HOME/worktrees/$REPO_NAME/$BRANCH_NAME"
SOURCE_REPO=$(git rev-parse --show-toplevel)

# Ensure parent directory exists
mkdir -p "$HOME/worktrees/$REPO_NAME"

# Create worktree with new branch
git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME"

echo "Worktree created at: $WORKTREE_PATH"
```

### Step 4: Setup Environment (CRITICAL)

After creating worktree, set up environment files and dependencies:

```bash
cd "$WORKTREE_PATH"

# --- ENV FILE HANDLING ---
# Priority: 1Password > Copy from source

# Check if .env.template exists (1Password mode)
if [[ -f ".env.template" ]] && command -v op &>/dev/null; then
  echo "Found .env.template - using 1Password to inject secrets..."
  if op inject -i .env.template -o .env.local 2>/dev/null; then
    echo "✓ Created .env.local via 1Password"
  else
    echo "⚠ 1Password inject failed, falling back to copy..."
    [[ -f "$SOURCE_REPO/.env.local" ]] && cp "$SOURCE_REPO/.env.local" .env.local && echo "✓ Copied .env.local"
  fi
else
  # No template - copy all .env*.local files from source
  echo "Copying environment files from source repo..."
  for envfile in "$SOURCE_REPO"/.env*.local; do
    [[ -f "$envfile" ]] && cp "$envfile" . && echo "✓ Copied $(basename "$envfile")"
  done
fi

# --- DEPENDENCY INSTALLATION ---
# Auto-detect package manager and install

if [[ -f "package.json" ]]; then
  echo "Installing Node.js dependencies..."
  if [[ -f "bun.lockb" ]]; then
    bun install
  elif [[ -f "pnpm-lock.yaml" ]]; then
    pnpm install
  elif [[ -f "yarn.lock" ]]; then
    yarn install
  else
    npm install
  fi
  echo "✓ Dependencies installed"
fi

# Python
if [[ -f "requirements.txt" ]]; then
  pip install -r requirements.txt
elif [[ -f "pyproject.toml" ]]; then
  poetry install 2>/dev/null || pip install -e .
fi

# Rust
[[ -f "Cargo.toml" ]] && cargo build

# Go
[[ -f "go.mod" ]] && go mod download

echo ""
echo "✓ Worktree ready at: $WORKTREE_PATH"
```

---

## Full Automated Script

Copy and run (replace branch name):

```bash
#!/bin/bash
set -e

BRANCH_NAME="${1:-feature-new-branch}"
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
SOURCE_REPO=$(git rev-parse --show-toplevel)
WORKTREE_PATH="$HOME/worktrees/$REPO_NAME/$BRANCH_NAME"

# Verify in git repo
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: Not in a git repository"
  exit 1
fi

# Check if branch already exists
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Branch '$BRANCH_NAME' already exists."
  echo "Creating worktree from existing branch..."
  git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
else
  echo "Creating new branch and worktree..."
  mkdir -p "$HOME/worktrees/$REPO_NAME"
  git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME"
fi

cd "$WORKTREE_PATH"

# --- ENV FILE HANDLING (1Password first, fallback to copy) ---
if [[ -f ".env.template" ]] && command -v op &>/dev/null; then
  echo "Injecting secrets via 1Password..."
  op inject -i .env.template -o .env.local 2>/dev/null || {
    echo "1Password failed, copying from source..."
    [[ -f "$SOURCE_REPO/.env.local" ]] && cp "$SOURCE_REPO/.env.local" .env.local
  }
else
  # Copy all .env*.local files
  for envfile in "$SOURCE_REPO"/.env*.local; do
    [[ -f "$envfile" ]] && cp "$envfile" .
  done
fi

# --- INSTALL DEPENDENCIES ---
if [[ -f "package.json" ]]; then
  if [[ -f "bun.lockb" ]]; then bun install
  elif [[ -f "pnpm-lock.yaml" ]]; then pnpm install
  elif [[ -f "yarn.lock" ]]; then yarn install
  else npm install
  fi
fi

[[ -f "requirements.txt" ]] && pip install -r requirements.txt
[[ -f "pyproject.toml" ]] && poetry install 2>/dev/null
[[ -f "Cargo.toml" ]] && cargo build
[[ -f "go.mod" ]] && go mod download

echo ""
echo "✓ Worktree created successfully!"
echo "Path: $WORKTREE_PATH"
echo ""
echo "Run: cd $WORKTREE_PATH"
```

---

## Branch Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/<description>` | `feature/user-auth` |
| Bug fix | `fix/<description>` | `fix/login-redirect` |
| Refactor | `refactor/<description>` | `refactor/api-client` |
| Docs | `docs/<description>` | `docs/readme-update` |

---

## Environment Strategy

| Condition | Action |
|-----------|--------|
| `.env.template` exists + `op` available | Use `op inject` to generate `.env.local` |
| `op inject` fails | Fallback: copy from source repo |
| No `.env.template` | Copy all `.env*.local` from source |
| No env files in source | Skip (worktree starts without env) |

---

## Options

### Create from remote branch

If working on someone else's branch:

```bash
git fetch origin
git worktree add "$HOME/worktrees/$REPO_NAME/their-branch" origin/their-branch
```

### Create from specific commit

```bash
git worktree add "$HOME/worktrees/$REPO_NAME/detached" -d abc123
```

---

## Next Steps

After creating worktree:
1. `cd ~/worktrees/<repo>/<branch>`
2. Verify environment: `cat .env.local | head -5`
3. Start development

When done, use [cleanup.md](cleanup.md) to remove the worktree.

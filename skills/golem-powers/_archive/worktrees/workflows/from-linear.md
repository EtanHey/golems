# Create Worktree from Linear Issue

Create an isolated git worktree for a Linear issue, using Linear's auto-generated branch name.

---

## Prerequisites

Ensure Linear API key is configured:

```bash
LINEAR_KEY=$(op read "op://Private/linear/api-key" 2>/dev/null)
[ -z "$LINEAR_KEY" ] && echo "ERROR: Linear API key not found" && exit 1
```

---

## Quick Workflow

### Step 1: Fetch issue details

Replace `ENG-123` with your issue identifier:

```bash
ISSUE_ID="ENG-123"
LINEAR_KEY=$(op read "op://Private/linear/api-key")

ISSUE_DATA=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_KEY" \
  --data "{
    \"query\": \"query GetIssue(\$id: String!) { issue(id: \$id) { id identifier title branchName } }\",
    \"variables\": { \"id\": \"$ISSUE_ID\" }
  }" \
  https://api.linear.app/graphql)

echo "$ISSUE_DATA" | jq '.data.issue'
```

### Step 2: Create worktree with Linear's branch name

Linear auto-generates sanitized branch names:

```bash
BRANCH_NAME=$(echo "$ISSUE_DATA" | jq -r '.data.issue.branchName')
IDENTIFIER=$(echo "$ISSUE_DATA" | jq -r '.data.issue.identifier')
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREE_PATH="$HOME/worktrees/$REPO_NAME/$BRANCH_NAME"

# Create worktree
mkdir -p "$HOME/worktrees/$REPO_NAME"
git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME"

echo "Worktree created: $WORKTREE_PATH"
echo "Run: cd $WORKTREE_PATH"
```

---

## Full Automated Script

Copy and run (replace ENG-123):

```bash
#!/bin/bash
set -e

ISSUE_ID="${1:-ENG-123}"

# Get Linear API key from 1Password
LINEAR_KEY=$(op read "op://Private/linear/api-key" 2>/dev/null)
if [ -z "$LINEAR_KEY" ]; then
  echo "ERROR: Linear API key not found in 1Password"
  echo "Add with: op item create --category 'API Credential' --title 'linear' --vault 'Private' 'api-key=lin_api_...'"
  exit 1
fi

# Verify in git repo
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: Not in a git repository"
  exit 1
fi

# Fetch issue from Linear
ISSUE_DATA=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_KEY" \
  --data "{
    \"query\": \"query GetIssue(\$id: String!) { issue(id: \$id) { id identifier title branchName } }\",
    \"variables\": { \"id\": \"$ISSUE_ID\" }
  }" \
  https://api.linear.app/graphql)

# Extract fields
BRANCH_NAME=$(echo "$ISSUE_DATA" | jq -r '.data.issue.branchName')
IDENTIFIER=$(echo "$ISSUE_DATA" | jq -r '.data.issue.identifier')
TITLE=$(echo "$ISSUE_DATA" | jq -r '.data.issue.title')

if [ "$BRANCH_NAME" = "null" ]; then
  echo "ERROR: Issue $ISSUE_ID not found in Linear"
  exit 1
fi

REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREE_PATH="$HOME/worktrees/$REPO_NAME/$BRANCH_NAME"

echo "Creating worktree for: $IDENTIFIER - $TITLE"
echo "Branch: $BRANCH_NAME"
echo "Path: $WORKTREE_PATH"
echo ""

# Create worktree
mkdir -p "$HOME/worktrees/$REPO_NAME"

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Branch exists, using existing..."
  git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
else
  git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME"
fi

cd "$WORKTREE_PATH"

# --- ENV FILE HANDLING (1Password first, fallback to copy) ---
SOURCE_REPO=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [[ -f ".env.template" ]] && command -v op &>/dev/null; then
  echo "Injecting secrets via 1Password..."
  op inject -i .env.template -o .env.local 2>/dev/null || {
    echo "1Password failed, copying from source..."
    [[ -n "$SOURCE_REPO" && -f "$SOURCE_REPO/.env.local" ]] && cp "$SOURCE_REPO/.env.local" .env.local
  }
else
  # Copy all .env*.local files
  for envfile in "$SOURCE_REPO"/.env*.local; do
    [[ -f "$envfile" ]] && cp "$envfile" . && echo "Copied $(basename "$envfile")"
  done
fi

# --- INSTALL DEPENDENCIES ---
if [[ -f "package.json" ]]; then
  echo "Installing dependencies..."
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
echo ""
echo "Run: cd $WORKTREE_PATH"
```

---

## Custom Branch Name Format

If you prefer a different branch naming convention instead of Linear's auto-generated name:

### Using type prefix (feature/ENG-123-description)

```bash
IDENTIFIER=$(echo "$ISSUE_DATA" | jq -r '.data.issue.identifier')
TITLE=$(echo "$ISSUE_DATA" | jq -r '.data.issue.title' | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | head -c 30)
BRANCH_NAME="feature/${IDENTIFIER}-${TITLE}"
# Result: feature/ENG-123-add-user-auth
```

### Using identifier only

```bash
BRANCH_NAME=$(echo "$ISSUE_DATA" | jq -r '.data.issue.identifier | ascii_downcase')
# Result: eng-123
```

### Using fix prefix for bugs

```bash
IDENTIFIER=$(echo "$ISSUE_DATA" | jq -r '.data.issue.identifier')
TITLE=$(echo "$ISSUE_DATA" | jq -r '.data.issue.title' | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-' | head -c 30)
BRANCH_NAME="fix/${IDENTIFIER}-${TITLE}"
# Result: fix/ENG-456-login-redirect
```

---

## Update Linear Issue State

Optionally move issue to "In Progress" after creating worktree:

```bash
# Get "In Progress" state ID
STATE_DATA=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_KEY" \
  --data '{"query": "{ workflowStates(filter: { type: { eq: \"started\" } }) { nodes { id name } } }"}' \
  https://api.linear.app/graphql)

STATE_ID=$(echo "$STATE_DATA" | jq -r '.data.workflowStates.nodes[0].id')
ISSUE_UUID=$(echo "$ISSUE_DATA" | jq -r '.data.issue.id')

# Update issue state
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_KEY" \
  --data "{
    \"query\": \"mutation UpdateIssue(\$id: String!, \$input: IssueUpdateInput!) { issueUpdate(id: \$id, input: \$input) { success } }\",
    \"variables\": {
      \"id\": \"$ISSUE_UUID\",
      \"input\": { \"stateId\": \"$STATE_ID\" }
    }
  }" \
  https://api.linear.app/graphql | jq '.data.issueUpdate'
```

---

## Troubleshooting

**"Issue not found" error?**
- Check the issue identifier is correct (e.g., ENG-123, not just 123)
- Verify API key has access to the team/project

**"branchName is null"?**
- Very old issues may not have auto-generated branch names
- Use custom branch format instead (see above)

**"branch already exists" error?**
- Branch was created previously
- Worktree will use existing branch

**Linear API key not found?**
- Add to 1Password: `op item create --category "API Credential" --title "linear" --vault "Private" "api-key=lin_api_..."`
- See [Linear skill](../../../linear/SKILL.md) for setup

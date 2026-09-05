# List Secrets Workflow

Imperative instructions for listing and finding secrets in 1Password.

---

## List All Items in Default Vault

### Step 1: Get all items

Run:
```bash
op item list
```

Output shows: Name, ID, Vault, Updated timestamp.

### Step 2: For more detail

Run:
```bash
op item list --format=json | jq '.[] | {title, id, vault: .vault.name, category, updated_at}'
```

---

## List Items in Specific Vault

### Step 1: List available vaults

Run:
```bash
op vault list
```

### Step 2: List items in vault

Run:
```bash
op item list --vault "VaultName"
```

---

## Search by Name

Run:
```bash
op item list | grep -i "search-term"
```

Or with fuzzy matching:
```bash
op item list --format=json | jq -r '.[] | .title' | grep -i "term"
```

---

## Search by Tag

Run:
```bash
op item list --tags "tag-name"
```

Multiple tags (AND):
```bash
op item list --tags "tag1,tag2"
```

---

## Filter by Category

Available categories: Login, Password, SecureNote, CreditCard, Identity, Document, API_CREDENTIAL

Run:
```bash
op item list --categories "Password"
```

---

## Get Item Details

### Step 1: Find item ID

Run:
```bash
op item list | grep -i "item-name"
```

### Step 2: Get full details

Run:
```bash
op item get "item-name-or-id"
```

### Step 3: Get specific field

Run:
```bash
op item get "item-name" --fields password
```

Or for custom fields:
```bash
op item get "item-name" --fields "label=fieldname"
```

---

## Get op:// Reference for a Secret

Use this to get the reference format for configs:

Run:
```bash
op item get "item-name" --vault "VaultName" --format=json | jq -r '"op://\(.vault.name)/\(.title)/password"'
```

Output format: `op://VaultName/ItemName/password`

---

## List Items by Project/Service (Ralph Format)

Ralph organizes secrets as: `{project}/{service}/{key}`

List all secrets for a project:
```bash
op item list | grep "^myproject/"
```

List all secrets for a service across projects:
```bash
op item list | grep "/anthropic/"
```

---

## Export Item List (Backup)

Run:
```bash
op item list --format=json > items-backup-$(date +%Y%m%d).json
```

**Note:** This exports metadata only, not actual secret values.

---

## Troubleshooting

**"not signed in" error?**
- Run: `op signin`
- Or see [troubleshoot.md](troubleshoot.md)

**Empty results but items exist?**
- Check you're querying the correct vault: `op vault list`
- Specify vault: `op item list --vault "VaultName"`

**Permission denied?**
- Your 1Password account may not have access to that vault
- Check with vault owner or use `op vault list` to see accessible vaults

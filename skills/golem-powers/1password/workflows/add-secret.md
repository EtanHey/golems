# Add Secret Workflow

Imperative instructions for creating new secrets in 1Password.

---

## Create a Password/API Key

### Step 1: Verify vault access

Run:
```bash
op vault list
```

Identify the target vault name.

### Step 2: Create item

Run:
```bash
op item create --category "Password" \
  --title "item-title" \
  --vault "VaultName" \
  "password=your-secret-value"
```

### Step 3: Verify creation

Run:
```bash
op item get "item-title" --vault "VaultName"
```

Success: Shows item details with created timestamp.

---

## Create with Ralph Naming Convention

Ralph uses: `{project}/{service}/{key}` format.

### Step 1: Create with project/service path

Run:
```bash
op item create --category "Password" \
  --title "myproject/anthropic/API_KEY" \
  --vault "Private" \
  "password=sk-ant-..."
```

### Step 2: Get op:// reference

Run:
```bash
echo "op://Private/myproject/anthropic/API_KEY/password"
```

Use this reference in .env.template files.

---

## Create API Credential

For services with multiple fields (API key + secret):

Run:
```bash
op item create --category "API_CREDENTIAL" \
  --title "myproject/stripe/credentials" \
  --vault "Private" \
  "credential=sk_live_..." \
  "Section.Additional.secret=whsec_..."
```

---

## Create with Tags

Run:
```bash
op item create --category "Password" \
  --title "myproject/db/CONNECTION_STRING" \
  --vault "Private" \
  --tags "production,database" \
  "password=postgresql://..."
```

---

## Create from Stdin (Secure)

For sensitive values, avoid command history:

Run:
```bash
read -s SECRET_VALUE
op item create --category "Password" \
  --title "myproject/service/KEY" \
  --vault "Private" \
  "password=$SECRET_VALUE"
unset SECRET_VALUE
```

---

## Update Existing Secret

### Step 1: Find the item

Run:
```bash
op item list | grep "item-name"
```

### Step 2: Update value

Run:
```bash
op item edit "item-name" --vault "VaultName" "password=new-value"
```

### Step 3: Verify update

Run:
```bash
op item get "item-name" --vault "VaultName" --fields password
```

---

## Create Secure Note

For documentation or multi-line secrets:

Run:
```bash
op item create --category "SecureNote" \
  --title "myproject/config/notes" \
  --vault "Private" \
  "notesPlain=Your notes here..."
```

For multi-line:
```bash
op item create --category "SecureNote" \
  --title "myproject/config/cert" \
  --vault "Private" \
  "notesPlain=$(cat certificate.pem)"
```

---

## Batch Create from JSON

### Step 1: Create items.json

```json
[
  {"title": "proj/svc1/KEY", "password": "value1"},
  {"title": "proj/svc2/KEY", "password": "value2"}
]
```

### Step 2: Create items in loop

Run:
```bash
jq -c '.[]' items.json | while read item; do
  title=$(echo "$item" | jq -r '.title')
  pw=$(echo "$item" | jq -r '.password')
  op item create --category "Password" --title "$title" --vault "Private" "password=$pw"
done
```

**Important:** Delete items.json after import: `rm items.json`

---

## Troubleshooting

**"item already exists" error?**
- Use `op item edit` to update existing item
- Or delete first: `op item delete "item-name" --vault "VaultName"`

**"vault not found" error?**
- Run: `op vault list` to see available vaults
- Check vault name spelling and case

**"not signed in" error?**
- Run: `op signin`
- Or see [troubleshoot.md](troubleshoot.md)

**Want to see all categories?**
- Categories: Login, Password, SecureNote, CreditCard, Identity, Document, API_CREDENTIAL, Server, Database, SSHKey

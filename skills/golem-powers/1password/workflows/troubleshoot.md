# Troubleshooting Workflow

Imperative instructions for fixing common 1Password CLI issues.

---

## Not Signed In (Most Common!)

### Symptom

`op` commands fail with "not signed in" or "session expired".

### Diagnosis

Run:
```bash
op account list
```

Look for: Empty output or "no accounts configured".

### Fix

#### Step 1: Sign in

Run:
```bash
op signin
```

Follow the prompts (biometric or master password).

#### Step 2: Verify

Run:
```bash
op account list
```

Success: Shows account email and user ID.

---

## Biometric Timeout

### Symptom

- Biometric prompt appears but times out
- Long-running scripts fail with auth errors
- Multiple prompts during batch operations

### Diagnosis

Run:
```bash
op signin --raw
```

If it hangs or times out, biometric unlock is failing.

### Fixes

#### Option 1: Extend session timeout

In 1Password app:
1. Open 1Password > Settings > Security
2. Set "Lock after" to longer duration (e.g., 1 hour)
3. Retry operation

#### Option 2: Use service account (for automation)

For CI/CD or long-running scripts:
```bash
export OP_SERVICE_ACCOUNT_TOKEN="your-service-account-token"
op item list  # Uses token instead of biometric
```

Get service account from: 1Password.com > Settings > Developer > Service Accounts

#### Option 3: Pre-authenticate

Before running scripts:
```bash
op signin --raw > /dev/null  # Warm up biometric
# Now run your operations
```

---

## op CLI Not Installed

### Symptom

`command not found: op`

### Fix

#### macOS (Homebrew)

Run:
```bash
brew install --cask 1password-cli
```

#### macOS (pkg)

Download from: https://1password.com/downloads/command-line/

#### Verify installation

Run:
```bash
op --version
```

Success: Shows version number (e.g., 2.24.0).

---

## Token Conflict (OP_SESSION_*)

### Symptom

- Auth works for one account but not another
- Old sessions interfere with new signin
- "Invalid session" errors

### Diagnosis

Run:
```bash
env | grep OP_
```

Look for: `OP_SESSION_*` or `OP_SERVICE_ACCOUNT_TOKEN` variables.

### Fix

#### Step 1: Clear old session variables

Run:
```bash
unset OP_SESSION_my
unset OP_SERVICE_ACCOUNT_TOKEN
```

For all session vars:
```bash
for var in $(env | grep "^OP_" | cut -d= -f1); do unset $var; done
```

#### Step 2: Re-authenticate

Run:
```bash
op signin
```

#### Step 3: Verify clean session

Run:
```bash
op account list
op vault list
```

---

## Multiple Accounts

### Symptom

- Wrong account being used
- Can't switch between personal/work accounts

### Diagnosis

Run:
```bash
op account list
```

Shows all configured accounts.

### Fix

#### Switch account

Run:
```bash
op signin --account "account-shorthand"
```

Find account shorthand in `op account list` output.

#### Set default account

Run:
```bash
op account default --account "account-shorthand"
```

---

## Vault Not Found

### Symptom

`vault not found: VaultName`

### Diagnosis

Run:
```bash
op vault list
```

Check: Vault name, case sensitivity, account access.

### Fixes

#### Check spelling and case

Vault names are case-sensitive. "Private" ≠ "private".

#### Check account

Different accounts may have different vaults:
```bash
op vault list --account "work"
op vault list --account "personal"
```

#### Request access

If vault belongs to a team, contact vault administrator.

---

## Permission Denied

### Symptom

`permission denied` when accessing items or vaults.

### Fix

#### Check vault membership

Run:
```bash
op vault list
```

Verify you have access to the target vault.

#### Check item permissions

Some items may have restricted access. Contact vault/item owner.

---

## Connect Server Issues (1Password Connect)

### Symptom

Errors when using 1Password Connect (self-hosted):
- "connection refused"
- "certificate error"

### Fix

#### Check server status

Run:
```bash
curl -s https://your-connect-server:8443/heartbeat
```

#### Check credentials

Run:
```bash
op connect server list
```

#### Reconfigure

Run:
```bash
op connect server add --url https://your-connect-server:8443 --token "your-token"
```

---

## Slow Performance

### Symptom

`op` commands take several seconds to complete.

### Fixes

#### Enable cache

In 1Password app settings, enable "Cache vaults and items locally".

#### Check network

1Password Connect or cloud sync may be slow. Test:
```bash
time op vault list
```

#### Use specific vault

Instead of searching all vaults:
```bash
op item list --vault "Private"  # Faster than op item list
```

---

## Invalid JSON Output

### Symptom

Commands produce malformed JSON.

### Fix

#### Specify format explicitly

Run:
```bash
op item list --format=json
```

#### Check for warnings in output

Warnings may be interleaved. Redirect stderr:
```bash
op item list --format=json 2>/dev/null | jq .
```

---

## Session Persistence Issues

### Symptom

Need to re-authenticate every shell session.

### Fixes

#### Enable biometric unlock

In 1Password app settings:
1. Settings > Security > Biometric Unlock
2. Enable for CLI

#### Use environment variable

Add to .zshrc:
```bash
eval $(op signin --raw)  # Only if you trust your shell history
```

**Warning:** This stores session in shell history. Use with caution.

---

## Factory Reset (Last Resort)

If nothing else works:

#### Step 1: Remove all config

Run:
```bash
rm -rf ~/.config/op
rm -rf ~/Library/Application\ Support/1Password\ CLI
```

#### Step 2: Reinstall

Run:
```bash
brew uninstall 1password-cli
brew install --cask 1password-cli
```

#### Step 3: Re-configure

Run:
```bash
op signin
```

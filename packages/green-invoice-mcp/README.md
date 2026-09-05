# Green Invoice MCP Server

MCP server for [Green Invoice (Morning)](https://www.greeninvoice.co.il/) — Israeli invoicing, receipts, and client management via REST API.

## Tools

| Tool | Description |
|------|-------------|
| `invoice_create` | Create any document type (quote, tax invoice, receipt, refund) |
| `invoice_list` | Search/list documents with filters (type, date range) |
| `receipt_create` | Convenience wrapper for receipts (kabala) — defaults to ILS, Hebrew, VAT exempt |
| `client_search` | Search clients by name, email, or tax ID (Hebrew supported) |
| `client_create` | Create a new client record |

## Setup

### 1. Get API Keys

1. Log in to [Green Invoice](https://app.greeninvoice.co.il/)
2. Go to Settings -> Developer Tools -> API Keys
3. Create a new API key pair (ID + Secret)

### 2. Store in 1Password

```bash
op item create --category=api-credential \
  --title="Green Invoice API" \
  --vault="Golems" \
  'credential=<API_KEY_ID>' \
  'notes=<API_KEY_SECRET>'
```

1Password path: `op://Golems/Green Invoice API/`

### 3. Set Environment Variables

```bash
# .env or shell profile
GREEN_INVOICE_ID=your-api-key-id
GREEN_INVOICE_SECRET=your-api-key-secret

# Optional: use sandbox for testing
GREEN_INVOICE_SANDBOX=true
```

### 4. Add to .mcp.json

```json
{
  "mcpServers": {
    "green-invoice": {
      "command": "bun",
      "args": ["run", "packages/green-invoice-mcp/src/mcp-server.ts"],
      "env": {
        "GREEN_INVOICE_ID": "op://Golems/Green Invoice API/credential",
        "GREEN_INVOICE_SECRET": "op://Golems/Green Invoice API/notes"
      }
    }
  }
}
```

## API Reference

Base URL: `https://api.greeninvoice.co.il/api/v1`
Sandbox: `https://sandbox.d.greeninvoice.co.il/api/v1`

### Document Types

| Code | Type |
|------|------|
| 10 | Price Quote |
| 100 | Order |
| 305 | Tax Invoice |
| 320 | Tax Invoice-Receipt |
| 400 | Receipt (Kabala) |
| 330 | Refund/Credit Note |

### Payment Types

| Code | Method |
|------|--------|
| 1 | Cash |
| 2 | Check |
| 3 | Credit Card |
| 4 | Bank Transfer |
| 5 | PayPal |
| 10 | Payment App |

## Error Handling

- **401/403**: Auto-refreshes JWT token and retries once
- **429**: Exponential backoff retry (up to 3 attempts), respects `Retry-After` header
- **Other errors**: Returns descriptive error message with status code

## Tests

```bash
bun test packages/green-invoice-mcp/src/__tests__/
```

46 tests covering auth flow, all 5 tools, Hebrew content, error handling, and retry logic.

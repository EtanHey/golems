---
name: branded-doc
description: |
  Generate professional branded HTML documents from structured content. Use when the user asks
  to create a proposal, contract feedback, client response, pricing sheet, or any professional
  document that needs branding. Triggers on: "draft a response", "create proposal", "branded doc",
  "feedback document", "client document", "/branded-doc".
---

# Branded Document Generator

Generate A4-ready branded HTML documents with color-coded sections, pricing tables, and RTL support.

## How It Works

1. Build a JSON file with the document content
2. Run `bun scripts/branded-doc.ts input.json output.html`
3. Open the HTML in a browser and print to PDF

## Quick Start

```bash
# Generate from JSON file
bun scripts/branded-doc.ts /tmp/doc-input.json ~/Documents/output.html

# Pipe from stdin
cat /tmp/doc-input.json | bun scripts/branded-doc.ts - ~/Documents/output.html
```

## JSON Schema

```json
{
  "title": "Document Title",
  "date": "1 March 2026",
  "recipient": "Name — Company",
  "intro": ["Opening line.", "Context line."],
  "sections": [
    {
      "num": 1,
      "title": "Section Title",
      "tag": "change",
      "body": "Section content in natural language."
    }
  ],
  "pricing": {
    "title": "Pricing",
    "headers": ["Plan", "Rate", "Total"],
    "rows": [["Retainer", "$100/hr", "$2,000"]],
    "note": "Optional footnote."
  },
  "availability": "Immediately.",
  "closing": "Closing line.",
  "output": "~/Documents/output.html"
}
```

## Section Tags

| Tag | Label | Color | Use |
|-----|-------|-------|-----|
| `remove` | Remove | Red | Delete this clause |
| `change` | Change | Amber | Modify this clause |
| `add` | Add | Green | Add new clause |
| `narrow` | Narrow | Amber | Reduce scope |
| `note` | Note | Blue | Informational |

## Branding Configuration

Personal branding loads from `~/.config/branded-doc.json`:

```json
{
  "name": "Your Name",
  "nameHebrew": "השם שלך",
  "title": "Your Title",
  "email": "you@example.com",
  "phone": "+1 555-000-0000",
  "website": "example.com",
  "logoBase64": "(optional) base64-encoded PNG/SVG image for header logo"
}
```

Per-document override via `"branding"` field in input JSON.

## Writing Rules

When generating document content:
- Write naturally, not like AI output
- Body text: no em dashes, use commas/periods
- Titles: em dashes OK for section titles
- Vary sentence length and structure
- No "in addition" at the start of every point
- Read like a professional would write in email

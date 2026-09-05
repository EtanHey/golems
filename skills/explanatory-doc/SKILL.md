---
name: explanatory-doc
description: |
  Generate visual, branded HTML documents that explain concepts to non-technical audiences.
  Use when creating explanatory content for friends, partners, investors, or anyone who needs
  to understand a technical topic in simple language. NOT for contracts or proposals (use branded-doc).
  Triggers on: "explain to", "make a document for", "explanatory doc", "visual explanation",
  "send him/her an explanation", "/explanatory-doc".
---

# Explanatory Document Generator

Generate branded, visual RTL Hebrew HTML documents with colored sections, callout boxes, phase cards, checklists, Q&A cards, and tables.

**When to use this vs branded-doc:**
- `explanatory-doc` = Explaining concepts (trading bot to a friend, study tips, project overview)
- `branded-doc` = Contract feedback, proposals, pricing sheets, client documents

## How It Works

1. Build a JSON file with the document content
2. Run `bun scripts/explanatory-doc.ts input.json output.html`
3. Generate PDF: `/Applications/Brave\ Browser.app/Contents/MacOS/Brave\ Browser --headless --disable-gpu --print-to-pdf="output.pdf" --no-margins "output.html"`

## Quick Start

```bash
# Generate from JSON file
bun scripts/explanatory-doc.ts /tmp/doc-input.json ~/Documents/output.html

# Pipe from stdin
cat /tmp/doc-input.json | bun scripts/explanatory-doc.ts - ~/Documents/output.html

# Generate PDF from HTML
/Applications/Brave\ Browser.app/Contents/MacOS/Brave\ Browser \
  --headless --disable-gpu --no-margins \
  --print-to-pdf="$HOME/Documents/output.pdf" \
  "$HOME/Documents/output.html"
```

## JSON Schema

```json
{
  "title": "Document Title",
  "subtitle": "Optional context line (sources, date range, etc.)",
  "date": "March 2026",
  "recipient": "Name (optional)",
  "sections": [
    {
      "num": 1,
      "title": "Section Title",
      "color": "blue",
      "blocks": [
        { "type": "text", "content": "Paragraph. Use **bold** for emphasis." },
        { "type": "callout", "style": "warn", "title": "Note Title", "content": "Callout content" },
        { "type": "table", "headers": ["Col1", "Col2"], "rows": [["Cell", "Cell"], [{"text": "+22%", "style": "pos"}, {"text": "-30%", "style": "neg"}]] },
        { "type": "phase", "title": "Phase 1", "risk": "zero", "riskLabel": "Risk: None", "items": ["Step 1", "Step 2"], "note": "Optional note" },
        { "type": "list", "items": ["Bullet 1", "Bullet 2"] },
        { "type": "checklist", "items": ["Green checkmark item 1", "Green checkmark item 2"] },
        { "type": "qa", "items": [{ "q": "Question?", "a": "Answer." }] },
        { "type": "divider" }
      ]
    }
  ],
  "closing": "Optional closing text",
  "output": "~/Documents/output.html"
}
```

## Block Types

| Type | Visual | Use |
|------|--------|-----|
| `text` | Paragraph | Regular content |
| `callout` | Colored sidebar box | Key insights, warnings, tips |
| `table` | Striped table with dark header | Data, comparisons |
| `phase` | Rounded card with risk badge | Project phases, steps |
| `list` | Bullet list | Features, items |
| `checklist` | Green checkmark list | Safeguards, done items |
| `qa` | Card with blue question | FAQ section |
| `divider` | Horizontal line | Section separator |

## Callout Styles

| Style | Color | Use |
|-------|-------|-----|
| `info` (default) | Blue | General notes, tips |
| `warn` | Amber | Warnings, caveats |
| `danger` | Red | Critical warnings, risks |
| `success` | Green | Positive outcomes, recommendations |

## Section Colors

All sections use the same green numbered circle for visual consistency (matching the Avi Huberman style). The `color` field is available for future customization but currently maps to the same green.

| Color | Use |
|-------|-----|
| `blue` | Default, informational |
| `red` | Problems, risks, warnings |
| `green` | Solutions, positives |
| `amber` | Caution, expectations |
| `purple` | People, roles, meta |

## Table Cell Styling

Regular cells are plain strings. For colored cells (positive/negative):
```json
{ "text": "+22.8%", "style": "pos" }
{ "text": "-62.7%", "style": "neg" }
```

## Phase Risk Levels

| Risk | Badge Color | Use |
|------|-------------|-----|
| `zero` | Green | No risk at all |
| `low` | Yellow | Controlled, limited risk |
| `medium` | Orange | Moderate risk |
| `high` | Red | High risk |

## Visual Style

The document uses a **dark slate banner header** with the document title (NOT freelancing branding). Modeled after the "Avi Huberman Tips" visual style:
- **Header:** Dark charcoal (#0f172a), white title text, centered
- **Number badges:** Muted teal (#0d9488), rounded rectangles (not circles)
- **Table headers:** Teal (#0d9488), with light gray alternating rows (#f8fafc)
- **Section dividers:** Teal top-border line on each section
- **Callouts:** Info=blue, Warn=amber (insight boxes), Danger=red, Success=green (action boxes)
- **Q&A cards:** Teal question text (#0d9488)

No personal branding (no name/email/phone). The document is about the topic, not the sender.

## Page Break Rules

**Each section gets its own page.** The script forces `page-break-before: always` on every section (except the first). This guarantees no component is ever split across pages. The `<hr>` dividers between sections are hidden — replaced by teal top-border lines on each section.

Because each section gets a full page, make sure sections have enough content to fill the page well. A section with just a 2-row table and one line of text will look sparse. Add explanatory text, callouts with key takeaways, or context paragraphs to fill out short sections.

## Writing Rules

When generating content for explanatory docs:
- Write in simple, everyday language — the reader is smart but not technical
- Use **bold** for key terms when they first appear
- Explain jargon in parentheses: "Stop Loss (automatic exit when price drops)"
- Keep paragraphs short — 2-3 sentences max
- Use callouts for the most important takeaways
- Use phases for step-by-step processes
- Use Q&A for anticipated questions
- Use checklists for safeguards or summary items
- Hebrew RTL — write naturally, the template handles direction
- **Each section = one page**, so fill each section with enough content: explanatory paragraphs, real data/facts, callouts with key insights. A sparse section with just a table looks empty.
- Be genuinely explanatory — add context, real numbers, analogies. The goal is that the reader walks away understanding the topic deeply, not just seeing bullet points.

## Full Workflow

1. User asks to explain something to someone
2. Gather content (research, notes, conversation)
3. Structure into sections with appropriate block types
4. Write JSON to temp file
5. Run `bun scripts/explanatory-doc.ts` to generate HTML
6. Generate PDF via Brave headless
7. Copy to Obsidian: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/personal/Personal/`

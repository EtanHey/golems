#!/usr/bin/env bun
/**
 * Explanatory Document Generator
 *
 * Generates visual, branded RTL Hebrew HTML documents for explaining concepts
 * to non-technical audiences. Parallel to branded-doc.ts but for explanatory
 * content (not contracts/proposals).
 *
 * Visual style: Teal/green topic banner header (like Avi Huberman doc),
 * colored numbered circles, callout boxes, phase cards, checklists,
 * Q&A cards, tables with pos/neg styling. NOT freelancing branding.
 *
 * Usage:
 *   bun scripts/explanatory-doc.ts <input.json>              # Output to stdout
 *   bun scripts/explanatory-doc.ts <input.json> <output.html> # Write to file
 *   cat input.json | bun scripts/explanatory-doc.ts -         # Read from stdin
 *
 * JSON Schema:
 *   {
 *     "title": "Document Title",
 *     "subtitle": "Optional subtitle",
 *     "date": "March 2026",
 *     "recipient": "Name (optional)",
 *     "sections": [
 *       {
 *         "num": 1,
 *         "title": "Section Title",
 *         "color": "blue",
 *         "blocks": [
 *           { "type": "text", "content": "Paragraph text" },
 *           { "type": "callout", "style": "info", "title": "Title", "content": "..." },
 *           { "type": "table", "headers": [...], "rows": [...] },
 *           { "type": "phase", "title": "...", "risk": "zero", "riskLabel": "...", "items": [...] },
 *           { "type": "list", "items": [...] },
 *           { "type": "checklist", "items": [...] },
 *           { "type": "qa", "items": [{ "q": "?", "a": "." }] },
 *           { "type": "divider" }
 *         ]
 *       }
 *     ],
 *     "closing": "Closing text",
 *     "branding": { ... }
 *   }
 *
 * Block types: text | callout | table | phase | list | checklist | qa | divider
 * Callout styles: info (blue) | warn (amber) | danger (red) | success (green)
 * Section colors: blue | red | green | amber | purple
 * Phase risk: zero | low | medium | high
 * Table cell: "text" or { "text": "...", "style": "pos" | "neg" }
 */

// --- Types ---

interface TextBlock {
  type: "text";
  content: string;
}

interface CalloutBlock {
  type: "callout";
  style?: "info" | "warn" | "danger" | "success";
  title?: string;
  content: string;
}

interface TableCell {
  text: string;
  style?: "pos" | "neg";
}

interface TableBlock {
  type: "table";
  headers: string[];
  rows: (string | TableCell)[][];
}

interface PhaseBlock {
  type: "phase";
  title: string;
  risk: "zero" | "low" | "medium" | "high";
  riskLabel: string;
  items: string[];
  note?: string;
}

interface ListBlock {
  type: "list";
  items: string[];
}

interface ChecklistBlock {
  type: "checklist";
  items: string[];
}

interface QABlock {
  type: "qa";
  items: { q: string; a: string }[];
}

interface DividerBlock {
  type: "divider";
}

type Block =
  | TextBlock
  | CalloutBlock
  | TableBlock
  | PhaseBlock
  | ListBlock
  | ChecklistBlock
  | QABlock
  | DividerBlock;

interface Section {
  num: number;
  title: string;
  color: "blue" | "red" | "green" | "amber" | "purple";
  blocks: Block[];
}

interface DocInput {
  title: string;
  subtitle?: string;
  date?: string;
  recipient?: string;
  source?: string; // e.g. "Based on Huberman Lab #57" — shown in header
  sections: Section[];
  closing?: string;
  output?: string;
}

// --- HTML escaping ---
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Inline formatting: **bold** ---
function fmt(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// --- Render blocks ---
function renderBlock(block: Block): string {
  switch (block.type) {
    case "text":
      return `<p>${fmt(block.content)}</p>`;

    case "callout": {
      const style = block.style || "info";
      const titleHtml = block.title
        ? `<strong>${fmt(block.title)}</strong>`
        : "";
      return `<div class="callout ${style}">${titleHtml}${fmt(block.content)}</div>`;
    }

    case "table": {
      const headersHtml = block.headers
        .map((h) => `<th>${esc(h)}</th>`)
        .join("");
      const rowsHtml = block.rows
        .map((row) => {
          const cells = row
            .map((cell) => {
              if (typeof cell === "string") {
                return `<td>${fmt(cell)}</td>`;
              }
              const cls = cell.style ? ` class="${cell.style}"` : "";
              return `<td${cls}>${fmt(cell.text)}</td>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("\n    ");
      return `<table>
  <thead><tr>${headersHtml}</tr></thead>
  <tbody>
    ${rowsHtml}
  </tbody>
</table>`;
    }

    case "phase": {
      const riskClass =
        block.risk === "zero"
          ? "risk-zero"
          : block.risk === "low"
            ? "risk-low"
            : block.risk === "medium"
              ? "risk-medium"
              : "risk-high";
      const itemsHtml = block.items
        .map((item) => `<li>${fmt(item)}</li>`)
        .join("\n    ");
      const noteHtml = block.note ? `<p>${fmt(block.note)}</p>` : "";
      return `<div class="phase">
  <h3>${fmt(block.title)}</h3>
  <span class="risk ${riskClass}">${esc(block.riskLabel)}</span>
  <ul>
    ${itemsHtml}
  </ul>
  ${noteHtml}
</div>`;
    }

    case "list": {
      const itemsHtml = block.items
        .map((item) => `<li>${fmt(item)}</li>`)
        .join("\n  ");
      return `<ul>
  ${itemsHtml}
</ul>`;
    }

    case "checklist": {
      const itemsHtml = block.items
        .map((item) => `<li>${fmt(item)}</li>`)
        .join("\n  ");
      return `<ul class="checklist">
  ${itemsHtml}
</ul>`;
    }

    case "qa": {
      return block.items
        .map(
          (item) =>
            `<div class="qa-card">
  <div class="q">${fmt(item.q)}</div>
  ${fmt(item.a)}
</div>`,
        )
        .join("\n");
    }

    case "divider":
      return "<hr>";

    default:
      return "";
  }
}

// --- Build HTML ---
function buildHTML(input: DocInput): string {
  const VALID_COLORS = new Set(["blue", "red", "green", "amber", "purple"]);

  const sectionsHTML = input.sections
    .map((s) => {
      const color = VALID_COLORS.has(s.color) ? s.color : "blue";
      const blocksHtml = s.blocks.map(renderBlock).join("\n\n");
      return `<section class="doc-section">
<h2 class="${color}"><span class="num">${s.num}</span>${esc(s.title)}</h2>

${blocksHtml}
</section>`;
    })
    .join("\n\n<hr>\n\n");

  const subtitleHTML = input.subtitle
    ? `<div class="subtitle">${fmt(input.subtitle)}${input.date ? `<br>${esc(input.date)}` : ""}</div>`
    : input.date
      ? `<div class="subtitle">${esc(input.date)}</div>`
      : "";

  const closingHTML = input.closing
    ? `<p class="closing">${fmt(input.closing)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(input.title)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Arial, sans-serif;
    line-height: 1.8;
    color: #1e293b;
    background: #fff;
    font-size: 14px;
  }

  /* ===== DARK BANNER HEADER (matching Avi Huberman style) ===== */
  /* Dark charcoal/slate header — NOT green. The topic color comes through
     in section dividers and accents, not the header itself. */
  .topic-header {
    background: #0f172a;
    padding: 48px 40px 40px;
    text-align: center;
    direction: rtl;
  }
  .topic-header h1 {
    color: white;
    font-size: 32px;
    font-weight: 800;
    margin-bottom: 14px;
    letter-spacing: -0.3px;
  }
  .topic-header .tagline {
    color: rgba(255, 255, 255, 0.75);
    font-size: 14px;
    line-height: 1.8;
    max-width: 520px;
    margin: 0 auto 8px;
  }
  .topic-header .source {
    color: rgba(255, 255, 255, 0.4);
    font-size: 11px;
    margin-top: 14px;
    letter-spacing: 0.3px;
  }

  /* ===== CONTENT ===== */
  .content {
    max-width: 720px;
    margin: 0 auto;
    padding: 36px 40px 48px;
  }

  .subtitle {
    color: #64748b;
    font-size: 13px;
    margin-bottom: 32px;
    padding-bottom: 16px;
    border-bottom: 2px solid #e2e8f0;
  }

  /* ===== SECTION HEADINGS ===== */
  /* Rounded-rect badge (not circle) matching Avi style.
     Muted teal (#0d9488) — NOT neon green. */
  h2 {
    font-size: 21px;
    font-weight: 700;
    margin-top: 40px;
    margin-bottom: 16px;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h2 .num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    height: 34px;
    padding: 0 4px;
    background: #0d9488;
    color: white;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    flex-shrink: 0;
  }

  p { margin-bottom: 16px; }

  /* Section dividers — colored top lines matching the Avi doc.
     Each section gets a thin teal line above it. */
  hr {
    border: none;
    border-top: 3px solid #0d9488;
    margin: 36px 0 8px;
  }

  /* ===== CALLOUTS (Avi-style) ===== */
  /* Subtle right border (RTL), rounded corners on the border side,
     soft background. More breathing room than typical callouts. */
  .callout {
    background: #f0fdf4;
    border-right: 4px solid #0d9488;
    padding: 16px 20px;
    border-radius: 0 10px 10px 0;
    margin: 18px 0;
    font-size: 13.5px;
    line-height: 1.7;
  }
  /* Yellow insight/warning box — amber tones */
  .callout.warn {
    background: #fefce8;
    border-right-color: #d97706;
  }
  /* Red danger box */
  .callout.danger {
    background: #fef2f2;
    border-right-color: #dc2626;
  }
  /* Info — light blue */
  .callout.info {
    background: #eff6ff;
    border-right-color: #3b82f6;
  }
  /* Green action/success summary */
  .callout.success {
    background: #ecfdf5;
    border-right-color: #059669;
  }
  .callout strong { display: block; margin-bottom: 6px; color: #334155; }

  /* ===== Q&A CARDS ===== */
  .qa-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px 20px;
    margin: 14px 0;
  }
  .qa-card .q { font-weight: 700; font-size: 14px; color: #0d9488; margin-bottom: 8px; }

  /* ===== TABLES ===== */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 18px 0;
    font-size: 13px;
    border-radius: 8px;
    overflow: hidden;
  }
  th {
    background: #0d9488;
    color: white;
    padding: 11px 16px;
    text-align: right;
    font-weight: 600;
    font-size: 12.5px;
  }
  td {
    padding: 10px 16px;
    border-bottom: 1px solid #e2e8f0;
  }
  tr:nth-child(even) td { background: #f8fafc; }
  .pos { color: #0d9488; font-weight: 700; }
  .neg { color: #dc2626; font-weight: 700; }

  /* ===== PHASE CARDS ===== */
  .phase {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 20px;
    margin: 16px 0;
  }
  .phase h3 { font-size: 16px; margin-bottom: 8px; }
  .phase .risk {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 12px;
    border-radius: 12px;
    margin-bottom: 10px;
  }
  .risk-zero { background: #dcfce7; color: #166534; }
  .risk-low { background: #fef9c3; color: #854d0e; }
  .risk-medium { background: #fed7aa; color: #9a3412; }
  .risk-high { background: #fecaca; color: #991b1b; }

  /* ===== LISTS ===== */
  ul { padding-right: 22px; margin: 10px 0; }
  li { margin-bottom: 6px; }

  /* Checklist — open circles like the Avi PDF checklist page */
  .checklist { list-style: none; padding: 0; }
  .checklist li {
    padding: 8px 0;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .checklist li::before {
    content: "\\2713";
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: #0d9488;
    color: white;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }

  /* ===== CLOSING ===== */
  .closing {
    margin-top: 28px;
    font-size: 14px;
    color: #64748b;
  }

  /* ===== FOOTER ===== */
  .topic-footer {
    border-top: 2px solid #e2e8f0;
    padding: 16px 40px;
    text-align: center;
    color: #94a3b8;
    font-size: 11px;
    margin-top: 48px;
  }

  /* ===== PAGE LAYOUT: ONE SECTION PER PAGE ===== */
  /* Each section starts on a fresh page with a teal top border.
     This guarantees no component is ever split across pages.
     The <hr> dividers are hidden — replaced by section top-borders. */
  hr { display: none; }

  .doc-section {
    border-top: 3px solid #0d9488;
    padding-top: 12px;
    margin-top: 0;
    page-break-before: always;
    break-before: always;
  }
  /* First section flows naturally after header — no forced break */
  .doc-section:first-of-type {
    page-break-before: auto;
    break-before: auto;
    border-top: none;
  }

  /* Individual components also protected in case a section is very long */
  .phase, .callout, .qa-card, .checklist, table {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  h2 {
    page-break-after: avoid;
    break-after: avoid;
  }
</style>
</head>
<body>

<!-- TOPIC BANNER HEADER -->
<div class="topic-header">
  <h1>${esc(input.title)}</h1>
  ${input.subtitle ? `<div class="tagline">${fmt(input.subtitle)}</div>` : ""}
  ${input.source ? `<div class="source">${fmt(input.source)}</div>` : ""}
</div>

<!-- CONTENT -->
<div class="content">

${input.date || input.recipient ? `<div class="subtitle">${input.recipient ? `<strong>${esc(input.recipient)}</strong>` : ""}${input.date && input.recipient ? " · " : ""}${input.date ? esc(input.date) : ""}</div>` : ""}

${sectionsHTML}

${closingHTML}

</div><!-- /content -->

<!-- FOOTER -->
<div class="topic-footer">
  ${input.source ? fmt(input.source) : esc(input.title)}
</div>

</body>
</html>`;
}

// --- Main ---
async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    console.error(
      "Usage: bun scripts/explanatory-doc.ts <input.json> [output.html]",
    );
    console.error("       cat input.json | bun scripts/explanatory-doc.ts -");
    process.exit(1);
  }

  let jsonStr: string;
  if (inputPath === "-") {
    const chunks: Buffer[] = [];
    const reader = Bun.stdin.stream().getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.from(value));
    }
    jsonStr = Buffer.concat(chunks).toString("utf-8");
  } else {
    jsonStr = await Bun.file(inputPath).text();
  }

  const input: DocInput = JSON.parse(jsonStr);
  const html = buildHTML(input);

  const finalOutput = outputPath || input.output;
  if (finalOutput) {
    const home = process.env.HOME || require("os").homedir() || "";
    const resolvedPath = finalOutput.replace(/^~/, home);
    await Bun.write(resolvedPath, html);
    console.log(`Written: ${resolvedPath}`);
  } else {
    process.stdout.write(html);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

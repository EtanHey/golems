#!/usr/bin/env bun
/**
 * Branded Document Generator
 *
 * Generates professional RTL Hebrew HTML documents from JSON input.
 * Matches the branded template at ~/Documents/freelance/templates/branded-feedback.html
 *
 * Usage:
 *   bun scripts/branded-doc.ts <input.json>              # Read from file, output to stdout
 *   bun scripts/branded-doc.ts <input.json> <output.html> # Read from file, write to file
 *   cat input.json | bun scripts/branded-doc.ts -         # Read from stdin
 *
 * JSON Schema:
 *   {
 *     "title": "כותרת המסמך",
 *     "date": "1 במרץ 2026",
 *     "recipient": "שם — חברה",
 *     "intro": ["היי שם,", "פתיחה נוספת."],
 *     "sections": [
 *       { "num": 1, "title": "כותרת", "tag": "change", "body": "תוכן" }
 *     ],
 *     "pricing": {
 *       "title": "מחירון",
 *       "headers": ["מסלול", "תעריף", "סה\"כ"],
 *       "rows": [["שורה 1", "X ₪/שעה", "X ₪"]],
 *       "note": "הערה"
 *     },
 *     "availability": "מיידי.",
 *     "closing": "סיום.",
 *     "output": "optional/path/to/output.html"
 *   }
 *
 * Tag types: remove | change | add | narrow | note
 */

// --- Logo (base64-encoded EH favicon) ---
const LOGO_BASE64 = `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`;

// --- Types ---
interface Branding {
  name: string;
  nameHebrew: string;
  title: string;
  email: string;
  phone: string;
  website: string;
  logoBase64?: string;
}

interface Section {
  num: number;
  title: string;
  tag: "remove" | "change" | "add" | "narrow" | "note";
  body: string;
}

interface PricingTable {
  title?: string;
  headers: string[];
  rows: string[][];
  note?: string;
}

interface DocInput {
  title: string;
  date: string;
  recipient: string;
  intro: string[];
  sections: Section[];
  pricing?: PricingTable;
  availability?: string;
  closing: string;
  output?: string;
  branding?: Partial<Branding>;
}

// --- Default branding (override via ~/.config/branded-doc.json or input.branding) ---
const DEFAULT_BRANDING: Branding = {
  name: "Your Name",
  nameHebrew: "השם שלך",
  title: "Your Title",
  email: "you@example.com",
  phone: "+1 555-000-0000",
  website: "example.com",
  logoBase64: LOGO_BASE64,
};

async function loadBranding(
  inputBranding?: Partial<Branding>,
): Promise<Branding> {
  let configBranding: Partial<Branding> = {};
  const home = process.env.HOME || require("os").homedir();
  if (home) {
    const configPath = `${home}/.config/branded-doc.json`;
    try {
      const configFile = Bun.file(configPath);
      if (await configFile.exists()) {
        configBranding = JSON.parse(await configFile.text());
      }
    } catch {
      // No config file — use defaults
    }
  }
  return {
    ...DEFAULT_BRANDING,
    ...configBranding,
    ...inputBranding,
  };
}

// --- Tag labels (Hebrew) ---
const TAG_LABELS: Record<string, string> = {
  remove: "להסיר",
  change: "לשנות",
  add: "להוסיף",
  narrow: "לצמצם",
  note: "הערה",
};

// --- Allowed tag types ---
const VALID_TAGS = new Set(["remove", "change", "add", "narrow", "note"]);

// --- HTML escaping ---
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Build HTML ---
function buildHTML(input: DocInput, brand: Branding): string {
  const sectionsHTML = input.sections
    .map((s) => {
      const tag = VALID_TAGS.has(s.tag) ? s.tag : "note";
      const num = Number.isFinite(Number(s.num)) ? Number(s.num) : 0;
      return `
<div class="section">
    <div class="section-header">
        <span class="section-num">${num}.</span>
        <span class="section-title">${esc(s.title)}</span>
        <span class="tag tag-${tag}">${TAG_LABELS[tag]}</span>
    </div>
    <div class="section-body ${tag}">
        ${esc(s.body)}
    </div>
</div>`;
    })
    .join("\n");

  const introHTML = input.intro
    .map((line) => `<div class="intro">${esc(line)}</div>`)
    .join("\n");

  let pricingHTML = "";
  if (input.pricing) {
    const p = input.pricing;
    const headersRow = p.headers.map((h) => `<th>${esc(h)}</th>`).join("");
    const bodyRows = p.rows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`,
      )
      .join("\n        ");

    pricingHTML = `
<div class="pricing-title">${esc(p.title || "מחירון")}</div>

<table class="pricing">
    <thead>
        <tr>${headersRow}</tr>
    </thead>
    <tbody>
        ${bodyRows}
    </tbody>
</table>

${p.note ? `<div class="pricing-note">${esc(p.note)}</div>` : ""}`;
  }

  const availabilityHTML = input.availability
    ? `<div class="availability"><strong>מועד תחילה:</strong> ${esc(input.availability)}</div>`
    : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<style>
@page {
    size: A4;
    margin: 0;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: Arial, 'Helvetica Neue', sans-serif;
    color: #333333;
    font-size: 9pt;
    line-height: 1.45;
    direction: rtl;
}

.page {
    width: 210mm;
    min-height: 297mm;
    padding: 0;
    position: relative;
}

/* =================== HEADER =================== */
.header {
    background: linear-gradient(135deg, #00003F 0%, #001566 100%);
    padding: 14px 30px 12px 30px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    direction: rtl;
}

.header-right {
    display: flex;
    align-items: center;
    gap: 14px;
}

.header-logo {
    width: 42px;
    height: 42px;
    border-radius: 8px;
}

.header-name {
    color: white;
    font-size: 16pt;
    font-weight: bold;
    letter-spacing: 0.5px;
    white-space: nowrap;
}

.header-title {
    color: #0F82EB;
    font-size: 9pt;
    margin-top: 2px;
    font-weight: normal;
}

.header-left {
    text-align: left;
    direction: ltr;
    color: #8899BB;
    font-size: 8pt;
    line-height: 1.8;
}

.header-left a {
    color: #8899BB;
    text-decoration: none;
}

.blue-accent {
    height: 3px;
    background: #0F82EB;
}

/* =================== BODY =================== */
.content {
    padding: 16px 30px 12px 30px;
}

.doc-title {
    color: #00003F;
    font-size: 13pt;
    font-weight: bold;
    margin-bottom: 4px;
}

.doc-meta {
    color: #888888;
    font-size: 8pt;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #E0E0E0;
}

.doc-meta strong { color: #666666; }

.intro {
    margin-bottom: 8px;
    font-size: 9pt;
}

/* =================== SECTIONS =================== */
.section {
    margin-bottom: 8px;
    page-break-inside: avoid;
}

.section-header {
    margin-bottom: 3px;
    display: flex;
    align-items: baseline;
    gap: 5px;
}

.section-num {
    color: #0F82EB;
    font-size: 10pt;
    font-weight: bold;
}

.section-title {
    color: #00003F;
    font-size: 9.5pt;
    font-weight: bold;
}

.tag {
    font-size: 7.5pt;
    font-weight: bold;
    padding: 0px 6px;
    border-radius: 3px;
    margin-right: 6px;
    display: inline-block;
}

/* Tag colors */
.tag-remove { background: #FDEAEA; color: #E70E0E; }
.tag-change { background: #FFF8E1; color: #D4850B; }
.tag-add    { background: #E8F5E9; color: #10B981; }
.tag-narrow { background: #FFF8E1; color: #D4850B; }
.tag-note   { background: #E3F2FD; color: #1565C0; }

.section-body {
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 9pt;
    line-height: 1.45;
}

/* Section body colors match tags */
.section-body.remove { background: #FDF5F5; border-right: 3px solid #E70E0E; }
.section-body.change { background: #FFFCF0; border-right: 3px solid #D4850B; }
.section-body.add    { background: #F5FBF5; border-right: 3px solid #10B981; }
.section-body.narrow { background: #FFFCF0; border-right: 3px solid #D4850B; }
.section-body.note   { background: #F0F7FF; border-right: 3px solid #1565C0; }

/* =================== PRICING =================== */
.pricing-title {
    color: #00003F;
    font-size: 10pt;
    font-weight: bold;
    margin-top: 10px;
    margin-bottom: 5px;
}

table.pricing {
    width: 100%;
    border-collapse: collapse;
    direction: rtl;
    margin-bottom: 8px;
}

table.pricing th {
    background: #00003F;
    color: white;
    padding: 4px 10px;
    text-align: center;
    font-size: 8.5pt;
    font-weight: bold;
}

table.pricing td {
    padding: 3px 10px;
    text-align: center;
    font-size: 8.5pt;
    border-bottom: 1px solid #E8E8E8;
}

table.pricing tr:nth-child(even) td {
    background: #F0F4FF;
}

.pricing-note {
    color: #888888;
    font-size: 8pt;
    margin-bottom: 8px;
}

/* =================== CLOSING =================== */
.availability {
    margin-bottom: 8px;
    font-size: 9pt;
}

.availability strong { color: #00003F; }

.closing {
    margin-bottom: 10px;
    font-size: 9pt;
}

.signature {
    margin-top: 10px;
}

.sig-name {
    color: #00003F;
    font-size: 11pt;
    font-weight: bold;
}

.sig-title {
    color: #0F82EB;
    font-size: 8pt;
    margin-top: 1px;
}

/* =================== FOOTER =================== */
.footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #00003F;
    padding: 10px 30px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    direction: ltr;
}

.footer-brand {
    color: #8899BB;
    font-size: 8pt;
}

.footer-contact {
    color: #8899BB;
    font-size: 8pt;
}

.footer-contact a {
    color: #0F82EB;
    text-decoration: none;
}

</style>
</head>
<body>
<div class="page">

<!-- HEADER -->
<div class="header">
    <div class="header-right">
        ${brand.logoBase64 ? `<img src="data:image/png;base64,${brand.logoBase64}" class="header-logo" alt="${esc(brand.name.slice(0, 2))}">` : ""}
        <div>
            <div class="header-name">${esc(brand.name)}</div>
            <div class="header-title">${esc(brand.title)}</div>
        </div>
    </div>
    <div class="header-left">
        ${esc(brand.email)}<br>
        ${esc(brand.phone)}<br>
        <a href="https://${esc(brand.website)}">${esc(brand.website)}</a>
    </div>
</div>
<div class="blue-accent"></div>

<!-- CONTENT -->
<div class="content">

<div class="doc-title">${esc(input.title)}</div>
<div class="doc-meta">
    <strong>תאריך:</strong> ${esc(input.date)} &nbsp;&nbsp;|&nbsp;&nbsp;
    <strong>נמען:</strong> ${esc(input.recipient)}
</div>

${introHTML}

${sectionsHTML}

${pricingHTML}

${availabilityHTML}

<div class="closing">${esc(input.closing)}</div>

<div class="signature">
    <div class="sig-name">${esc(brand.nameHebrew)}</div>
    <div class="sig-title">${esc(brand.title)}</div>
</div>

</div> <!-- /content -->

<!-- FOOTER -->
<div class="footer">
    <div class="footer-brand">${esc(brand.name)} &nbsp;|&nbsp; ${esc(brand.title)}</div>
    <div class="footer-contact"><a href="https://${esc(brand.website)}">${esc(brand.website)}</a> &nbsp;|&nbsp; ${esc(brand.email)}</div>
</div>

</div> <!-- /page -->
</body>
</html>`;
}

// --- Main ---
async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) {
    console.error(
      "Usage: bun scripts/branded-doc.ts <input.json> [output.html]",
    );
    console.error("       cat input.json | bun scripts/branded-doc.ts -");
    process.exit(1);
  }

  let jsonStr: string;
  if (inputPath === "-") {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(Buffer.from(chunk));
    }
    jsonStr = Buffer.concat(chunks).toString("utf-8");
  } else {
    jsonStr = await Bun.file(inputPath).text();
  }

  const input: DocInput = JSON.parse(jsonStr);
  const brand = await loadBranding(input.branding);
  const html = buildHTML(input, brand);

  // Determine output path: CLI arg > JSON field > stdout
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

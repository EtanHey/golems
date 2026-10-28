#!/usr/bin/env node
// All PR-controlled input is data, supplied through env (never shell interpolation).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const globs = JSON.parse(readFileSync(new URL('./visual-proof-globs.json', import.meta.url), 'utf8'));
const { PR_BODY = '', PR_LABELS = '[]', PR_CHANGED_FILES = '' } = process.env;
try {
  const labels = JSON.parse(PR_LABELS);
  if (!Array.isArray(labels) || labels.some(label => typeof label !== 'string')) throw Error('invalid PR_LABELS');
  const files = PR_CHANGED_FILES.split(/[\n\0]/).filter(Boolean);
  // The committed list uses directory/** globs; reject unsupported syntax rather than broaden silently.
  if (globs.some(glob => !glob.endsWith('/**') || /[*?\[\]]/.test(glob.slice(0, -3)))) throw Error('unsupported visual glob');
  const visual = labels.includes('visual') || files.some(file => globs.some(glob => file.startsWith(glob.slice(0, -2))));
  if (!visual) {
    console.log('Visual proof: non-visual PR');
  } else {
    const prose = visibleMarkdown(PR_BODY);
    const section = prose.match(/^## Visual proof[ \t]*\r?\n([\s\S]*?)(?=^#{1,2}[ \t]|$(?![\s\S]))/m)?.[1] ?? '';
    const fields = ['Desktop before', 'Desktop after', '390 px before', '390 px after', 'GIF', 'E2E screenshot diffs'];
    const missing = fields.filter(field => {
      const lines = section.split(/\r?\n/).filter(line => line.startsWith(`${field}:`));
      if (lines.length !== 1) return true;
      const value = lines[0].slice(field.length + 1).trim();
      if (field === 'GIF' && value === 'none: no animation or interaction changed') return false;
      // Reviewable GitHub attachments or repo-relative committed files; ignored/private paths fail.
      const links = [...value.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)].map(match => match[1]);
      return !links.some(link => {
        if (/^https:\/\/github\.com\/user-attachments\/(assets|files)\//.test(link)) return true;
        // Inspect the raw URL path before URL normalization can erase parent traversal.
        const file = link.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:blob|raw)\/[a-f0-9]{40}\/(.+)$/);
        return file ? safeFilePath(file[1]) : safeFilePath(link) && isCommitted(link);
      });
    });
    for (const field of missing) console.error(`Visual proof missing: ${field}`);
    process.exitCode = missing.length ? 1 : 0;
    if (!missing.length) console.log('Visual proof: all required artifact links present (reviewer must inspect and cite)');
  }
} catch (error) {
  console.error(`Visual proof input error: ${error.message}`);
  process.exitCode = 1;
}
function isCommitted(path) {
  return spawnSync('git', ['ls-files', '--error-unmatch', '--', path], { stdio: 'ignore' }).status === 0;
}

function safeFilePath(path) {
  try {
    // Decode repeatedly so encoded separators and nested encoding cannot hide segments.
    for (let depth = 0; path.includes('%'); depth++) {
      if (depth === 8) return false;
      const decoded = decodeURIComponent(path);
      if (decoded === path) return false;
      path = decoded;
    }
    if (path.split('/').some(segment => ['docs.local', 'node_modules', '..'].includes(segment))) return false;
    return /^[\w-]+(?:\/[\w.-]+)+\.(png|jpe?g|webp|gif|html|md|zip)$/i.test(path);
  } catch {
    return false;
  }
}

function visibleMarkdown(markdown) {
  let fence = null;
  let comment = false;
  const visible = [];
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      visible.push('');
      continue;
    }
    let clean = '';
    for (let i = 0; i < line.length;) {
      if (comment) {
        const end = line.indexOf('-->', i);
        if (end < 0) { clean += ' '.repeat(line.length - i); break; }
        clean += ' '.repeat(end + 3 - i);
        i = end + 3;
        comment = false;
      } else if (line.startsWith('<!--', i)) {
        comment = true;
        clean += '    ';
        i += 4;
      } else {
        clean += line[i++];
      }
    }
    const open = clean.match(/^ {0,3}(`{3,}|~{3,})/);
    if (open) { fence = open[1]; clean = ''; }
    visible.push(clean);
  }
  if (comment || fence) throw Error('unclosed Markdown comment or fence');
  // Preserve character positions: removing excluded text must never create a heading/link.
  const prose = visible.join('\n');
  let result = '';
  for (let i = 0; i < prose.length;) {
    if (prose[i] !== '`') { result += prose[i++]; continue; }
    const opener = prose.slice(i).match(/^`+/)[0];
    let end = i + opener.length;
    while (end < prose.length) {
      if (prose[end] !== '`') { end++; continue; }
      const run = prose.slice(end).match(/^`+/)[0];
      if (run.length === opener.length) break;
      end += run.length;
    }
    if (end === prose.length) throw Error('unclosed Markdown code span');
    const after = end + opener.length;
    result += prose.slice(i, after).replace(/[^\n]/g, ' ');
    i = after;
  }
  return result;
}

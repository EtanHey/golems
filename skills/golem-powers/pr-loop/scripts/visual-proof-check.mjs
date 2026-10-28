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
    const prose = PR_BODY.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '');
    const section = prose.match(/^## Visual proof\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? '';
    const fields = ['Desktop before', 'Desktop after', '390 px before', '390 px after', 'GIF', 'E2E screenshot diffs'];
    const missing = fields.filter(field => {
      const lines = section.split(/\r?\n/).filter(line => line.startsWith(`${field}:`));
      if (lines.length !== 1) return true;
      const value = lines[0].slice(field.length + 1).trim();
      if (field === 'GIF' && value === 'none: no animation or interaction changed') return false;
      // Reviewable GitHub attachments or repo-relative committed files; ignored/private paths fail.
      const links = [...value.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)].map(match => match[1]);
      return !links.some(link => /^https:\/\/github\.com\/user-attachments\/(assets|files)\//.test(link)
        || /^https:\/\/github\.com\/[^/]+\/[^/]+\/(blob|raw)\/[a-f0-9]{40}\//.test(link)
        || (/^[\w-]+(?:\/[\w.-]+)+\.(png|jpe?g|webp|gif|html|md|zip)$/i.test(link)
          && !/(^|\/)(docs\.local|node_modules|\.\.)\//.test(link)
          && isCommitted(link)));
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

import { createReadStream, readFileSync } from 'node:fs';
import * as zlib from 'node:zlib';

export const MAX_SCAN_BYTES = 64 * 1024 * 1024;
export const SCAN_TIMEOUT_MS = 15_000;
export const MEDIA = /\.(?:mp4|mov|m4v|mkv|webm|mp3|wav|flac|aac|m4a|ogg|png|jpe?g|gif|webp|heic|avif)$/i;

// Parse only this policy's strict, single-quoted patterns list; unknown syntax
// fails closed instead of silently omitting a changed publication rule.
function adjacentPatterns() {
  const policy = readFileSync(new URL('../../../../scripts/publish-boundary-policy.yaml', import.meta.url), 'utf8');
  const lines = policy.split('\n');
  const start = lines.indexOf('  credential-adjacent:');
  if (start < 0 || lines[start + 1] !== '    patterns:') throw new Error('scan-policy-error');
  const block = [];
  for (const line of lines.slice(start + 2)) {
    if (/^  \S|^\S/.test(line)) break;
    if (line.trim()) block.push(line);
  }
  if (!block.length) throw new Error('scan-policy-error');
  return block.map((line, i) => {
    const value = /^      - '((?:[^']|'')*)'$/.exec(line)?.[1];
    if (!value) throw new Error('scan-policy-error');
    const source = value.replace(/''/g, "'").replace(/\[:space:\]/g, '\\s').replace(/\[:alnum:\]/g, 'A-Za-z0-9');
    if (/\[:[a-z]+:\]/.test(source)) throw new Error('scan-policy-error');
    return [i === 1 ? 'private-key' : `credential-adjacent-${i + 1}`, new RegExp(source)];
  });
}
export function contentRules() {
  return [
    ['supabase', /(?<![A-Za-z0-9_])sbp_[0-9a-f]{40}/],
    ['google', /(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{35}/],
    ['github', /(?<![A-Za-z0-9_])gh[pousr]_[0-9A-Za-z]{36}/],
    ['github-pat', /(?<![A-Za-z0-9_])github_pat_[0-9A-Za-z_]{22,}/],
    ['openai', /(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
    ['aws', /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/],
    ['slack', /(?<![A-Za-z0-9])xox[abprs]-[0-9A-Za-z-]{10,}/],
    ...adjacentPatterns(),
  ];
}
export function scanner() {
  const rules = contentRules();
  const chunks = [];
  let bytes = 0;
  return {
    push(buf) {
      bytes += buf.length;
      if (bytes > MAX_SCAN_BYTES) throw new Error('scan-size-limit');
      chunks.push(Buffer.from(buf));
    },
    result() {
      // A whole bounded text catches even unbounded policy spans across chunks.
      const text = Buffer.concat(chunks).toString('latin1');
      return rules.filter(([, re]) => re.test(text)).map(([name]) => name);
    },
  };
}

// Compressed streams run in a killable child with a parent-enforced wall clock.
async function main(abs) {
  let result;
  try {
    const scan = scanner();
    const source = createReadStream(abs);
    const decoder = /\.gz$/i.test(abs) ? zlib.createGunzip() : /\.zst$/i.test(abs) ? zlib.createZstdDecompress() : null;
    source.on('error', () => decoder?.destroy(new Error('scan-unreadable')));
    const stream = decoder ? source.pipe(decoder) : source;
    try { for await (const buf of stream) scan.push(buf); }
    finally { source.destroy(); decoder?.destroy(); }
    result = scan.result();
  } catch (error) {
    result = [error.message === 'scan-size-limit' || error.message === 'scan-unreadable' || error.message === 'scan-policy-error'
      ? error.message : 'scan-decompression-error'];
  }
  process.stdout.write(JSON.stringify(result));
}
if (process.argv[1] === new URL(import.meta.url).pathname) await main(process.argv[2]);

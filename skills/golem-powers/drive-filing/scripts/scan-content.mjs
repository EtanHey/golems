import { createReadStream, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { isUtf8 } from 'node:buffer';
import * as zlib from 'node:zlib';

export const MAX_SCAN_BYTES = 64 * 1024 * 1024;
export const SCAN_TIMEOUT_MS = 15_000;
export function encodingMagic(data) {
  const hex = data.subarray(0, 8).toString('hex');
  if (hex.startsWith('7f454c46')) return 'ELF';
  if (/^(cffaedfe|cefaedfe|feedface|feedfacf|cafebabe)/.test(hex)) return 'Mach-O';
  if (data.toString('ascii',0,15) === 'SQLite format 3') return 'SQLite';
  if (hex.startsWith('0061736d')) return 'WebAssembly';
  if (/^(fffe|feff)/.test(hex)) return 'UTF-16-BOM';
  return 'unknown';
}
// Media signatures identify a format, never permission to skip credential checks.
export function mediaMagic(b) {
  const hex = b.subarray(0, 16).toString('hex');
  return hex.startsWith('89504e470d0a1a0a') || hex.startsWith('ffd8ff') ||
    /^(474946383761|474946383961)/.test(hex) ||
    (b.length >= 16 && b.readUInt32BE(0) >= 16 && b.readUInt32BE(0) <= b.length &&
      b.toString('ascii', 4, 8) === 'ftyp' && /^(isom|iso[0-9]|mp4[12]|M4[AV] |qt  |avif|avis|heic|heix|hevc|mif1|msf1|3g[p2])/.test(b.toString('ascii', 8, 12))) ||
    (b.toString('ascii', 0, 4) === 'RIFF' && /WAVE|WEBP|AVI /.test(b.toString('ascii', 8, 12))) ||
    /^(494433|664c6143|4f676753|1a45dfa3)/.test(hex) ||
    (b.length >= 4 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 6) !== 0);
}
function compression(b) {
  const hex = b.subarray(0, 8).toString('hex');
  if (hex.startsWith('1f8b')) return 'gz';
  if (hex.startsWith('28b52ffd')) return 'zst';
  if (/^(504b0304|504b0506|504b0708|fd377a585a00|425a68|377abcaf271c|52617221|04224d18)/.test(hex) ||
      b.toString('ascii', 257, 262) === 'ustar') return 'unsupported';
  return null;
}

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
    return [value === '-----BEGIN [A-Z ]*PRIVATE KEY-----' ? 'private-key' : `credential-adjacent-${i + 1}`, new RegExp(source)];
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
    ['generic-assignment', /(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*['"]?\S{8,}/i],
    ['credential-json-key', /"(?:refresh_token|access_token|private_key|client_secret)"\s*:/i],
    ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
    ['google-oauth', /ya29\./],
    ['google-oauth-secret', /GOCSPX-|1\/\/0[A-Za-z0-9_-]{30,}/],
    ['stripe', /[sr]k_live_[A-Za-z0-9]{16,}/],
    ['anthropic', /sk-ant-/],
    ['url-credentials', /:\/\/[^/\s:@]+:[^/\s@]+@/],
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

// Each worker hashes the exact raw bytes it classifies. Decoding is bounded,
// and nested encodings/compressors hold instead of being scanned as raw text.
export async function scanData(data, abs = '', { history = false } = {}) {
  try {
    if (data.length > MAX_SCAN_BYTES) throw new Error('scan-size-limit');
    if (mediaMagic(data)) {
      if (history) return {shapes:['scan-unsupported-encoding']};
      const scan = scanner(); scan.push(data);
      return {shapes:scan.result()};
    }
    const format = compression(data);
    if (format === 'unsupported' || /\.(zip|xz|bz2|7z|tar|tgz|taz|br|lz4|rar)$/i.test(abs)) throw new Error('scan-unsupported-decoder');
    if (/\.(gz|zst)$/i.test(abs) && !format) throw new Error('scan-decompression-error');
    if (format) {
      const decoder = format === 'gz' ? zlib.createGunzip() : zlib.createZstdDecompress();
      const decoded = []; let size = 0;
      for await (const buf of Readable.from([data]).pipe(decoder)) {
        size += buf.length;
        if (size > MAX_SCAN_BYTES) { decoder.destroy(); throw new Error('scan-size-limit'); }
        decoded.push(buf);
      }
      data = Buffer.concat(decoded);
      if (compression(data)) throw new Error('scan-unsupported-decoder');
    }
    const encoded = data.toString('ascii').trim();
    if ((encoded.length >= 32 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) &&
        Buffer.from(encoded,'base64').toString('base64') === encoded) || data.includes(0) || !isUtf8(data)) {
      return {shapes:['scan-unsupported-encoding'],magic:encodingMagic(data)};
    }
    const scan = scanner(); scan.push(data);
    return {shapes:scan.result()};
  } catch (error) {
    const safe = new Set(['scan-size-limit','scan-policy-error','scan-unsupported-decoder']);
    return {shapes:[safe.has(error.message) ? error.message : 'scan-decompression-error']};
  }
}
export async function scanFile(abs) {
  let result, sha256, magic, bytes = 0;
  try {
    if (/\.(zip|xz|bz2|7z|tar|tgz|taz|br|lz4|rar)$/i.test(abs)) throw new Error('scan-unsupported-decoder');
    const chunks = [], hash = createHash('sha256');
    for await (const buf of createReadStream(abs, {highWaterMark: 64 * 1024})) {
      bytes += buf.length;
      hash.update(buf);
      if (bytes > MAX_SCAN_BYTES) throw new Error('scan-size-limit');
      chunks.push(buf);
    }
    sha256 = hash.digest('hex');
    {
      const receipt = await scanData(Buffer.concat(chunks), abs);
      result = receipt.shapes; magic = receipt.magic;
    }
  } catch (error) {
    const safe = new Set(['scan-size-limit', 'scan-unreadable', 'scan-policy-error', 'scan-unsupported-decoder', 'scan-unsupported-encoding']);
    result = [safe.has(error.message) ? error.message : 'scan-decompression-error'];
  }
  return { shapes: result, sha256, bytes, magic };
}
if (process.argv[1] === new URL(import.meta.url).pathname) process.stdout.write(JSON.stringify(await scanFile(process.argv[2])));

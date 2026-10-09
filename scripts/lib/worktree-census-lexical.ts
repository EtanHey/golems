// Lexical JSON only. Schema, relations, digest and census status belong to later layers.
type Diagnostic = 'SIZE' | 'UTF8' | 'BOM' | 'JSON_SYNTAX' |
  'DUPLICATE_KEY' | 'UNICODE_SCALAR' | 'NONFINITE_NUMBER';
type Result = { ok: true; value: unknown } | { ok: false; code: Diagnostic };
type Frame =
  | { kind: 'object'; value: Record<string, unknown>; keys: Set<string>; key: string;
      state: 'keyOrEnd' | 'key' | 'colon' | 'value' | 'commaOrEnd' }
  | { kind: 'array'; value: unknown[]; state: 'valueOrEnd' | 'value' | 'commaOrEnd' };
const failure = (code: Diagnostic): Result => ({ ok: false, code });

/** Decode bounded strict UTF-8 JSON without losing duplicate keys or recursing on containers. */
export function parseCensusJsonBytes(bytes: Uint8Array): Result {
  if (bytes.byteLength > 16_777_216) return failure('SIZE');
  let text: string;
  try {
    // ignoreBOM=true preserves the BOM in the decoded text so it can be rejected.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch { return failure('UTF8'); }
  if (text.charCodeAt(0) === 0xfeff) return failure('BOM');
  let offset = 0, complete = false, root: unknown;
  const stack: Frame[] = [];
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const whitespace = () => {
    while (text[offset] === ' ' || text[offset] === '\t' ||
      text[offset] === '\r' || text[offset] === '\n') offset++;
  };
  const string = (): { value: string } | { code: Diagnostic } => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') { offset++; continue; }
      if (char !== '"') continue;
      let value: string;
      try { value = JSON.parse(text.slice(start, offset)); }
      catch { return { code: 'JSON_SYNTAX' }; }
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = value.charCodeAt(++i);
          if (!(low >= 0xdc00 && low <= 0xdfff)) return { code: 'UNICODE_SCALAR' };
        } else if (code >= 0xdc00 && code <= 0xdfff) return { code: 'UNICODE_SCALAR' };
      }
      return { value };
    }
    return { code: 'JSON_SYNTAX' };
  };
  const accept = (value: unknown, parent: Frame | undefined) => {
    if (!parent) { root = value; complete = true; }
    else {
      if (parent.kind === 'array') parent.value.push(value);
      else Object.defineProperty(parent.value, parent.key,
        { value, writable: true, enumerable: true, configurable: true });
      parent.state = 'commaOrEnd';
    }
  };
  while (true) {
    whitespace();
    const frame = stack[stack.length - 1], char = text[offset];
    if (!frame && complete) {
      return offset === text.length ? { ok: true, value: root } : failure('JSON_SYNTAX');
    }
    if (frame?.kind === 'object' && (frame.state === 'keyOrEnd' || frame.state === 'key')) {
      if (char === '}' && frame.state === 'keyOrEnd') { offset++; stack.pop(); continue; }
      if (char !== '"') return failure('JSON_SYNTAX');
      const key = string();
      if ('code' in key) return failure(key.code);
      if (frame.keys.has(key.value)) return failure('DUPLICATE_KEY');
      frame.keys.add(key.value); frame.key = key.value; frame.state = 'colon';
      continue;
    }
    if (frame?.kind === 'object' && frame.state === 'colon') {
      if (char !== ':') return failure('JSON_SYNTAX');
      offset++; frame.state = 'value'; continue;
    }
    if (frame?.state === 'commaOrEnd') {
      if (char === (frame.kind === 'object' ? '}' : ']')) { offset++; stack.pop(); continue; }
      if (char !== ',') return failure('JSON_SYNTAX');
      offset++; frame.state = frame.kind === 'object' ? 'key' : 'value'; continue;
    }
    if (frame?.kind === 'array' && frame.state === 'valueOrEnd' && char === ']') {
      offset++; stack.pop(); continue;
    }
    if (char === '{') {
      const value = {};
      accept(value, frame); offset++;
      stack.push({ kind: 'object', value, keys: new Set(), key: '', state: 'keyOrEnd' });
    } else if (char === '[') {
      const value: unknown[] = [];
      accept(value, frame); offset++;
      stack.push({ kind: 'array', value, state: 'valueOrEnd' });
    } else if (char === '"') {
      const parsed = string();
      if ('code' in parsed) return failure(parsed.code);
      accept(parsed.value, frame);
    } else if (char === '-' || (char >= '0' && char <= '9')) {
      number.lastIndex = offset;
      const match = number.exec(text);
      if (!match) return failure('JSON_SYNTAX');
      const parsed = Number(match[0]);
      if (!Number.isFinite(parsed)) return failure('NONFINITE_NUMBER');
      offset = number.lastIndex; accept(parsed, frame);
    } else {
      const literal = ['true', 'false', 'null'].find(token => text.startsWith(token, offset));
      if (!literal) return failure('JSON_SYNTAX');
      offset += literal.length;
      accept(literal === 'null' ? null : literal === 'true', frame);
    }
  }
}
